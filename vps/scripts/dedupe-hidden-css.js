#!/usr/bin/env node
/**
 * Remove redundant `[hidden] { display: none }` rules.
 * Canonical util: `client/styles/primitives.css` → `[hidden] { display: none !important; }`
 *
 * Keeps the global `[hidden]` rule and any rule whose body is more than display:none.
 *
 * Usage:
 *   node scripts/dedupe-hidden-css.js           # dry-run
 *   node scripts/dedupe-hidden-css.js --write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, '../client');
const write = process.argv.includes('--write');

/** @param {string} dir @param {(name: string) => boolean} pred */
function walk(dir, pred) {
	/** @type {string[]} */
	const out = [];
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			if (ent.name === 'node_modules' || ent.name === 'build') continue;
			out.push(...walk(full, pred));
		} else if (ent.isFile() && pred(ent.name)) {
			out.push(full);
		}
	}
	return out;
}

/**
 * @param {import('postcss').Rule} rule
 */
function isRedundantHiddenDisplayRule(rule) {
	const selectors = rule.selectors.map((s) => s.trim());
	if (selectors.length === 0) return false;
	for (const sel of selectors) {
		if (/:not\s*\(\s*\[hidden\]\s*\)/i.test(sel)) return false;
		if (!/\[hidden\]/.test(sel)) return false;
		if (sel === '[hidden]') return false;
	}
	const decls = rule.nodes?.filter((n) => n.type === 'decl') ?? [];
	if (decls.length === 0) return false;
	return decls.every(
		(d) => d.type === 'decl' && d.prop === 'display' && /^none$/i.test(d.value.trim()),
	);
}

/**
 * @param {string} css
 * @param {string} from
 */
function stripCss(css, from) {
	const root = postcss.parse(css, { from });
	/** @type {string[]} */
	const removed = [];
	root.walkRules((rule) => {
		if (!isRedundantHiddenDisplayRule(rule)) return;
		removed.push(rule.selector.replace(/\s+/g, ' ').trim());
		rule.remove();
	});
	if (removed.length === 0) return { css, removed };
	return { css: root.toString().replace(/\n{3,}/g, '\n\n'), removed };
}

/**
 * Shadow DOM stylesheets do not see light-DOM primitives.css.
 * Collapse per-selector `[hidden]` rules into one in-shadow util.
 * @param {string} src
 */
function stripJsStyleBlocks(src) {
	const lines = src.split('\n');
	/** @type {string[]} */
	const out = [];
	/** @type {string[]} */
	const removed = [];
	let i = 0;
	let insertUtilAt = -1;
	let utilIndent = '\t\t\t\t';
	while (i < lines.length) {
		const line = lines[i];
		// Multi-line selector lists ending in `{` on a later line.
		if (/\[hidden\]/.test(line) && !/\{/.test(line) && /,\s*$/.test(line)) {
			let j = i;
			/** @type {string[]} */
			const selLines = [];
			while (j < lines.length && !/\{/.test(lines[j])) {
				selLines.push(lines[j]);
				j += 1;
			}
			if (j < lines.length && /^\s*[^\n{]*\[hidden\][^\n{]*\{\s*$/.test(lines[j]) || (j < lines.length && /\[hidden\]/.test(selLines.join(' ')) && /\{\s*$/.test(lines[j]))) {
				const indent = (line.match(/^(\s*)/) || ['', ''])[1];
				const sel = [...selLines, lines[j].replace(/\{\s*$/, '')].join(' ').replace(/\s+/g, ' ').trim();
				if (!/:not\s*\(\s*\[hidden\]\s*\)/i.test(sel) && sel !== '[hidden]') {
					let k = j + 1;
					/** @type {string[]} */
					const body = [];
					while (k < lines.length && !/^\s*\}\s*$/.test(lines[k])) {
						body.push(lines[k]);
						k += 1;
					}
					const onlyDisplayNone =
						body.length > 0 &&
						body.every(
							(b) =>
								/^\s*$/.test(b) ||
								/^\s*display\s*:\s*none(\s*!important)?\s*;?\s*$/i.test(b),
						);
					if (onlyDisplayNone && k < lines.length) {
						removed.push(sel);
						if (insertUtilAt < 0) {
							insertUtilAt = out.length;
							utilIndent = indent;
						}
						i = k + 1;
						if (i < lines.length && /^\s*$/.test(lines[i])) i += 1;
						continue;
					}
				}
			}
		}
		const selMatch = line.match(/^(\s*)([^\n{]*\[hidden\][^\n{]*)\{\s*$/);
		if (selMatch) {
			const indent = selMatch[1];
			const sel = selMatch[2].trim();
			if (!/:not\s*\(\s*\[hidden\]\s*\)/i.test(sel) && sel !== '[hidden]') {
				let j = i + 1;
				/** @type {string[]} */
				const body = [];
				while (j < lines.length && !/^\s*\}\s*$/.test(lines[j])) {
					body.push(lines[j]);
					j += 1;
				}
				const onlyDisplayNone =
					body.length > 0 &&
					body.every(
						(b) =>
							/^\s*$/.test(b) ||
							/^\s*display\s*:\s*none(\s*!important)?\s*;?\s*$/i.test(b),
					);
				if (onlyDisplayNone && j < lines.length) {
					removed.push(sel);
					if (insertUtilAt < 0) {
						insertUtilAt = out.length;
						utilIndent = indent;
					}
					i = j + 1;
					if (i < lines.length && /^\s*$/.test(lines[i])) i += 1;
					continue;
				}
			}
		}
		out.push(line);
		i += 1;
	}
	if (removed.length > 0 && insertUtilAt >= 0 && !/\[hidden\]\s*\{\s*display\s*:\s*none/i.test(out.join('\n'))) {
		out.splice(
			insertUtilAt,
			0,
			`${utilIndent}[hidden] {`,
			`${utilIndent}\tdisplay: none !important;`,
			`${utilIndent}}`,
			'',
		);
		removed.push('(inserted in-shadow [hidden] util)');
	}
	return { src: out.join('\n'), removed };
}

/** @type {{ file: string, removed: string[] }[]} */
const report = [];
let changedFiles = 0;
let removedRules = 0;

for (const file of walk(clientRoot, (n) => n.endsWith('.css'))) {
	const rel = path.relative(path.resolve(__dirname, '..'), file);
	const raw = fs.readFileSync(file, 'utf8');
	if (!raw.includes('[hidden]')) continue;
	const { css, removed } = stripCss(raw, rel);
	if (removed.length === 0) continue;
	report.push({ file: rel, removed });
	changedFiles += 1;
	removedRules += removed.length;
	if (write) fs.writeFileSync(file, css);
}

for (const file of walk(path.join(clientRoot, 'elements/modals'), (n) => n.endsWith('.js'))) {
	const rel = path.relative(path.resolve(__dirname, '..'), file);
	const raw = fs.readFileSync(file, 'utf8');
	if (!/\[hidden\]\s*\{/.test(raw)) continue;
	const { src, removed } = stripJsStyleBlocks(raw);
	if (removed.length === 0) continue;
	report.push({ file: rel, removed });
	changedFiles += 1;
	removedRules += removed.length;
	if (write) fs.writeFileSync(file, src);
}

console.log(write ? 'Wrote changes.' : 'Dry-run (pass --write to apply).');
console.log(`files=${changedFiles} rules=${removedRules}`);
for (const row of report) {
	console.log(`\n${row.file} (${row.removed.length})`);
	for (const sel of row.removed) console.log(`  - ${sel}`);
}
