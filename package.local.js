// Local-only dev tools for contributors.
// - Not installed on Vercel (not referenced from package.json deps)
// - Run `npm run setup:local` after `npm ci` to install these into node_modules

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const localDevDependencies = {
	'@jest/globals': '^30.2.0',
	jest: '^30.2.0',
	nodemon: '^3.1.11'
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = __dirname;

const entries = Object.entries(localDevDependencies || {});

if (entries.length === 0) {
	console.log('[parascene] package.local.js has no localDevDependencies; nothing to install.');
} else {
	const pkgs = entries.map(([name, version]) => `${name}@${version}`);
	const cmd = ['npm', 'install', '--no-save', '--no-package-lock', ...pkgs].join(' ');

	console.log('[parascene] Installing local-only dev tools from package.local.js...');
	console.log('[parascene] cwd:', repoRoot);
	console.log('[parascene] cmd:', cmd);

	execSync(cmd, {
		cwd: repoRoot,
		stdio: 'inherit'
	});

	console.log('[parascene] Local-only dev tools installed.');
}

