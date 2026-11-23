import crypto from "node:crypto";

const KIOSK_TOKEN_VERSION = "k1";
const KIOSK_TOKEN_TTL_MS = 1000 * 60 * 60 * 24;

function secret() {
	return String(process.env.KIOSK_TOKEN_SECRET || process.env.SESSION_SECRET || "").trim() || "parascene-kiosk-v1";
}

function sign(payload) {
	return crypto.createHmac("sha256", secret()).update(String(payload)).digest("base64url").slice(0, 24);
}

export function mintKioskToken({ threadId, slug, expiresAtMs }) {
	const id = Number(threadId);
	const name = String(slug || "").trim().toLowerCase();
	if (!Number.isFinite(id) || id <= 0 || !name) throw new Error("Invalid kiosk token inputs");
	const payload = { v: KIOSK_TOKEN_VERSION, t: id, s: name, e: Number.isFinite(Number(expiresAtMs)) ? Number(expiresAtMs) : Date.now() + KIOSK_TOKEN_TTL_MS };
	const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
	return `${encoded}.${sign(encoded)}`;
}

export function verifyKioskToken(raw) {
	const parts = String(raw || "").split(".");
	if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: "INVALID_TOKEN" };
	const expected = sign(parts[0]);
	const actual = Buffer.from(parts[1], "utf8");
	const wanted = Buffer.from(expected, "utf8");
	if (actual.length !== wanted.length || !crypto.timingSafeEqual(actual, wanted)) return { ok: false, error: "BAD_SIGNATURE" };
	let payload;
	try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return { ok: false, error: "INVALID_PAYLOAD" }; }
	if (payload?.v !== KIOSK_TOKEN_VERSION) return { ok: false, error: "BAD_VERSION" };
	const threadId = Number(payload.t);
	const slug = typeof payload.s === "string" ? payload.s.trim().toLowerCase() : "";
	const expiresAtMs = Number(payload.e);
	if (!Number.isFinite(threadId) || threadId <= 0) return { ok: false, error: "BAD_THREAD" };
	if (!slug) return { ok: false, error: "BAD_SLUG" };
	if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return { ok: false, error: "EXPIRED" };
	return { ok: true, threadId, slug, expiresAtMs };
}
