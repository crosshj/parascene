import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(repoRoot, "public", ".build-info.json");

function resolveCommit() {
	const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
	if (fromEnv) return fromEnv;
	try {
		return execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}

const payload = {
	commit: resolveCommit(),
	deployedAt: new Date().toISOString()
};

fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log("[stamp-build-info]", payload.commit ? payload.commit.slice(0, 7) : "unknown", payload.deployedAt);
