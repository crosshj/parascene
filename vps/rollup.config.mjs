import fs from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import CleanCSS from "clean-css";
import terser from "@rollup/plugin-terser";
import { nodeResolve } from '@rollup/plugin-node-resolve';

const vpsDir = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(vpsDir, "build");
const isProduction = process.env.NODE_ENV === "production";
let loggedSupabaseCircular = false;

function sharedOnWarn(warning, warn) {
	if (
		warning.code === 'CIRCULAR_DEPENDENCY' &&
		Array.isArray(warning.ids) &&
		warning.ids.some((id) => id && id.includes('/webauthn'))
	) {
		if (!loggedSupabaseCircular) {
			console.log('[rollup] suppressed circular dep warning for Supabase WebAuthn modules');
			loggedSupabaseCircular = true;
		}
		return;
	}
	warn(warning);
}

function assertVpsClientBoundary() {
	return {
		name: 'assert-vps-client-boundary',
		buildStart() {
			assertVpsClientBoundaryOnDisk();
		},
		generateBundle() {
			const outside = [...this.getModuleIds()].filter((id) => {
				if (!path.isAbsolute(id) || id.startsWith('\0')) return false;
				const relative = path.relative(vpsDir, id);
				return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
			});
			if (outside.length) {
				throw new Error([
					'VPS browser bundle source must stay inside vps/.',
					'Copy the required implementation into vps/ and update its imports.',
					'Outside source modules:',
					...outside.sort().map((id) => `  - ${id}`),
				].join('\n'));
			}
		},
	};
}

export function assertVpsClientBoundaryOnDisk() {
	const vendorMirror = path.join(vpsDir, 'client', 'vendor');
	if (existsSync(vendorMirror)) {
		const entries = listFiles(vendorMirror).map((entry) => `  - ${path.relative(vpsDir, entry)}`);
		throw new Error([
			'vps/client/vendor is not an allowed migration boundary.',
			'Place each ported WWW module in its owning VPS client directory and update imports to that canonical path.',
			'Do not preserve a mirrored WWW tree or forwarding wrappers.',
			entries.length ? 'Found:' : 'The directory is empty; remove it from the deployment source.',
			...entries,
		].join('\n'));
	}
}

function listFiles(directory) {
	return readdirSync(directory).flatMap((name) => {
		const entry = path.join(directory, name);
		return existsSync(entry) && statSync(entry).isDirectory()
			? listFiles(entry)
			: [entry];
	});
}

function htmlStringImports() {
	return {
		name: "html-string-imports",
		async load(id) {
			if (!id.endsWith(".html")) return null;
			this.addWatchFile(id);
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
			this.addWatchFile(id);
			cssSources.set(id, await fs.readFile(id, "utf8"));
			return "export default {};";
		},
		generateBundle() {
			// File reads finish asynchronously. Emit CSS in module import order,
			// so component overrides always follow their foundational styles.
			const visited = new Set();
			const ordered = [];
			const visit = (id) => {
				if (visited.has(id)) return;
				visited.add(id);
				const info = this.getModuleInfo(id);
				for (const dependency of [...info?.importedIds || [], ...info?.dynamicallyImportedIds || []]) visit(dependency);
				if (cssSources.has(id)) ordered.push(cssSources.get(id));
			};
			for (const id of this.getModuleIds()) if (this.getModuleInfo(id)?.isEntry) visit(id);
			const source = ordered.join("\n\n");
			const minified = new CleanCSS({ level: 1 }).minify(source);
			if (minified.errors.length) throw new Error(minified.errors.join("\n"));
			this.emitFile({ type: "asset", name: "app.css", source: minified.styles });
		},
		async writeBundle(_options, bundle) {
			const entry = Object.values(bundle).find((output) =>
				output.type === "chunk" && output.isEntry &&
				output.facadeModuleId === path.join(vpsDir, "client", "app.js")
			);
			const jsFile = entry?.fileName;
			const cssFile = Object.keys(bundle).find((fileName) => fileName.endsWith(".css"));
			if (!jsFile || !cssFile) throw new Error("Rollup did not produce the app JavaScript and CSS assets");
			const appBuild = createHash("sha256").update(bundle[jsFile].code).digest("hex").slice(0, 12);
			await fs.writeFile(path.join(buildDir, "manifest.json"), JSON.stringify({ js: jsFile, css: cssFile, appBuild }, null, 2) + "\n", "utf8");
		}
	};
}

export default {
	onwarn: sharedOnWarn,
	watch: { clearScreen: false },
	input: path.join(vpsDir, "client", "app.js"),
	output: {
		dir: buildDir,
		format: "es",
		inlineDynamicImports: true,
		sourcemap: !isProduction,
		entryFileNames: "app.[hash].js",
		assetFileNames: "app.[hash][extname]"
	},
	plugins: [
		assertVpsClientBoundary(),
		nodeResolve({ browser: true }),
		htmlStringImports(),
		emitImportedCss(),
		...(isProduction ? [terser()] : []),
	]
};
