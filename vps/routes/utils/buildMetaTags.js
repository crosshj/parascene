import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const vpsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const isProduction = process.env.NODE_ENV === "production";

function localGitCommit() {
	if (isProduction) return "";
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: vpsDir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"]
		}).trim();
	} catch {
		return "";
	}
}

const defaultCommit = localGitCommit();
const defaultStartedAt = isProduction ? "" : new Date().toISOString();

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export function buildMetaTags(appBuild = "development") {
	const commit = process.env.BUILD_COMMIT || process.env.GIT_COMMIT || defaultCommit;
	const values = {
		"app-version": process.env.APP_VERSION || (isProduction ? "beta" : "development"),
		"build-commit": commit,
		"build-commit-url": process.env.BUILD_COMMIT_URL || (commit ? `https://github.com/crosshj/parascene/commit/${commit}` : ""),
		"build-suffix": process.env.BUILD_SUFFIX || (isProduction ? "" : "-next"),
		"build-deployed-at": process.env.BUILD_DEPLOYED_AT || defaultStartedAt,
		"app-build": appBuild,
		"asset-version": process.env.ASSET_VERSION || commit || "beta"
	};
	return Object.entries(values)
		.map(([name, value]) => `<meta name="${name}" content="${escapeHtml(value)}" />`)
		.join("\n\t\t");
}
