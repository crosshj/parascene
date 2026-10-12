#!/usr/bin/env node
/**
 * Semantic presentation audit across client (and optional pages).
 * Report-only: duplicate CSS classes, property conflicts, JS style taxonomy.
 *
 * Usage:
 *   node scripts/check/css-audit.js
 *   node scripts/check/css-audit.js --json
 *   node scripts/check/css-audit.js --out path/to/report.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";
import postcss from "postcss";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CLIENT_ROOT = path.join(REPO_ROOT, "client");
const PAGES_ROOT = path.join(REPO_ROOT, "pages");

const CREATE_TRIO = [
	"views/Create/CreateView.css",
	"components/CreateComposer/CreateComposer.css",
	"views/CreationDetail/CreationDetailView.css",
];

const STATIC_PROPS = new Set([
	"display",
	"visibility",
	"color",
	"background",
	"backgroundcolor",
	"backgroundimage",
	"opacity",
	"padding",
	"paddingtop",
	"paddingright",
	"paddingbottom",
	"paddingleft",
	"margin",
	"margintop",
	"marginright",
	"marginbottom",
	"marginleft",
	"border",
	"borderradius",
	"bordercolor",
	"borderwidth",
	"borderstyle",
	"boxshadow",
	"font",
	"fontsize",
	"fontweight",
	"fontfamily",
	"textalign",
	"lineheight",
	"letterspacing",
	"whitespace",
	"alignitems",
	"justifycontent",
	"flexdirection",
	"gap",
	"zindex",
	"cursor",
	"pointerevents",
	"overflow",
	"textoverflow",
]);

const GEOMETRY_PROPS = new Set([
	"top",
	"left",
	"right",
	"bottom",
	"width",
	"height",
	"minwidth",
	"minheight",
	"maxwidth",
	"maxheight",
	"transform",
	"position",
]);

const args = new Set(process.argv.slice(2));
const wantJson = args.has("--json");
const outIdx = process.argv.indexOf("--out");
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null;
const includePages = args.has("--pages");

function walkFiles(root, exts, out = []) {
	if (!fs.existsSync(root)) return out;
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "build" || entry.name.startsWith(".")) continue;
		const full = path.join(root, entry.name);
		if (entry.isDirectory()) walkFiles(full, exts, out);
		else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
	}
	return out;
}

function rel(filePath) {
	return path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
}

function camelToKebab(name) {
	return String(name || "")
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/_/g, "-")
		.toLowerCase();
}

function normalizeProp(name) {
	return String(name || "")
		.replace(/-/g, "")
		.toLowerCase();
}

function extractClassesFromSelector(selector) {
	const classes = new Set();
	const re = /\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g;
	let m;
	while ((m = re.exec(selector))) classes.add(m[1]);
	return classes;
}

function parseCssFile(filePath) {
	const css = fs.readFileSync(filePath, "utf8");
	const root = postcss.parse(css, { from: filePath });
	const classes = new Set();
	/** @type {Map<string, Map<string, Set<string>>>} selector -> prop -> values */
	const decls = new Map();

	root.walkRules((rule) => {
		const selectors = rule.selector.split(",").map((s) => s.trim()).filter(Boolean);
		for (const sel of selectors) {
			for (const cls of extractClassesFromSelector(sel)) classes.add(cls);
			if (!decls.has(sel)) decls.set(sel, new Map());
			const propMap = decls.get(sel);
			rule.walkDecls((decl) => {
				const prop = decl.prop.toLowerCase();
				if (!propMap.has(prop)) propMap.set(prop, new Set());
				propMap.get(prop).add(decl.value.trim());
			});
		}
	});

	return { file: rel(filePath), classes, decls };
}

function isLiteralNode(node) {
	if (!node) return false;
	if (node.type === "Literal") return true;
	if (node.type === "TemplateLiteral" && node.expressions.length === 0) return true;
	return false;
}

