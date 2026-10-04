/* WWW library query contracts, owned by the VPS Library domain. */
function prefixedTable(name) { return `prsn_${name}`; }
export function createLibraryQueries(client) {
const serviceClient = client; const supabase = client;
return {
selectUserProfilesByUserIds: async (userIds) => {
			const idList = Array.isArray(userIds) ? userIds.filter((id) => id != null && Number.isFinite(Number(id))) : [];
			if (idList.length === 0) return new Map();
			const { data, error } = await serviceClient
				.from(prefixedTable("user_profiles"))
				.select("user_id, user_name, display_name, about, socials, avatar_url, cover_image_url, badges, meta, created_at, updated_at")
				.in("user_id", idList);
			if (error) throw error;
			const map = new Map();
			for (const row of data ?? []) {
				map.set(Number(row.user_id), row);
			}
			return map;
		},
selectPromptInjectionsForLibrary: {
			all: async (userId) => {
				const uid = Number(userId);
				if (!Number.isFinite(uid) || uid <= 0) return [];
				const { data, error } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.select(
						"id, tag, tag_type, title, visibility, owner_user_id, updated_at, is_active, deleted_at, meta"
					)
					.eq("is_active", true)
					.is("deleted_at", null)
					.or(`owner_user_id.is.null,owner_user_id.eq.${uid},visibility.eq.public,visibility.eq.unlisted`);
				if (error) throw error;
				const rows = data ?? [];
				rows.sort((a, b) => {
					const t = String(a.tag_type ?? "").localeCompare(String(b.tag_type ?? ""));
					if (t !== 0) return t;
					return String(a.tag ?? "").localeCompare(String(b.tag ?? ""));
				});
				return rows;
			}
		},
selectGlobalStylePromptInjectionByTag: {
			get: async (tag) => {
				const raw = String(tag ?? "")
					.trim()
					.toLowerCase();
				if (!raw) return null;
				const { data, error } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.select("id, tag, meta")
					.eq("tag_type", "style")
					.is("owner_user_id", null)
					.eq("is_active", true)
					.is("deleted_at", null)
					.eq("tag", raw)
					.maybeSingle();
				if (error) throw error;
				return data ?? null;
			}
		},
updateGlobalStyleCatalogMetaByTag: {
			run: async (tag, patch) => {
				const t = String(tag ?? "")
					.trim()
					.toLowerCase();
				if (!t || !patch || typeof patch !== "object") return { changes: 0 };
				const { data: row, error: selErr } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.select("id, meta")
					.eq("tag_type", "style")
					.is("owner_user_id", null)
					.eq("is_active", true)
					.is("deleted_at", null)
					.eq("tag", t)
					.maybeSingle();
				if (selErr) throw selErr;
				if (!row?.id) return { changes: 0 };
				let meta = {};
				const rawMeta = row.meta;
				if (rawMeta != null && typeof rawMeta === "object" && !Array.isArray(rawMeta)) {
					meta = { ...rawMeta };
				} else if (typeof rawMeta === "string" && rawMeta.trim()) {
					try {
						const o = JSON.parse(rawMeta);
						if (o && typeof o === "object" && !Array.isArray(o)) meta = o;
					} catch {
						meta = {};
					}
				}
				for (const [k, v] of Object.entries(patch)) {
					if (v === null || v === undefined) delete meta[k];
					else meta[k] = v;
				}
				const now = new Date().toISOString();
				const { data: updated, error: updErr } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.update({ meta, updated_at: now })
					.eq("id", row.id)
					.select("id");
				if (updErr) throw updErr;
				const n = Array.isArray(updated) ? updated.length : 0;
				return { changes: n };
			}
		},
updateGlobalStyleCatalogByTag: {
			run: async (tag, patch) => {
				const t = String(tag ?? "")
					.trim()
					.toLowerCase();
				if (!t || !patch || typeof patch !== "object") return { changes: 0 };
				const update = {};
				if (Object.prototype.hasOwnProperty.call(patch, "title")) {
					update.title = patch.title ?? null;
				}
				if (Object.prototype.hasOwnProperty.call(patch, "description")) {
					update.description = patch.description ?? null;
				}
				if (Object.prototype.hasOwnProperty.call(patch, "visibility")) {
					update.visibility = patch.visibility ?? "public";
				}
				if (Object.prototype.hasOwnProperty.call(patch, "injectionText")) {
					update.injection_text = patch.injectionText ?? "";
				}
				if (Object.keys(update).length === 0) return { changes: 0 };
				update.updated_at = new Date().toISOString();
				const { data, error } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.update(update)
					.eq("tag_type", "style")
					.is("owner_user_id", null)
					.eq("is_active", true)
					.is("deleted_at", null)
					.eq("tag", t)
					.select("id");
				if (error) throw error;
				return { changes: Array.isArray(data) ? data.length : 0 };
			}
		},
deletePromptInjectionStylesByTagAdmin: {
			run: async (slug) => {
				const raw = String(slug ?? "")
					.trim()
					.toLowerCase();
				if (!raw) return { changes: 0 };
				const { data: rows, error: selErr } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.select("id")
					.eq("tag_type", "style")
					.is("deleted_at", null)
					.eq("tag", raw);
				if (selErr) throw selErr;
				const list = Array.isArray(rows) ? rows : [];
				const ids = list.map((r) => r.id).filter((id) => id != null);
				if (ids.length === 0) return { changes: 0 };
				const now = new Date().toISOString();
				const { data: updated, error: updErr } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.update({ deleted_at: now, is_active: false, updated_at: now })
					.in("id", ids)
					.select("id");
				if (updErr) throw updErr;
				const n = Array.isArray(updated) ? updated.length : 0;
				return { changes: n };
			}
		},
insertGlobalStylePromptInjection: {
			run: async (tag, injectionText, title, description, visibility) => {
				const normalizedTag = String(tag ?? "")
					.trim()
					.toLowerCase();
				const inj = String(injectionText ?? "").trim();
				if (!normalizedTag || !inj) {
					return { changes: 0 };
				}
				const vis = visibility === "unlisted" ? "unlisted" : "public";
				const { data, error } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.insert({
						tag: normalizedTag,
						tag_type: "style",
						injection_text: inj,
						title: title ?? null,
						description: description ?? null,
						owner_user_id: null,
						visibility: vis,
						is_active: true
					})
					.select("id")
					.single();
				if (error) throw error;
				return {
					changes: data?.id != null ? 1 : 0,
					insertId: data?.id
				};
			}
		},
selectGlobalPersonaPromptInjectionByTag: {
			get: async (tag) => {
				const raw = String(tag ?? "")
					.trim()
					.toLowerCase();
				if (!raw) return null;
				const { data, error } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.select("id, tag, tag_type, injection_text, title, description, visibility, meta")
					.eq("tag_type", "persona")
					.is("owner_user_id", null)
					.eq("is_active", true)
					.is("deleted_at", null)
					.eq("tag", raw)
					.maybeSingle();
				if (error) throw error;
				return data ?? null;
			}
		},
insertGlobalPersonaPromptInjection: {
			run: async (tag, injectionText, title, description, meta) => {
				const normalizedTag = String(tag ?? "")
					.trim()
					.toLowerCase();
				if (!normalizedTag) {
					throw new Error("insertGlobalPersonaPromptInjection: missing tag");
				}
				const { data, error } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.insert({
						tag: normalizedTag,
						tag_type: "persona",
						injection_text: injectionText,
						title: title ?? null,
						description: description ?? null,
						meta: meta && typeof meta === "object" ? meta : null,
						owner_user_id: null,
						visibility: "public",
						is_active: true
					})
					.select("id")
					.single();
				if (error) throw error;
				return {
					insertId: data.id,
					changes: 1
				};
			}
		},
updateGlobalPersonaCatalogByTag: {
			run: async (tag, { title, description, injectionText, meta }) => {
				const raw = String(tag ?? "")
					.trim()
					.toLowerCase();
				if (!raw) return { changes: 0 };
				const inj = String(injectionText ?? "").trim();
				if (!inj) return { changes: 0 };
				const { data, error } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.update({
						title: title == null ? null : String(title),
						description: description == null ? null : String(description),
						injection_text: inj,
						meta: meta && typeof meta === "object" ? meta : null,
						updated_at: new Date().toISOString()
					})
					.eq("tag_type", "persona")
					.is("owner_user_id", null)
					.eq("is_active", true)
					.is("deleted_at", null)
					.eq("tag", raw)
					.select("id");
				if (error) throw error;
				const n = Array.isArray(data) ? data.length : 0;
				return { changes: n };
			}
		},
insertAudioClip: {
			run: async (row) => {
				const now = new Date().toISOString();
				const { data, error } = await serviceClient
					.from(prefixedTable("audio_clips"))
					.insert({
						...row,
						updated_at: now
					})
					.select("*")
					.single();
				if (error) throw error;
				return data;
			}
		},
updateAudioClip: {
			run: async (id, patch) => {
				const clipId = Number(id);
				if (!Number.isFinite(clipId) || clipId <= 0) return null;
				const { data, error } = await serviceClient
					.from(prefixedTable("audio_clips"))
					.update({
						...patch,
						updated_at: new Date().toISOString()
					})
					.eq("id", clipId)
					.is("deleted_at", null)
					.select("*")
					.maybeSingle();
				if (error) throw error;
				return data ?? null;
			}
		},
softDeleteAudioClip: {
			run: async (id) => {
				const clipId = Number(id);
				if (!Number.isFinite(clipId) || clipId <= 0) return { changes: 0 };
				const { data, error } = await serviceClient
					.from(prefixedTable("audio_clips"))
					.update({
						deleted_at: new Date().toISOString(),
						is_active: false,
						updated_at: new Date().toISOString()
					})
					.eq("id", clipId)
					.is("deleted_at", null)
					.select("id");
				if (error) throw error;
				return { changes: Array.isArray(data) ? data.length : 0 };
			}
		},
selectAudioClipUsagesForClip: {
			page: async (clipId, options = {}) => {
				const id = Number(clipId);
				if (!Number.isFinite(id) || id <= 0) return { items: [], total: 0 };
				const lim = Math.min(Math.max(1, Number(options.limit) || 24), 100);
				const off = Math.max(0, Number(options.offset) || 0);
				const { data, error, count } = await serviceClient
					.from(prefixedTable("audio_clip_usages"))
					.select(
						"id, audio_clip_id, created_image_id, used_at, meta, prsn_created_images!inner(id, user_id, filename, file_path, title, published, status, meta, created_at)",
						{ count: "exact" }
					)
					.eq("audio_clip_id", id)
					.order("used_at", { ascending: false })
					.range(off, off + lim - 1);
				if (error) throw error;
				return { items: data ?? [], total: typeof count === "number" ? count : (data ?? []).length };
			}
		}
};
}
