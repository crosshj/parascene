import express from "express";
import Busboy from "busboy";
import sharp from "sharp";

function normalizePersonalityTag(input) {
	const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
	if (!raw) return null;
	if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(raw)) return null;
	return raw;
}

function canPromotePersona(user) {
	if (!user) return false;
	if (user.role === "admin") return true;
	const plan = user.meta?.plan ?? "free";
	return plan === "founder";
}

function isAdminUser(user) {
	return Boolean(user && user.role === "admin");
}

const STYLE_SLUG_RE = /^(?=.*[a-z])[a-z0-9][a-z0-9_-]{0,63}$/;

function slugToDisplayTitle(slug) {
	const s = String(slug ?? "").trim();
	if (!s) return "";
	const parts = s.split(/[_-]+/).filter(Boolean);
	if (parts.length === 0) return s;
	return parts.map((p) => (p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())).join(" ");
}

function buildPersonaInjectionText(tag) {
	return `When @${tag} is mentioned, treat this as the recurring community character associated with that handle across parascene creations. Keep the visual identity consistent with prior images that reference @${tag}.`;
}

function buildPersonaDescription(tag) {
	return `Promoted from personality discovery. Use @${tag} in prompts to reference this persona.`;
}

function isUniqueViolation(err) {
	if (!err) return false;
	if (err.code === "23505") return true;
	const msg = String(err.message || "");
	return msg.includes("UNIQUE constraint") || msg.includes("duplicate key");
}

function buildGenericUrl(key) {
	const segments = String(key || "")
		.split("/")
		.filter(Boolean)
		.map((seg) => encodeURIComponent(seg));
	return `/api/images/generic/${segments.join("/")}`;
}

function extractGenericKey(url) {
	const raw = typeof url === "string" ? url.trim() : "";
	if (!raw) return null;
	if (!raw.startsWith("/api/images/generic/")) return null;
	const tail = raw.slice("/api/images/generic/".length);
	if (!tail) return null;
	const segments = tail.split("/").filter(Boolean).map((seg) => {
		try {
			return decodeURIComponent(seg);
		} catch {
			return seg;
		}
	});
	return segments.join("/");
}

