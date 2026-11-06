/**
 * Fail fast when Rollup devDependencies are missing (common after clone or `npm ci --omit=dev`).
 * Used by `npm run build` (prebuild) and nodemon before rebuilding the chat bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = path.join(repoRoot, 'node_modules', '@rollup', 'plugin-node-resolve', 'package.json');

if (!fs.existsSync(marker)) {
	console.error(
		'[parascene] Rollup devDependencies are missing or incomplete (expected @rollup/plugin-node-resolve).\n' +
			'From the repository root run:\n' +
			'  npm install\n' +
			'If dependencies were installed without dev packages, run:\n' +
			'  npm install --include=dev'
	);
	process.exit(1);
}
