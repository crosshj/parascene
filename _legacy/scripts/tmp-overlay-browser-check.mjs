/**
 * Temporary overlay smoke test — run: node scripts/tmp-overlay-browser-check.mjs
 * Requires logged-in session OR will report auth blocker.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:2367';
const TIMEOUT = 15000;
const AUTH_STATE = '.overlay-test-auth.json';
const saveAuth = process.argv.includes('--save-auth');

function log(status, msg) {
	console.log(`[${status}] ${msg}`);
}

async function saveAuthFlow() {
	const { chromium } = await import('playwright');
	const browser = await chromium.launch({ headless: false });
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await context.newPage();
	await page.goto(`${BASE}/auth.html?returnUrl=%2Ffeed`, { waitUntil: 'domcontentloaded' });
	log('INFO', 'Log in in the opened browser window. Waiting up to 5 min for /feed …');
	try {
		await page.waitForURL((url) => url.pathname === '/feed' || url.pathname.startsWith('/chat'), {
			timeout: 300000,
		});
	} catch {
		log('BLOCKED', 'Login timed out.');
		await browser.close();
		process.exit(2);
	}
	await context.storageState({ path: AUTH_STATE });
	log('OK', `Saved session to ${AUTH_STATE}`);
	await browser.close();
}

async function waitForOverlay(page) {
	await page.waitForSelector('#prsn-spa-page-overlay', { timeout: TIMEOUT });
	await page.waitForSelector('#prsn-spa-page-overlay iframe', { timeout: TIMEOUT });
}

async function overlayOpen(page) {
	return page.evaluate(() => {
		const el = document.getElementById('prsn-spa-page-overlay');
		return el instanceof HTMLElement && el.isConnected;
	});
}

async function addressBar(page) {
	return page.evaluate(() => window.location.pathname + window.location.search + window.location.hash);
}

async function lanePath(page) {
	return page.evaluate(() => {
		const st = window.history?.state;
		return st?.prsnOverlayReturnPath || st?.prsnOverlayReturnPath === '' ? st.prsnOverlayReturnPath : null;
	});
}

async function main() {
	if (saveAuth) {
		await saveAuthFlow();
		return;
	}

	const { chromium } = await import('playwright');
	const fs = await import('node:fs');
	const hasAuth = fs.existsSync(AUTH_STATE);
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		...(hasAuth ? { storageState: AUTH_STATE } : {}),
	});
	const page = await context.newPage();

	const results = [];

	async function check(name, fn) {
		try {
			await fn();
			results.push({ name, pass: true });
			log('PASS', name);
		} catch (err) {
			results.push({ name, pass: false, error: String(err?.message || err) });
			log('FAIL', `${name}: ${err?.message || err}`);
		}
	}

	// --- Auth gate ---
	await page.goto(`${BASE}/feed`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
	const onAuth = page.url().includes('/auth');
	if (onAuth) {
		log('BLOCKED', 'Not logged in. Run: node scripts/tmp-overlay-browser-check.mjs --save-auth');
		log('INFO', `Current URL: ${page.url()}`);
		await browser.close();
		process.exit(2);
	}

	await check('Feed lane loads', async () => {
		await page.waitForSelector('body', { timeout: TIMEOUT });
		const path = await addressBar(page);
		if (!path.includes('/feed') && !path.includes('/chat')) {
			throw new Error(`Unexpected path: ${path}`);
		}
	});

	const feedLane = await addressBar(page);

	await check('Prompt library opens in overlay', async () => {
		await page.goto(`${BASE}/feed`, { waitUntil: 'domcontentloaded' });
		await page.evaluate(() => {
			return import('/shared/spaPageOverlay.js').then((m) => {
				m.openSpaPageOverlayFromHref('/prompt-library#styles');
			});
		});
		await waitForOverlay(page);
		const bar = await addressBar(page);
		if (!bar.startsWith('/prompt-library')) throw new Error(`Address bar: ${bar}`);
		const frame = page.frameLocator('#prsn-spa-page-overlay iframe');
		await frame.locator('[data-prompt-library-root], .prompt-library-page').first().waitFor({ timeout: TIMEOUT });
	});

	await check('Overlay stack: prompt library → profile (programmatic)', async () => {
		// Find a persona link in iframe if any; else use /user
		const frame = page.frameLocator('#prsn-spa-page-overlay iframe');
		const personaLink = frame.locator('a[href^="/p/"]').first();
		const count = await personaLink.count();
		if (count > 0) {
			await personaLink.click();
		} else {
			await page.evaluate(() =>
				import('/shared/spaPageOverlay.js').then((m) => m.routeSpaPageOverlayFromEmbed('/user'))
			);
		}
		await page.waitForFunction(
			() => {
				const p = window.location.pathname;
				return p === '/user' || /^\/p\//.test(p) || /^\/user\/\d+/.test(p);
			},
			{ timeout: TIMEOUT }
		);
		if (!(await overlayOpen(page))) throw new Error('Overlay closed after profile nav');
	});

	await check('Back shrinks overlay stack', async () => {
		const before = await addressBar(page);
		await page.goBack({ waitUntil: 'domcontentloaded' });
		await page.waitForFunction(
			() => window.location.pathname.startsWith('/prompt-library'),
			{ timeout: TIMEOUT }
		);
		if (!(await overlayOpen(page))) throw new Error('Overlay closed on back');
		const after = await addressBar(page);
		if (after === before) throw new Error(`URL unchanged: ${after}`);
	});

	await check('Escape dismisses overlay to lane', async () => {
		await page.keyboard.press('Escape');
		await page.waitForFunction(() => !document.getElementById('prsn-spa-page-overlay'), { timeout: TIMEOUT });
		const bar = await addressBar(page);
		if (!bar.includes('/feed')) throw new Error(`Expected feed lane, got ${bar}`);
	});

	await check('Direct /p/ URL (no overlay history) is standalone', async () => {
		await page.goto(`${BASE}/p/oceanman`, { waitUntil: 'domcontentloaded' });
		if (await overlayOpen(page)) throw new Error('Overlay open on direct profile URL');
	});

	// Return to feed for link intercept test
	await page.goto(`${BASE}/feed`, { waitUntil: 'networkidle' });

	await check('Feed profile link opens overlay (if card present)', async () => {
		const profileLink = page.locator('a[data-profile-link][href^="/p/"], a[data-profile-link][href^="/user"]').first();
		if ((await profileLink.count()) === 0) {
			log('SKIP', 'No feed profile link visible — empty feed?');
			return;
		}
		await profileLink.click({ timeout: TIMEOUT });
		await waitForOverlay(page);
		await page.keyboard.press('Escape');
		await page.waitForFunction(() => !document.getElementById('prsn-spa-page-overlay'), { timeout: TIMEOUT });
	});

	const passed = results.filter((r) => r.pass).length;
	const failed = results.filter((r) => !r.pass).length;
	console.log('\n--- Summary ---');
	console.log(`Passed: ${passed}, Failed: ${failed}, Lane was: ${feedLane}`);
	await browser.close();
	process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
