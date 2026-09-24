import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_BIN || "ffprobe";
const MAX_NORMALIZED_VIDEO_BYTES = 50 * 1024 * 1024;

function mediaError(message, code = "MEDIA_INVALID") {
	const error = new Error(message);
	error.code = code;
	return error;
}

export function isVideoUpload(filename, contentType) {
	if (String(contentType || "").toLowerCase().startsWith("video/")) return true;
	return /\.(?:avi|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm)$/i.test(String(filename || ""));
}

/**
 * Validate and normalize an uploaded video to a browser-streamable MP4.
 * The source filename is deliberately not changed; it remains the user's
 * display name while storage receives the normalized bytes and MIME type.
 */
export async function normalizeUploadedVideo(input) {
	if (!Buffer.isBuffer(input) || input.length === 0) throw mediaError("The video is empty");
	const directory = await mkdtemp(path.join(os.tmpdir(), "parascene-video-"));
	const sourcePath = path.join(directory, "source.bin");
	const outputPath = path.join(directory, "normalized.mp4");
	try {
		await writeFile(sourcePath, input);
		let probe;
		try {
			const result = await execFileAsync(FFPROBE_BIN, [
				"-v", "error", "-show_streams", "-show_format", "-of", "json", sourcePath
			], { maxBuffer: 1024 * 1024, timeout: 120_000 });
			probe = JSON.parse(result.stdout || "{}");
		} catch {
			throw mediaError("The uploaded video could not be inspected");
		}
		if (!Array.isArray(probe?.streams) || !probe.streams.some((stream) => stream?.codec_type === "video")) {
			throw mediaError("The uploaded file does not contain a video stream");
		}
		const formatNames = String(probe?.format?.format_name || "").split(",").map((value) => value.trim().toLowerCase());
		const videoStreams = probe.streams.filter((stream) => stream?.codec_type === "video");
		const audioStreams = probe.streams.filter((stream) => stream?.codec_type === "audio");
		const canRemux =
			(formatNames.includes("mov") || formatNames.includes("mp4")) &&
			videoStreams.length > 0 &&
			videoStreams.every((stream) => String(stream.codec_name || "").toLowerCase() === "h264") &&
			audioStreams.every((stream) => String(stream.codec_name || "").toLowerCase() === "aac");
		try {
			const args = canRemux
				? ["-y", "-v", "error", "-i", sourcePath, "-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-movflags", "+faststart", "-f", "mp4", outputPath]
				: ["-y", "-v", "error", "-i", sourcePath, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-f", "mp4", outputPath];
			await execFileAsync(FFMPEG_BIN, args, { maxBuffer: 2 * 1024 * 1024, timeout: 300_000 });
		} catch {
			if (!canRemux) throw mediaError("The uploaded video could not be normalized");
			try {
				await execFileAsync(FFMPEG_BIN, [
					"-y", "-v", "error", "-i", sourcePath,
					"-map", "0:v:0", "-map", "0:a?",
					"-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
					"-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
					"-f", "mp4", outputPath
				], { maxBuffer: 2 * 1024 * 1024, timeout: 300_000 });
			} catch {
				throw mediaError("The uploaded video could not be normalized");
			}
		}
		const normalized = await readFile(outputPath);
		if (!normalized.length) throw mediaError("The normalized video is empty");
		if (normalized.length > MAX_NORMALIZED_VIDEO_BYTES) throw mediaError("The normalized video is too large", "MEDIA_TOO_LARGE");
		return { buffer: normalized, contentType: "video/mp4" };
	} finally {
		await rm(directory, { recursive: true, force: true }).catch(() => undefined);
	}
}
