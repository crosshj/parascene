#!/usr/bin/env node
/**
 * Phase 2 helper: CreateComposer.css (loaded from layout) is the shared create-workflow
 * stylesheet. Remove identical rules from CreateView.css and CreationDetailView.css
 * after stripping :where(.create-workflow-root) for comparison.
 *
 * Usage: node scripts/dedupe-create-workflow-css.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VPS = path.resolve(__dirname, "..");
const SCOPE = ":where(.create-workflow-root)";

const COMPOSER = path.join(VPS, "client/components/CreateComposer/CreateComposer.css");
const CREATE = path.join(VPS, "client/views/Create/CreateView.css");
const DETAIL = path.join(VPS, "client/views/CreationDetail/CreationDetailView.css");

function stripScope(selector) {
	return selector
		.split(",")
		.map((part) => {
			let s = part.trim().replace(/\s+/g, " ");
			if (s.startsWith(`${SCOPE} `)) s = s.slice(SCOPE.length + 1).trim();
			else if (s.startsWith(SCOPE)) s = s.slice(SCOPE.length).trim();
			s = s.replace(/^\.create-workflow-root(?=\.|$|\s|:)/, "").trim();
			return s;
		})
		.filter(Boolean)
		.join(", ");
}

function declBody(rule) {
	const decls = [];
	for (const node of rule.nodes || []) {
		if (node.type === "decl") decls.push(`${node.prop}:${node.value}`);
	}
	return decls.sort().join(";");
}

function mediaPath(rule) {
	const parts = [];
	let p = rule.parent;
	while (p) {
		if (p.type === "atrule" && !/keyframes/i.test(p.name)) {
			parts.unshift(`@${p.name} ${p.params}`);
		}
		p = p.parent;
	}
	return parts.join(">>");
}

function ruleKey(rule) {
	if (rule.parent?.type === "atrule" && /keyframes/i.test(rule.parent.name)) return null;
	const body = declBody(rule);
	if (!body) return null;
	const bare = stripScope(rule.selector);
	if (!bare) return null;
	return `${mediaPath(rule)}@@${bare}@@${body}`;
}

function collectKeys(filePath) {
	const root = postcss.parse(fs.readFileSync(filePath, "utf8"), { from: filePath });
	const keys = new Set();
	root.walkRules((rule) => {
		const key = ruleKey(rule);
		if (key) keys.add(key);
	});
	return keys;
}

function pruneFile(filePath, sharedKeys, label) {
	const before = fs.readFileSync(filePath, "utf8");
	const root = postcss.parse(before, { from: filePath });
	let removed = 0;
	let removedBytes = 0;

	const toRemove = [];
	root.walkRules((rule) => {
		const key = ruleKey(rule);
		if (key && sharedKeys.has(key)) toRemove.push(rule);
	});

	for (const rule of toRemove) {
		removedBytes += Buffer.byteLength(rule.toString(), "utf8");
		removed += 1;
		const parent = rule.parent;
		rule.remove();
		// Drop empty @media / @supports wrappers (but never keyframes).
		if (
			parent &&
			parent.type === "atrule" &&
			!/keyframes/i.test(parent.name) &&
			parent.nodes &&
			parent.nodes.length === 0
		) {
			parent.remove();
		}
	}

	// Remove leading empty comments blocks left as noise — keep file header comment if present.
	const next = root.toResult({ annotation: false }).css;
	const header = `/* Shared create-workflow rules live in CreateComposer.css (loaded from layout). ${label} keeps surface-specific overrides only. */\n`;
	const body = next.replace(/^\s*\/\* Shared styles for creations \+ creation detail \*\/\s*/m, "");
	const out = `${header}${body.trimStart()}`;
	fs.writeFileSync(filePath, out.endsWith("\n") ? out : `${out}\n`, "utf8");
	return {
		removed,
		removedBytes,
		beforeBytes: Buffer.byteLength(before, "utf8"),
		afterBytes: Buffer.byteLength(out, "utf8"),
	};
}

const sharedKeys = collectKeys(COMPOSER);
const createStats = pruneFile(CREATE, sharedKeys, "CreateView.css");
const detailStats = pruneFile(DETAIL, sharedKeys, "CreationDetailView.css");

const composerCss = fs.readFileSync(COMPOSER, "utf8");
if (!composerCss.includes("canonical shared create-workflow stylesheet")) {
	const banner =
		"/* Canonical shared create-workflow stylesheet (imported from core/layout.js).\n" +
		"   CreateView.css and CreationDetailView.css keep only surface-specific overrides.\n" +
		"   Re-run: node scripts/dedupe-create-workflow-css.js */\n";
	const rest = composerCss.replace(/^\s*\/\* Shared styles for creations \+ creation detail \*\/\s*/m, "");
	fs.writeFileSync(COMPOSER, `${banner}${rest.trimStart()}`, "utf8");
}

console.log(
	JSON.stringify(
		{
			sharedKeys: sharedKeys.size,
			create: createStats,
			detail: detailStats,
		},
		null,
		2,
	),
);
