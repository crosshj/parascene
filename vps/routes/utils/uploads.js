import crypto from "node:crypto";
import path from "node:path";
import { Transform } from "node:stream";
import { contentTypeForFile } from "./files.js";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function normalizeOriginalFilename(value) {
	const name = String(value || "").trim();
	if (!name || name.length > 255 || name.includes("/") || name.includes("\\") || /[\0-\x1f\x7f]/.test(name)) {
		return null;
	}
	return name;
}

export function uploadContentType(filename, headerValue) {
	const provided = String(headerValue || "").split(";", 1)[0].trim().toLowerCase();
	if (provided === "application/mp4") return "video/mp4";
	if (provided && provided !== "application/octet-stream" && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(provided)) {
		return provided;
	}
	return contentTypeForFile({ name: filename });
}

export function createFileId(filename, extensionOverride = null) {
	const candidate = path.extname(filename).toLowerCase();
	const override = String(extensionOverride || "").toLowerCase();
	const extension = /^\.[a-z0-9]{1,10}$/.test(override)
		? override
		: /^\.[a-z0-9]{1,10}$/.test(candidate) ? candidate : "";
	const encodedName = Buffer.from(filename, "utf8").toString("base64url").slice(0, 160);
	return `misc_${Date.now()}_${crypto.randomBytes(6).toString("base64url")}_fn_${encodedName}${extension}`;
}

export function createSizeLimitedStream(source, maximumBytes = MAX_UPLOAD_BYTES) {
	let bytesRead = 0;
	let exceeded = false;
	const stream = new Transform({
		transform(chunk, _encoding, callback) {
			bytesRead += chunk.length;
			if (bytesRead > maximumBytes) {
				exceeded = true;
				return callback(new Error("Upload exceeds the file-size limit"));
			}
			return callback(null, chunk);
		}
	});
	source.pipe(stream);
	return {
		stream,
		get bytesRead() { return bytesRead; },
		get exceeded() { return exceeded; }
	};
}
