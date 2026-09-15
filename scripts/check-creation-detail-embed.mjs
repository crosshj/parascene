/**
 * Forbid direct full-page navigation/reload in creation-detail embed-capable code.
 * Use creationDetailRuntime.js (navigate, refreshAfterMutation, navigateFromModal) instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const EMBED_CAPABLE_FILES = [
	'public/pages/creation-detail.js',
	'public/components/modals/publish.js',
	'public/components/modals/tip-creator.js',
];

const FORBIDDEN = [
	/\blocation\.reload\s*\(/,
	/\blocation\.href\s*=/,
	/\blocation\.assign\s*\(/,
	/\blocation\.replace\s*\(/,
];

function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/[^\n]*/g, '');
}

const violations = [];

for (const rel of EMBED_CAPABLE_FILES) {
	const abs = path.join(repoRoot, rel);
	if (!fs.existsSync(abs)) {
		violations.push({ file: rel, line: 0, text: 'file missing' });
		continue;
	}
	const lines = stripComments(fs.readFileSync(abs, 'utf8')).split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		for (const re of FORBIDDEN) {
			if (re.test(line)) {
				violations.push({ file: rel, line: i + 1, text: line.trim() });
				break;
			}
		}
	}
}

if (violations.length) {
	console.error('[parascene] creation-detail embed check failed.\n');
	console.error('Do not use location.reload/href/assign/replace in embed-capable files.');
	console.error('Use public/shared/creationDetailRuntime.js instead.\n');
	for (const v of violations) {
		console.error(`  ${v.file}:${v.line}  ${v.text}`);
	}
	process.exit(1);
}

console.log('[parascene] creation-detail embed check passed.');

/**
 * Modules loaded as `...js${qs}` from creation-detail / overlay. A static
 * `import './sibling.js'` drops the version query and can pair a new parent
 * with a stale child (missing named exports).
 */
const CACHE_BUSTED_SHARED = [
	'public/shared/creationDetailSeed.js',
	'public/shared/creationCard.js',
	'public/shared/routeCardGroupMedia.js',
	'public/shared/userText.js',
	'public/shared/feedCardBuild.js',
	'public/shared/chatInlineImageLightbox.js',
	'public/shared/audioCoverWaveform.js',
	'public/shared/creationGroupMedia.js',
	'public/shared/creationBadges.js',
	'public/shared/spaPageOverlay.js',
	'public/shared/createSubmit.js',
	'public/shared/createComposer.js',
];

const STATIC_SIBLING = /\bfrom\s+['"](?:\.\/|\/shared\/|\/icons\/)/;
const STATIC_SIDE_EFFECT = /\bimport\s+['"](?:\.\/|\/shared\/|\/icons\/)/;

const cacheBustViolations = [];

for (const rel of CACHE_BUSTED_SHARED) {
	const abs = path.join(repoRoot, rel);
	if (!fs.existsSync(abs)) {
		cacheBustViolations.push({ file: rel, line: 0, text: 'file missing' });
		continue;
	}
	const lines = stripComments(fs.readFileSync(abs, 'utf8')).split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (STATIC_SIBLING.test(line) || STATIC_SIDE_EFFECT.test(line)) {
			cacheBustViolations.push({ file: rel, line: i + 1, text: line.trim() });
		}
	}
}

if (cacheBustViolations.length) {
	console.error('[parascene] cache-busted shared import check failed.\n');
	console.error('These files are loaded with an asset-version query.');
	console.error('Import siblings with the same query, not a static `./foo.js`.\n');
	for (const v of cacheBustViolations) {
		console.error(`  ${v.file}:${v.line}  ${v.text}`);
	}
	process.exit(1);
}

console.log('[parascene] cache-busted shared import check passed.');
