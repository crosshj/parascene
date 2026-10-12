import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';

const loader = `data:text/javascript,${encodeURIComponent(`
	export async function load(url, context, nextLoad) {
		if (url.endsWith('.css')) return { format: 'module', source: 'export default "";', shortCircuit: true };
		return nextLoad(url, context);
	}
`)}`;
register(loader);

const root = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(root, '..');
const clientRoot = path.join(appRoot, 'client');

function readClient(rel) {
	return fs.readFileSync(path.join(clientRoot, rel), 'utf8');
}

function installDom() {
	const dom = new JSDOM('<!doctype html><html><body></body></html>', {
		url: 'http://localhost/app',
		pretendToBeVisual: true,
	});
	const w = dom.window;
	w.HTMLDialogElement.prototype.showModal = function showModal() {
		this.open = true;
	};
	w.HTMLDialogElement.prototype.close = function close() {
		this.open = false;
		this.dispatchEvent(new w.Event('close'));
	};
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		HTMLElement: globalThis.HTMLElement,
		HTMLButtonElement: globalThis.HTMLButtonElement,
		HTMLDialogElement: globalThis.HTMLDialogElement,
		customElements: globalThis.customElements,
		navigator: globalThis.navigator,
	};
	globalThis.window = w;
	globalThis.document = w.document;
	globalThis.HTMLElement = w.HTMLElement;
	globalThis.HTMLButtonElement = w.HTMLButtonElement;
	globalThis.HTMLDialogElement = w.HTMLDialogElement;
	globalThis.customElements = w.customElements;
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: w.navigator,
	});
	return () => {
		try {
			document.body.replaceChildren();
		} catch {
			// ignore teardown races with custom elements
		}
		globalThis.window = previous.window;
		globalThis.document = previous.document;
		globalThis.HTMLElement = previous.HTMLElement;
		globalThis.HTMLButtonElement = previous.HTMLButtonElement;
		globalThis.HTMLDialogElement = previous.HTMLDialogElement;
		globalThis.customElements = previous.customElements;
		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: previous.navigator,
		});
	};
}

test('share modal optional rows start hidden and toggle via hidden', async () => {
	const restore = installDom();
	try {
		await import('../client/elements/modals/share.js');
		const el = document.createElement('app-modal-share');
		document.body.appendChild(el);
		const vynly = el.querySelector('[data-share-vynly]');
		const google = el.querySelector('[data-share-google-photos]');
		assert.ok(vynly instanceof HTMLButtonElement);
		assert.ok(google instanceof HTMLButtonElement);
		assert.equal(vynly.hidden, true);
		assert.equal(google.hidden, true);
		await el.open(1, {
			vynlyConfigured: true,
			imageExportEligible: false,
		});
		assert.equal(vynly.hidden, false);
		assert.equal(google.hidden, true);
		el.close();
		el.remove();
	} finally {
		restore();
	}
});

test('phase-3c UserProfile feedCardBuild and server modal avoid static show/hide styles', () => {
	const profile = readClient('views/UserProfile/UserProfileView.js');
	assert.doesNotMatch(profile, /\.style\.(display|opacity|cursor|pointerEvents)\s*=/);
	assert.match(profile, /errorBox\.hidden\s*=/);
	assert.match(profile, /data-profile-edit-error\s+hidden/);

	const feed = readClient('shared/feedCardBuild.js');
	assert.doesNotMatch(feed, /\.style\.(display|opacity|visibility)\s*=/);
	assert.match(feed, /is-feed-media-concealed/);
	assert.match(feed, /data-feed-menu\s+hidden/);

	const server = readClient('elements/modals/server.js');
	assert.doesNotMatch(server, /actions\.style\.display/);
	assert.match(server, /provider-capabilities-empty/);
	assert.match(server, /actions\.hidden\s*=/);
});

