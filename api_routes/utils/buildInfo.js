import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const _projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let _packageJsonVersionCache;
let _buildInfoFileCache;

function getPackageVersion() {
	if (_packageJsonVersionCache !== undefined) return _packageJsonVersionCache;
	try {
		const raw = fs.readFileSync(path.join(_projectRoot, "package.json"), "utf8");
		_packageJsonVersionCache = JSON.parse(raw)?.version || "0";
	} catch {
		_packageJsonVersionCache = "0";
	}
	return _packageJsonVersionCache;
}

function readBuildInfoFile() {
	if (_buildInfoFileCache !== undefined) return _buildInfoFileCache;
	try {
		const raw = fs.readFileSync(path.join(_projectRoot, "public", ".build-info.json"), "utf8");
		const parsed = JSON.parse(raw);
		_buildInfoFileCache =
			parsed && typeof parsed === "object"
				? {
						commit: typeof parsed.commit === "string" ? parsed.commit.trim() : "",
						deployedAt: typeof parsed.deployedAt === "string" ? parsed.deployedAt.trim() : ""
					}
				: null;
	} catch {
		_buildInfoFileCache = null;
	}
	return _buildInfoFileCache;
}

function tryGitHead() {
	try {
		return execSync("git rev-parse HEAD", { cwd: _projectRoot, encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}

function tryDevStampMtimeIso() {
	try {
		const st = fs.statSync(path.join(_projectRoot, "public", ".asset-version-dev"));
		return new Date(st.mtimeMs).toISOString();
	} catch {
		return "";
	}
}

const DEFAULT_GITHUB_REPO = "crosshj/parascene";

function getGitHubRepoSlug() {
	const owner = process.env.VERCEL_GIT_REPO_OWNER?.trim();
	const slug = process.env.VERCEL_GIT_REPO_SLUG?.trim();
	if (owner && slug) return `${owner}/${slug}`;
	try {
		const url = execSync("git remote get-url origin", { cwd: _projectRoot, encoding: "utf8" }).trim();
		const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
		if (match) return `${match[1]}/${match[2]}`;
	} catch {
		// ignore
	}
	return DEFAULT_GITHUB_REPO;
}

function getGitHubCommitUrl(commit) {
	const sha = String(commit || "").trim();
	if (!/^[0-9a-f]{7,40}$/i.test(sha)) return "";
	const repo = getGitHubRepoSlug();
	if (!repo) return "";
	return `https://github.com/${repo}/commit/${sha}`;
}

/**
 * Build metadata for About UI and `<meta name="build-*">` tags.
 */
export function getBuildMetadata() {
	const fromFile = readBuildInfoFile();
	const commit =
		process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
		fromFile?.commit ||
		process.env.BUILD_ID?.trim() ||
		process.env.ASSET_VERSION?.trim() ||
		tryGitHead() ||
		"";
	const deployedAt =
		process.env.BUILD_TIME?.trim() ||
		fromFile?.deployedAt ||
		tryDevStampMtimeIso() ||
		"";
	return {
		commit,
		commitUrl: getGitHubCommitUrl(commit),
		deployedAt,
		version: getPackageVersion()
	};
}
