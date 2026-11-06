import {
	fetchCreationEmbedPayload,
	parseHeroCreationOrShareRef,
	parseHeroDirectMediaUrl
} from './userText.js';
import { mergeFullChallengeConfigForChallenge, pickChallengeHeroImageUrl } from '../chat/challenges/challengeAdmin.js';
import { extractChallengeEvents } from '../chat/challenges/model/extractEvents.js';
import { fetchAllChatThreadMessages } from '../chat/challenges/model/buildChannelModel.js';
import { readChallengesChannelCache } from '../chat/challenges/challengesChannelCache.js';
import {
	challengeHistoryThumbCacheKey,
	isChallengeHistoryThumbCacheStale,
	readChallengeHistoryThumbCache,
	writeChallengeHistoryThumbCache
} from './challengeHistoryThumbCache.js';

/**
 * Same hero ref resolution as the Challenges pane history cards.
 * @param {{ msg: object, payload: object }[]} configEntries
 * @param {unknown} challengeId
 */
export function challengeHeroRefFromConfigEntries(configEntries, challengeId) {
	return pickChallengeHeroImageUrl(mergeFullChallengeConfigForChallenge(configEntries, challengeId));
}

/**
 * Match {@link ../chat/challenges/views/emptyParticipantView.js} thumb markup exactly.
 * @param {unknown} heroRef
 * @param {unknown} challengeId
 * @param {(value: unknown) => string} escapeHtml
 */
export function renderChallengeHistoryThumbWrapHtml(heroRef, challengeId, escapeHtml) {
	const esc = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value ?? '');
	const ref = typeof heroRef === 'string' ? heroRef.trim() : '';
	const cid = typeof challengeId === 'string' ? challengeId.trim() : '';
	const challengeIdAttr = cid ? ` data-challenge-id="${esc(cid)}"` : '';
	return `<div class="challenge-pane-history-card-thumb-wrap" data-challenge-history-thumb-pending data-challenge-history-thumb-ref="${esc(ref)}"${challengeIdAttr}>
		<img class="challenge-pane-history-card-thumb" alt="" loading="lazy" hidden data-challenge-history-thumb-img />
		<div class="challenge-pane-history-card-thumb-fallback" aria-hidden="true" data-challenge-history-thumb-fallback></div>
	</div>`;
}

/**
 * Fill thumb refs from merged challenge configs (Challenges pane source of truth).
 * @param {Element | null | undefined} rootEl
 * @param {{ msg: object, payload: object }[]} configEntries
 */
export function enrichChallengeHistoryThumbRefs(rootEl, configEntries) {
	const wraps = Array.from(
		rootEl?.querySelectorAll?.('[data-challenge-history-thumb-pending]') || []
	);
	for (const wrap of wraps) {
		if (!(wrap instanceof HTMLElement)) continue;
		const cid = wrap.getAttribute('data-challenge-id') || '';
		if (!cid) continue;
		const ref = challengeHeroRefFromConfigEntries(configEntries, cid);
		if (ref) wrap.setAttribute('data-challenge-history-thumb-ref', ref);
	}
}

/**
 * Prefer compact thumbnail URLs for small history / organize cards.
 * @param {object | null} data — GET /api/create/images/:id
 * @returns {string | null}
 */
function imageUrlFromCreationPayload(data) {
	if (!data || data._error) return null;
	const statusRaw =
		typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'completed';
	if (statusRaw !== 'completed') return null;
	const mediaType = typeof data.media_type === 'string' ? data.media_type : 'image';
	const url = typeof data.url === 'string' ? data.url.trim() : '';
	const thumb =
		typeof data.thumbnail_url === 'string' ? data.thumbnail_url.trim() : '';
	// Card thumbs are ~72–160px: always prefer the thumbnail variant when present.
	if (mediaType === 'video') {
		return thumb || url || null;
	}
	return thumb || url || null;
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLImageElement} img
 * @param {HTMLElement | null} fallback
 * @param {string} src
 * @param {{ keepOnError?: string | null }} [opts]
 */
function applyThumbSrc(wrap, img, fallback, src, opts) {
	const keepOnError =
		typeof opts?.keepOnError === 'string' && opts.keepOnError.trim()
			? opts.keepOnError.trim()
			: null;
	if (fallback) fallback.hidden = true;
	wrap.removeAttribute('data-challenge-history-thumb-pending');
	img.hidden = false;
	if (img.getAttribute('src') === src) {
		if (img.complete && img.naturalWidth > 0) {
			wrap.removeAttribute('data-challenge-history-thumb-pending');
			img.hidden = false;
		}
		return;
	}
	img.addEventListener(
		'error',
		() => {
			if (keepOnError) {
				img.src = keepOnError;
				img.hidden = false;
				if (fallback) fallback.hidden = true;
				return;
			}
			wrap.removeAttribute('data-challenge-history-thumb-pending');
			img.removeAttribute('src');
			img.hidden = true;
			if (fallback) fallback.hidden = false;
		},
		{ once: true }
	);
	img.addEventListener(
		'load',
		() => {
			if (img.naturalWidth > 0) {
				wrap.removeAttribute('data-challenge-history-thumb-pending');
				img.hidden = false;
			}
		},
		{ once: true }
	);
	img.src = src;
	if (img.complete && img.naturalWidth > 0) {
		wrap.removeAttribute('data-challenge-history-thumb-pending');
		img.hidden = false;
	}
}