function literalString(node) {
	if (!node) return null;
	if (node.type === "Literal") return node.value == null ? String(node.value) : String(node.value);
	if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
		return node.quasis.map((q) => q.value.cooked ?? "").join("");
	}
	return null;
}

function classifyStyleProp(prop, valueIsLiteral, literalValue) {
	const p = normalizeProp(prop);
	if (!valueIsLiteral) return "dynamic_ok";
	if (STATIC_PROPS.has(p)) return "static_candidate";
	if (GEOMETRY_PROPS.has(p)) {
		const v = String(literalValue ?? "");
		if (/^\d+(\.\d+)?px$/i.test(v) || v === "0" || v === "none" || v === "absolute" || v === "fixed" || v === "relative") {
			return "static_candidate";
		}
		return "dynamic_ok";
	}
	return valueIsLiteral ? "static_candidate" : "dynamic_ok";
}

function walkAcorn(node, visit) {
	if (!node || typeof node !== "object") return;
	visit(node);
	for (const key of Object.keys(node)) {
		if (key === "start" || key === "end" || key === "loc") continue;
		const child = node[key];
		if (Array.isArray(child)) for (const c of child) walkAcorn(c, visit);
		else if (child && typeof child === "object" && child.type) walkAcorn(child, visit);
	}
}

