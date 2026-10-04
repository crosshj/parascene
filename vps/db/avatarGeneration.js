function prefixedTable(name){return 'prsn_'+name}
export function createAvatarGenerationQueries(client){const serviceClient=client,supabase=client;return {
insertCreatedImageAnon: {
			run: async (prompt, filename, filePath, width, height, status, meta) => {
				const metaVal = typeof meta === "object" && meta !== null ? meta : meta == null ? null : meta;
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.insert({
						prompt: prompt ?? null,
						filename,
						file_path: filePath,
						width,
						height,
						status,
						meta: metaVal
					})
					.select("id")
					.single();
				if (error) throw error;
				return Promise.resolve({ insertId: data?.id, changes: data ? 1 : 0 });
			}
		},
selectCreatedImagesAnonByIds: {
			all: async (ids) => {
				const safeIds = Array.isArray(ids)
					? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
					: [];
				if (safeIds.length === 0) return [];
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.select("id, prompt, filename, file_path, width, height, status, created_at, meta")
					.in("id", safeIds);
				if (error) throw error;
				return Array.isArray(data) ? data : [];
			}
		},
selectRecentCompletedCreatedImageAnonByPrompt: {
			all: async (prompt, sinceIso, limit = 5) => {
				if (prompt == null || String(prompt).trim() === "") return [];
				const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 20);
				const { data, error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.select("id, prompt, filename, file_path, width, height, status, created_at, meta")
					.eq("prompt", String(prompt).trim())
					.eq("status", "completed")
					.gte("created_at", sinceIso)
					.order("created_at", { ascending: false })
					.limit(safeLimit);
				if (error) throw error;
				return Array.isArray(data) ? data : [];
			}
		},
countCreatedImagesAnonByFilename: {
			get: async (filename) => {
				if (!filename || typeof filename !== "string" || filename.includes("..") || filename.includes("/"))
					return { count: 0 };
				const { count, error } = await serviceClient
					.from(prefixedTable("created_images_anon"))
					.select("id", { count: "exact", head: true })
					.eq("filename", filename.trim());
				if (error) throw error;
				return { count: count ?? 0 };
			}
		},
updateTryRequestsNullAnonId: {
			run: async (createdImageAnonId) => {
				const id = Number(createdImageAnonId);
				const { error } = await serviceClient
					.from(prefixedTable("try_requests"))
					.update({ created_image_anon_id: null })
					.eq("created_image_anon_id", id);
				if (error) throw error;
				return Promise.resolve({ changes: 1 });
			}
		},
selectTryRequestByCidAndPrompt: {
			get: async (anonCid, prompt) => {
				if (prompt == null || String(prompt).trim() === "") return undefined;
				const { data, error } = await serviceClient
					.from(prefixedTable("try_requests"))
					.select("id, anon_cid, prompt, created_at, fulfilled_at, created_image_anon_id")
					.eq("anon_cid", anonCid)
					.eq("prompt", String(prompt).trim())
					.order("created_at", { ascending: false })
					.limit(1);
				if (error) throw error;
				const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
				return row ?? undefined;
			}
		},
insertTryRequest: {
			run: async (anonCid, prompt, created_image_anon_id, fulfilled_at = null, meta = null) => {
				const metaVal = typeof meta === "object" && meta !== null ? meta : meta == null ? null : meta;
				const { error } = await serviceClient
					.from(prefixedTable("try_requests"))
					.insert({
						anon_cid: anonCid,
						prompt: prompt ?? null,
						created_image_anon_id,
						fulfilled_at: fulfilled_at ?? null,
						meta: metaVal,
					});
				if (error) throw error;
				return Promise.resolve({ changes: 1 });
			}
		}
};}
