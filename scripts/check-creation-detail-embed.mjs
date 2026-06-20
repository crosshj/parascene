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