/**
 * Resolve one pending thumb wrap (stale-then-refresh when a cached URL exists).
 * @param {HTMLElement} wrap
 */
async function hydrateOneChallengeHistoryThumb(wrap) {
	const raw = wrap.getAttribute('data-challenge-history-thumb-ref') || '';
	const img = wrap.querySelector('[data-challenge-history-thumb-img]');
	const fallbackEl = wrap.querySelector('[data-challenge-history-thumb-fallback]');
	const fallback = fallbackEl instanceof HTMLElement ? fallbackEl : null;

	const showFallback = () => {
		wrap.removeAttribute('data-challenge-history-thumb-pending');
		if (img instanceof HTMLImageElement) {
			img.removeAttribute('src');
			img.hidden = true;
		}
		if (fallback) fallback.hidden = false;
	};

	if (!(img instanceof HTMLImageElement)) {
		showFallback();
		return;
	}

	const challengeId = wrap.getAttribute('data-challenge-id') || '';
	const cacheKey = challengeHistoryThumbCacheKey(raw, challengeId);
	const cached = cacheKey ? readChallengeHistoryThumbCache(cacheKey) : null;
	let paintedFromCache = false;
	let cachedUrl = '';

	if (cached?.url) {
		cachedUrl = cached.url;
		applyThumbSrc(wrap, img, fallback, cachedUrl);
		paintedFromCache = true;
		if (!isChallengeHistoryThumbCacheStale(cached.cachedAt)) {
			return;
		}
	}

	let src = null;
	const challengeOpts = challengeId ? { challengeId } : null;
	const cref = parseHeroCreationOrShareRef(raw);
	if (cref?.kind === 'creation') {
		const data = await fetchCreationEmbedPayload(cref.creationId, cref.shareOpts, challengeOpts);
		src = imageUrlFromCreationPayload(data);
	} else {
		src = parseHeroDirectMediaUrl(raw);
	}

	if (!src) {
		if (!paintedFromCache) showFallback();
		return;
	}

	if (cacheKey) writeChallengeHistoryThumbCache(cacheKey, src);

	if (paintedFromCache && img.getAttribute('src') === src) return;
	applyThumbSrc(wrap, img, fallback, src, {
		keepOnError: paintedFromCache ? cachedUrl : null
	});
}

/**
 * Resolve challenge history card media refs inside a root element.
 * Fetches in parallel; paints cached URLs immediately (stale-then-refresh).
 * @param {Element | null | undefined} rootEl
 */
export async function hydrateChallengeHistoryThumbnails(rootEl) {
	const wraps = Array.from(
		rootEl?.querySelectorAll?.('[data-challenge-history-thumb-pending]') || []
	).filter((el) => el instanceof HTMLElement);
	if (!wraps.length) return;
	await Promise.all(wraps.map((wrap) => hydrateOneChallengeHistoryThumb(wrap)));
}

/**
 * @param {Function} fetchJson
 * @returns {Promise<{ msg: object, payload: object }[]>}
 */
export async function fetchChallengesChannelConfigEntries(fetchJson) {
	const result = await fetchJson('/api/chat/threads', { credentials: 'include' });
	if (!result?.ok) return [];
	const threads = Array.isArray(result.data?.threads) ? result.data.threads : [];
	const challengesThread = threads.find((row) => {
		if (!row || row.type !== 'channel') return false;
		return String(row.channel_slug || '').trim().toLowerCase() === 'challenges';
	});
	const threadId = challengesThread?.id != null ? Number(challengesThread.id) : NaN;
	if (!Number.isFinite(threadId) || threadId <= 0) return [];

	const cached = readChallengesChannelCache();
	if (
		cached &&
		Number(cached.threadId) === threadId &&
		Array.isArray(cached.messages) &&
		cached.messages.length > 0
	) {
		return extractChallengeEvents(cached.messages).configs;
	}

	const messages = await fetchAllChatThreadMessages(threadId);
	return extractChallengeEvents(messages).configs;
}

/**
 * Challenges pane parity: resolve refs from thread configs, then hydrate thumbs.
 * @param {Element | null | undefined} rootEl
 * @param {Function} fetchJson
 */
export async function hydrateChallengeFeedCardThumbsLikePane(rootEl, fetchJson) {
	if (!(rootEl instanceof Element)) return;
	try {
		const configEntries = await fetchChallengesChannelConfigEntries(fetchJson);
		if (configEntries.length) {
			enrichChallengeHistoryThumbRefs(rootEl, configEntries);
		}
	} catch (err) {
		console.warn('[feed] challenge card thumb configs', err?.message || err);
	}
	await hydrateChallengeHistoryThumbnails(rootEl);
}
