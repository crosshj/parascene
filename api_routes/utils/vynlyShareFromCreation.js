import { VynlyApiError } from "./vynlyClient.js";
import { applyVynlyShareWatermark } from "./vynlyShareWatermark.js";

const MAX_BYTES = 4 * 1024 * 1024;
const CAPTION_MAX = 2000;

/**
 * Vynly renders handle + caption with no gap. Prefix a visible space so title doesn’t run into the name.
 * U+00A0 (NBSP) survives trimming/collapse better than a normal ASCII space at the start of the string.
 */
const VYNLY_CAPTION_PREFIX = "\u00a0";

/** @see https://vynly.co/agents — declaredSource allow-list */
const ALLOWED_DECLARED = new Set([
	"grok",
	"gemini",
	"imagen",
	"dalle",
	"chatgpt",
	"gptimage",
	"midjourney",
	"firefly",
	"stablediffusion",
	"flux",
	"ideogram",
	"leonardo",
	"runway",
	"sora",
	"claude",
	"other"
]);

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeDeclaredSource(raw) {
	const s = String(raw || "")
		.trim()
		.toLowerCase();
	if (ALLOWED_DECLARED.has(s)) return s;
	return "other";
}

/**
 * @param {unknown} raw
 * @returns {object | null}
 */
function parseMeta(raw) {
	if (raw == null) return null;
	if (typeof raw === "object") return raw;
	if (typeof raw !== "string") return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/**
 * @param {unknown} metaRaw - row.meta
 * @returns {boolean}
 */
export function creationRowIsVideo(metaRaw) {
	const meta = parseMeta(metaRaw);
	if (!meta || typeof meta !== "object") return false;
	if (meta.video && typeof meta.video === "object") return true;
	const fp = typeof meta.file_path === "string" ? meta.file_path.trim() : "";
	if (fp.startsWith("/api/videos/created/")) return true;
	const vf = typeof meta.video_filename === "string" ? meta.video_filename : "";
	if (vf.startsWith("video/")) return true;
	return false;
}

/**
 * @param {string | null | undefined} filename
 * @returns {string}
 */
function guessContentType(filename) {
	const f = String(filename || "").toLowerCase();
	if (f.endsWith(".webp")) return "image/webp";
	if (f.endsWith(".jpg") || f.endsWith(".jpeg")) return "image/jpeg";
	if (f.endsWith(".png")) return "image/png";
	if (f.endsWith(".gif")) return "image/gif";
	return "image/png";
}

/**
 * @param {object} row - created_images row
 * @param {string} [overrideCaption]
 */
function defaultCaption(row, overrideCaption) {
	if (typeof overrideCaption === "string" && overrideCaption.trim()) {
		const t = overrideCaption.trim();
		return t.length > CAPTION_MAX ? `${t.slice(0, CAPTION_MAX - 1)}…` : t;
	}
	const title = typeof row.title === "string" ? row.title.trim() : "";
	if (title) return title.length > CAPTION_MAX ? `${title.slice(0, CAPTION_MAX - 1)}…` : title;
	const desc = typeof row.description === "string" ? row.description.trim() : "";
	if (desc) return desc.length > CAPTION_MAX ? `${desc.slice(0, CAPTION_MAX - 1)}…` : desc;
	const meta = parseMeta(row.meta) || {};
	const prompt = typeof meta.prompt === "string" ? meta.prompt.trim() : "";
	if (prompt) {
		const base = `From Parascene: ${prompt}`;
		return base.length > CAPTION_MAX ? `${base.slice(0, CAPTION_MAX - 1)}…` : base;
	}
	return "Shared from Parascene #aiart";
}

/**
 * @param {string} body
 * @returns {string}
 */
function captionForVynly(body) {
	const raw = String(body || "").trimEnd();
	const maxBody = CAPTION_MAX - VYNLY_CAPTION_PREFIX.length;
	if (raw.length <= maxBody) {
		return `${VYNLY_CAPTION_PREFIX}${raw}`;
	}
	return `${VYNLY_CAPTION_PREFIX}${raw.slice(0, Math.max(0, maxBody - 1))}…`;
}

/**
 * Resolve creation row with same access rules as POST /api/create/images/:id/share.
 *
 * @param {object} deps
 * @param {object} deps.queries
 * @param {{ id: number, role?: string }} user
 * @param {number} creationId
 */
async function resolveAuthorizedImageRow(deps, user, creationId) {
	const { queries } = deps;
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) {
		return { error: "Invalid creation id", status: 400 };
	}

	let image = await queries.selectCreatedImageById?.get(id, user.id);

	if (!image) {
		const any = await queries.selectCreatedImageByIdAnyUser?.get(id);
		if (!any) {
			return { error: "Image not found", status: 404 };
		}
		const isPublished = any.published === 1 || any.published === true;
		const isAdmin = user.role === "admin";
		if (!isPublished && !isAdmin) {
			return { error: "Image not found", status: 404 };
		}
		image = any;
	}

	const status = image.status || "completed";
	if (status !== "completed") {
		return { error: "Only completed images can be shared", status: 400 };
	}

	if (creationRowIsVideo(image.meta)) {
		return { error: "Video creations cannot be posted to Vynly from Parascene yet", status: 400 };
	}

	if (!image.filename) {
		return { error: "Image file missing", status: 400 };
	}

	return { image };
}

