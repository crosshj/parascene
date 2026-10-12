import { createStorageCache } from '../../core/storageCache.js';
import { challengeEntryRequests, challengeIdsWithEntries, createChallengeEntryCache } from './entryCreations.js';
import { pickChallengeConfigTimestamp } from '../../shared/challenges/challengeAdmin.js';
import { parseIso } from '../../shared/challenges/constants.js';
import { buildChallengesChannelModel } from '../../shared/challenges/model/buildChannelModel.js';
import { ACTIVE_PARTICIPANT_PHASES } from '../../shared/challenges/model/participantSlice.js';
import { deriveChallengePhase } from '../../shared/challenges/model/phases.js';

const CACHE_PREFIX = 'prsn-vps-challenge-history-v1';
const ACTIVE_MAX_AGE_MS = 15_000;

function boundaryTimes(cfg) {
	const times = [];
	for (const field of ['submission_start_at', 'submission_end_at', 'voting_start_at', 'voting_end_at']) {
		const ms = parseIso(pickChallengeConfigTimestamp(cfg, field));
		if (ms != null) times.push(ms);
	}
	return times;
}

/**
 * First instant after `nowMs` when this challenge is no longer active.
 * Computed from the config saved with the snapshot.
 * @param {object | null | undefined} cfg
 * @param {number} nowMs
 * @returns {number | null}
 */
export function nextActiveChallengeInactiveAt(cfg, nowMs) {
	if (!cfg || !ACTIVE_PARTICIPANT_PHASES.has(deriveChallengePhase(cfg, nowMs))) return null;
	const future = boundaryTimes(cfg).filter((time) => time > nowMs).sort((a, b) => a - b);
	for (const time of future) {
		if (!ACTIVE_PARTICIPANT_PHASES.has(deriveChallengePhase(cfg, time + 1))) return time + 1;
	}
	return null;
}

/**
 * When this snapshot of the channel stops being a valid picture of previous challenges:
 * the soonest moment any challenge that is active at save time becomes inactive.
 * @param {object[]} messages
 * @param {number} nowMs
 * @returns {number | null}
 */
export function challengeHistoryExpiresAt(messages, nowMs) {
	const model = buildChallengesChannelModel(messages, { nowMs });
	let expiresAt = null;
	for (const item of model.participant?.activeChallenges || []) {
		const at = nextActiveChallengeInactiveAt(item.latestConfig, nowMs);
		if (at == null) continue;
		if (expiresAt == null || at < expiresAt) expiresAt = at;
	}
	return expiresAt;
}

/**
 * @param {object[]} messages
 * @param {string} challengeId
 * @param {number} nowMs
 */
export function challengeIsActive(messages, challengeId, nowMs) {
	const id = String(challengeId || '').trim();
	if (!id) return false;
	const model = buildChallengesChannelModel(messages, { nowMs });
	return (model.participant?.activeChallenges || []).some((item) => item.challengeId === id);
}

function parsePayload(message) {
	const raw = message?.body;
	const text = typeof raw === 'string' ? raw.trim() : '';
	if (!text || !text.startsWith('{')) return null;
	try {
		const payload = JSON.parse(text);
		return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
	} catch {
		return null;
	}
}

function messageChallengeId(message) {
	const payload = parsePayload(message);
	if (!payload || payload.challenge_id == null) return '';
	return String(payload.challenge_id).trim();
}

/** Config and submission messages for challenges that are active at `now`. */
function activeSlice(messages, now) {
	const model = buildChallengesChannelModel(messages, { nowMs: now });
	const ids = new Set((model.participant?.activeChallenges || []).map((item) => item.challengeId));
	if (!ids.size) return [];
	return messages.filter((message) => {
		const payload = parsePayload(message);
		const kind = typeof payload?.kind === 'string' ? payload.kind.trim() : '';
		if (kind !== 'challenge_config' && kind !== 'challenge_submission') return false;
		return ids.has(messageChallengeId(message));
	});
}

function mergeMessages(base, overlay) {
	const map = new Map();
	for (const message of base || []) map.set(String(message?.id), message);
	for (const message of overlay || []) map.set(String(message?.id), message);
	return [...map.values()].sort((a, b) => Number(a?.id) - Number(b?.id));
}

