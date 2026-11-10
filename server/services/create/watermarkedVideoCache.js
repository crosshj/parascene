import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { getBaseAppUrl, getShareBaseUrl } from "./url.js";
import { parseCreationMeta } from "./resolveCreatedImageStorageFilename.js";

const execFileAsync = promisify(execFile);
const CACHE_DIR = path.join(os.tmpdir(), "parascene-watermarked-video-cache");
const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_DURATION_SECONDS = 300;
const MAX_JOBS = 20;
const WATERMARK_SVG = new URL("./watermark.svg", import.meta.url);

export function watermarkedVideoPublicOrigin(appVersion = process.env.APP_VERSION, nodeEnv = process.env.NODE_ENV) {
	if (appVersion === "beta") return "https://beta-sh.parascene.com";
	if (nodeEnv === "production") return getShareBaseUrl();
	return getBaseAppUrl();
}

function publicError(message, status = 400) {
	return Object.assign(new Error(message), { status });
}

async function run(bin, args, timeout) {
	return execFileAsync(bin, args, { timeout, maxBuffer: 1024 * 1024 });
}

async function renderWatermarkedVideo(input, output, logoPath) {
	let probe;
	try {
		const result = await run(process.env.FFPROBE_BIN || "ffprobe", [
			"-v", "error", "-show_streams", "-show_format", "-of", "json", input
		], 30_000);
		probe = JSON.parse(result.stdout || "{}");
	} catch {
		throw publicError("Could not inspect this video");
	}
	const video = probe.streams?.find((stream) => stream.codec_type === "video");
	const duration = Number(probe.format?.duration || video?.duration);
	if (!video || !Number.isFinite(duration) || duration <= 0) throw publicError("Could not inspect this video");
	if (duration > MAX_DURATION_SECONDS) throw publicError("Watermarked video exports support clips up to five minutes");
	const sourceW = Number(video.width);
	const sourceH = Number(video.height);
	if (!(sourceW > 0 && sourceH > 0)) throw publicError("Could not inspect this video");
	const scale = Math.min(1, 1280 / sourceW, 1280 / sourceH);
	const width = Math.max(2, Math.floor(sourceW * scale / 2) * 2);
	const height = Math.max(2, Math.floor(sourceH * scale / 2) * 2);
	const margin = Math.max(10, Math.round(Math.min(width, height) * 0.018));
	const logoWidth = Math.max(24, Math.min(Math.round(Math.min(width, height) * 0.42), Math.round(width * 0.45), width - 2 * margin));
	const logoSvg = (await readFile(WATERMARK_SVG, "utf8"));
	const logo = await sharp(Buffer.from(logoSvg)).resize({ width: logoWidth }).png().toBuffer();
	await writeFile(logoPath, logo);
	try {
		await run(process.env.FFMPEG_BIN || "ffmpeg", [
			"-y", "-v", "error", "-i", input, "-i", logoPath,
			"-filter_complex", `[0:v]scale=${width}:${height},setsar=1[scaled];[scaled][1:v]overlay=W-w-${margin}:H-h-${margin}[out]`,
			"-map", "[out]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "25",
			"-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output
		], 5 * 60_000);
	} catch {
		throw publicError("Could not prepare a watermarked video", 502);
	}
	const result = await stat(output);
	if (!result.size || result.size > MAX_VIDEO_BYTES) throw publicError("Watermarked video exceeds the export size limit", 413);
	return { duration, outputBytes: result.size };
}