/** Parse numeric creation id from pasted link, path, or plain digits. */
function parseCreationIdFromLink(raw) {
	const s = String(raw ?? "").trim();
	if (!s) return null;
	const onlyDigits = /^\d+$/.exec(s);
	if (onlyDigits) {
		const n = parseInt(onlyDigits[0], 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	}
	try {
		const u = new URL(s, "https://www.parascene.com");
		const m = u.pathname.match(/\/creations\/(\d+)/);
		if (m) {
			const n = parseInt(m[1], 10);
			return Number.isFinite(n) && n > 0 ? n : null;
		}
	} catch {
		// ignore
	}
	const m2 = s.match(/\/creations\/(\d+)/);
	if (m2) {
		const n = parseInt(m2[1], 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	}
	return null;
}

function parseInjectionMeta(raw) {
	if (raw == null) return {};
	if (typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
	if (typeof raw !== "string" || !raw.trim()) return {};
	try {
		const o = JSON.parse(raw);
		return o && typeof o === "object" && !Array.isArray(o) ? { ...o } : {};
	} catch {
		return {};
	}
}

function parseMultipartPersonaCatalog(req) {
	return new Promise((resolve, reject) => {
		const busboy = Busboy({
			headers: req.headers,
			limits: {
				fileSize: 4 * 1024 * 1024,
				files: 1,
				fields: 32
			}
		});
		const fields = {};
		const files = {};
		busboy.on("field", (name, value) => {
			fields[name] = value;
		});
		busboy.on("file", (name, file, info) => {
			const chunks = [];
			let total = 0;
			file.on("data", (data) => {
				total += data.length;
				chunks.push(data);
			});
			file.on("limit", () => {
				const err = new Error("File too large");
				err.code = "FILE_TOO_LARGE";
				reject(err);
			});
			file.on("end", () => {
				if (total === 0) return;
				files[name] = {
					filename: info?.filename || "",
					mimeType: info?.mimeType || "application/octet-stream",
					buffer: Buffer.concat(chunks)
				};
			});
		});
		busboy.on("error", (e) => reject(e));
		busboy.on("finish", () => resolve({ fields, files }));
		req.pipe(busboy);
	});
}

/**
 * GET /api/prompt-injections — all injections the user may see in the prompt library (single payload; client filters by tag_type).
 * Auth required.
 */
export default function createPromptInjectionsRoutes({ queries, storage }) {
	const router = express.Router();

	router.get("/api/prompt-injections", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const fn = queries.selectPromptInjectionsForLibrary?.all;
			if (typeof fn !== "function") {
				return res.status(501).json({ error: "Prompt library is not available" });
			}
			const items = await fn(req.auth.userId);
			const user = await queries.selectUserById.get(req.auth.userId);
			const canAddStyle = canPromotePersona(user);
			res.set("Cache-Control", "private, max-age=30");
			return res.json({
				items: Array.isArray(items) ? items : [],
				canAddStyle
			});
		} catch (err) {
			console.error("[prompt-injections]", err);
			return res.status(500).json({ error: "Failed to load prompt library" });
		}
	});

	/**
	 * GET /api/styles/new — whether the user may create a global catalog style (admin or founder).
	 * Registered before GET /api/styles/:slug so "new" is not captured as :slug.
	 */
	router.get("/api/styles/new", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const user = await queries.selectUserById.get(req.auth.userId);
			res.set("Cache-Control", "private, no-store");
			return res.json({ canCreate: Boolean(user && canPromotePersona(user)) });
		} catch (err) {
			console.error("[styles new]", err);
			return res.status(500).json({ error: "Failed to load" });
		}
	});

	/**
	 * POST /api/styles — create global catalog style (admin or founder). Body: tag, injection_text, title?, description?, visibility? public|unlisted
	 */
	router.post("/api/styles", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const user = await queries.selectUserById.get(req.auth.userId);
			if (!canPromotePersona(user)) {
				return res.status(403).json({ error: "Forbidden" });
			}
			const body = req.body && typeof req.body === "object" ? req.body : {};
			const tag = String(body.tag ?? "").trim().toLowerCase();
			if (tag === "new") {
				return res.status(400).json({ error: 'The tag "new" is reserved' });
			}
			if (!STYLE_SLUG_RE.test(tag)) {
				return res.status(400).json({ error: "Invalid style tag" });
			}
			const injectionText = String(body.injection_text ?? "").trim();
			if (!injectionText) {
				return res.status(400).json({ error: "Prompt modifiers are required" });
			}
			const titleRaw = body.title != null ? String(body.title).trim() : "";
			const descRaw = body.description != null ? String(body.description).trim() : "";
			const vis = String(body.visibility ?? "public").trim().toLowerCase();
			if (vis !== "public" && vis !== "unlisted") {
				return res.status(400).json({ error: "Visibility must be public or unlisted" });
			}
			const fn = queries.insertGlobalStylePromptInjection?.run;
			if (typeof fn !== "function") {
				return res.status(501).json({ error: "Styles are not available" });
			}
			try {
				const result = await fn(tag, injectionText, titleRaw || null, descRaw || null, vis);
				const n = Number(result?.changes ?? 0);
				if (!Number.isFinite(n) || n < 1) {
					return res.status(500).json({ error: "Could not save style" });
				}
			} catch (e) {
				if (isUniqueViolation(e)) {
					return res.status(409).json({ error: "A style with this tag already exists" });
				}
				throw e;
			}
			return res.status(201).json({ ok: true, tag });
		} catch (err) {
			console.error("[styles create]", err);
			return res.status(500).json({ error: "Failed to create style" });
		}
	});

	/**
	 * GET /api/styles/:slug — one style row visible to the user (library rules).
	 * Used by /styles/:slug detail page.
	 */
	router.get("/api/styles/:slug", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const raw = String(req.params?.slug ?? "").trim();
			const slug = raw.toLowerCase();
			if (!STYLE_SLUG_RE.test(slug)) {
				return res.status(400).json({ error: "Invalid style slug" });
			}
			const fn = queries.selectPromptInjectionStyleBySlugForUser?.get;
			if (typeof fn !== "function") {
				return res.status(501).json({ error: "Styles are not available" });
			}
			const row = await fn(req.auth.userId, slug);
			if (!row) {
				return res.status(404).json({ error: "Style not found" });
			}
			const user = await queries.selectUserById.get(req.auth.userId);
			const rowMeta = parseInjectionMeta(row.meta);
			let styleThumbUrl =
				typeof rowMeta.style_thumb_url === "string" ? rowMeta.style_thumb_url.trim() : "";
			if (!styleThumbUrl) {
				const gFn = queries.selectGlobalStylePromptInjectionByTag?.get;
				if (typeof gFn === "function") {
					const globalRow = await gFn(slug);
					const gm = parseInjectionMeta(globalRow?.meta);
					styleThumbUrl =
						typeof gm.style_thumb_url === "string" ? gm.style_thumb_url.trim() : "";
				}
			}
			res.set("Cache-Control", "private, max-age=60");
			return res.json({
				style: {
					tag: row.tag,
					title: row.title ?? null,
					description: row.description ?? null,
					visibility: row.visibility ?? null,
					injection_text: typeof row.injection_text === "string" ? row.injection_text : null,
					style_thumb_url: styleThumbUrl || null
				},
				adminCanDelete: isAdminUser(user),
				canSetStyleThumb: canPromotePersona(user)
			});
		} catch (err) {
			console.error("[styles]", err);
			return res.status(500).json({ error: "Failed to load style" });
		}
	});

	/**
	 * PATCH /api/styles/:slug — admin/founder: set catalog style image from a published creation link, or clear.
	 * Body: { creation_link?: string, clear_thumb?: boolean }
	 */
	router.patch("/api/styles/:slug", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const user = await queries.selectUserById.get(req.auth.userId);
			if (!canPromotePersona(user)) {
				return res.status(403).json({ error: "Forbidden" });
			}
			if (!storage?.uploadGenericImage || typeof storage.getImageBuffer !== "function") {
				return res.status(501).json({ error: "Style images are not available" });
			}
			const raw = String(req.params?.slug ?? "").trim();
			const slug = raw.toLowerCase();
			if (!STYLE_SLUG_RE.test(slug)) {
				return res.status(400).json({ error: "Invalid style slug" });
			}
			const fnGetGlobal = queries.selectGlobalStylePromptInjectionByTag?.get;
			const fnUpdateMeta = queries.updateGlobalStyleCatalogMetaByTag?.run;
			if (typeof fnGetGlobal !== "function" || typeof fnUpdateMeta !== "function") {
				return res.status(501).json({ error: "Styles are not available" });
			}
			const globalRow = await fnGetGlobal(slug);
			if (!globalRow) {
				return res.status(404).json({ error: "Catalog style not found" });
			}

			const body = req.body && typeof req.body === "object" ? req.body : {};
			const clearThumb = body.clear_thumb === true;
			const linkRaw = typeof body.creation_link === "string" ? body.creation_link.trim() : "";

			const meta = parseInjectionMeta(globalRow.meta);
			const oldThumbUrl = typeof meta.style_thumb_url === "string" ? meta.style_thumb_url.trim() : "";
			const oldKey = extractGenericKey(oldThumbUrl);
			const pendingDeletes = [];

			if (clearThumb) {
				await fnUpdateMeta(slug, { style_thumb_url: null });
				if (oldKey && storage.deleteGenericImage) {
					pendingDeletes.push(oldKey);
				}
				if (storage.deleteGenericImage && pendingDeletes.length > 0) {
					for (const key of pendingDeletes) {
						try {
							await storage.deleteGenericImage(key);
						} catch {
							// ignore
						}
					}
				}
				return res.json({ ok: true, style_thumb_url: null });
			}

			const creationId = parseCreationIdFromLink(linkRaw);
			if (!creationId) {
				return res.status(400).json({
					error: "Invalid link",
					message: "Paste a creation URL such as /creations/123 or a numeric id."
				});
			}

			const fnAny = queries.selectCreatedImageByIdAnyUser?.get;
			if (typeof fnAny !== "function") {
				return res.status(501).json({ error: "Not available" });
			}
			const creation = await fnAny(creationId);
			if (!creation) {
				return res.status(404).json({ error: "Creation not found" });
			}
			const pub = creation.published === 1 || creation.published === true;
			if (!pub) {
				return res.status(403).json({
					error: "Forbidden",
					message: "Only published creations can be used as a style image."
				});
			}
			if (creation.unavailable_at != null && String(creation.unavailable_at).trim() !== "") {
				return res.status(403).json({ error: "Forbidden", message: "This creation is unavailable." });
			}
			const cMeta = parseInjectionMeta(creation.meta);
			if (cMeta?.media_type === "video") {
				return res.status(400).json({ error: "Video creations cannot be used as a style image." });
			}
			const status = creation.status != null ? String(creation.status).trim().toLowerCase() : "";
			if (status && status !== "completed") {
				return res.status(400).json({ error: "Creation is not ready to use as an image." });
			}
			const filename = creation.filename != null ? String(creation.filename).trim() : "";
			if (!filename || filename.includes("..") || filename.includes("/")) {
				return res.status(400).json({ error: "Invalid creation image" });
			}

			const now = Date.now();
			const rand = Math.random().toString(36).slice(2, 9);
			let buffer;
			try {
				buffer = await storage.getImageBuffer(filename);
			} catch {
				return res.status(400).json({ error: "Could not read creation image" });
			}
			let resized;
			try {
				resized = await sharp(buffer)
					.rotate()
					.resize(280, 320, { fit: "cover" })
					.png()
					.toBuffer();
			} catch {
				return res.status(400).json({ error: "Could not process creation image" });
			}
			const key = `prompt-styles/${slug}/thumb_${now}_${rand}.png`;
			let stored;
			try {
				stored = await storage.uploadGenericImage(resized, key, {
					contentType: "image/png"
				});
			} catch {
				return res.status(500).json({ error: "Could not store style image" });
			}
			const newUrl = buildGenericUrl(stored);
			await fnUpdateMeta(slug, { style_thumb_url: newUrl });
			if (oldKey && oldThumbUrl !== newUrl && storage.deleteGenericImage) {
				pendingDeletes.push(oldKey);
			}
			if (storage.deleteGenericImage && pendingDeletes.length > 0) {
				for (const k of pendingDeletes) {
					try {
						await storage.deleteGenericImage(k);
					} catch {
						// ignore
					}
				}
			}
			return res.json({ ok: true, style_thumb_url: newUrl });
		} catch (err) {
			console.error("[styles patch]", err);
			return res.status(500).json({ error: "Failed to update style image" });
		}
	});

	/**
	 * DELETE /api/styles/:slug — admin only; soft-deletes all catalog rows for this style tag.
	 */
	router.delete("/api/styles/:slug", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const user = await queries.selectUserById.get(req.auth.userId);
			if (!isAdminUser(user)) {
				return res.status(403).json({ error: "Forbidden" });
			}
			const raw = String(req.params?.slug ?? "").trim();
			const slug = raw.toLowerCase();
			if (!STYLE_SLUG_RE.test(slug)) {
				return res.status(400).json({ error: "Invalid style slug" });
			}
			const fn = queries.deletePromptInjectionStylesByTagAdmin?.run;
			if (typeof fn !== "function") {
				return res.status(501).json({ error: "Styles are not available" });
			}
			const result = await fn(slug);
			const n = Number(result?.changes ?? 0);
			if (!Number.isFinite(n) || n <= 0) {
				return res.status(404).json({ error: "Style not found or already removed" });
			}
			return res.json({ ok: true, deleted: n });
		} catch (err) {
			console.error("[styles delete]", err);
			return res.status(500).json({ error: "Failed to delete style" });
		}
	});

	/**
	 * GET /api/prompt-injections/personas/promote-eligibility?tag=slug
	 * Admins and founder-tier users: whether a non-user personality can be added as a global Prompt Library persona.
	 */
	router.get("/api/prompt-injections/personas/promote-eligibility", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}
			if (!canPromotePersona(user)) {
				return res.status(403).json({ error: "Forbidden" });
			}
			const tag = normalizePersonalityTag(req.query?.tag ?? "");
			if (!tag) {
				return res.status(400).json({ error: "Invalid tag" });
			}
			const fn = queries.selectGlobalPersonaPromptInjectionByTag?.get;
			if (typeof fn !== "function") {
				return res.status(501).json({ error: "Prompt personas are not available" });
			}
			const profile = await queries.selectUserProfileByUsername?.get(tag);
			if (profile && Number(profile.user_id) > 0) {
				return res.json({
					can_promote: false,
					already_in_library: false,
					reason: "registered_user"
				});
			}
			const existing = await fn(tag);
			if (existing) {
				return res.json({
					can_promote: false,
					already_in_library: true,
					reason: "already_in_library"
				});
			}
			return res.json({
				can_promote: true,
				already_in_library: false
			});
		} catch (err) {
			console.error("[prompt-injections promote-eligibility]", err);
			return res.status(500).json({ error: "Failed to check eligibility" });
		}
	});

	/**
	 * GET /api/prompt-injections/personas/in-library?tag=slug
	 * Whether this slug appears as a persona row visible to the current user (same rules as GET /api/prompt-injections).
	 */
	router.get("/api/prompt-injections/personas/in-library", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const tag = normalizePersonalityTag(req.query?.tag ?? "");
			if (!tag) {
				return res.status(400).json({ error: "Invalid tag" });
			}
			const fnGlobal = queries.selectGlobalPersonaPromptInjectionByTag?.get;
			const fnLib = queries.selectPersonaPromptInjectionInLibraryForUserByTag?.get;
			if (typeof fnLib !== "function") {
				return res.status(501).json({ error: "Prompt personas are not available" });
			}
			// Prefer the global library row (owner_user_id IS NULL) — that is what POST .../catalog updates.
			// Without this, LIMIT 1 on the OR query can return another visible row for the same tag and edits look ignored.
			let row = null;
			if (typeof fnGlobal === "function") {
				const globalRow = await fnGlobal(tag);
				if (globalRow) row = globalRow;
			}
			if (!row) {
				row = await fnLib(req.auth.userId, tag);
			}
			res.set("Cache-Control", "private, max-age=30");
			const in_library = Boolean(row);
			let avatarUrl = null;
			if (in_library) {
				const meta = parseInjectionMeta(row.meta);
				const u = meta?.persona_avatar_url;
				avatarUrl = typeof u === "string" && u.trim() ? u.trim() : null;
			}
			return res.json({
				in_library,
				persona: in_library
					? {
							tag: row.tag != null ? String(row.tag) : tag,
							title: row.title != null ? String(row.title) : null,
							description: row.description != null ? String(row.description) : null,
							character_description:
								typeof row.injection_text === "string" ? row.injection_text : null,
							avatar_url: avatarUrl
						}
					: null
			});
		} catch (err) {
			console.error("[prompt-injections in-library]", err);
			return res.status(500).json({ error: "Failed to check persona" });
		}
	});

	/**
	 * POST /api/prompt-injections/personas/promote { tag }
	 * Creates a global public persona row (Prompt Library) for a personality slug that is not a registered user.
	 */
	router.post("/api/prompt-injections/personas/promote", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}
			if (!canPromotePersona(user)) {
				return res.status(403).json({ error: "Forbidden" });
			}
			const tag = normalizePersonalityTag(req.body?.tag ?? "");
			if (!tag) {
				return res.status(400).json({ error: "Invalid tag" });
			}
			const fnGet = queries.selectGlobalPersonaPromptInjectionByTag?.get;
			const fnInsert = queries.insertGlobalPersonaPromptInjection?.run;
			if (typeof fnGet !== "function" || typeof fnInsert !== "function") {
				return res.status(501).json({ error: "Prompt personas are not available" });
			}
			const profile = await queries.selectUserProfileByUsername?.get(tag);
			if (profile && Number(profile.user_id) > 0) {
				return res.status(400).json({ error: "Invalid tag", message: "That handle is a registered user account." });
			}
			const existing = await fnGet(tag);
			if (existing) {
				return res.status(409).json({ error: "Conflict", message: "This persona is already in the prompt library." });
			}
			const title = slugToDisplayTitle(tag);
			const injectionText = buildPersonaInjectionText(tag);
			const description = buildPersonaDescription(tag);
			const meta = {
				source: "personality_discovery_promote",
				promoted_by_user_id: Number(user.id)
			};
			try {
				const result = await fnInsert(tag, injectionText, title, description, meta);
				return res.status(201).json({
					id: result.insertId ?? result.lastInsertRowid ?? null,
					tag,
					title,
					injection_text: injectionText
				});
			} catch (err) {
				if (isUniqueViolation(err)) {
					return res.status(409).json({ error: "Conflict", message: "This persona is already in the prompt library." });
				}
				throw err;
			}
		} catch (err) {
			console.error("[prompt-injections promote]", err);
			return res.status(500).json({ error: "Failed to promote persona" });
		}
	});

	/**
	 * POST /api/prompt-injections/personas/:tag/catalog (multipart)
	 * Updates the global Prompt Library persona row: title, description (visitor-facing), character_description → injection_text,
	 * optional avatar file / try URL / remove. Same role gate as promote. Mirrors profile POST shape.
	 */
	router.post("/api/prompt-injections/personas/:tag/catalog", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}
			if (!canPromotePersona(user)) {
				return res.status(403).json({ error: "Forbidden" });
			}
			const rawParam = String(req.params?.tag ?? "").trim();
			const tag = normalizePersonalityTag(decodeURIComponent(rawParam));
			if (!tag) {
				return res.status(400).json({ error: "Invalid tag" });
			}
			if (!storage?.uploadGenericImage) {
				return res.status(500).json({ error: "Image storage not available" });
			}

			let fields;
			let files;
			try {
				({ fields, files } = await parseMultipartPersonaCatalog(req));
			} catch (e) {
				if (e?.code === "FILE_TOO_LARGE") {
					return res.status(400).json({ error: "File too large" });
				}
				return res.status(400).json({ error: "Invalid multipart body" });
			}

			const fnGet = queries.selectGlobalPersonaPromptInjectionByTag?.get;
			const fnUpdate = queries.updateGlobalPersonaCatalogByTag?.run;
			if (typeof fnGet !== "function" || typeof fnUpdate !== "function") {
				return res.status(501).json({ error: "Not available" });
			}
			const row = await fnGet(tag);
			if (!row) {
				return res.status(404).json({
					error: "Not found",
					message: "No global Prompt Library persona exists for this tag."
				});
			}

			let title = typeof fields?.title === "string" ? fields.title.trim() : "";
			if (!title) {
				title = row.title != null && String(row.title).trim() ? String(row.title).trim() : slugToDisplayTitle(tag);
			}
			if (title.length > 200) {
				return res.status(400).json({ error: "Title too long" });
			}

			let description = typeof fields?.description === "string" ? fields.description.trim() : "";
			description = description || null;
			if (description && description.length > 4000) {
				return res.status(400).json({ error: "Description too long" });
			}

			const character = typeof fields?.character_description === "string" ? fields.character_description.trim() : "";
			if (!character) {
				return res.status(400).json({
					error: "Character required",
					message: "Character description is required — it is used when this persona appears in prompts."
				});
			}
			if (character.length > 4000) {
				return res.status(400).json({ error: "Character description too long" });
			}

			const meta = parseInjectionMeta(row.meta);
			const avatarRemove = Boolean(fields?.avatar_remove);
			const avatarFile = files?.avatar_file || null;
			const tryUrl = typeof fields?.avatar_try_url === "string" ? fields.avatar_try_url.trim() : "";
			const avatarCreationIdRaw = typeof fields?.avatar_creation_id === "string" ? fields.avatar_creation_id.trim() : "";
			const avatarCreationId = avatarCreationIdRaw ? parseInt(avatarCreationIdRaw, 10) : NaN;

			const oldAvatarUrl = typeof meta.persona_avatar_url === "string" ? meta.persona_avatar_url.trim() : "";
			const oldAvatarKey = extractGenericKey(oldAvatarUrl);
			const pendingDeletes = [];

			const now = Date.now();
			const rand = Math.random().toString(36).slice(2, 9);

			if (avatarRemove) {
				delete meta.persona_avatar_url;
				if (oldAvatarKey && storage.deleteGenericImage) {
					pendingDeletes.push(oldAvatarKey);
				}
			} else if (avatarFile?.buffer?.length) {
				let resized;
				try {
					resized = await sharp(avatarFile.buffer)
						.rotate()
						.resize(128, 128, { fit: "cover" })
						.png()
						.toBuffer();
				} catch {
					return res.status(400).json({ error: "Invalid avatar image" });
				}
				const key = `prompt-personas/${tag}/avatar_${now}_${rand}.png`;
				const stored = await storage.uploadGenericImage(resized, key, {
					contentType: "image/png"
				});
				const newUrl = buildGenericUrl(stored);
				meta.persona_avatar_url = newUrl;
				if (oldAvatarKey && oldAvatarUrl !== newUrl && storage.deleteGenericImage) {
					pendingDeletes.push(oldAvatarKey);
				}
			} else if (tryUrl.startsWith("/api/try/images/")) {
				const afterPrefix = tryUrl.slice("/api/try/images/".length);
				const filename = afterPrefix ? afterPrefix.split("/")[0].split("?")[0].trim() : "";
				if (
					!filename ||
					filename.includes("..") ||
					filename.includes("/") ||
					!storage.getImageBufferAnon
				) {
					return res.status(400).json({ error: "Invalid avatar try URL" });
				}
				try {
					const buffer = await storage.getImageBufferAnon(filename);
					const resized = await sharp(buffer)
						.rotate()
						.resize(128, 128, { fit: "cover" })
						.png()
						.toBuffer();
					const key = `prompt-personas/${tag}/avatar_${now}_${rand}.png`;
					const stored = await storage.uploadGenericImage(resized, key, {
						contentType: "image/png"
					});
					const newUrl = buildGenericUrl(stored);
					meta.persona_avatar_url = newUrl;
					if (oldAvatarKey && oldAvatarUrl !== newUrl && storage.deleteGenericImage) {
						pendingDeletes.push(oldAvatarKey);
					}
				} catch {
					return res.status(400).json({ error: "Could not promote generated avatar" });
				}
			} else if (Number.isFinite(avatarCreationId) && avatarCreationId > 0) {
				const fnAny = queries.selectCreatedImageByIdAnyUser?.get;
				if (typeof fnAny !== "function" || typeof storage.getImageBuffer !== "function") {
					return res.status(501).json({ error: "Not available" });
				}
				const creation = await fnAny(avatarCreationId);
				if (!creation) {
					return res.status(404).json({ error: "Creation not found" });
				}
				const pub = creation.published === 1 || creation.published === true;
				if (!pub) {
					return res.status(403).json({
						error: "Forbidden",
						message: "Only published creations can be used as a persona avatar."
					});
				}
				if (creation.unavailable_at != null && String(creation.unavailable_at).trim() !== "") {
					return res.status(403).json({ error: "Forbidden", message: "This creation is unavailable." });
				}
				const cMeta = parseInjectionMeta(creation.meta);
				if (cMeta?.media_type === "video") {
					return res.status(400).json({ error: "Video creations cannot be used as a persona avatar." });
				}
				const filename = creation.filename != null ? String(creation.filename).trim() : "";
				if (!filename || filename.includes("..") || filename.includes("/")) {
					return res.status(400).json({ error: "Invalid creation image" });
				}
				try {
					const buffer = await storage.getImageBuffer(filename);
					const resized = await sharp(buffer)
						.rotate()
						.resize(128, 128, { fit: "cover" })
						.png()
						.toBuffer();
					const key = `prompt-personas/${tag}/avatar_${now}_${rand}.png`;
					const stored = await storage.uploadGenericImage(resized, key, {
						contentType: "image/png"
					});
					const newUrl = buildGenericUrl(stored);
					meta.persona_avatar_url = newUrl;
					if (oldAvatarKey && oldAvatarUrl !== newUrl && storage.deleteGenericImage) {
						pendingDeletes.push(oldAvatarKey);
					}
				} catch {
					return res.status(400).json({ error: "Could not read creation image" });
				}
			}

			const result = await fnUpdate(tag, {
				title,
				description,
				injectionText: character,
				meta
			});
			if (!result || Number(result.changes) < 1) {
				return res.status(500).json({ error: "Update failed" });
			}

			if (storage.deleteGenericImage && pendingDeletes.length > 0) {
				for (const key of pendingDeletes) {
					try {
						await storage.deleteGenericImage(key);
					} catch {
						// ignore
					}
				}
			}

			const outAvatar =
				typeof meta.persona_avatar_url === "string" && meta.persona_avatar_url.trim()
					? meta.persona_avatar_url.trim()
					: null;
			return res.json({
				ok: true,
				persona: {
					tag,
					title,
					description,
					character_description: character,
					avatar_url: outAvatar
				}
			});
		} catch (err) {
			console.error("[prompt-injections persona catalog]", err);
			return res.status(500).json({ error: "Failed to save persona" });
		}
	});

	return router;
}
