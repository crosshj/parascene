/**
 * Frontend Rollup builds (expand with more outputs as routes move behind bundles).
 * Chat: src/chat/main.js → public/build/chat.bundle.js (gitignored);
 * also writes public/build/chat.bundle.css (global.css + pages/chat.css, optional minify).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import { buildChatBundleCss } from '../scripts/build-chat-bundle-css.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

/**
 * Safe minify for chat JS (terser) and merged CSS (clean-css level 1). On by default.
 * Local opt-out (either):
 * - `CHAT_BUNDLE_MINIFY=0 npm run build`
 * - `touch .no-minify-chat-bundle` at repo root (gitignored)
 * Force on even with marker file: `CHAT_BUNDLE_MINIFY=1 npm run build`
 */
function shouldMinifyChatBundle() {
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

const minifyChatBundle = shouldMinifyChatBundle();
let loggedSupabaseCircular = false;

/** Dynamic imports like `/shared/api.js${qs}` → `/shared/api.js?v=…` must resolve to disk paths without `?`. */
function stripUrlQueryAndHash(id) {
	if (typeof id !== 'string') return id;
	const norm = id.replace(/\\/g, '/');
	const q = norm.indexOf('?');
	const h = norm.indexOf('#');
	let end = norm.length;
	if (q >= 0) end = Math.min(end, q);
	if (h >= 0) end = Math.min(end, h);
	return end < norm.length ? norm.slice(0, end) : norm;
}

/**
 * Map `/shared/<file>.js` → `src/shared/<file>.js` when the bundle needs different wiring than `public/shared`
 * (relative `./` inside public modules resolves against `/build/chat.bundle.js` → 404).
 */
const CHAT_BUNDLE_SHARED_OVERRIDES = {
	'/shared/autogrow.js': path.join(repoRoot, 'src', 'shared', 'autogrow.js'),
	'/shared/triggeredSuggest.js': path.join(repoRoot, 'src', 'shared', 'triggeredSuggest.js'),
	'/shared/feedCardBuild.js': path.join(repoRoot, 'src', 'shared', 'feedCardBuild.js'),
	'/shared/comments.js': path.join(repoRoot, 'src', 'shared', 'comments.js'),
	'/shared/supabaseBrowser.js': path.join(repoRoot, 'src', 'shared', 'supabaseBrowser.js'),
	'/shared/realtimeBroadcast.js': path.join(repoRoot, 'src', 'shared', 'realtimeBroadcast.js')
};

/** Single `@supabase/supabase-js` graph: `realtimeBroadcast` imports `./supabaseBrowser.js` → must not resolve to `public/` (import-map comment only; Rollup must use `src/shared`). */
function resolveBundledSupabaseBrowser() {
	const srcSb = path.join(repoRoot, 'src', 'shared', 'supabaseBrowser.js');
	return {
		name: 'resolve-bundled-supabase-browser',
		enforce: 'post',
		resolveId(id) {
			if (!id || typeof id !== 'string') return null;
			const norm = id.replace(/\\/g, '/');
			if (norm.endsWith('/public/shared/supabaseBrowser.js')) {
				return srcSb;
			}
			return null;
		}
	};
}

/**
 * Browser code uses root URLs (`/shared/...`) so runtime matches Express `public/`.
 * Without this, Rollup leaves those specifiers as external fetches at runtime instead of bundling them.
 */
function resolvePublicAbsoluteImports() {
	const prefixes = [
		['/shared/', path.join(repoRoot, 'public', 'shared')],
		['/icons/', path.join(repoRoot, 'public', 'icons')],
		['/components/', path.join(repoRoot, 'public', 'components')],
		['/pages/', path.join(repoRoot, 'public', 'pages')]
	];
	return {
		name: 'resolve-public-absolute-imports',
		resolveId(id) {
			if (!id || typeof id !== 'string' || !id.startsWith('/')) return null;
			const clean = stripUrlQueryAndHash(id);
			if (Object.hasOwn(CHAT_BUNDLE_SHARED_OVERRIDES, clean)) {
				return CHAT_BUNDLE_SHARED_OVERRIDES[clean];
			}
			for (const [prefix, absDir] of prefixes) {
				if (clean.startsWith(prefix)) {
					return path.join(absDir, clean.slice(prefix.length));
				}
			}
			return null;
		},
		resolveDynamicImport(specifier) {
			if (typeof specifier !== 'string') return null;
			const clean = stripUrlQueryAndHash(specifier);
			if (Object.hasOwn(CHAT_BUNDLE_SHARED_OVERRIDES, clean)) {
				return CHAT_BUNDLE_SHARED_OVERRIDES[clean];
			}
			for (const [prefix, absDir] of prefixes) {
				if (clean.startsWith(prefix)) {
					return path.join(absDir, clean.slice(prefix.length));
				}
			}
			return null;
		}
	};
}

/** Delegates to `scripts/build-chat-bundle-css.mjs` (also run from nodemon when Rollup is skipped). */
function buildChatCssBundlePlugin() {
	return {
		name: 'build-chat-css-bundle',
		async writeBundle() {
			await buildChatBundleCss();
		}
	};
}

/** Bump dev asset stamp so getAssetVersion() invalidates ?v= after each rebuild. */
function touchDevAssetStampPlugin() {
	return {
		name: 'touch-dev-asset-stamp',
		writeBundle() {
			try {
				const stamp = path.join(repoRoot, 'public', '.asset-version-dev');
				fs.writeFileSync(stamp, String(Date.now()), 'utf8');
			} catch {
				// ignore
			}
		}
	};
}

export default {
	input: path.join(__dirname, 'chat', 'main.js'),
	output: {
		file: path.join(repoRoot, 'public', 'build', 'chat.bundle.js'),
		format: 'es',
		inlineDynamicImports: true,
		sourcemap: true
	},
	plugins: [
		resolvePublicAbsoluteImports(),
		nodeResolve(),
		resolveBundledSupabaseBrowser(),
		...(minifyChatBundle
			? [
				terser({
					ecma: 2022,
					module: true,
					compress: {
						passes: 1,
						unsafe: false,
						unsafe_comps: false,
					},
					format: {
						comments: false,
					},
				}),
			]
			: []),
		buildChatCssBundlePlugin(),
		touchDevAssetStampPlugin(),
	],
	onwarn(warning, warn) {
		// Ignore the known circular dependency inside Supabase WebAuthn helpers.
		if (
			warning.code === 'CIRCULAR_DEPENDENCY' &&
			Array.isArray(warning.ids) &&
			warning.ids.some((id) => id && id.includes('/webauthn'))
		) {
			if (!loggedSupabaseCircular) {
				console.log(
					'[rollup] suppressed circular dep warning for Supabase WebAuthn modules'
				);
				loggedSupabaseCircular = true;
			}
			return;
		}
		warn(warning);
	},
};