test('phase-3d Doom lightbox comments picker sentinel avoid static presentation styles', () => {
	const doom = readClient('views/DoomScroll/DoomSlideView.js');
	assert.doesNotMatch(doom, /\.style\.opacity\s*=/);
	assert.match(doom, /is-doom-media-revealed/);
	assert.match(doom, /mediaFrame\.removeAttribute\('style'\)/);

	const park = readClient('shared/doomFeedVideoCache.js');
	assert.doesNotMatch(park, /\.style\.(position|opacity|pointerEvents|left|top|width|height)\s*=/);
	assert.match(park, /is-doom-video-parked/);

	const lightbox = readClient('shared/chatInlineImageLightbox.js');
	assert.doesNotMatch(lightbox, /\.style\.zIndex\s*=/);
	assert.doesNotMatch(lightbox, /\.style\.pointerEvents\s*=/);
	assert.match(lightbox, /is-lightbox-crossfade-front/);

	const comments = readClient('shared/creationCommentsThread.js');
	assert.doesNotMatch(comments, /\.style\.(display|visibility)\s*=/);
	assert.match(comments, /commentsToolbarEl\.hidden\s*=/);
	assert.match(comments, /commentsSection\.hidden\s*=/);

	const picker = readClient('shared/imagePickerModal.js');
	assert.doesNotMatch(picker, /fileInput\.style\./);
	assert.match(picker, /image-file-input/);

	const scroll = readClient('shared/infinite-scroll.js');
	assert.doesNotMatch(scroll, /sentinelEl\.style\./);
	assert.match(scroll, /infinite-scroll-sentinel/);

	const primitives = readClient('styles/primitives.css');
	assert.match(primitives, /\.image-file-input\s*\{/);
	assert.match(primitives, /\.infinite-scroll-sentinel\s*\{/);
	assert.match(primitives, /\.is-doom-video-parked\s*\{/);

	const doomCss = readClient('views/DoomScroll/DoomScrollView.css');
	assert.match(doomCss, /\.is-doom-media-revealed\s*\{/);
});

test('phase-3 AdvancedCreate and feed challenge skeleton avoid static inline styles', () => {
	const advanced = readClient('views/Create/AdvancedCreate.js');
	assert.match(advanced, /data-method-group\s+hidden/);
	assert.match(advanced, /data-fields-group\s+hidden/);
	assert.doesNotMatch(advanced, /methodGroup\.style\.display/);
	assert.doesNotMatch(advanced, /fieldsGroup\.style\.display/);

	const feedChallenge = readClient('views/Feed/feedChannelChallenge.js');
	assert.doesNotMatch(feedChallenge, /shell\.style\.(minHeight|padding|background|border|boxShadow)/);

	const detail = readClient('views/CreationDetail/CreationDetailView.js');
	assert.doesNotMatch(detail, /moreMenu\.style\.display/);
	assert.match(detail, /landscapeGeneratePrompt\.hidden\s*=/);
	assert.doesNotMatch(detail, /\.style\.(display|visibility)\s*=/);
	assert.match(detail, /is-hero-concealed/);
	assert.match(detail, /data-related-container[^>]*\bhidden\b/);
});

test('phase-1 surfaces prefer hidden over inline display toggles', () => {
	const share = readClient('elements/modals/share.js');
	assert.match(share, /data-share-google-photos\s+hidden/);
	assert.match(share, /data-share-vynly\s+hidden/);
	assert.match(share, /\.hidden\s*=/);
	assert.doesNotMatch(share, /style\.display\s*=/);
	assert.doesNotMatch(share, /style="display:\s*none/);

	const publish = readClient('elements/modals/publish.js');
	assert.match(publish, /data-publish-alert\s+hidden/);
	assert.match(publish, /data-doom-full-height-row\s+hidden/);
	assert.match(publish, /alert\.hidden\s*=/);
	assert.doesNotMatch(publish, /style\.display\s*=/);
	assert.doesNotMatch(publish, /cancelLink\.style\.(pointerEvents|opacity)/);

	const details = readClient('elements/modals/creation-details.js');
	assert.match(details, /data-group-context-field\s+hidden/);
	assert.match(details, /data-provider-error-field\s+hidden/);
	assert.doesNotMatch(details, /style\.display\s*=/);

	const notes = readClient('elements/modals/notifications.js');
	assert.match(notes, /data-mark-all-read-footer\s+hidden/);
	assert.match(notes, /footer\.hidden\s*=/);
	assert.doesNotMatch(notes, /footer\.style\.display/);
});

test('phase-3j light-DOM modals use native app-dialog; legacy base.css is gone', () => {
	assert.equal(fs.existsSync(path.join(clientRoot, 'elements/modals/base.css')), false);

	for (const rel of [
		'elements/modals/creation-details.js',
		'elements/modals/tip-creator.js',
		'elements/modals/share.js',
		'elements/modals/publish.js',
	]) {
		const js = readClient(rel);
		assert.match(js, /createModalDismissButton/, rel);
		assert.match(js, /showModal\(/, rel);
		assert.match(js, /app-dialog/, rel);
		assert.doesNotMatch(js, /elements\/modals\/base\.css/, rel);
		assert.doesNotMatch(js, /modal-overlay|publish-modal-overlay/, rel);
	}

	assert.match(readClient('elements/modals/share.js'), /share-qr-dialog/);
	assert.match(readClient('elements/modals/creation-details.css'), /\.creation-details-dialog\[open\]/);
	assert.match(readClient('elements/modals/tip-creator.css'), /\.tip-creator-dialog\[open\]/);
	assert.match(readClient('elements/modals/share.css'), /\.share-dialog\[open\]/);
	assert.match(readClient('elements/modals/publish.css'), /\.publish-dialog\[open\]/);
});

test('triggered suggest route icons and popup open state live in CSS / hidden', () => {
	const js = readClient('shared/triggeredSuggest.js');
	assert.match(js, /triggered-suggest-item-route-icon-wrap/);
	assert.match(js, /popup\.hidden\s*=/);
	assert.doesNotMatch(js, /glyph\.style\.(display|width|height|color)/);
	assert.doesNotMatch(js, /popup\.style\.display\s*=/);

	const css = readClient('components/TriggeredSuggest/TriggeredSuggest.css');
	assert.doesNotMatch(css, /\.triggered-suggest-popup\[hidden\]/);
	assert.match(css, /\.triggered-suggest-item-route-icon-wrap\s*\{/);
	const primitives = readClient('styles/primitives.css');
	assert.match(primitives, /^\[hidden\]\s*\{[^}]*display:\s*none\s*!important/m);
});

test('phase-3i SidebarOverlays credits/notifications use native app-dialog', () => {
	const js = readClient('views/SidebarOverlays/SidebarOverlaysView.js');
	assert.match(js, /createModalDismissButton/);
	assert.match(js, /showModal\(/);
	assert.match(js, /app-dialog/);
	assert.doesNotMatch(js, /modal-overlay/);
	assert.doesNotMatch(js, /elements\/modals\/base\.css/);

	const css = readClient('views/SidebarOverlays/SidebarOverlaysView.css');
	assert.match(css, /\.ps-overlays-dialog\[open\]/);
	assert.doesNotMatch(css, /\.modal-overlay/);

	assert.equal(fs.existsSync(path.join(clientRoot, 'elements/modals/base.css')), false);

	const modalCss = readClient('components/Modal/Modal.css');
	assert.match(modalCss, /\.modal-dismiss\s*\{/);
});

test('phase-3h modal chrome shares --app-modal-* tokens; static detail/notifications styles cleared', () => {
	const modalCss = readClient('components/Modal/Modal.css');
	assert.match(modalCss, /--app-modal-radius/);
	assert.match(modalCss, /--app-modal-backdrop/);
	assert.match(modalCss, /\.app-dialog\s*\{[^}]*var\(--app-modal-radius\)/s);
	assert.doesNotMatch(modalCss, /border-radius:\s*14px/);

	const detail = readClient('views/CreationDetail/CreationDetailView.js');
	assert.doesNotMatch(detail, /style="margin-right:\s*6px/);
	assert.match(detail, /creation-detail-action-strip-pill-icon/);

	const notes = readClient('elements/modals/notifications.js');
	assert.match(notes, /notifications-status-message/);
	assert.doesNotMatch(notes, /style="color:\s*var\(--text-muted\)/);
});

test('phase-3g skeleton helpers use size classes instead of inline styles', () => {
	const skel = readClient('shared/skeleton.js');
	assert.doesNotMatch(skel, /style="/);
	assert.match(skel, /skeleton-circle--/);
	assert.match(skel, /skeleton-pill--w/);
	assert.match(skel, /skeleton-line--w/);

	const primitives = readClient('styles/primitives.css');
	assert.match(primitives, /\.skeleton-circle--36\s*\{/);
	assert.match(primitives, /\.skeleton-pill--w72\s*\{/);
	assert.match(primitives, /\.skeleton-line--title\s*\{/);
	assert.match(primitives, /\.skeleton-fill\s*\{/);

	const detail = readClient('views/CreationDetail/CreationDetailView.js');
	assert.doesNotMatch(detail, /skeleton[^\n]*style="/);
	assert.match(detail, /skeleton-line--title/);
	assert.match(detail, /skeleton-circle--40/);

	const seed = readClient('shared/creationDetailSeed.js');
	assert.doesNotMatch(seed, /skeleton[^\n]*style="/);
	assert.match(seed, /skeleton-fill/);
	assert.match(seed, /skeleton-circle--22/);
});

test('phase-3f buttons use btn-* and Modal.css is global; ps-button is gone', () => {
	assert.equal(fs.existsSync(path.join(clientRoot, 'components/Button/Button.js')), false);
	assert.equal(fs.existsSync(path.join(clientRoot, 'components/Button/Button.css')), false);

	const overlaysJs = readClient('views/SidebarOverlays/SidebarOverlaysView.js');
	assert.match(overlaysJs, /btn-secondary/);
	assert.match(overlaysJs, /btn-outlined/);
	assert.doesNotMatch(overlaysJs, /ps-(outline|secondary)-button/);

	const overlaysCss = readClient('views/SidebarOverlays/SidebarOverlaysView.css');
	assert.doesNotMatch(overlaysCss, /\.ps-(outline|secondary)-button\b/);
	assert.match(overlaysCss, /\.btn-outlined\.is-green/);

	const stylesIndex = readClient('styles/index.js');
	assert.match(stylesIndex, /components\/Modal\/Modal\.css/);
	assert.match(readClient('components/Modal/Modal.css'), /\.app-dialog\s*\{/);
});

test('scoped [hidden] display:none duplicates are collapsed to primitives util', () => {
	const primitives = readClient('styles/primitives.css');
	assert.match(primitives, /^\[hidden\]\s*\{[^}]*display:\s*none\s*!important/m);
	assert.doesNotMatch(primitives, /\.beta-app-overlay__content\s+\[hidden\]/);

	const scopedWrappers = [
		'views/Feed/FeedView.css',
		'views/Explore/ExploreView.css',
		'views/Library/LibraryView.css',
		'components/Modal/Modal.css',
		'components/SearchComposer/SearchComposer.css',
	];
	for (const rel of scopedWrappers) {
		const css = readClient(rel);
		assert.doesNotMatch(
			css,
			/\[hidden\]\s*\{[^}]*display:\s*none/i,
			`${rel} should rely on primitives [hidden]`,
		);
	}

	for (const rel of [
		'elements/modals/account-menu.js',
		'elements/modals/notifications.js',
		'elements/modals/server.js',
		'elements/modals/profile.js',
	]) {
		const js = readClient(rel);
		assert.match(js, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
		assert.doesNotMatch(js, /\.[A-Za-z0-9_-]+\[hidden\]\s*\{/);
	}
});

test('audit:css reports and keeps phase-1 static hits low', () => {
	const outFile = path.join(os.tmpdir(), `css-audit-report-${process.pid}.json`);
	try {
		const run = spawnSync(process.execPath, ['scripts/check/css-audit.js', '--out', outFile], {
			cwd: appRoot,
			encoding: 'utf8',
			maxBuffer: 10 * 1024 * 1024,
		});
		assert.equal(run.status, 0, run.stderr || run.stdout);
		const report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
		assert.ok(report.counts.cssFiles >= 60);
		assert.ok(Array.isArray(report.createOverlap));
		// Phase 2: CreateView/Detail duplicates removed; shared rules live in CreateComposer.css.
		assert.ok(report.counts.createTrioSharedClasses <= 10);

		const byFile = new Map(report.staticByFile.map((row) => [row.file, row]));
		const expectLow = {
			'client/shared/triggeredSuggest.js': 3,
			'client/elements/modals/share.js': 1,
			'client/elements/modals/publish.js': 0,
			'client/elements/modals/creation-details.js': 0,
			'client/elements/modals/notifications.js': 0,
			'client/views/CreationDetail/CreationDetailView.js': 5,
			'client/views/Create/AdvancedCreate.js': 0,
			'client/views/Feed/feedChannelChallenge.js': 0,
			'client/views/UserProfile/UserProfileView.js': 3,
			'client/shared/feedCardBuild.js': 0,
			'client/elements/modals/server.js': 0,
			'client/shared/doomFeedVideoCache.js': 0,
			'client/shared/imagePickerModal.js': 0,
			'client/shared/infinite-scroll.js': 0,
			'client/shared/creationCommentsThread.js': 0,
			'client/shared/chatInlineImageLightbox.js': 0,
			'client/views/DoomScroll/DoomSlideView.js': 0,
		};
		for (const [file, maxStatic] of Object.entries(expectLow)) {
			const row = byFile.get(file);
			const staticCandidates = row?.staticCandidates ?? 0;
			assert.ok(
				staticCandidates <= maxStatic,
				`${file} static_candidate=${staticCandidates} expected <= ${maxStatic}`,
			);
		}
	} finally {
		try {
			fs.unlinkSync(outFile);
		} catch {
			// ignore
		}
	}
});