export function createWatermarkedVideoCache({ storage, now = () => Date.now(), cacheDir = CACHE_DIR,
	publicOrigin = watermarkedVideoPublicOrigin() }) {
	const jobs = new Map();
	let active = 0;
	let initialized;

	async function init() {
		if (!initialized) initialized = (async () => {
			await mkdir(cacheDir, { recursive: true });
			const names = await readdir(cacheDir);
			await Promise.all(names.map(async (name) => {
				if (!name.startsWith("job-")) return;
				const dir = path.join(cacheDir, name);
				const info = await stat(dir).catch(() => null);
				if (!info?.isDirectory()) return;
				let saved;
				try { saved = JSON.parse(await readFile(path.join(dir, "job.json"), "utf8")); } catch { /* incomplete job */ }
				if (saved?.status === "ready" && typeof saved.id === "string" &&
					Number.isFinite(saved.expiresAt) && saved.expiresAt > now() &&
					Number.isInteger(saved.userId) && Number.isInteger(saved.creationId) &&
					Number.isFinite(saved.duration) && Number.isFinite(saved.outputBytes) &&
					await stat(path.join(dir, "watermarked.mp4")).catch(() => null)) {
					jobs.set(saved.id, { ...saved, dir, path: path.join(dir, "watermarked.mp4"), error: null });
				} else if (saved || now() - info.mtimeMs > TTL_MS) {
					await rm(dir, { recursive: true, force: true });
				}
			}));
		})();
		return initialized;
	}

	async function sweep() {
		for (const [id, job] of jobs) {
			if (job.status === "preparing" || job.expiresAt > now()) continue;
			jobs.delete(id);
			await rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
		}
		const trackedDirs = new Set([...jobs.values()].map((job) => job.dir));
		for (const name of await readdir(cacheDir).catch(() => [])) {
			if (!name.startsWith("job-")) continue;
			const dir = path.join(cacheDir, name);
			if (trackedDirs.has(dir)) continue;
			const info = await stat(dir).catch(() => null);
			if (info?.isDirectory() && now() - info.mtimeMs > TTL_MS) {
				await rm(dir, { recursive: true, force: true }).catch(() => undefined);
			}
		}
	}
	const timer = setInterval(() => void sweep(), 60_000);
	timer.unref?.();

	function videoFilename(image) {
		const meta = parseCreationMeta(image.meta);
		const video = meta?.video;
		if (meta?.media_type !== "video" || !video) throw publicError("Video file missing");
		const filename = typeof video.filename === "string" && video.filename.trim()
			? video.filename.trim()
			: typeof video.file_path === "string" && video.file_path.startsWith("/api/videos/created/")
				? video.file_path.slice("/api/videos/created/".length).split("?")[0]
				: "";
		if (!filename || filename.includes("..")) throw publicError("Video file missing");
		return filename;
	}

	async function prepare({ image, userId }) {
		await init();
		await sweep();
		const filename = videoFilename(image);
		const existing = [...jobs.values()].find((job) => job.userId === Number(userId) && job.creationId === Number(image.id) &&
			(job.status === "preparing" || (job.status === "ready" && job.expiresAt - now() > 30 * 60_000)));
		if (existing) return { id: existing.id, status: existing.status };
		const occupied = [...jobs.values()].filter((job) => job.status !== "failed").length;
		if (active >= 2 || occupied >= MAX_JOBS) throw publicError("Video preparation is busy. Please try again shortly.", 429);
		const id = randomUUID();
		const dir = await mkdtemp(path.join(cacheDir, "job-"));
		const job = { id, userId: Number(userId), creationId: Number(image.id), status: "preparing", dir,
			path: path.join(dir, "watermarked.mp4"), expiresAt: now() + TTL_MS, error: null };
		jobs.set(id, job);
		active++;
		void (async () => {
			try {
				const source = await storage.getVideoBuffer(filename);
				if (!Buffer.isBuffer(source) || !source.length) throw publicError("Video file missing");
				if (source.length > MAX_VIDEO_BYTES) throw publicError("Video exceeds the export size limit", 413);
				const input = path.join(dir, "source");
				await writeFile(input, source);
				const rendered = await renderWatermarkedVideo(input, job.path, path.join(dir, "watermark.png"));
				await rm(input, { force: true });
				await rm(path.join(dir, "watermark.png"), { force: true });
				job.expiresAt = now() + TTL_MS;
				job.duration = rendered.duration;
				job.outputBytes = rendered.outputBytes;
				await writeFile(path.join(dir, "job.json"), JSON.stringify({ id, userId: job.userId,
					creationId: job.creationId, status: "ready", expiresAt: job.expiresAt,
					duration: job.duration, outputBytes: job.outputBytes }));
				job.status = "ready";
			} catch (error) {
				job.status = "failed";
				job.error = error?.message || "Could not prepare this video";
				job.expiresAt = now() + 5 * 60_000;
				await rm(dir, { recursive: true, force: true }).catch(() => undefined);
			} finally {
				active--;
			}
		})();
		return { id, status: job.status };
	}

	function get(id) {
		const job = jobs.get(String(id));
		return job && job.expiresAt > now() ? job : null;
	}

	function preparedUrl(id, userId, creationId) {
		const job = get(id);
		if (!job || job.userId !== Number(userId) || job.creationId !== Number(creationId) || job.status !== "ready") {
			throw publicError("Watermarked video is not ready. Please prepare it again.", 409);
		}
		return `${publicOrigin}/api/share/watermarked-video/${encodeURIComponent(job.id)}`;
	}

	return { init, prepare, get, preparedUrl, sweep };
}
