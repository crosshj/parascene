/**
 * Lasting unpublished view access for challenge results/highlights creations.
 * Survives winners-pin expiry while the challenge still points at the creation.
 */

import { getSupabaseServiceClient } from "./supabaseService.js";
import { canViewUnpublishedCreationViaChallengeResults } from "./challengeSubmitShared.js";
import { creationMetaHasChallengeResultsOrganizerRef } from "../../src/shared/challengeOrganizerRefMeta.js";

function parseMeta(raw) {
	if (!raw) return {};
	if (typeof raw === "object" && !Array.isArray(raw)) return raw;
	if (typeof raw === "string") {
		try {
			const o = JSON.parse(raw);
			return o && typeof o === "object" && !Array.isArray(o) ? o : {};
		} catch {
			return {};
		}
	}
	return {};
}

/**
 * @param {{
 *   image: { id?: unknown, meta?: unknown, unavailable_at?: unknown },
 *   userId: number,
 *   challengeId?: string,
 * }} args
 * @returns {Promise<boolean>}
 */
export async function canViewUnpublishedChallengeResultsCreation(args) {
	const image = args?.image;
	const userId = Number(args?.userId);
	if (!image || !Number.isFinite(userId) || userId <= 0) return false;
	if (image.unavailable_at != null && image.unavailable_at !== "") return false;

	const meta = parseMeta(image.meta);
	if (creationMetaHasChallengeResultsOrganizerRef(meta)) return true;

	const sb = getSupabaseServiceClient();
	if (!sb) return false;
	try {
		return await canViewUnpublishedCreationViaChallengeResults(sb, {
			ancestorRow: image,
			challengeId: typeof args?.challengeId === "string" ? args.challengeId : undefined,
			viewerUserId: userId
		});
	} catch {
		return false;
	}
}
