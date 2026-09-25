import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import CleanCSS from "clean-css";
import terser from "@rollup/plugin-terser";

const vpsDir = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(vpsDir, "build");

function htmlStringImports() {
	return {
		name: "html-string-imports",
		async load(id) {
			if (!id.endsWith(".html")) return null;
			const source = await fs.readFile(id, "utf8");
			return `export default ${JSON.stringify(source)};`;
		}
	};
}

function emitImportedCss() {
	const cssSources = new Map();
	return {
		name: "emit-imported-css",
		buildStart() {
			cssSources.clear();
			return fs.rm(buildDir, { recursive: true, force: true });
		},
		async load(id) {
			if (!id.endsWith(".css")) return null;
			cssSources.set(id, await fs.readFile(id, "utf8"));
			return "export default {};";
		},
		generateBundle() {
			const source = [...cssSources.values()].join("\n\n");
			const minified = new CleanCSS({ level: 1 }).minify(source);
			if (minified.errors.length) throw new Error(minified.errors.join("\n"));
			this.emitFile({ type: "asset", name: "app.css", source: minified.styles });
		},
		async writeBundle(_options, bundle) {
			const jsFile = Object.keys(bundle).find((fileName) => fileName.endsWith(".js"));
			const cssFile = Object.keys(bundle).find((fileName) => fileName.endsWith(".css"));
			if (!jsFile || !cssFile) throw new Error("Rollup did not produce the app JavaScript and CSS assets");
			await fs.writeFile(path.join(buildDir, "manifest.json"), JSON.stringify({ js: jsFile, css: cssFile }, null, 2) + "\n", "utf8");
		}
	};
}

export default {
	input: path.join(vpsDir, "client", "app.js"),
	output: {
		dir: buildDir,
		format: "es",
		entryFileNames: "app.[hash].js",
		assetFileNames: "app.[hash][extname]"
	},
	plugins: [htmlStringImports(), emitImportedCss(), terser()]
};
