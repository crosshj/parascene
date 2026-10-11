const DEFAULT_BASE = "https://vynly.co";

export class VynlyApiError extends Error {
	/**
	 * @param {string} message
	 * @param {number} status
	 * @param {string} [bodySnippet]
	 */
	constructor(message, status, bodySnippet = "") {
		super(message);
		this.name = "VynlyApiError";
		this.status = status;
		this.bodySnippet = bodySnippet;
	}
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
function normalizeBaseUrl(baseUrl) {
	const s = String(baseUrl || "").trim() || DEFAULT_BASE;
	try {
		const u = new URL(s);
		return u.origin;
	} catch {
		return DEFAULT_BASE;
	}
}

/**
 * @param {Response} res
 * @returns {Promise<never>}
 */
async function throwIfNotOk(res) {
	if (res.ok) return;
	const text = await res.text().catch(() => "");
	const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
	throw new VynlyApiError(`Vynly API ${res.status}`, res.status, snippet);
}

/**
 * @param {object} opts
 * @param {string} [opts.baseUrl] - Tests only; production always uses https://vynly.co
 * @param {typeof fetch} [opts.fetchImpl]
 */
function resolveBaseUrl(opts) {
	if (opts.baseUrl != null && String(opts.baseUrl).trim()) {
		return normalizeBaseUrl(String(opts.baseUrl).trim());
	}
	return DEFAULT_BASE;
}

export function createVynlyClient(opts = {}) {
	const baseUrl = resolveBaseUrl(opts);
	const fetchImpl = opts.fetchImpl ?? fetch;

	/**
	 * @param {string} token
	 * @param {string} pathWithQuery
	 * @param {RequestInit} [init]
	 */
	async function authorizedFetch(token, pathWithQuery, init = {}) {
		const url = `${baseUrl}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`;
		const headers = new Headers(init.headers || {});
		headers.set("Authorization", `Bearer ${token}`);
		const res = await fetchImpl(url, { ...init, headers });
		await throwIfNotOk(res);
		const ct = res.headers.get("content-type") || "";
		if (ct.includes("application/json")) {
			return await res.json();
		}
		return await res.text();
	}

	return {
		baseUrl,

		/**
		 * @param {string} token
		 * @param {{ before?: string | number, limit?: string | number }} [query]
		 */
		async getPosts(token, query = {}) {
			const sp = new URLSearchParams();
			if (query.before != null && String(query.before).trim()) {
				sp.set("before", String(query.before).trim());
			}
			if (query.limit != null && String(query.limit).trim()) {
				sp.set("limit", String(query.limit).trim());
			}
			const q = sp.toString();
			return await authorizedFetch(token, `/api/posts${q ? `?${q}` : ""}`, { method: "GET" });
		},

		/**
		 * @param {string} token
		 */
		async getSparks(token) {
			return await authorizedFetch(token, "/api/sparks", { method: "GET" });
		},

		/**
		 * @param {string} token
		 * @param {string} q
		 * @param {Record<string, string>} [extraQuery]
		 */
		async getSearch(token, q, extraQuery = {}) {
			const sp = new URLSearchParams();
			sp.set("q", String(q || ""));
			for (const [k, v] of Object.entries(extraQuery)) {
				if (v != null && String(v).trim()) sp.set(k, String(v));
			}
			return await authorizedFetch(token, `/api/search?${sp.toString()}`, { method: "GET" });
		},

		/**
		 * @param {string} token
		 * @param {unknown} body - JSON-serializable
		 */
		async postSpark(token, body) {
			return await authorizedFetch(token, "/api/sparks", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body ?? {})
			});
		},

		/**
		 * @param {string} token
		 * @param {unknown} body - JSON body per Vynly (blobUrl, contentType, caption, …)
		 */
		async postImageJson(token, body) {
			return await authorizedFetch(token, "/api/posts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body ?? {})
			});
		},

		/**
		 * @param {string} token
		 * @param {{
		 *   buffer: Buffer,
		 *   filename: string,
		 *   contentType: string,
		 *   caption: string,
		 *   tags?: string,
		 *   declaredSource: string,
		 *   width: number,
		 *   height: number
		 * }} fields
		 */
		async postImageMultipart(token, fields) {
			const fd = new FormData();
			const blob = new Blob([fields.buffer], { type: fields.contentType || "image/png" });
			fd.append("image", blob, fields.filename || "image.png");
			fd.append("caption", fields.caption || "");
			if (fields.tags != null) fd.append("tags", String(fields.tags));
			fd.append("declaredSource", fields.declaredSource || "other");
			fd.append("width", String(fields.width));
			fd.append("height", String(fields.height));

			const url = `${baseUrl}/api/posts`;
			const res = await fetchImpl(url, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: fd
			});
			await throwIfNotOk(res);
			return await res.json();
		}
	};
}
