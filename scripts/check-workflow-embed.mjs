/**
 * Forbid direct full-page navigation/reload in workflow embed-capable code.
 * Use creationDetailRuntime.js, creationEditRuntime.js, or createPageRuntime.js instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const EMBED_CAPABLE_FILES = [
	'public/pages/creation-detail.js',
	'public/components/modals/publish.js',
	'public/components/modals/tip-creator.js',
	'public/pages/creation-edit.js',
	'public/pages/entry/entry-create.js',
	'public/components/routes/create.js',
];

const FORBIDDEN = [
	/\blocation\.reload\s*\(/,
	/\blocation\.href\s*=/,
	/\blocation\.assign\s*\(/,
	/\blocation\.replace\s*\(/,
];

const ALLOWED_LINE_PATTERNS = [
	/\bisCreationEditEmbed\s*\(/,
	/\bisCreatePageEmbed\s*\(/,
	/\bisCreatePageEmbedMode\s*\(/,
	/\bisStandaloneCreatePagePath\s*\(/,
	/\bcreationEditNavigate\b/,
	/\bcreationEditShellOut\b/,
	/\bopenBlogEditorFromCreate\b/,
	/\bshellOut\s*\(/,
	/\bnavigate\s*\(/,
	/\bnavigateFromModal\s*\(/,
];

function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/[^\n]*/g, '');
}

function isAllowedLine(line) {
	return ALLOWED_LINE_PATTERNS.some((re) => re.test(line));
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
			if (re.test(line) && !isAllowedLine(line)) {
				violations.push({ file: rel, line: i + 1, text: line.trim() });
				break;
			}
		}
	}
}

if (violations.length) {
	console.error('[parascene] workflow embed check failed.\n');
	console.error('Do not use location.reload/href/assign/replace in embed-capable files.');
	console.error('Use embed runtime modules instead.\n');
	for (const v of violations) {
		console.error(`  ${v.file}:${v.line}  ${v.text}`);
	}
	process.exit(1);
}

console.log('[parascene] workflow embed check passed.');
