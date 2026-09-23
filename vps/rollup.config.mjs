import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import CleanCSS from "clean-css";
import terser from "@rollup/plugin-terser";

const vpsDir = path.dirname(fileURLToPath(import.meta.url));

function emitAppCss() {
	return {
		name: "emit-app-css",
		async writeBundle() {
			const source = path.join(vpsDir, "src", "app.css");
			const destination = path.join(vpsDir, "build", "app.css");
			await fs.mkdir(path.dirname(destination), { recursive: true });
			const css = await fs.readFile(source, "utf8");
			const minified = new CleanCSS({ level: 1 }).minify(css);
			if (minified.errors.length) throw new Error(minified.errors.join("\n"));
			await fs.writeFile(destination, minified.styles, "utf8");
		}
	};
}

export default {
	input: path.join(vpsDir, "src", "app.js"),
	output: {
		file: path.join(vpsDir, "build", "app.js"),
		format: "es"
	},
	plugins: [terser(), emitAppCss()]
};
