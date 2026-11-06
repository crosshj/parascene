import { PARASCENE_BLUE_SERVER_ID } from "../../public/shared/generationDefaults.js";
import { buildProviderHeaders } from "./providerAuth.js";

const MINT_TIMEOUT_MS = 20_000;
const COVER_TIMEOUT_MS = 20_000;
const COVER_MAX_BYTES = 2 * 1024 * 1024;

export const CDN_OBJECT_ID_RE = /^o_[a-f0-9]{24}$/;

export function blueCdnOriginFromServerUrl(serverUrl) {
	const raw = typeof serverUrl === "string" ? serverUrl.trim() : "";
	if (!raw) return null;
	try {
		return new URL(raw).origin;
	} catch {
		return null;
	}
}

export function parseCdnWindowQuery(soRaw, duRaw) {
	const hasSo = soRaw != null && String(soRaw).trim() !== "";
	const hasDu = duRaw != null && String(duRaw).trim() !== "";
	if (!hasSo && !hasDu) return {};
	const so = hasSo ? Number(soRaw) : 0;
	const du = hasDu ? Number(duRaw) : null;
	if (!Number.isFinite(so) || so < 0) {
		const err = new Error("so must be a non-negative number.");
		err.status = 400;
		throw err;
	}
	if (du != null && (!Number.isFinite(du) || !(du > 0))) {
		const err = new Error("du must be a positive number.");
		err.status = 400;
		throw err;
	}
	return du == null ? { so } : { so, du };
}

function cdnError(status, message) {
	const err = new Error(message);
	err.status = status;
	return err;
}

async function readJsonSafe(res) {
	const contentType = String(res.headers.get("content-type") || "").toLowerCase();
	if (!contentType.includes("application/json")) {
		return null;
	}
	try {
		return await res.json();
	} catch {
		return null;
	}
}

export async function loadBlueCdnContext(queries) {
	if (typeof queries?.selectServerById?.get !== "function") {
		throw cdnError(503, "Audio hosting is not configured");
	}
	const server = await queries.selectServerById.get(PARASCENE_BLUE_SERVER_ID);
	const origin = blueCdnOriginFromServerUrl(server?.server_url);
	if (!origin) {
		throw cdnError(503, "Audio hosting is not configured");
	}
	const headers = buildProviderHeaders(
		{ Accept: "application/json", "Content-Type": "application/json" },
		server.auth_token,
		server.server_config?.custom_headers
	);
	return { origin, headers };
}

async function mintJson(ctx, pathname, { method = "POST", body = undefined, okStatuses = [200, 201] } = {}) {
	const url = `${ctx.origin}${pathname}`;
	let res;
	try {
		res = await fetch(url, {
			method,
			headers: ctx.headers,
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			signal: AbortSignal.timeout(MINT_TIMEOUT_MS)
		});
	} catch (err) {
		const wrapped = cdnError(502, "Could not reach audio host");
		wrapped.cause = err;
		throw wrapped;
	}
	const json = await readJsonSafe(res);
	if (!okStatuses.includes(res.status)) {
		const message =
			(typeof json?.error === "string" && json.error.trim()) ||
			(typeof json?.message === "string" && json.message.trim()) ||
			`Audio host returned ${res.status}`;
		throw cdnError(res.status === 401 || res.status === 403 ? 502 : res.status >= 400 && res.status < 500 ? res.status : 502, message);
	}
	return json || {};
}

export async function mintCdnUpload(ctx, { pin, contentType, filename }) {
	const json = await mintJson(ctx, "/cdn/uploads", {
		body: {
			pin: Boolean(pin),
			content_type: contentType,
			filename
		},
		okStatuses: [201, 200]
	});
	const objectId = typeof json.object_id === "string" ? json.object_id.trim() : "";
	const uploadUrl = typeof json.upload_url === "string" ? json.upload_url.trim() : "";
	if (!CDN_OBJECT_ID_RE.test(objectId) || !uploadUrl) {
		throw cdnError(502, "Audio host did not return an upload URL");
	}
	return {
		object_id: objectId,
		upload_url: uploadUrl,
		expires_at: typeof json.expires_at === "string" ? json.expires_at : null
	};
}

export async function mintCdnFetchLink(ctx, objectId, { so, du } = {}) {
	if (!CDN_OBJECT_ID_RE.test(objectId)) {
		throw cdnError(400, "Invalid audio object");
	}
	const body = {};
	if (so != null) body.so = so;
	if (du != null) body.du = du;
	const json = await mintJson(ctx, `/cdn/objects/${encodeURIComponent(objectId)}/links`, {
		body,
		okStatuses: [201, 200]
	});
	const url = typeof json.url === "string" ? json.url.trim() : "";
	if (!url) {
		throw cdnError(502, "Audio host did not return a fetch URL");
	}
	return {
		url,
		expires_at: typeof json.expires_at === "string" ? json.expires_at : null,
		object_id: objectId
	};
}

export async function pinCdnObject(ctx, objectId) {
	if (!CDN_OBJECT_ID_RE.test(objectId)) {
		throw cdnError(400, "Invalid audio object");
	}
	await mintJson(ctx, `/cdn/objects/${encodeURIComponent(objectId)}/pin`, {
		okStatuses: [200]
	});
}

export async function deleteCdnObject(ctx, objectId) {
	if (!CDN_OBJECT_ID_RE.test(objectId)) return false;
	try {
		await mintJson(ctx, `/cdn/objects/${encodeURIComponent(objectId)}`, {
			method: "DELETE",
			okStatuses: [200, 404]
		});
		return true;
	} catch {
		return false;
	}
}

export async function fetchCdnCoverJpeg(fetchUrl) {
	const base = typeof fetchUrl === "string" ? fetchUrl.trim() : "";
	if (!base) return null;
	let coverUrl;
	try {
		const parsed = new URL(base);
		parsed.searchParams.set("cover", "1");
		coverUrl = parsed.toString();
	} catch {
		return null;
	}
	let res;
	try {
		res = await fetch(coverUrl, {
			method: "GET",
			signal: AbortSignal.timeout(COVER_TIMEOUT_MS)
		});
	} catch {
		return null;
	}
	if (!res.ok) return null;
	const contentType = String(res.headers.get("content-type") || "")
		.split(";")[0]
		.trim()
		.toLowerCase();
	if (contentType && contentType !== "image/jpeg" && contentType !== "image/jpg") {
		return null;
	}
	let buf;
	try {
		const ab = await res.arrayBuffer();
		if (ab.byteLength < 32 || ab.byteLength > COVER_MAX_BYTES) return null;
		buf = Buffer.from(ab);
	} catch {
		return null;
	}
	return buf;
}

export async function deleteCdnObjectBestEffort(queries, objectId) {
	if (!CDN_OBJECT_ID_RE.test(String(objectId || ""))) return;
	try {
		const ctx = await loadBlueCdnContext(queries);
		await deleteCdnObject(ctx, objectId);
	} catch {
		// ignore
	}
}
