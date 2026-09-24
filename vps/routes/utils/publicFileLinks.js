import crypto from "node:crypto";
import { normalizeOriginalFilename } from "./uploads.js";
import { normalizeFileId } from "./files.js";

const TOKEN_CONTEXT = "parascene-public-file-v1";

function signature(payload, filename, secret) {
	return crypto.createHmac("sha256", secret)
		.update(`${TOKEN_CONTEXT}\0${payload}\0${filename}`)
		.digest()
		.subarray(0, 12)
		.toString("base64url");
}

function usableSecret(value) {
	const secret = String(value || "").trim();
	return secret || null;
}

export function createPublicFileToken(userId, fileId, filename, secretValue = process.env.SESSION_SECRET) {
	const ownerId = Number(userId);
	const id = normalizeFileId(fileId);
	const name = normalizeOriginalFilename(filename);
	const secret = usableSecret(secretValue);
	if (!Number.isInteger(ownerId) || ownerId <= 0 || !id || !name || !secret) return null;
	const payload = Buffer.from(`${ownerId}:${id}`).toString("base64url");
	return `${payload}.${signature(payload, name, secret)}`;
}

export function verifyPublicFileToken(tokenValue, filename, secretValue = process.env.SESSION_SECRET) {
	const token = String(tokenValue || "");
	const name = normalizeOriginalFilename(filename);
	const secret = usableSecret(secretValue);
	if (!name || !secret || token.length > 512) return null;
	const parts = token.split(".");
	if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
	const [payload, suppliedSignature] = parts;
	const expected = signature(payload, name, secret);
	const suppliedBytes = Buffer.from(suppliedSignature, "base64url");
	const expectedBytes = Buffer.from(expected, "base64url");
	if (suppliedBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(suppliedBytes, expectedBytes)) return null;
	try {
		const decoded = Buffer.from(payload, "base64url").toString("utf8");
		const separator = decoded.indexOf(":");
		if (separator < 1) return null;
		const userId = Number(decoded.slice(0, separator));
		const fileId = normalizeFileId(decoded.slice(separator + 1));
		if (!Number.isInteger(userId) || userId <= 0 || !fileId) return null;
		return { userId, fileId, filename: name };
	} catch {
		return null;
	}
}
