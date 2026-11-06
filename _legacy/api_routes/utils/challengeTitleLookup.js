/**
 * Resolve challenge display titles by challenge_id for surfaces that only
 * have a creation meta stamp / pin id (e.g. #comments stream).
 */

import { loadChallengeFeedSnapshotSharedCached } from '../feed/challengeFeedSnapshotCache.js';
import { getSupabaseServiceClient } from './supabaseService.js';
import {
	fetchThreadMessagesNewestFirst,
	findChallengesChannelThreadId,
	pickLatestChallengeConfigForChallengeId
} from './challengeSubmitShared.js';

/**
 * @param {unknown} snap
 * @param {Map<string, string>} out
 */
function absorbSnapshotChallengeTitles(snap, out) {
	if (!snap || typeof snap !== 'object') return;
	const primaryId = typeof snap.challengeId === 'string' ? snap.challengeId.trim() : '';
	const primaryTitle = typeof snap.title === 'string' ? snap.title.trim() : '';
	if (primaryId && primaryTitle) out.set(primaryId, primaryTitle);
	for (const row of Array.isArray(snap.boardRows) ? snap.boardRows : []) {
		const id = typeof row?.challengeId === 'string' ? row.challengeId.trim() : '';
		const title = typeof row?.title === 'string' ? row.title.trim() : '';
		if (id && title) out.set(id, title);
	}
	for (const key of ['nextChallenge', 'previousChallenge']) {
		const row = snap[key];
		const id = typeof row?.challengeId === 'string' ? row.challengeId.trim() : '';
		const title = typeof row?.title === 'string' ? row.title.trim() : '';
		if (id && title) out.set(id, title);
	}
}

/**
 * @param {iterable} challengeIds
 * @returns {Promise<Map<string, string>>}
 */
export async function resolveChallengeTitlesByIds(challengeIds) {
	/** @type {Map<string, string>} */
	const out = new Map();
	const ids = [
		...new Set(
			[...(challengeIds || [])]
				.map((id) => (id != null ? String(id).trim() : ''))
				.filter(Boolean)
		)
	];
	if (ids.length === 0) return out;

	try {
		const snap = await loadChallengeFeedSnapshotSharedCached();
		absorbSnapshotChallengeTitles(snap, out);
	} catch {
		// ignore cache miss
	}

	const missing = ids.filter((id) => !out.get(id));
	if (missing.length === 0) return out;

	try {
		const sb = getSupabaseServiceClient();
		if (!sb) return out;
		const threadId = await findChallengesChannelThreadId(sb);
		if (!threadId) return out;
		const messagesNewest = await fetchThreadMessagesNewestFirst(sb, threadId);
		for (const challengeId of missing) {
			const cfg = pickLatestChallengeConfigForChallengeId(messagesNewest, challengeId);
			const title = typeof cfg?.title === 'string' ? cfg.title.trim() : '';
			if (title) out.set(challengeId, title);
		}
	} catch {
		// ignore lookup failures — callers keep Creation N fallback
	}

	return out;
}

/**
 * Challenge ids referenced by creation meta (pins + organizer refs).
 * @param {unknown} meta
 * @returns {string[]}
 */
export function challengeIdsFromCreationMeta(meta) {
	/** @type {string[]} */
	const out = [];
	const seen = new Set();
	const push = (raw) => {
		const id = raw != null ? String(raw).trim() : '';
		if (!id || seen.has(id)) return;
		seen.add(id);
		out.push(id);
	};
	if (Array.isArray(meta?.challenge_feed_pins)) {
		for (const row of meta.challenge_feed_pins) {
			if (row && typeof row === 'object') push(row.challenge_id);
		}
	}
	if (Array.isArray(meta?.challenge_organizer_refs)) {
		for (const row of meta.challenge_organizer_refs) {
			if (row && typeof row === 'object') push(row.challenge_id);
		}
	}
	return out;
}
