// Active WWW src/chat/chatPage.js presence ranking, unchanged.
import { CHAT_SIDEBAR_COLLAPSE_LIST_CAP } from '../../shared/chatSidebarRoster.js';

const DM_PROMOTION_RECENT_ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const DM_ORDER_WEIGHT_LAST_SEEN = 0.9;
const DM_ORDER_WEIGHT_LAST_INTERACTED = 0.1;
const DM_ORDER_LAST_SEEN_DECAY_MS = 10 * 60 * 1000;
const DM_ORDER_LAST_INTERACTED_DECAY_MS = 45 * 60 * 1000;
const DM_ORDER_RECENT_ACTIVE_EXTREME_BUMP = 8;
const DM_ORDER_ONLINE_BOOST = 1;
const DM_ORDER_STALE_OFFLINE_MULTIPLIER = 0.1;

export function prioritizeOnlineDmsInVisibleWindow(dms, opts = {}) {
	const raw = Array.isArray(dms) ? dms : [];
	const capRaw = Number(opts?.visibleCap);
	const cap =
		Number.isFinite(capRaw) && capRaw > 0
			? Math.floor(capRaw)
			: CHAT_SIDEBAR_COLLAPSE_LIST_CAP;
	const isOnline = typeof opts?.isOnline === 'function' ? opts.isOnline : () => false;
	const getLastSeenMs =
		typeof opts?.getLastSeenMs === 'function'
			? opts.getLastSeenMs
			: () => 0;
	const getLastInteractedMs =
		typeof opts?.getLastInteractedMs === 'function'
			? opts.getLastInteractedMs
			: () => 0;
	const isPriorityPresenceRow = (row, nowMs) => {
		if (isOnline(row)) return true;
		return lastSeenAgeMs(row, nowMs) <= DM_PROMOTION_RECENT_ACTIVE_WINDOW_MS;
	};
	const recencyDecayScore = (ms, nowMs, decayMs) => {
		const ts = Number(ms);
		if (!Number.isFinite(ts) || ts <= 0) return 0;
		const age = Math.max(0, nowMs - ts);
		return Math.exp(-age / decayMs);
	};
	const lastSeenAgeMs = (row, nowMs) => {
		const seenRaw = Number(getLastSeenMs(row));
		const seenMs = Number.isFinite(seenRaw) ? seenRaw : 0;
		if (seenMs <= 0) return Infinity;
		return Math.max(0, nowMs - seenMs);
	};
	const scoreRow = (row) => {
		const nowMs = Date.now();
		const online = isOnline(row);
		const recentlyActive = lastSeenAgeMs(row, nowMs) <= DM_PROMOTION_RECENT_ACTIVE_WINDOW_MS;
		const seenRaw = Number(getLastSeenMs(row));
		const seenMs = Number.isFinite(seenRaw) ? seenRaw : 0;
		const interactedRaw = Number(getLastInteractedMs(row));
		const interactedMs = Number.isFinite(interactedRaw) ? interactedRaw : 0;
		const seenScore = recencyDecayScore(seenMs, nowMs, DM_ORDER_LAST_SEEN_DECAY_MS);
		const interactedScore = recencyDecayScore(
			interactedMs,
			nowMs,
			DM_ORDER_LAST_INTERACTED_DECAY_MS
		);
		let score =
			seenScore * DM_ORDER_WEIGHT_LAST_SEEN +
			interactedScore * DM_ORDER_WEIGHT_LAST_INTERACTED;
		if (recentlyActive) {
			// Inside the 15-minute active window, presence should dominate over interaction recency.
			score += DM_ORDER_RECENT_ACTIVE_EXTREME_BUMP;
		}
		if (online) {
			score += DM_ORDER_ONLINE_BOOST;
		} else if (!recentlyActive) {
			// Strongly demote stale-offline rows so recently active users bubble up.
			score *= DM_ORDER_STALE_OFFLINE_MULTIPLIER;
		}
		return score;
	};
	const reorderVisibleWithPriorityPresenceFirst = (rows) => {
		const list = Array.isArray(rows) ? [...rows] : [];
		if (list.length === 0) return list;
		const vis = list.slice(0, cap);
		const restRows = list.slice(cap);
		const nowMs = Date.now();
		const pri = [];
		const other = [];
		for (let i = 0; i < vis.length; i += 1) {
			const row = vis[i];
			if (isPriorityPresenceRow(row, nowMs)) {
				pri.push({ row, i, score: scoreRow(row) });
			} else {
				other.push(row);
			}
		}
		pri.sort((a, b) => {
			if (a.score !== b.score) return b.score - a.score;
			return a.i - b.i;
		});
		return [...pri.map((x) => x.row), ...other, ...restRows];
	};
	if (raw.length <= cap) return reorderVisibleWithPriorityPresenceFirst(raw);

	const visible = raw.slice(0, cap);
	const rest = raw.slice(cap);
	const demotableVisibleRanked = [];
	for (let i = 0; i < visible.length; i += 1) {
		if (isOnline(visible[i])) continue;
		demotableVisibleRanked.push({ i, score: scoreRow(visible[i]) });
	}
	demotableVisibleRanked.sort((a, b) => {
		if (a.score !== b.score) return a.score - b.score;
		return a.i - b.i;
	});
	const demotableVisibleIdxs = demotableVisibleRanked.map((x) => x.i);
	if (demotableVisibleIdxs.length === 0) return [...raw];

	const promotableRestRanked = [];
	for (let i = 0; i < rest.length; i += 1) {
		const row = rest[i];
		const nowMs = Date.now();
		if (!isPriorityPresenceRow(row, nowMs)) continue;
		promotableRestRanked.push({ i, score: scoreRow(rest[i]) });
	}
	if (promotableRestRanked.length === 0) return [...raw];
	promotableRestRanked.sort((a, b) => {
		if (a.score !== b.score) return b.score - a.score;
		return a.i - b.i;
	});
	const promotableRestIdxs = promotableRestRanked.map((x) => x.i);

	const swapCount = Math.min(demotableVisibleIdxs.length, promotableRestIdxs.length);
	if (swapCount <= 0) return [...raw];
	const demoteIdxSet = new Set(demotableVisibleIdxs.slice(0, swapCount));
	const promoteIdxSet = new Set(promotableRestIdxs.slice(0, swapCount));
	const promoted = [];
	for (let i = 0; i < rest.length; i += 1) {
		if (promoteIdxSet.has(i)) promoted.push(rest[i]);
	}
	const demoted = [];
	for (let i = 0; i < visible.length; i += 1) {
		if (demoteIdxSet.has(i)) demoted.push(visible[i]);
	}
	let promotedCursor = 0;
	const newVisible = visible.map((row, i) => {
		if (!demoteIdxSet.has(i)) return row;
		const next = promoted[promotedCursor];
		promotedCursor += 1;
		return next;
	});
	const restWithoutPromoted = [];
	for (let i = 0; i < rest.length; i += 1) {
		if (!promoteIdxSet.has(i)) restWithoutPromoted.push(rest[i]);
	}
	return reorderVisibleWithPriorityPresenceFirst([...newVisible, ...demoted, ...restWithoutPromoted]);
}
