import {
	fetchCreationEmbedPayload,
	parseHeroCreationOrShareRef,
	parseHeroDirectMediaUrl
} from './userText.js';
import { mergeFullChallengeConfigForChallenge, pickChallengeHeroImageUrl } from '../chat/challenges/challengeAdmin.js';
import { extractChallengeEvents } from '../chat/challenges/model/extractEvents.js';
import { fetchAllChatThreadMessages } from '../chat/challenges/model/buildChannelModel.js';

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
	if (mediaType === 'video') {
		return thumb || url || null;
	}
	return url || thumb || null;
}

/**
 * Resolve challenge history card media refs inside a root element.
 * @param {Element | null | undefined} rootEl
 */
export async function hydrateChallengeHistoryThumbnails(rootEl) {
	const wraps = Array.from(
		rootEl?.querySelectorAll?.('[data-challenge-history-thumb-pending]') || []
	);
	for (const wrap of wraps) {
		if (!(wrap instanceof HTMLElement)) continue;
		const raw = wrap.getAttribute('data-challenge-history-thumb-ref') || '';
		const img = wrap.querySelector('[data-challenge-history-thumb-img]');
		const fallback = wrap.querySelector('[data-challenge-history-thumb-fallback]');

		const showFallback = () => {
			wrap.removeAttribute('data-challenge-history-thumb-pending');
			if (img instanceof HTMLImageElement) {
				img.removeAttribute('src');
				img.hidden = true;
			}
			if (fallback instanceof HTMLElement) {
				fallback.hidden = false;
			}
		};

		if (!(img instanceof HTMLImageElement)) {
			showFallback();
			continue;
		}

		let src = null;
		const challengeId = wrap.getAttribute('data-challenge-id') || '';
		const challengeOpts = challengeId ? { challengeId } : null;
		const cref = parseHeroCreationOrShareRef(raw);
		if (cref?.kind === 'creation') {
			const data = await fetchCreationEmbedPayload(cref.creationId, cref.shareOpts, challengeOpts);
			src = imageUrlFromCreationPayload(data);
		} else {
			src = parseHeroDirectMediaUrl(raw);
		}

		if (!src) {
			showFallback();
			continue;
		}

		if (fallback instanceof HTMLElement) fallback.hidden = true;
		wrap.removeAttribute('data-challenge-history-thumb-pending');
		img.hidden = false;
		img.addEventListener(
			'error',
			() => {
				showFallback();
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
