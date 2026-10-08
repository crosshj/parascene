import { createStorageCache } from '../../core/storageCache.js';
import {
	mergeFullChallengeConfigForChallenge,
	pickChallengeHeroImageUrl,
	pickChallengeResultsCreationUrl,
	pickChallengeTopicVoteCreationUrl
} from '../../shared/challenges/challengeAdmin.js';

const CACHE_PREFIX = 'prsn-vps-challenge-entries-v1';

function parsePayload(message) {
	const text = typeof message?.body === 'string' ? message.body.trim() : '';
	if (!text || !text.startsWith('{')) return null;
	try {
		const payload = JSON.parse(text);
		return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
	} catch {
		return null;
	}
}

function creationIdFromRef(raw) {
	const text = typeof raw === 'string' ? raw : '';
	const match = text.match(/\/creations\/(\d+)/) || text.match(/\/(?:api\/)?create\/images\/(\d+)/);
	const id = match ? Number(match[1]) : NaN;
	return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Creation ids the challenge grid needs, taken from the cached channel.
 * Submissions keep their message id so unpublished entries can be proved.
 * @param {object[]} messages
 * @param {string} challengeId
 * @returns {{ id: number, messageId: number | null }[]}
 */
export function challengeEntryRequests(messages, challengeId) {
	const id = String(challengeId || '').trim();
	if (!id) return [];
	const refs = new Map();
	const configs = [];
	for (const message of Array.isArray(messages) ? messages : []) {
		const payload = parsePayload(message);
		if (!payload || String(payload.challenge_id || '').trim() !== id) continue;
		const kind = String(payload.kind || '').trim();
		if (kind === 'challenge_config') configs.push({ payload });
		if (kind !== 'challenge_submission') continue;
		const creationId = Number(payload.created_image_id);
		const messageId = Number(message?.id);
		if (!Number.isInteger(creationId) || creationId <= 0) continue;
		refs.set(creationId, Number.isInteger(messageId) && messageId > 0 ? messageId : null);
	}
	const merged = mergeFullChallengeConfigForChallenge(configs, id);
	for (const ref of [pickChallengeHeroImageUrl(merged), pickChallengeResultsCreationUrl(merged), pickChallengeTopicVoteCreationUrl(merged)]) {
		const creationId = creationIdFromRef(ref);
		if (creationId && !refs.has(creationId)) refs.set(creationId, null);
	}
	return [...refs].map(([creationId, messageId]) => ({ id: creationId, messageId }));
}

/**
 * @param {object[]} messages
 * @returns {string[]}
 */
export function challengeIdsWithEntries(messages) {
	const ids = [];
	const seen = new Set();
	for (const message of Array.isArray(messages) ? messages : []) {
		const payload = parsePayload(message);
		if (!payload || String(payload.kind || '').trim() !== 'challenge_submission') continue;
		const id = String(payload.challenge_id || '').trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

/**
 * Cached creation cards for challenge grids. Expires with the channel snapshot.
 * @param {{ viewerId?: number | null, storage?: () => Storage, now?: () => number }} [opts]
 */
export function createChallengeEntryCache({ viewerId, storage, now = () => Date.now() } = {}) {
	const id = Number(viewerId);
	const cache = Number.isFinite(id) && id > 0
		? createStorageCache(`${CACHE_PREFIX}:${id}`, {
			storage,
			validate: (data) => Number(data?.viewerId) === id
				&& Number(data?.threadId) > 0
				&& data?.byChallenge
				&& typeof data.byChallenge === 'object'
		})
		: null;
	/** @type {{ viewerId: number, threadId: number, expiresAt: number | null, byChallenge: Record<string, object[]> } | null} */
	let memory = null;

	function readRecord(threadId, at) {
		if (!memory) memory = cache?.read()?.data || null;
		const stored = memory;
		if (!stored || Number(stored.threadId) !== Number(threadId)) return null;
		if (stored.expiresAt != null && at >= Number(stored.expiresAt)) return null;
		return stored;
	}

	function writeRecord(record) {
		memory = record;
		cache?.write({ updatedAt: now(), data: record });
	}

	return {
		/**
		 * @param {number} threadId
		 * @param {string} challengeId
		 * @returns {object[] | null}
		 */
		read(threadId, challengeId) {
			const key = String(challengeId || '').trim();
			const record = readRecord(threadId, now());
			const items = key && record?.byChallenge?.[key];
			return Array.isArray(items) ? items : null;
		},
		/**
		 * @param {number} threadId
		 * @param {string} challengeId
		 * @param {object[]} items
		 * @param {number | null} expiresAt
		 */
		write(threadId, challengeId, items, expiresAt) {
			const key = String(challengeId || '').trim();
			const tid = Number(threadId);
			if (!key || !Number.isFinite(tid) || tid <= 0 || !Array.isArray(items)) return;
			const current = readRecord(tid, now());
			const merged = new Map((current?.byChallenge?.[key] || []).map((row) => [Number(row.id), row]));
			for (const item of items) merged.set(Number(item.id), item);
			const byChallenge = { ...(current?.byChallenge || {}), [key]: [...merged.values()] };
			writeRecord({
				viewerId: id,
				threadId: tid,
				expiresAt: expiresAt ?? current?.expiresAt ?? null,
				byChallenge
			});
		},
		clear() {
			memory = null;
			cache?.clear();
		}
	};
}
