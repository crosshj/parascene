/**
 * Persist prsn_cid (Client Id) values onto user_profiles.meta.prsn_cids for logged-in users.
 */

import { getClientIdFromRequest, mergePrsnCidsIntoProfileMeta, prsnCidFromMeta } from "./prsnCids.js";

function safeJsonParse(value, fallback) {
	if (value == null) return fallback;
	if (typeof value === "object") return value;
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	try {
		return JSON.parse(trimmed);
	} catch {
		return fallback;
	}
}

export function tryRequestMetaFromRow(raw) {
	if (raw == null) return null;
	if (typeof raw === "object") return raw;
	if (typeof raw === "string" && raw.trim()) return safeJsonParse(raw, null);
	return null;
}

function normalizeProfileRowForAppend(row) {
	if (!row) {
		return {
			user_name: null,
			display_name: null,
			about: null,
			socials: {},
			avatar_url: null,
			cover_image_url: null,
			badges: [],
			meta: {}
		};
	}
	const meta = safeJsonParse(row.meta, {});
	return {
		user_name: row.user_name ?? null,
		display_name: row.display_name ?? null,
		about: row.about ?? null,
		socials: safeJsonParse(row.socials, {}),
		avatar_url: row.avatar_url ?? null,
		cover_image_url: row.cover_image_url ?? null,
		badges: safeJsonParse(row.badges, []),
		meta
	};
}

/**
 * Merge current request client id (+ optional try-session metas) into profile.prsn_cids.
 * @param {object} queries — db queries
 * @param {number} userId
 * @param {import("express").Request} req
 * @param {{ extraIds?: string[], includeTrySessionMetas?: boolean }} [options]
 *   - includeTrySessionMetas: when true (default), loads try_requests for ps_cid and merges meta client ids.
 *   - extraIds: precomputed ids (e.g. when the caller already fetched try rows — set includeTrySessionMetas false to avoid a second query).
 */
export async function appendPrsnCidsForUserId(queries, userId, req, options = {}) {
	const extraIds = Array.isArray(options.extraIds) ? options.extraIds : [];
	const includeTrySessionMetas = options.includeTrySessionMetas !== false;

	let mergeFromTry = [];
	if (includeTrySessionMetas && queries.selectTryRequestsByCid?.all) {
		const anon = typeof req.cookies?.ps_cid === "string" ? req.cookies.ps_cid.trim() : null;
		if (anon) {
			const tr = (await queries.selectTryRequestsByCid.all(anon)) || [];
			mergeFromTry = tr.map((r) => prsnCidFromMeta(tryRequestMetaFromRow(r.meta))).filter(Boolean);
		}
	}

	const cid = getClientIdFromRequest(req);
	const toMerge = [cid, ...extraIds, ...mergeFromTry].filter((x) => typeof x === "string" && x.trim());
	if (toMerge.length === 0) return;

	const row = await queries.selectUserProfileByUserId?.get?.(userId);
	const profile = normalizeProfileRowForAppend(row);
	const nextMeta = mergePrsnCidsIntoProfileMeta(profile.meta || {}, toMerge);
	const before = JSON.stringify(profile.meta?.prsn_cids ?? []);
	const after = JSON.stringify(nextMeta.prsn_cids ?? []);
	if (before === after) return;
	if (!queries.upsertUserProfile?.run) return;
	await queries.upsertUserProfile.run(userId, {
		user_name: profile.user_name,
		display_name: profile.display_name,
		about: profile.about,
		socials: profile.socials ?? {},
		avatar_url: profile.avatar_url,
		cover_image_url: profile.cover_image_url,
		badges: profile.badges ?? [],
		meta: nextMeta
	});
}
