/**
 * Writes `public/build/chat.bundle.css` from:
 * - `public/global.css`
 * - `public/pages/chat.css`
 * - optional `src/chat/feed/feedChallengeCard.css` overrides (source-of-truth for chat-only feed card tweaks)
 * - optional `src/chat/doom/DoomCommentsPopover.css` (doom comments sheet)
 * Same logic as the Rollup plugin; runnable standalone (`node scripts/build-chat-bundle-css.mjs`)
 * so dev servers always get a CSS file when Rollup is skipped or partially fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function shouldMinify() {
	const raw = process.env.CHAT_BUNDLE_MINIFY;
	if (raw !== undefined && String(raw).trim() !== '') {
		const e = String(raw).trim().toLowerCase();
		if (e === '0' || e === 'false' || e === 'off' || e === 'no') return false;
		return true;
	}
	try {
		if (fs.existsSync(path.join(repoRoot, '.no-minify-chat-bundle'))) return false;
	} catch {
		// ignore
	}
	return true;
}

export async function buildChatBundleCss() {
	const globalPath = path.join(repoRoot, 'public', 'global.css');
	const chatPath = path.join(repoRoot, 'public', 'pages', 'chat.css');
	const srcFeedCardPath = path.join(repoRoot, 'src', 'chat', 'feed', 'feedChallengeCard.css');
	const doomCommentsPath = path.join(repoRoot, 'src', 'chat', 'doom', 'DoomCommentsPopover.css');
	const outPath = path.join(repoRoot, 'public', 'build', 'chat.bundle.css');
	const globalCss = fs.readFileSync(globalPath, 'utf8');
	const chatCss = fs.readFileSync(chatPath, 'utf8');
	const srcFeedCardCss = fs.existsSync(srcFeedCardPath)
		? fs.readFileSync(srcFeedCardPath, 'utf8')
		: '';
	const doomCommentsCss = fs.existsSync(doomCommentsPath)
		? fs.readFileSync(doomCommentsPath, 'utf8')
		: '';
	const combined = `${globalCss}

/* public/pages/chat.css (after global.css) */
${chatCss}
${srcFeedCardCss ? `\n/* src/chat/feed/feedChallengeCard.css (after chat.css) */\n${srcFeedCardCss}\n` : ''}
${doomCommentsCss ? `\n/* src/chat/doom/DoomCommentsPopover.css */\n${doomCommentsCss}\n` : ''}
`;
	let out = combined;
	if (shouldMinify()) {
		try {
			const { default: CleanCSS } = await import('clean-css');
			const r = new CleanCSS({ level: 1 }).minify(combined);
			if (r.errors?.length) {
				for (const e of r.errors) console.warn('[build-chat-bundle-css]', e);
			}
			if (r.warnings?.length) {
				for (const w of r.warnings) console.warn('[build-chat-bundle-css]', w);
			}
			out = r.styles;
		} catch (err) {
			const code = err && typeof err === 'object' ? err.code : '';
			const missing = code === 'ERR_MODULE_NOT_FOUND' || String(err?.message || '').includes('clean-css');
			if (missing) {
				console.warn(
					'[build-chat-bundle-css] clean-css not installed or failed to load; writing unminified CSS. Run: npm install (devDependency clean-css).'
				);
			} else {
				console.warn('[build-chat-bundle-css] minify failed; writing unminified CSS:', err);
			}
			out = combined;
		}
	}
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, out, 'utf8');
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
	buildChatBundleCss().catch((err) => {
		console.error('[build-chat-bundle-css]', err);
		process.exit(1);
	});
}