function extractClassesFromJsString(str, into) {
	if (!str || typeof str !== "string") return;
	const classAttr = /\bclass(?:Name)?\s*=\s*["'`]([^"'`]+)["'`]/g;
	let m;
	while ((m = classAttr.exec(str))) {
		for (const part of m[1].split(/\s+/)) if (part) into.add(part);
	}
	const selectorClass = /\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g;
	while ((m = selectorClass.exec(str))) into.add(m[1]);
	for (const part of str.split(/\s+/)) {
		if (/^[_a-zA-Z][_a-zA-Z0-9-]*$/.test(part) && part.includes("-")) into.add(part);
	}
}

function parseJsFile(filePath) {
	const source = fs.readFileSync(filePath, "utf8");
	const file = rel(filePath);
	const styleHits = [];
	const inlineStyles = [];
	const referencedClasses = new Set();

	let ast;
	try {
		ast = acorn.parse(source, {
			ecmaVersion: "latest",
			sourceType: "module",
			locations: true,
			allowHashBang: true,
		});
	} catch (err) {
		return {
			file,
			parseError: String(err?.message || err),
			styleHits,
			inlineStyles,
			referencedClasses,
		};
	}

	walkAcorn(ast, (node) => {
		// el.style.prop = value
		if (
			node.type === "AssignmentExpression" &&
			node.left?.type === "MemberExpression" &&
			!node.left.computed &&
			node.left.object?.type === "MemberExpression" &&
			!node.left.object.computed &&
			node.left.object.property?.name === "style"
		) {
			const prop = camelToKebab(node.left.property?.name || "");
			const lit = isLiteralNode(node.right);
			const litVal = lit ? literalString(node.right) : null;
			styleHits.push({
				kind: "assignment",
				prop,
				line: node.loc?.start?.line ?? null,
				taxonomy: classifyStyleProp(prop, lit, litVal),
				value: litVal,
			});
		}

		// el.style.setProperty('prop', value)
		if (
			node.type === "CallExpression" &&
			node.callee?.type === "MemberExpression" &&
			!node.callee.computed &&
			node.callee.property?.name === "setProperty" &&
			node.callee.object?.type === "MemberExpression" &&
			!node.callee.object.computed &&
			node.callee.object.property?.name === "style"
		) {
			const propArg = node.arguments[0];
			const valArg = node.arguments[1];
			const prop = camelToKebab(literalString(propArg) || (propArg?.type === "Identifier" ? propArg.name : "unknown"));
			const lit = isLiteralNode(valArg);
			const litVal = lit ? literalString(valArg) : null;
			styleHits.push({
				kind: "setProperty",
				prop,
				line: node.loc?.start?.line ?? null,
				taxonomy: classifyStyleProp(prop, lit, litVal),
				value: litVal,
			});
		}

		// classList.add/remove/toggle('foo')
		if (
			node.type === "CallExpression" &&
			node.callee?.type === "MemberExpression" &&
			!node.callee.computed &&
			["add", "remove", "toggle", "contains", "replace"].includes(node.callee.property?.name) &&
			node.callee.object?.type === "MemberExpression" &&
			!node.callee.object.computed &&
			node.callee.object.property?.name === "classList"
		) {
			for (const arg of node.arguments) {
				const s = literalString(arg);
				if (s) referencedClasses.add(s);
			}
		}

		// querySelector / closest / matches with class selectors
		if (
			node.type === "CallExpression" &&
			node.callee?.type === "MemberExpression" &&
			!node.callee.computed &&
			["querySelector", "querySelectorAll", "closest", "matches"].includes(node.callee.property?.name)
		) {
			const s = literalString(node.arguments[0]);
			if (s) extractClassesFromJsString(s, referencedClasses);
		}

		if (node.type === "Literal" && typeof node.value === "string") {
			if (/\bstyle\s*=\s*["']/i.test(node.value) || /style=["'][^"']*["']/i.test(node.value)) {
				inlineStyles.push({
					line: node.loc?.start?.line ?? null,
					snippet: node.value.slice(0, 120),
				});
			}
			extractClassesFromJsString(node.value, referencedClasses);
		}

		if (node.type === "TemplateLiteral") {
			const cooked = node.quasis.map((q) => q.value.cooked ?? "").join("${…}");
			if (/\bstyle\s*=/i.test(cooked)) {
				inlineStyles.push({
					line: node.loc?.start?.line ?? null,
					snippet: cooked.slice(0, 120),
				});
			}
			for (const q of node.quasis) extractClassesFromJsString(q.value.cooked ?? "", referencedClasses);
		}

		if (
			node.type === "AssignmentExpression" &&
			node.left?.type === "MemberExpression" &&
			!node.left.computed &&
			node.left.property?.name === "className"
		) {
			const s = literalString(node.right);
			if (s) for (const part of s.split(/\s+/)) if (part) referencedClasses.add(part);
		}
	});

	return { file, styleHits, inlineStyles, referencedClasses };
}

function overlapScore(a, b) {
	if (!a.size || !b.size) return { shared: 0, ratio: 0 };
	let shared = 0;
	for (const c of a) if (b.has(c)) shared += 1;
	const denom = Math.min(a.size, b.size);
	return { shared, ratio: denom ? shared / denom : 0 };
}

function buildReport() {
	const cssFiles = walkFiles(CLIENT_ROOT, [".css"]);
	if (includePages) walkFiles(PAGES_ROOT, [".css"], cssFiles);

	const jsFiles = walkFiles(CLIENT_ROOT, [".js"]);
	if (includePages) walkFiles(PAGES_ROOT, [".js", ".html"], jsFiles);

	const cssParsed = cssFiles.map(parseCssFile);
	const jsParsed = jsFiles.filter((f) => f.endsWith(".js")).map(parseJsFile);

	/** @type {Map<string, Set<string>>} */
	const classToFiles = new Map();
	/** selector -> prop -> [{file, value}] */
	const selectorPropValues = new Map();

	for (const sheet of cssParsed) {
		for (const cls of sheet.classes) {
			if (!classToFiles.has(cls)) classToFiles.set(cls, new Set());
			classToFiles.get(cls).add(sheet.file);
		}
		for (const [sel, propMap] of sheet.decls) {
			if (!selectorPropValues.has(sel)) selectorPropValues.set(sel, new Map());
			const globalProp = selectorPropValues.get(sel);
			for (const [prop, values] of propMap) {
				if (!globalProp.has(prop)) globalProp.set(prop, []);
				for (const value of values) {
					globalProp.get(prop).push({ file: sheet.file, value });
				}
			}
		}
	}

	const duplicateClasses = [...classToFiles.entries()]
		.filter(([, files]) => files.size >= 2)
		.map(([name, files]) => ({
			name,
			fileCount: files.size,
			files: [...files].sort(),
		}))
		.sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name));

	const propertyConflicts = [];
	for (const [sel, propMap] of selectorPropValues) {
		for (const [prop, entries] of propMap) {
			const byFile = new Map();
			for (const e of entries) {
				if (!byFile.has(e.file)) byFile.set(e.file, new Set());
				byFile.get(e.file).add(e.value);
			}
			if (byFile.size < 2) continue;
			const allValues = new Set();
			for (const vals of byFile.values()) for (const v of vals) allValues.add(v);
			if (allValues.size < 2) continue;
			propertyConflicts.push({
				selector: sel,
				prop,
				files: [...byFile.entries()].map(([file, values]) => ({
					file,
					values: [...values],
				})),
			});
		}
	}
	propertyConflicts.sort((a, b) => a.selector.localeCompare(b.selector) || a.prop.localeCompare(b.prop));

	const byRel = new Map(cssParsed.map((s) => [s.file.replace(/^client\//, ""), s]));
	const createOverlap = [];
	for (let i = 0; i < CREATE_TRIO.length; i++) {
		for (let j = i + 1; j < CREATE_TRIO.length; j++) {
			const aKey = CREATE_TRIO[i];
			const bKey = CREATE_TRIO[j];
			const a = byRel.get(aKey);
			const b = byRel.get(bKey);
			if (!a || !b) continue;
			const { shared, ratio } = overlapScore(a.classes, b.classes);
			createOverlap.push({
				a: `client/${aKey}`,
				b: `client/${bKey}`,
				shared,
				aCount: a.classes.size,
				bCount: b.classes.size,
				ratio: Number(ratio.toFixed(3)),
			});
		}
	}
	const trioSets = CREATE_TRIO.map((k) => byRel.get(k)?.classes).filter(Boolean);
	let trioShared = 0;
	if (trioSets.length === 3) {
		for (const c of trioSets[0]) {
			if (trioSets[1].has(c) && trioSets[2].has(c)) trioShared += 1;
		}
	}

	const allCssClasses = new Set(classToFiles.keys());
	const allJsClasses = new Set();
	const styleByFile = [];
	const staticByProp = new Map();
	let staticTotal = 0;
	let dynamicTotal = 0;
	let inlineTotal = 0;

	for (const js of jsParsed) {
		for (const c of js.referencedClasses) allJsClasses.add(c);
		const staticHits = js.styleHits.filter((h) => h.taxonomy === "static_candidate");
		const dynamicHits = js.styleHits.filter((h) => h.taxonomy === "dynamic_ok");
		staticTotal += staticHits.length;
		dynamicTotal += dynamicHits.length;
		inlineTotal += js.inlineStyles.length;
		if (staticHits.length || js.inlineStyles.length) {
			styleByFile.push({
				file: js.file,
				staticCandidates: staticHits.length,
				dynamicOk: dynamicHits.length,
				inlineStyles: js.inlineStyles.length,
				topProps: rankProps(staticHits),
				samples: staticHits.slice(0, 8).map((h) => ({
					line: h.line,
					prop: h.prop,
					value: h.value,
					kind: h.kind,
				})),
			});
		}
		for (const h of staticHits) {
			staticByProp.set(h.prop, (staticByProp.get(h.prop) || 0) + 1);
		}
	}
	styleByFile.sort((a, b) => b.staticCandidates - a.staticCandidates || a.file.localeCompare(b.file));

	const undefinedInCss = [...allJsClasses]
		.filter((c) => !allCssClasses.has(c) && looksLikeClassHint(c))
		.sort()
		.slice(0, 80);
	const definedUnused = [...allCssClasses]
		.filter((c) => !allJsClasses.has(c))
		.sort()
		.slice(0, 80);

	return {
		generatedAt: new Date().toISOString(),
		roots: includePages ? ["client", "pages"] : ["client"],
		counts: {
			cssFiles: cssParsed.length,
			jsFiles: jsParsed.length,
			uniqueClasses: allCssClasses.size,
			duplicateClasses: duplicateClasses.length,
			propertyConflicts: propertyConflicts.length,
			staticStyleHits: staticTotal,
			dynamicStyleHits: dynamicTotal,
			inlineStyleAttrs: inlineTotal,
			createTrioSharedClasses: trioShared,
		},
		createOverlap,
		duplicateClasses: duplicateClasses.slice(0, 80),
		propertyConflicts: propertyConflicts.slice(0, 60),
		staticByFile: styleByFile.slice(0, 40),
		staticByProp: [...staticByProp.entries()]
			.map(([prop, count]) => ({ prop, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 30),
		hints: {
			undefinedInCss,
			definedUnusedSample: definedUnused,
		},
	};
}

function looksLikeClassHint(name) {
	if (!name || name.length < 3) return false;
	if (/^[A-Z]/.test(name)) return false;
	if (["true", "false", "null", "undefined", "function", "return", "const", "let", "var"].includes(name)) return false;
	return /[a-z]/.test(name) && (name.includes("-") || name.startsWith("is") || name.startsWith("has"));
}

function rankProps(hits) {
	const map = new Map();
	for (const h of hits) map.set(h.prop, (map.get(h.prop) || 0) + 1);
	return [...map.entries()]
		.map(([prop, count]) => ({ prop, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 6);
}

function printHuman(report) {
	const lines = [];
	lines.push("CSS / presentation audit");
	lines.push(`generated: ${report.generatedAt}`);
	lines.push("");
	lines.push("Counts");
	for (const [k, v] of Object.entries(report.counts)) {
		lines.push(`  ${k}: ${v}`);
	}
	lines.push("");
	lines.push("Create trio class overlap");
	for (const row of report.createOverlap) {
		lines.push(
			`  ${path.basename(row.a)} × ${path.basename(row.b)}: shared=${row.shared} ratio=${row.ratio} (${row.aCount} vs ${row.bCount})`,
		);
	}
	lines.push(`  all three shared: ${report.counts.createTrioSharedClasses}`);
	lines.push("");
	lines.push("Top duplicate classes (by file count)");
	for (const row of report.duplicateClasses.slice(0, 25)) {
		lines.push(`  .${row.name}  files=${row.fileCount}`);
		lines.push(`    ${row.files.slice(0, 5).join(", ")}${row.files.length > 5 ? ", …" : ""}`);
	}
	lines.push("");
	lines.push("Property conflicts (same selector+prop, different values across files)");
	for (const row of report.propertyConflicts.slice(0, 20)) {
		lines.push(`  ${row.selector} { ${row.prop} }`);
		for (const f of row.files.slice(0, 4)) {
			lines.push(`    ${f.file}: ${f.values.join(" | ")}`);
		}
	}
	lines.push("");
	lines.push("JS static_candidate style hits (by file)");
	for (const row of report.staticByFile.slice(0, 20)) {
		lines.push(
			`  ${row.file}: static=${row.staticCandidates} dynamic=${row.dynamicOk} inlineAttr=${row.inlineStyles}`,
		);
		for (const s of row.samples.slice(0, 4)) {
			lines.push(`    L${s.line} ${s.kind} ${s.prop}=${JSON.stringify(s.value)}`);
		}
	}
	lines.push("");
	lines.push("Top static props");
	for (const row of report.staticByProp.slice(0, 15)) {
		lines.push(`  ${row.prop}: ${row.count}`);
	}
	lines.push("");
	lines.push("Hints (noisy): undefined_in_css sample");
	lines.push(`  ${report.hints.undefinedInCss.slice(0, 15).join(", ") || "(none)"}`);
	lines.push("");
	return lines.join("\n");
}

const report = buildReport();

if (outPath) {
	fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
	fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (wantJson && !outPath) {
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else if (!wantJson) {
	process.stdout.write(`${printHuman(report)}\n`);
	if (outPath) process.stdout.write(`\nWrote JSON: ${outPath}\n`);
}

process.exit(0);