/**
 * Channel history for previous challenges, plus a short cache for active ones.
 * A view asks for the main page or one challenge. This provider decides whether
 * that request is served from cache, fetched, or served stale while it updates.
 * The channel snapshot expires when the earliest active challenge becomes inactive.
 * The active cache is kept only briefly, and any channel change replaces it.
 * @param {{ viewerId?: number | null, storage?: () => Storage, now?: () => number, activeMaxAge?: number }} [opts]
 */
export function createChallengeHistoryProvider({ viewerId, storage, now = () => Date.now(), activeMaxAge = ACTIVE_MAX_AGE_MS } = {}) {
	const id = Number(viewerId);
	const cacheKey = `${CACHE_PREFIX}:${id}`;
	const cache = Number.isFinite(id) && id > 0
		? createStorageCache(cacheKey, {
			storage,
			validate: (data) => Number(data?.viewerId) === id
				&& Number(data?.threadId) > 0
				&& Array.isArray(data?.messages)
				&& (data.expiresAt == null || Number.isFinite(Number(data.expiresAt)))
		})
		: null;
	/** @type {Map<number, { threadId: number, savedAt: number, messages: object[] }>} */
	const activeByThread = new Map();
	const entries = createChallengeEntryCache({ viewerId, storage, now });
	/** @type {Map<string, Promise<object[]>>} */
	const entryLoads = new Map();
	/** @type {Map<number, { threadId: number, loadChannel: Function | null, inflight: { history: boolean, active: boolean, promise: Promise<void> } | null, subs: Set<object>, timer: ReturnType<typeof setTimeout> | null, historyTimer: ReturnType<typeof setTimeout> | null }>} */
	const slots = new Map();
	let lastLog = '';

	function log(state, detail = {}) {
		const key = `${state}:${detail.part || ''}:${detail.reason || ''}:${detail.source || ''}:${detail.view || ''}:${detail.messages ?? ''}:${detail.challengeId || ''}`;
		const quiet = state === 'serve' || state === 'fetch' || state === 'update';
		if (quiet && key === lastLog) return;
		lastLog = key;
		// console.log('[challenge-history]', state, detail);
	}

	function readHistory() {
		return cache?.read()?.data || null;
	}

	function historyState(threadId, at) {
		if (!cache) return { status: 'missing', reason: 'no viewer cache' };
		const data = readHistory();
		if (!data) return { status: 'missing', reason: 'empty' };
		if (Number(data.threadId) !== Number(threadId)) return { status: 'missing', reason: 'thread mismatch' };
		if (data.expiresAt != null && at >= Number(data.expiresAt)) return { status: 'stale', data };
		return { status: 'fresh', data };
	}

	function activeState(threadId, at) {
		const data = activeByThread.get(Number(threadId));
		if (!data) return { status: 'missing' };
		if (at >= data.savedAt + activeMaxAge) return { status: 'stale', data };
		return { status: 'fresh', data };
	}

	function saveHistory(threadId, messages, at, replacing) {
		if (!cache || !Array.isArray(messages)) return null;
		const expiresAt = challengeHistoryExpiresAt(messages, at);
		cache.write({
			updatedAt: at,
			data: { viewerId: id, threadId: Number(threadId), expiresAt, messages }
		});
		const stored = readHistory();
		if (!stored) {
			log('save failed', { reason: 'write did not persist', threadId: Number(threadId), messages: messages.length });
			return null;
		}
		log(replacing ? 'updated' : 'stored', { part: 'channel', threadId: Number(threadId), messages: stored.messages.length, expiresAt });
		return stored;
	}

	function saveActive(threadId, messages, at) {
		const slice = activeSlice(messages, at);
		const record = { threadId: Number(threadId), savedAt: at, messages: slice };
		activeByThread.set(Number(threadId), record);
		log('updated', { part: 'active', threadId: Number(threadId), messages: slice.length, maxAge: activeMaxAge });
		return record;
	}

	/**
	 * @param {{ kind: 'main' } | { kind: 'challenge', challengeId: string }} request
	 */
	function answer(threadId, request, at) {
		const history = historyState(threadId, at);
		const active = activeState(threadId, at);
		const historyMessages = history.data?.messages || null;
		if (request.kind === 'challenge') {
			const challengeId = String(request.challengeId || '').trim();
			const known = historyMessages ? challengeIsActive(historyMessages, challengeId, at) : null;
			if (known === false && historyMessages) {
				return {
					paint: 'challenge',
					messages: historyMessages,
					source: history.status === 'stale' ? 'stale' : 'cache',
					active: false,
					error: null
				};
			}
			if (known === true && active.data) {
				const mine = active.data.messages.filter((message) => messageChallengeId(message) === challengeId);
				return {
					paint: 'challenge',
					messages: mergeMessages(historyMessages, mine),
					source: active.status === 'stale' ? 'stale' : 'cache',
					active: true,
					error: null
				};
			}
			return { paint: 'pending', messages: null, source: null, active: known === true, error: null };
		}
		if (active.data) {
			return {
				paint: 'board',
				messages: mergeMessages(historyMessages, active.data.messages),
				source: active.status === 'stale' || history.status === 'stale' ? 'stale' : 'cache',
				active: true,
				error: null
			};
		}
		if (historyMessages) {
			return { paint: 'previous', messages: historyMessages, source: history.status === 'stale' ? 'stale' : 'cache', active: false, error: null };
		}
		return { paint: 'pending', messages: null, source: null, active: null, error: null };
	}

	function publish(slot, { exceptPast = false } = {}) {
		const at = now();
		for (const sub of slot.subs) {
			const delivery = answer(slot.threadId, sub.request, at);
			if (exceptPast && delivery.paint === 'challenge' && delivery.active === false) continue;
			if (delivery.paint !== 'pending') {
				log('serve', {
					view: sub.request.kind === 'challenge' ? 'challenge' : 'main',
					part: delivery.paint,
					source: delivery.source,
					challengeId: sub.request.challengeId || '',
					messages: delivery.messages?.length || 0
				});
			}
			try { sub.listener(delivery); } catch (error) { console.error('[challenge-history] listener failed', error); }
		}
	}

	function armActiveTimer(slot) {
		clearTimeout(slot.timer);
		const record = activeByThread.get(slot.threadId);
		if (!record || !slot.subs.size) return;
		const delay = Math.max(0, record.savedAt + activeMaxAge - now());
		slot.timer = setTimeout(() => {
			slot.timer = null;
			if (!activeByThread.has(slot.threadId)) return;
			log('update', { part: 'active', reason: 'max age', threadId: slot.threadId });
			void runFetch(slot, { history: false, active: true });
		}, delay);
		slot.timer.unref?.();
	}

	function armHistoryTimer(slot) {
		clearTimeout(slot.historyTimer);
		const expiresAt = historyState(slot.threadId, now()).data?.expiresAt;
		if (expiresAt == null || !slot.subs.size) return;
		const delay = Number(expiresAt) - now();
		if (!(delay >= 0) || delay > 2_147_000_000) return;
		slot.historyTimer = setTimeout(() => {
			slot.historyTimer = null;
			log('update', { part: 'channel', reason: 'expired', threadId: slot.threadId });
			void runFetch(slot, { history: true, active: true });
		}, delay);
		slot.historyTimer.unref?.();
	}

	function runFetch(slot, writes) {
		if (!slot.loadChannel) {
			log('fetch failed', { reason: 'no loader', threadId: slot.threadId });
			return Promise.resolve();
		}
		if (slot.inflight) {
			slot.inflight.history = slot.inflight.history || writes.history;
			slot.inflight.active = slot.inflight.active || writes.active;
			return slot.inflight.promise;
		}
		const job = { history: writes.history, active: writes.active, promise: null };
		job.promise = (async () => {
			try {
				const messages = await slot.loadChannel(slot.threadId);
				if (!Array.isArray(messages)) throw new Error('Challenge channel response was empty.');
				const at = now();
				if (job.history) {
					const existing = historyState(slot.threadId, at);
					saveHistory(slot.threadId, messages, at, existing.status === 'stale');
				}
				if (job.active || job.history) saveActive(slot.threadId, messages, at);
				if (job.history) void warmEntryCreations(slot, messages);
				publish(slot);
				armActiveTimer(slot);
				armHistoryTimer(slot);
			} catch (error) {
				log('fetch failed', { reason: error?.message || 'fetch failed', threadId: slot.threadId });
				const at = now();
				for (const sub of slot.subs) {
					const delivery = answer(slot.threadId, sub.request, at);
					try { sub.listener({ ...delivery, error }); } catch (listenerError) { console.error('[challenge-history] listener failed', listenerError); }
				}
			} finally {
				if (slot.inflight === job) slot.inflight = null;
			}
		})();
		slot.inflight = job;
		return job.promise;
	}

	function ensure(slot, request) {
		const at = now();
		const history = historyState(slot.threadId, at);
		const active = activeState(slot.threadId, at);
		let wantHistory = history.status !== 'fresh';
		let wantActive = false;
		if (request.kind === 'main') wantActive = active.status !== 'fresh';
		else if (history.data && challengeIsActive(history.data.messages, request.challengeId, at)) wantActive = active.status !== 'fresh';
		else if (!history.data) wantHistory = true;
		if (!wantHistory && !wantActive) return;
		if (wantHistory) log(history.status === 'stale' ? 'update' : 'fetch', { part: 'channel', reason: history.reason || history.status, view: request.kind, threadId: slot.threadId });
		else log(active.status === 'stale' ? 'update' : 'fetch', { part: 'active', reason: active.status, view: request.kind, challengeId: request.challengeId || '', threadId: slot.threadId });
		void runFetch(slot, { history: wantHistory, active: wantActive });
	}

	function slotFor(threadId, loadChannel, loadEntryCreations) {
		const tid = Number(threadId);
		let slot = slots.get(tid);
		if (!slot) {
			slot = { threadId: tid, loadChannel: null, loadEntryCreations: null, inflight: null, subs: new Set(), timer: null, historyTimer: null };
			slots.set(tid, slot);
		}
		if (typeof loadChannel === 'function') slot.loadChannel = loadChannel;
		if (typeof loadEntryCreations === 'function') slot.loadEntryCreations = loadEntryCreations;
		return slot;
	}

	function ensureEntryCreations(threadId, challengeId, items) {
		const tid = Number(threadId);
		const key = String(challengeId || '').trim();
		const requested = Array.isArray(items) ? items : [];
		const cached = entries.read(tid, key) || [];
		const have = new Set(cached.map((row) => Number(row.id)));
		const missing = requested.filter((item) => !have.has(Number(item?.id)));
		if (cached.length && !missing.length) {
			log('serve', { part: 'entries', source: 'cache', challengeId: key, messages: cached.length });
			return Promise.resolve(cached);
		}
		const slot = slots.get(tid);
		if (!slot?.loadEntryCreations || !key) return Promise.resolve(cached);
		const loadKey = `${tid}:${key}`;
		const pending = entryLoads.get(loadKey);
		if (pending) return pending;
		log('fetch', { part: 'entries', reason: 'missing', challengeId: key, messages: missing.length || requested.length, threadId: tid });
		const job = Promise.resolve()
			.then(() => slot.loadEntryCreations(tid, key, missing.length ? missing : requested))
			.then((result) => {
				const list = Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : [];
				const expiresAt = historyState(tid, now()).data?.expiresAt ?? null;
				entries.write(tid, key, list, expiresAt);
				const stored = entries.read(tid, key) || list;
				log('stored', { part: 'entries', challengeId: key, messages: stored.length, threadId: tid });
				return stored;
			})
			.catch((error) => {
				log('fetch failed', { part: 'entries', reason: error?.message || 'fetch failed', challengeId: key });
				return [];
			})
			.finally(() => { entryLoads.delete(loadKey); });
		entryLoads.set(loadKey, job);
		return job;
	}

	async function warmEntryCreations(slot, messages) {
		if (!slot.loadEntryCreations) return;
		const ids = [];
		for (const sub of slot.subs) {
			if (sub.request?.kind === 'challenge' && sub.request.challengeId) ids.push(String(sub.request.challengeId));
		}
		for (const id of challengeIdsWithEntries(messages)) if (!ids.includes(id)) ids.push(id);
		const queue = ids.filter((id) => !entries.read(slot.threadId, id));
		let cursor = 0;
		async function worker() {
			while (cursor < queue.length) {
				const challengeId = queue[cursor++];
				const items = challengeEntryRequests(messages, challengeId);
				if (!items.length) continue;
				await ensureEntryCreations(slot.threadId, challengeId, items);
			}
		}
		await Promise.all([worker(), worker()]);
	}

	return {
		/**
		 * Ask for the main page or one challenge. The listener is called with what can be
		 * served now, and again when a fetch or a channel-change update replaces it.
		 * @param {{ threadId: number, request: { kind: 'main' } | { kind: 'challenge', challengeId: string }, loadChannel: (threadId: number) => Promise<object[]> }} spec
		 * @param {(delivery: { paint: 'pending' | 'previous' | 'board' | 'challenge', messages: object[] | null, source: 'cache' | 'stale' | 'fetch' | null, active: boolean | null, error: Error | null }) => void} listener
		 */
		observe({ threadId, request, loadChannel, loadEntryCreations }, listener) {
			const slot = slotFor(threadId, loadChannel, loadEntryCreations);
			const sub = { request, listener };
			slot.subs.add(sub);
			const delivery = answer(slot.threadId, request, now());
			if (delivery.paint !== 'pending') {
				log('serve', {
					view: request.kind === 'challenge' ? 'challenge' : 'main',
					part: delivery.paint,
					source: delivery.source,
					challengeId: request.challengeId || '',
					messages: delivery.messages?.length || 0
				});
			}
			try { listener(delivery); } catch (error) { console.error('[challenge-history] listener failed', error); }
			ensure(slot, request);
			armHistoryTimer(slot);
			return () => {
				slot.subs.delete(sub);
				if (!slot.subs.size) {
					clearTimeout(slot.timer);
					clearTimeout(slot.historyTimer);
					slot.timer = null;
					slot.historyTimer = null;
				}
			};
		},
		/**
		 * The sidebar badge is counted from the live channel. Fold that snapshot into
		 * the challenges cache so the main page shows the same new submission.
		 * A past challenge already on screen is left as it is.
		 * @param {number} threadId
		 * @param {object[]} messages
		 */
		applyChannelSnapshot(threadId, messages) {
			if (!Array.isArray(messages)) return;
			const tid = Number(threadId);
			const at = now();
			saveHistory(tid, messages, at, Boolean(readHistory()));
			saveActive(tid, messages, at);
			const slot = slots.get(tid);
			if (!slot) return;
			publish(slot, { exceptPast: true });
			armActiveTimer(slot);
			armHistoryTimer(slot);
		},
		/**
		 * Unread count moved before the new message is in hand. Drop the fresh
		 * active cache so the main page loads the channel instead of the old snapshot.
		 * @param {number} threadId
		 */
		noteChallengePing(threadId) {
			const tid = Number(threadId);
			const existing = activeByThread.get(tid);
			if (existing) existing.savedAt = Number.NEGATIVE_INFINITY;
			const slot = slots.get(tid);
			if (!slot?.subs.size) return;
			const at = now();
			const pastOnly = [...slot.subs].every((sub) => {
				const delivery = answer(slot.threadId, sub.request, at);
				return delivery.paint === 'challenge' && delivery.active === false;
			});
			if (pastOnly) return;
			log('update', { part: 'active', reason: 'attention', threadId: tid });
			void runFetch(slot, { history: true, active: true });
		},
		/**
		 * A reaction, new message, or other channel change replaces the short active cache.
		 * Messages from that change are stored directly. Without them, the active cache is refreshed.
		 * @param {number} threadId
		 * @param {{ reason?: string, messages?: object[] }} [detail]
		 */
		invalidateActive(threadId, { reason = 'channel change', messages } = {}) {
			const tid = Number(threadId);
			log('invalidate', { part: 'active', reason, threadId: tid, messages: Array.isArray(messages) ? messages.length : null });
			if (Array.isArray(messages)) {
				saveActive(tid, messages, now());
				const slot = slots.get(tid);
				if (slot) {
					publish(slot);
					armActiveTimer(slot);
					armHistoryTimer(slot);
				}
				return;
			}
			const existing = activeByThread.get(tid);
			if (existing) existing.savedAt = Number.NEGATIVE_INFINITY;
			const slot = slots.get(tid);
			if (!slot) return;
			publish(slot);
			log('update', { part: 'active', reason, threadId: tid });
			void runFetch(slot, { history: false, active: true });
		},
		preload() {},
		syncExternalCache(event) {
			if (event?.key !== cacheKey) return;
			for (const slot of slots.values()) publish(slot);
		},
		entryCreations(threadId, challengeId) {
			return entries.read(threadId, challengeId);
		},
		ensureEntryCreations,
		clearCache() {
			cache?.clear();
			activeByThread.clear();
			entries.clear();
		},
		destroy() {
			for (const slot of slots.values()) {
				clearTimeout(slot.timer);
				clearTimeout(slot.historyTimer);
			}
			slots.clear();
			activeByThread.clear();
		}
	};
}
