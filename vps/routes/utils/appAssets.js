import fs from "node:fs/promises";

export async function getAppAssetNames(buildDir) {
	try {
		const manifest = JSON.parse(await fs.readFile(`${buildDir}/manifest.json`, "utf8"));
		if (manifest?.js && manifest?.css) return manifest;
	} catch {
		// Fall back to development-friendly names before the first build.
	}
	return { js: "app.js", css: "app.css" };
}
