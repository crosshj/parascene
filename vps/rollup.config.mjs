import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import CleanCSS from "clean-css";
import terser from "@rollup/plugin-terser";

const vpsDir = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(vpsDir, "build");

function emitAppCss() {
	return {
		name: "emit-app-css",
		async buildStart() {
			await fs.rm(buildDir, { recursive: true, force: true });
		},
		async generateBundle() {
			const source = path.join(vpsDir, "src", "app.css");
			const css = await fs.readFile(source, "utf8");
			const minified = new CleanCSS({ level: 1 }).minify(css);
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
	input: path.join(vpsDir, "src", "app.js"),
	output: {
		dir: buildDir,
		format: "es",
		entryFileNames: "app.[hash].js",
		assetFileNames: "app.[hash][extname]"
	},
	plugins: [terser(), emitAppCss()]
};
