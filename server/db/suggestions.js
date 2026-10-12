// WWW prompt suggestions: users, personas and style-library visibility.
export function createSuggestionsStore(client) {
 const serviceClient = client;
 const prefixedTable = name => 'prsn_' + name;
 return {
searchUserProfilesByPrefix: async (prefix, limit = 10) => {
			if (typeof prefix !== "string" || !prefix.trim()) return [];
			const normalized = String(prefix).toLowerCase().trim();
			const cap = Math.min(Math.max(1, Number(limit) || 10), 20);
			const profilesTable = prefixedTable("user_profiles");
			const usersTable = prefixedTable("users");
			const orClause = `user_name.ilike.${normalized}%,user_name.ilike.%${normalized}%,display_name.ilike.${normalized}%,display_name.ilike.%${normalized}%`;
			const { data: rows, error } = await serviceClient
				.from(profilesTable)
				.select(`user_id, user_name, display_name, avatar_url, ${usersTable}!inner(role, meta)`)
				.or(orClause)
				.eq(`${usersTable}.role`, "consumer")
				.limit(cap * 4);
			if (error) throw error;
			const raw = (rows ?? []).filter((r) => {
				const u = r[usersTable];
				return u && (u.meta == null || u.meta.suspended !== true);
			});
			const byUserId = (r) => r.user_id;
			const un = (r) => String(r.user_name || "").toLowerCase();
			const dn = (r) => String(r.display_name || "").toLowerCase();
			const isPrefix = (r) => un(r).startsWith(normalized) || dn(r).startsWith(normalized);
			const deduped = [...new Map(raw.map((r) => [r.user_id, { user_id: r.user_id, user_name: r.user_name, display_name: r.display_name, avatar_url: r.avatar_url }])).values()];
			const prefixFirst = deduped.sort((a, b) => {
				const aP = isPrefix(a) ? 0 : 1;
				const bP = isPrefix(b) ? 0 : 1;
				if (aP !== bP) return aP - bP;
				return (un(a) || dn(a)).localeCompare(un(b) || dn(b));
			});
			return prefixFirst.slice(0, cap);
		},
searchPromptInjectionStylesByPrefix: {
			all: async (userId, prefix, limit) => {
				const uid = Number(userId);
				const p = String(prefix ?? "")
					.trim()
					.toLowerCase()
					.replace(/[^a-z0-9_-]/g, "");
				if (!Number.isFinite(uid) || uid <= 0 || !p) return [];
				const lim = Math.min(Math.max(1, Number(limit) || 10), 20);
				const { data, error } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.select("id, tag, title, tag_type, meta")
					.eq("tag_type", "style")
					.eq("is_active", true)
					.is("deleted_at", null)
					.or(`owner_user_id.is.null,owner_user_id.eq.${uid},visibility.eq.public,visibility.eq.unlisted`)
					.ilike("tag", `${p}%`)
					.order("tag", { ascending: true })
					.limit(lim);
				if (error) throw error;
				return data ?? [];
			}
		},
selectPublicStyleNames: {
			all: async () => {
				const { data, error } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.select("tag")
					.eq("tag_type", "style")
					.eq("is_active", true)
					.is("deleted_at", null)
					.is("owner_user_id", null)
					.eq("visibility", "public")
					.not("tag", "is", null)
					.order("tag", { ascending: true });
				if (error) throw error;
				return (data ?? [])
					.map((row) => ({ tag: typeof row?.tag === "string" ? row.tag.trim() : "" }))
					.filter((row) => row.tag);
			}
		},
searchPersonaPromptInjectionsByPrefix: {
			all: async (userId, prefix, limit) => {
				const uid = Number(userId);
				const p = String(prefix ?? "")
					.trim()
					.toLowerCase()
					.replace(/[^a-z0-9_-]/g, "");
				if (!Number.isFinite(uid) || uid <= 0 || !p) return [];
				const lim = Math.min(Math.max(1, Number(limit) || 10), 20);
				const { data, error } = await serviceClient
					.from(prefixedTable("prompt_injections"))
					.select("id, tag, title, meta")
					.eq("tag_type", "persona")
					.eq("is_active", true)
					.is("deleted_at", null)
					.or(`owner_user_id.is.null,owner_user_id.eq.${uid},visibility.eq.public,visibility.eq.unlisted`)
					.ilike("tag", `%${p}%`)
					.limit(Math.min(lim * 4, 80));
				if (error) throw error;
				const rows = Array.isArray(data) ? data : [];
				const norm = (t) => String(t ?? "").toLowerCase();
				const scored = rows
					.filter((r) => norm(r.tag).includes(p))
					.map((r) => {
						const t = norm(r.tag);
						const prefixHit = t.startsWith(p) ? 0 : 1;
						return { row: r, prefixHit, tag: t };
					})
					.sort((a, b) => {
						if (a.prefixHit !== b.prefixHit) return a.prefixHit - b.prefixHit;
						return a.tag.localeCompare(b.tag);
					});
				const seen = new Set();
				const out = [];
				for (const { row } of scored) {
					const t = norm(row.tag);
					if (!t || seen.has(t)) continue;
					seen.add(t);
					out.push(row);
					if (out.length >= lim) break;
				}
				return out;
			}
		}
 };
}
