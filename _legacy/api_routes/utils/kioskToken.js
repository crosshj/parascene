import crypto from "crypto";

const KIOSK_TOKEN_VERSION = "k1";
/** TV may stay open a long time; reload on 401 refreshes the token. */
const KIOSK_TOKEN_TTL_MS = 1000 * 60 * 60 * 24;

function getKioskTokenSecret() {
	const env = String(process.env.KIOSK_TOKEN_SECRET || process.env.SESSION_SECRET || "").trim();
	return env || "parascene-kiosk-v1";
}

function base64UrlEncode(buf) {
	return Buffer.from(buf)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function base64UrlDecode(value) {
	const s = String(value || "").trim();
	if (!s) return null;
	const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
	try {
		return Buffer.from(padded, "base64");
	} catch {
		return null;
	}
}

function signPayload(payloadB64) {
	return crypto
		.createHmac("sha256", getKioskTokenSecret())
		.update(String(payloadB64))
		.digest("base64url")
		.slice(0, 24);
}

/**
 * @param {{ threadId: number, slug: string, expiresAtMs?: number }} opts
 * @returns {string}
 */
export function mintKioskToken({ threadId, slug, expiresAtMs }) {
	const tid = Number(threadId);
	const s = String(slug || "").trim().toLowerCase();
	if (!Number.isFinite(tid) || tid <= 0 || !s) {
		throw new Error("Invalid kiosk token inputs");
	}
	const exp = Number.isFinite(Number(expiresAtMs))
		? Number(expiresAtMs)
		: Date.now() + KIOSK_TOKEN_TTL_MS;
	const payload = {
		v: KIOSK_TOKEN_VERSION,
		t: tid,
		s,
		e: exp
	};
	const p = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
	const sig = signPayload(p);
	return `${p}.${sig}`;
}

/**
 * @param {string} raw
 * @returns {{ ok: true, threadId: number, slug: string, expiresAtMs: number } | { ok: false, error: string }}
 */
export function verifyKioskToken(raw) {
	const parts = String(raw || "").split(".");
	if (parts.length !== 2) return { ok: false, error: "INVALID_TOKEN" };
	const [p, sig] = parts;
	if (!p || !sig) return { ok: false, error: "INVALID_TOKEN" };

	const expected = signPayload(p);
	const sigBuf = Buffer.from(String(sig), "utf8");
	const expBuf = Buffer.from(String(expected), "utf8");
	if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
		return { ok: false, error: "BAD_SIGNATURE" };
	}

	const payloadBuf = base64UrlDecode(p);
	if (!payloadBuf) return { ok: false, error: "INVALID_PAYLOAD" };
	let payload;
	try {
		payload = JSON.parse(payloadBuf.toString("utf8"));
	} catch {
		return { ok: false, error: "INVALID_PAYLOAD" };
	}
	if (payload?.v !== KIOSK_TOKEN_VERSION) return { ok: false, error: "BAD_VERSION" };
	const threadId = Number(payload?.t);
	const slug = typeof payload?.s === "string" ? payload.s.trim().toLowerCase() : "";
	const expiresAtMs = Number(payload?.e);
	if (!Number.isFinite(threadId) || threadId <= 0) return { ok: false, error: "BAD_THREAD" };
	if (!slug) return { ok: false, error: "BAD_SLUG" };
	if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return { ok: false, error: "BAD_EXP" };
	if (Date.now() > expiresAtMs) return { ok: false, error: "EXPIRED" };
	return { ok: true, threadId, slug, expiresAtMs };
}

export { KIOSK_TOKEN_TTL_MS };