/**
 * @param {object} deps
 * @param {object} deps.queries
 * @param {object} deps.storage
 * @param {{ id: number, role?: string }} deps.user
 * @param {number} deps.creationId
 * @param {{ caption?: string, tags?: string, declaredSource?: string, width?: number, height?: number }} [deps.options]
 * @param {ReturnType<import("./vynlyClient.js").createVynlyClient>} deps.client
 * @param {string} deps.token
 * @returns {Promise<object>}
 */
export async function shareCreationToVynly(deps) {
	const { queries, storage, user, creationId, options = {}, client, token } = deps;

	const resolved = await resolveAuthorizedImageRow({ queries }, user, creationId);
	if (resolved.error) {
		const err = new Error(resolved.error);
		err.status = resolved.status;
		throw err;
	}

	const { image } = resolved;
	const buf = await storage.getImageBuffer(image.filename);
	if (!buf || !Buffer.isBuffer(buf)) {
		const err = new Error("Failed to read image");
		err.status = 500;
		throw err;
	}

	if (buf.length > MAX_BYTES) {
		const err = new Error("Image is too large to post via Parascene (over 4 MB). Try a smaller export.");
		err.status = 413;
		throw err;
	}

	let uploadBuf = buf;
	let uploadContentType = guessContentType(image.filename);
	let uploadFilename =
		typeof image.filename === "string" && image.filename.includes("/")
			? image.filename.split("/").pop()
			: String(image.filename || "image.png");

	try {
		const wm = await applyVynlyShareWatermark(buf);
		if (wm.contentType && wm.filenameSuffix && wm.buffer) {
			uploadBuf = wm.buffer;
			uploadContentType = wm.contentType;
			const stem = String(uploadFilename || "image").replace(/\.[^.]+$/u, "") || "image";
			uploadFilename = `${stem}${wm.filenameSuffix}`;
		}
	} catch (wmErr) {
		if (wmErr && typeof wmErr === "object" && "status" in wmErr && typeof /** @type {{ status: number }} */ (wmErr).status === "number") {
			throw wmErr;
		}
	}

	if (uploadBuf.length > MAX_BYTES) {
		const err = new Error("Image is too large to post via Parascene (over 4 MB). Try a smaller export.");
		err.status = 413;
		throw err;
	}

	const width = Number.isFinite(Number(options.width))
		? Math.max(1, Math.floor(Number(options.width)))
		: Math.max(1, Math.floor(Number(image.width)) || 1024);
	const height = Number.isFinite(Number(options.height))
		? Math.max(1, Math.floor(Number(options.height)))
		: Math.max(1, Math.floor(Number(image.height)) || 1024);

	const caption = captionForVynly(defaultCaption(image, options.caption));
	const tagsRaw = typeof options.tags === "string" ? options.tags.trim() : "";
	const tags = tagsRaw || "parascene,aiart";
	const declaredSource = normalizeDeclaredSource(options.declaredSource);

	try {
		return await client.postImageMultipart(token, {
			buffer: uploadBuf,
			filename: uploadFilename || "image.png",
			contentType: uploadContentType,
			caption,
			tags,
			declaredSource,
			width,
			height
		});
	} catch (e) {
		if (e instanceof VynlyApiError) throw e;
		const err = new Error("Failed to post to Vynly");
		err.status = 502;
		err.cause = e;
		throw err;
	}
}
