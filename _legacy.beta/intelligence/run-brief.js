#!/usr/bin/env node
/**
 * Parascene intelligence v0 — compress recent activity into a paste-ready LLM brief.
 *
 * Usage:
 *   node intelligence/run-brief.js
 *   node intelligence/run-brief.js --days 7
 *   node intelligence/run-brief.js --days 14 --output .output/intelligence/custom.md
 */

import fs from 'fs/promises';
import path from 'path';
import { REPO_ROOT } from '../scripts/repo-root.cjs';
import { loadCreations, countsForRow } from './lib/load.js';
import { normalizeCreation } from './lib/normalize.js';
import { computeAttention } from './lib/attention.js';
import { extractTextSignals } from './lib/text-signals.js';
import { splitByWindow, buildAnalysis } from './lib/analyze.js';
import { renderBrief } from './lib/render-brief.js';

const DEFAULT_DAYS = 7;
const OUTPUT_DIR = path.join(REPO_ROOT, '.output', 'intelligence');

/**
 * @param {number} days
 * @param {Date} windowStart
 * @param {Date} windowEnd
 */
function defaultOutputPath(days, windowStart, windowEnd) {
	const from = windowStart.toISOString().slice(0, 10);
	const to = windowEnd.toISOString().slice(0, 10);
	return path.join(OUTPUT_DIR, `parascene-brief-${days}d-${from}_${to}.md`);
}

function printUsage() {
	console.log(`Parascene intelligence brief (v0)

Usage:
  node intelligence/run-brief.js [options]

Options:
  --days <n>        Analysis window in days (default: ${DEFAULT_DAYS})
  --output <path>   Output markdown path (default: auto from days + window dates)
  --help            Show this help

Default output: .output/intelligence/parascene-brief-<days>d-<from>_<to>.md
`);
}

function parseArgs(argv) {
	/** @type {{ days: number, output: string|null, help: boolean }} */
	const opts = {
		days: DEFAULT_DAYS,
		output: null,
		help: false
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') {
			opts.help = true;
			continue;
		}
		if (arg === '--days') {
			const n = Number(argv[++i]);
			if (!Number.isFinite(n) || n < 1) throw new Error('Invalid --days');
			opts.days = Math.floor(n);
			continue;
		}
		if (arg === '--output') {
			opts.output = String(argv[++i] ?? '').trim();
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return opts;
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printUsage();
		return;
	}

	const windowEnd = new Date();
	const windowStart = new Date(windowEnd.getTime() - opts.days * 24 * 60 * 60 * 1000);

	const { rows, likeCounts, commentCounts, shareCounts, remixCounts } = await loadCreations();

	const attention = { computeAttention };
	const signals = { extractTextSignals };

	const creations = rows.map((row) => {
		const counts = countsForRow(row, likeCounts, commentCounts, shareCounts, remixCounts);
		return normalizeCreation(row, counts, attention, signals);
	});

	const { pastWeek, historical } = splitByWindow(creations, windowStart, windowEnd);
	console.log(
		`[intelligence] Window: ${opts.days}d · past week ${pastWeek.length} · historical ${historical.length}`
	);

	const analysis = buildAnalysis(pastWeek, historical);
	const markdown = renderBrief(analysis, {
		windowStart,
		windowEnd,
		days: opts.days,
		generatedAt: new Date()
	});

	const outPath = opts.output
		? path.isAbsolute(opts.output)
			? opts.output
			: path.join(REPO_ROOT, opts.output)
		: defaultOutputPath(opts.days, windowStart, windowEnd);
	await fs.mkdir(path.dirname(outPath), { recursive: true });
	await fs.writeFile(outPath, markdown, 'utf8');
	console.log(`[intelligence] Wrote ${outPath}`);
}

main().catch((err) => {
	console.error(err.message || err);
	process.exitCode = 1;
});
