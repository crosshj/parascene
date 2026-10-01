import fs from "node:fs/promises";
import { createHash } from "node:crypto";

export async function getAppAssetNames(buildDir) {
	try {
		const manifest = JSON.parse(await fs.readFile(`${buildDir}/manifest.json`, "utf8"));
		if (manifest?.js && manifest?.css) {
			let appBuild = manifest.appBuild || "";
			if (!appBuild) {
				const js = await fs.readFile(`${buildDir}/${manifest.js}`);
				appBuild = createHash("sha256").update(js).digest("hex").slice(0, 12);
			}
			return { ...manifest, appBuild };
		}
	} catch {
		// Fall back to development-friendly names before the first build.
	}
	return { js: "app.js", css: "app.css", appBuild: "development" };
}
