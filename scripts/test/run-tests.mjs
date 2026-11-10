import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const testRoot = resolve(repoRoot, 'test');
const mode = process.argv[2] || 'unit';
if (!['unit', 'integration'].includes(mode)) {
	console.error(`Unknown test mode: ${mode}`);
	process.exit(2);
}

const suites = readdirSync(testRoot)
	.filter((name) => name.endsWith('.test.js'))
	.filter((name) => mode === 'integration'
		? name.endsWith('.integration.test.js')
		: !name.endsWith('.integration.test.js'))
	.sort()
	.map((name) => resolve(testRoot, name));

if (!suites.length) {
	console.error(`No ${mode} test suites found.`);
	process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...suites], { cwd: repoRoot, stdio: 'inherit' });
process.exit(result.status ?? 1);
