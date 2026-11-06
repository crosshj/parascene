import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();

/** Load report.css (inlined into HTML output). */
export async function loadReportStyles() {
	if (cache.has("report.css")) return cache.get("report.css");
	const css = await fs.readFile(path.join(DIR, "report.css"), "utf8");
	cache.set("report.css", css);
	return css;
}

/** Full `<style>` element for templates (keeps `{{…}}` out of `<style>` so editors do not flag CSS). */
export async function loadReportStyleBlock() {
	const css = await loadReportStyles();
	return `<style>\n${css}\n</style>`;
}
