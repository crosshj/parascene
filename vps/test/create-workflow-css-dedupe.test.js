import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const root = path.dirname(fileURLToPath(import.meta.url));
const vpsRoot = path.resolve(root, '..');
const clientRoot = path.join(vpsRoot, 'client');

test('layout loads CreateComposer.css as the shared create-workflow sheet', () => {
	const layout = fs.readFileSync(path.join(clientRoot, 'core/layout.js'), 'utf8');
	const shared = fs.readFileSync(path.join(clientRoot, 'components/CreateComposer/CreateComposer.css'), 'utf8');
	assert.match(layout, /CreateComposer\/CreateComposer\.css/);
	assert.match(shared, /canonical shared create-workflow stylesheet/i);
});

test('CreateView and CreationDetail stay thin overrides after dedupe', () => {
	const createBytes = fs.statSync(path.join(clientRoot, 'views/Create/CreateView.css')).size;
	const detailBytes = fs.statSync(path.join(clientRoot, 'views/CreationDetail/CreationDetailView.css')).size;
	const sharedBytes = fs.statSync(path.join(clientRoot, 'components/CreateComposer/CreateComposer.css')).size;
	assert.ok(createBytes < 40_000, `CreateView.css too large: ${createBytes}`);
	assert.ok(detailBytes < 50_000, `CreationDetailView.css too large: ${detailBytes}`);
	assert.ok(sharedBytes > 100_000, `CreateComposer.css unexpectedly small: ${sharedBytes}`);
});

test('audit create-trio shared class count stays low', () => {
	const outFile = path.join(os.tmpdir(), `css-audit-dedupe-${process.pid}.json`);
	try {
		const run = spawnSync(process.execPath, ['scripts/css-audit.js', '--out', outFile], {
			cwd: vpsRoot,
			encoding: 'utf8',
			maxBuffer: 10 * 1024 * 1024,
		});
		assert.equal(run.status, 0, run.stderr || run.stdout);
		const report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
		assert.ok(report.counts.createTrioSharedClasses <= 10);
		const createComposer = report.createOverlap.find(
			(row) => row.a.includes('CreateView') && row.b.includes('CreateComposer'),
		);
		assert.ok(createComposer);
		assert.ok(createComposer.shared < 50);
	} finally {
		try {
			fs.unlinkSync(outFile);
		} catch {
			// ignore
		}
	}
});
