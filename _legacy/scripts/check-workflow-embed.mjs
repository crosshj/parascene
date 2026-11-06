/**
 * Create/mutate are native-mount overlay routes. Forbid full-page reloads in
 * workflow code, and require the SPA overlay to mount them without an iframe.
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
	'public/shared/createWorkflow.js',
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
	/\bisCreateWorkflowNativeHost\s*\(/,
	/\bcreationEditNavigate\b/,
	/\bcreationEditShellOut\b/,
	/\bopenBlogEditorFromCreate\b/,
	/\bshellOut\s*\(/,
	/\bnavigate\s*\(/,
	/\bnavigateFromModal\s*\(/,
];

const OVERLAY_FILES = ['src/shared/spaPageOverlay.js', 'public/shared/spaPageOverlay.js'];

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

for (const rel of OVERLAY_FILES) {
	const abs = path.join(repoRoot, rel);
	if (!fs.existsSync(abs)) {
		violations.push({ file: rel, line: 0, text: 'file missing' });
		continue;
	}
	const source = fs.readFileSync(abs, 'utf8');
	if (!source.includes('function useNativeCreateWorkflow')) {
		violations.push({ file: rel, line: 0, text: 'missing useNativeCreateWorkflow (create/mutate must be native-mount)' });
	}
	if (!source.includes('mountCreateWorkflow')) {
		violations.push({ file: rel, line: 0, text: 'missing mountCreateWorkflow native attach' });
	}
	if (/fetch\(\s*['"`]\/create\?embed=1/.test(source)) {
		violations.push({ file: rel, line: 0, text: 'must not prefetch /create?embed=1 iframe HTML' });
	}
	if (/fetch\(\s*['"`]\/creations\/[^'"`]*mutate\?embed=1/.test(source)) {
		violations.push({ file: rel, line: 0, text: 'must not prefetch mutate?embed=1 iframe HTML' });
	}
}

if (violations.length) {
	console.error('[parascene] workflow embed check failed.\n');
	console.error('Do not use location.reload/href/assign/replace in embed-capable files.');
	console.error('Create/mutate overlay must native-mount, not reload an iframe.\n');
	for (const v of violations) {
		console.error(`  ${v.file}:${v.line}  ${v.text}`);
	}
	process.exit(1);
}

console.log('[parascene] workflow embed check passed.');
