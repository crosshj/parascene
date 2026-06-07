import {
	CHALLENGE_SCORE_REACTION_KEYS,
	challengeReactionKeyToScore,
	challengeScoreToReactionKey,
	parseIso
} from './constants.js';
import { MODAL_DISMISS_ICON_SVG } from '../../shared/modalDismiss.js';

/**
 * Set while the vote modal is open. Chat page `popstate` must call
 * {@link dismissChallengeVoteModalFromBrowserHistoryIfOpen} before `openThreadForCurrentPath`
 * (same pattern as the inline image lightbox).
 */
let challengeVoteModalPopstateDismiss = /** @type {null | (() => void)} */ (null);

/**
 * @returns {boolean} true if the vote modal was open and is now torn down (suppress further popstate handling).
 */
export function dismissChallengeVoteModalFromBrowserHistoryIfOpen() {
	if (!challengeVoteModalPopstateDismiss) return false;
	challengeVoteModalPopstateDismiss();
	return true;
}

/**
 * @param {{ viewerVote?: string | null }} row
 * @returns {number} 0 = none, 1–10 = score
 */
export function scoreFromChallengeRow(row) {
	const k = row.viewerVote;
	if (!k) return 0;
	return challengeReactionKeyToScore(k) ?? 0;
}

/**
 * Submissions with message id for blind voting: **unvoted entries first**, then by **`created_at` descending**
 * (newest among unvoted, newest among voted).
 * @param {object[]} ranked — ranked submission rows from participant model
 */
export function buildVoteSlidesNewestFirst(ranked) {
	const votedRank = (row) => (scoreFromChallengeRow(row) > 0 ? 1 : 0);
	return [...ranked]
		.filter((r) => r.messageId && Number(r.messageId) > 0)
		.sort((a, b) => {
			const ra = votedRank(a);
			const rb = votedRank(b);
			if (ra !== rb) return ra - rb;
			const tb = parseIso(b.msg?.created_at) ?? 0;
			const ta = parseIso(a.msg?.created_at) ?? 0;
			return tb - ta;
		});
}

/**
 * @param {object} row — ranked submission row (mutates msg.viewer_reactions + viewerVote)
 * @param {number} score0to10
 */
function patchRowViewerChallengeVote(row, score0to10) {
	const targetKey = challengeScoreToReactionKey(score0to10);
	const prev = Array.isArray(row.msg.viewer_reactions) ? row.msg.viewer_reactions : [];
	const kept = prev.filter((k) => !CHALLENGE_SCORE_REACTION_KEYS.includes(k));
	row.msg.viewer_reactions = targetKey ? [...kept, targetKey] : kept;
	row.viewerVote = targetKey || null;
}

/**
 * @param {number} messageId
 * @param {number} score0to10
 * @param {object} row
 * @param {(mid: number, key: string) => Promise<{ ok?: boolean }>} toggleReaction
 */
export async function applyChallengeVoteScore(messageId, score0to10, row, toggleReaction) {
	let vr = Array.isArray(row.msg.viewer_reactions) ? [...row.msg.viewer_reactions] : [];
	const targetKey = challengeScoreToReactionKey(score0to10);

	if (!targetKey) {
		for (const k of CHALLENGE_SCORE_REACTION_KEYS) {
			if (!vr.includes(k)) continue;
			const res = await toggleReaction(messageId, k);
			if (!res.ok) throw new Error('Could not update vote');
			vr = vr.filter((x) => x !== k);
		}
		patchRowViewerChallengeVote(row, 0);
		return;
	}

	for (const k of CHALLENGE_SCORE_REACTION_KEYS) {
		if (k === targetKey) continue;
		if (!vr.includes(k)) continue;
		const res = await toggleReaction(messageId, k);
		if (!res.ok) throw new Error('Could not update vote');
		vr = vr.filter((x) => x !== k);
	}
	if (!vr.includes(targetKey)) {
		const res = await toggleReaction(messageId, targetKey);
		if (!res.ok) throw new Error('Could not update vote');
	}
	patchRowViewerChallengeVote(row, score0to10);
}

function escAttr(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/** @param {number} score 1–10 (fractional allowed for smooth hue) */
function heatHue(score) {
	const n = Math.min(10, Math.max(1, Number(score)) || 1);
	return Math.round(218 - ((n - 1) / 9) * 208);
}

/** Thumb position along padded track: 0 = unpicked (center); 1–10 continuous left→right. */
function thumbFracFromHeatScore(v) {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) return 0.5;
	const clamped = Math.min(10, Math.max(1, n));
	return (clamped - 1) / 9;
}

/**
 * @param {{
 *   toggleReaction: (messageId: number, emojiKey: string) => Promise<{ ok?: boolean }>,
 *   onAfterVote?: () => void,
 * }} opts
 */
export function createChallengeVoteModal(opts) {
	const { toggleReaction, onAfterVote } = opts;
	let overlay = /** @type {HTMLElement | null} */ (null);
	let slides = /** @type {object[]} */ ([]);
	let slideIdx = 0;
	let cacheByCreationId = /** @type {Map<number, object | null>} */ (new Map());
	/** In-flight creation fetches so prefetch + main render share one network request. */
	let creationFetchInflight = /** @type {Map<number, Promise<object | null>>} */ (new Map());
	/** Keeps preload Image/Video elements alive so decoding/buffering isn’t GC’d mid-load. */
	let prefetchKeepAlive = /** @type {(HTMLImageElement | HTMLVideoElement)[]} */ ([]);
	/** Avoid assigning the same media URL to multiple warm loaders. */
	let mediaWarmByCreationId = /** @type {Set<number>} */ (new Set());
	const PREFETCH_KEEPALIVE_CAP = 24;
	let sliderBusy = false;
	/** True until the heat slider has been painted once from row data for the current slide (each navigation seeds once). */
	let heatNeedsSeedFromRow = true;
	/** Last value passed to paintHeatUi — thumb stays here; row/reactions must not override until the next slide. */
	let lastPaintedHeatScore = 0;
	/** While voting API runs, keep slider paint aligned to the score being committed (row updates after await). */
	let pendingHeatScore = /** @type {number | null} */ (null);
	/** Debounced vote API: latest score wins; cancelled on slide change / modal teardown. */
	const VOTE_COMMIT_DEBOUNCE_MS = 420;
	let voteCommitTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
	let queuedVoteScore = /** @type {number | null} */ (null);
	let queuedVoteMessageId = /** @type {number | null} */ (null);
	let heatDragCleanup = /** @type {null | (() => void)} */ (null);
	let mediaSwipeCleanup = /** @type {null | (() => void)} */ (null);
	/** Skip replacing media when the same creation is already shown (prevents layout flicker). */
	let lastVoteMediaCreationId = /** @type {number | null} */ (null);
	/** `pushState` layer while modal is open — browser back should close modal. */
	let voteModalHistoryPushed = false;
	/** Ignore the next `popstate` from programmatic `history.back()` after closing/replacing the modal. */
	let voteModalPopstateSuppress = 0;

	function cancelVoteCommitDebounce() {
		if (voteCommitTimer != null) {
			clearTimeout(voteCommitTimer);
			voteCommitTimer = null;
		}
		queuedVoteScore = null;
		queuedVoteMessageId = null;
	}

	/** Run any pending debounced score immediately (e.g. modal closing). */
	function flushPendingVoteCommit() {
		if (voteCommitTimer != null) {
			clearTimeout(voteCommitTimer);
			voteCommitTimer = null;
		}
		const s = queuedVoteScore;
		const mid = queuedVoteMessageId;
		queuedVoteScore = null;
		queuedVoteMessageId = null;
		if (s == null || mid == null) return;
		const currentRow = slides[slideIdx];
		if (!currentRow || Number(currentRow.messageId) !== mid) return;
		if (scoreFromChallengeRow(currentRow) === s) return;
		void commitSliderScoreImmediate(s);
	}

	function scheduleVoteCommit(nextScore) {
		const row = slides[slideIdx];
		if (!row?.messageId) return;
		let score = nextScore;
		if (score === 0 && scoreFromChallengeRow(row) >= 1) {
			score = 1;
		}
		const mid = Number(row.messageId);
		const prevScore = scoreFromChallengeRow(row);
		if (score === prevScore) {
			cancelVoteCommitDebounce();
			return;
		}
		queuedVoteScore = score;
		queuedVoteMessageId = mid;
		if (voteCommitTimer != null) clearTimeout(voteCommitTimer);
		voteCommitTimer = setTimeout(() => {
			voteCommitTimer = null;
			const score = queuedVoteScore;
			const expectedMid = queuedVoteMessageId;
			queuedVoteScore = null;
			queuedVoteMessageId = null;
			if (score == null || expectedMid == null) return;
			const r = slides[slideIdx];
			if (!r || Number(r.messageId) !== expectedMid) return;
			let commitScore = score;
			if (commitScore === 0 && scoreFromChallengeRow(r) >= 1) {
				commitScore = 1;
			}
			if (scoreFromChallengeRow(r) === commitScore) return;
			void commitSliderScoreImmediate(commitScore);
		}, VOTE_COMMIT_DEBOUNCE_MS);
	}

	/**
	 * @param {boolean} [isFromPopState] — true when `history` already moved back (do not call `history.back()`).
	 */
	function destroy(isFromPopState = false) {
		challengeVoteModalPopstateDismiss = null;
		flushPendingVoteCommit();
		sliderBusy = false;
		heatNeedsSeedFromRow = true;
		lastPaintedHeatScore = 0;
		pendingHeatScore = null;

		const shouldHistoryBack = voteModalHistoryPushed && !isFromPopState;
		voteModalHistoryPushed = false;

		document.removeEventListener('keydown', onVoteModalDocumentKeydown, true);
		if (typeof heatDragCleanup === 'function') {
			try {
				heatDragCleanup();
			} catch {
				// ignore
			}
			heatDragCleanup = null;
		}
		if (typeof mediaSwipeCleanup === 'function') {
			try {
				mediaSwipeCleanup();
			} catch {
				// ignore
			}
			mediaSwipeCleanup = null;
		}
		if (overlay) {
			overlay.remove();
			overlay = null;
			prefetchKeepAlive.length = 0;
			document.body.classList.remove('modal-open');
			document.documentElement.classList.remove('modal-open');
		}

		if (shouldHistoryBack) {
			voteModalPopstateSuppress += 1;
			history.back();
		}
	}

	/**
	 * Capture-phase listener so shortcuts work even when focus stayed on the page behind the overlay (common on chat).
	 */
	function onVoteModalDocumentKeydown(e) {
		if (!overlay?.isConnected) return;
		if (e.isComposing) return;

		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			destroy(false);
			return;
		}

		if (
			e.key === 'ArrowUp' ||
			e.key === 'ArrowDown' ||
			e.key === 'PageUp' ||
			e.key === 'PageDown'
		) {
			if (slides.length <= 1) return;
			e.preventDefault();
			e.stopPropagation();
			if (e.key === 'ArrowUp' || e.key === 'PageUp') go(-1);
			else go(1);
			return;
		}

		/* Score keys: Left/Right adjust horizontal heat slider (never gate on sliderBusy — same rationale as before). */
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
			if (slides.length === 0) return;
			const rootEl = overlay.querySelector('[data-challenge-vote-slider]');
			if (!(rootEl instanceof HTMLElement)) return;
			const cur = Number(rootEl.getAttribute('aria-valuenow'));
			const base = Number.isFinite(Number(cur)) ? Number(cur) : 0;
			const row = slides[slideIdx];
			const rowVote = row ? scoreFromChallengeRow(row) : 0;
			const pendingScore =
				pendingHeatScore != null
					? pendingHeatScore
					: queuedVoteScore != null
						? queuedVoteScore
						: null;
			const voteLocked =
				rowVote >= 1 || (pendingScore != null && pendingScore >= 1);
			const floor = voteLocked ? 1 : 0;
			let next = base;
			if (e.key === 'ArrowRight') {
				next = base === 0 ? 6 : Math.min(10, base + 1);
			} else if (e.key === 'ArrowLeft') {
				if (base === 0) {
					next = voteLocked ? 1 : 5;
				} else {
					next = Math.max(floor, base - 1);
				}
			} else if (e.key === 'Home') {
				next = 1;
			} else if (e.key === 'End') {
				next = 10;
			} else {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			paintHeatUi(next);
			syncHintForLiveScore(next);
			scheduleVoteCommit(next);
		}
	}

	function voteFetchCacheKey(creationId, challengeMessageId) {
		const id = Number(creationId);
		const mid =
			challengeMessageId != null &&
			Number.isFinite(Number(challengeMessageId)) &&
			Number(challengeMessageId) > 0
				? Number(challengeMessageId)
				: 0;
		if (!Number.isFinite(id) || id <= 0) return '';
		return `${id}:${mid}`;
	}

	function challengeMessageQueryParam(row) {
		const mid = row?.messageId != null ? Number(row.messageId) : NaN;
		return Number.isFinite(mid) && mid > 0 ? mid : null;
	}

	async function fetchCreation(creationId, challengeMessageId) {
		const id = Number(creationId);
		const ck = voteFetchCacheKey(id, challengeMessageId);
		if (!ck) return null;
		if (cacheByCreationId.has(ck)) return cacheByCreationId.get(ck);
		const existing = creationFetchInflight.get(ck);
		if (existing) return existing;

		const qs =
			challengeMessageId != null &&
			Number.isFinite(Number(challengeMessageId)) &&
			Number(challengeMessageId) > 0
				? `?challenge_message_id=${encodeURIComponent(String(Number(challengeMessageId)))}`
				: '';

		const p = (async () => {
			try {
				const res = await fetch(`/api/create/images/${encodeURIComponent(String(id))}${qs}`, {
					credentials: 'include'
				});
				const data = res.ok ? await res.json().catch(() => null) : null;
				cacheByCreationId.set(ck, data);
				return data;
			} catch {
				cacheByCreationId.set(ck, null);
				return null;
			} finally {
				if (creationFetchInflight.get(ck) === p) {
					creationFetchInflight.delete(ck);
				}
			}
		})();

		creationFetchInflight.set(ck, p);
		return p;
	}

	function trimPrefetchKeepAlive() {
		while (prefetchKeepAlive.length > PREFETCH_KEEPALIVE_CAP) {
			prefetchKeepAlive.shift();
		}
	}

	/**
	 * Start loading neighbor media URLs into the HTTP cache / decode pipeline so prev/next feel instant.
	 * Mirrors URL rules in injectVoteMediaFromCreation.
	 */
	function warmCreationMediaInBrowser(cid, c) {
		if (!c || c._error || mediaWarmByCreationId.has(cid)) return;
		mediaWarmByCreationId.add(cid);

		const mediaType = typeof c.media_type === 'string' ? c.media_type : 'image';
		const videoUrl = typeof c.video_url === 'string' ? c.video_url.trim() : '';
		const url = typeof c.url === 'string' ? c.url.trim() : '';
		const thumb = typeof c.thumbnail_url === 'string' ? c.thumbnail_url.trim() : '';

		if (mediaType === 'video' && videoUrl) {
			const poster = (thumb || url).trim();
			if (poster) {
				const posterImg = new Image();
				posterImg.decoding = 'async';
				posterImg.src = poster;
				prefetchKeepAlive.push(posterImg);
			}
			const warmVid = document.createElement('video');
			warmVid.preload = 'auto';
			warmVid.muted = true;
			warmVid.src = videoUrl;
			try {
				warmVid.load();
			} catch {
				// ignore
			}
			prefetchKeepAlive.push(warmVid);
			trimPrefetchKeepAlive();
			return;
		}

		const imgSrc = (url || thumb).trim();
		if (!imgSrc) return;
		const im = new Image();
		im.decoding = 'async';
		im.src = imgSrc;
		prefetchKeepAlive.push(im);
		trimPrefetchKeepAlive();
	}

	async function prefetchSlideMedia(row) {
		if (!overlay?.isConnected) return;
		const cid = row.creationId != null ? Number(row.creationId) : NaN;
		if (!Number.isFinite(cid) || cid <= 0) return;
		const msgId = challengeMessageQueryParam(row);
		const c = await fetchCreation(cid, msgId);
		if (!overlay?.isConnected || !c || c._error) return;
		warmCreationMediaInBrowser(cid, c);
	}

	function prefetchNeighborSlides() {
		if (!overlay?.isConnected || slides.length <= 1) return;
		const want = new Set([slideIdx - 1, slideIdx + 1]);
		for (const i of want) {
			if (i < 0 || i >= slides.length) continue;
			void prefetchSlideMedia(slides[i]);
		}
	}

	/* Stroke chevrons (matches `.feed-card-group-nav svg`); up/down for submission stepping. */
	const navUpSvg =
		'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 15l-6-6-6 6" /></svg>';
	const navDownSvg =
		'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" /></svg>';

	function el(sel) {
		return overlay?.querySelector(sel) ?? null;
	}

	function wireVoteModalVideoTap(stage) {
		const v = stage.querySelector('video.challenge-vote-modal-video');
		if (!(v instanceof HTMLVideoElement)) return;
		const onClick = (e) => {
			e.stopPropagation();
			if (v.paused) void v.play().catch(() => {});
			else v.pause();
		};
		v.addEventListener('click', onClick);
	}

	function injectVoteMediaFromCreation(stage, c, cid) {
		const mediaType = typeof c.media_type === 'string' ? c.media_type : 'image';
		const videoUrl = typeof c.video_url === 'string' ? c.video_url.trim() : '';
		const url = typeof c.url === 'string' ? c.url.trim() : '';
		const thumb = typeof c.thumbnail_url === 'string' ? c.thumbnail_url.trim() : '';
		const isNsfw = !!(c.nsfw ?? c.meta?.nsfw);
		const nsfwClass = isNsfw ? ' nsfw' : '';
		const idAttr = ` data-vote-media-id="${cid}"`;

		if (mediaType === 'video' && videoUrl) {
			const poster = thumb || url ? escAttr(thumb || url) : '';
			/* No native `controls` — they capture vertical touch before our swipe-to-next handler runs. */
			stage.innerHTML = `<video class="challenge-vote-modal-video" playsinline preload="metadata" title="Tap to play or pause"${poster ? ` poster="${poster}"` : ''} src="${escAttr(videoUrl)}"${idAttr}></video>`;
			wireVoteModalVideoTap(stage);
			lastVoteMediaCreationId = cid;
			return;
		}
		const imgSrc = url || thumb;
		if (!imgSrc) {
			stage.innerHTML =
				'<p class="challenge-vote-modal-media-fallback" role="status">No media available.</p>';
			lastVoteMediaCreationId = null;
			return;
		}
		stage.innerHTML = `<img class="challenge-vote-modal-media-img${nsfwClass}" src="${escAttr(imgSrc)}" alt="" decoding="async"${idAttr} />`;
		lastVoteMediaCreationId = cid;
	}

	async function renderMedia(stage, row) {
		const cid = row.creationId != null ? Number(row.creationId) : NaN;
		if (!Number.isFinite(cid) || cid <= 0) {
			stage.innerHTML =
				'<p class="challenge-vote-modal-media-fallback" role="status">No image for this entry.</p>';
			lastVoteMediaCreationId = null;
			return;
		}

		const existing = stage.querySelector(`[data-vote-media-id="${cid}"]`);
		if (lastVoteMediaCreationId === cid && existing) {
			return;
		}

		const msgId = challengeMessageQueryParam(row);
		const fetchKey = voteFetchCacheKey(cid, msgId);
		const cached = fetchKey && cacheByCreationId.has(fetchKey) ? cacheByCreationId.get(fetchKey) : undefined;
		if (cached !== undefined) {
			if (!overlay) return;
			if (!cached || cached._error) {
				stage.innerHTML =
					'<p class="challenge-vote-modal-media-fallback" role="status">Could not load this creation.</p>';
				lastVoteMediaCreationId = null;
				return;
			}
			injectVoteMediaFromCreation(stage, cached, cid);
			return;
		}

		stage.innerHTML = '<p class="challenge-vote-modal-media-loading" role="status">Loading…</p>';
		const c = await fetchCreation(cid, msgId);
		if (!overlay) return;
		if (!c || c._error) {
			stage.innerHTML =
				'<p class="challenge-vote-modal-media-fallback" role="status">Could not load this creation.</p>';
			lastVoteMediaCreationId = null;
			return;
		}
		injectVoteMediaFromCreation(stage, c, cid);
	}

	function paintHeatUi(value) {
		const rootEl = el('[data-challenge-vote-slider]');
		const thumb = el('[data-challenge-vote-thumb]');
		const fill = el('[data-challenge-vote-heat-fill]');
		const glow = el('[data-challenge-vote-heat-glow]');
		if (!(rootEl instanceof HTMLElement)) return;

		const raw = Number(value);
		const v = Number.isFinite(raw) ? raw : 0;
		const frac = thumbFracFromHeatScore(v);
		const roundedAria =
			v <= 0 ? 0 : Math.min(10, Math.max(1, Math.round(v)));

		rootEl.setAttribute('aria-valuenow', String(roundedAria));
		rootEl.dataset.score = String(roundedAria);
		rootEl.classList.toggle('challenge-vote-modal-heat--unpicked', v === 0);
		rootEl.classList.toggle('challenge-vote-modal-heat--hot', roundedAria >= 8);

		const hue = v === 0 ? 218 : heatHue(v);
		rootEl.style.setProperty('--vote-hue', String(hue));

		const glowOpacity =
			v === 0 ? 0.28 : 0.55 + (Math.min(10, Math.max(1, v)) / 10) * 0.35;

		if (thumb instanceof HTMLElement) {
			thumb.style.left = `calc(var(--heat-pad) + (100% - (var(--heat-pad) * 2)) * ${frac})`;
		}
		if (fill instanceof HTMLElement) {
			fill.style.width = `calc(var(--heat-pad) + (100% - (var(--heat-pad) * 2)) * ${frac})`;
		}
		if (glow instanceof HTMLElement) {
			glow.style.opacity = String(glowOpacity);
			glow.style.left = thumb instanceof HTMLElement ? thumb.style.left : '';
		}

		lastPaintedHeatScore = v;
	}

	function syncHintForLiveScore(v) {
		const hint = el('[data-challenge-vote-new-hint]');
		if (!(hint instanceof HTMLElement)) return;
		const live = Number(v);
		const showHint = !Number.isFinite(live) || live === 0;
		hint.textContent = showHint
			? 'Neutral until you move the slider. Cooler toward 1, warmer toward 10. Tap, drag, or use Left/Right keys.'
			: '';
		hint.classList.toggle('challenge-vote-modal-hint--inactive', !showHint);
	}

	function syncHeatAndBusyOnly() {
		const row = slides[slideIdx];
		const heatRoot = el('[data-challenge-vote-slider]');
		let score;
		if (pendingHeatScore != null) {
			score = pendingHeatScore;
		} else if (heatNeedsSeedFromRow) {
			score = row ? scoreFromChallengeRow(row) : 0;
			heatNeedsSeedFromRow = false;
		} else {
			score = lastPaintedHeatScore;
		}
		paintHeatUi(score);
		syncHintForLiveScore(score);
		if (heatRoot instanceof HTMLElement) {
			heatRoot.toggleAttribute('aria-disabled', !row || sliderBusy);
			heatRoot.classList.toggle('challenge-vote-modal-heat--busy', sliderBusy);
			const minAria = row && scoreFromChallengeRow(row) >= 1 ? 1 : 0;
			heatRoot.setAttribute('aria-valuemin', String(minAria));
		}
	}

	function syncChrome(opts = {}) {
		const reloadMedia = opts.reloadMedia !== false;
		const controls = el('.challenge-vote-modal-controls');
		if (controls instanceof HTMLElement) {
			controls.hidden = slides.length === 0;
			controls.setAttribute('aria-hidden', slides.length === 0 ? 'true' : 'false');
		}
		if (slides.length === 0) {
			const prevBtn = el('[data-challenge-vote-prev]');
			const nextBtn = el('[data-challenge-vote-next]');
			if (prevBtn instanceof HTMLButtonElement) {
				prevBtn.hidden = true;
				prevBtn.setAttribute('aria-hidden', 'true');
				prevBtn.disabled = true;
			}
			if (nextBtn instanceof HTMLButtonElement) {
				nextBtn.hidden = true;
				nextBtn.setAttribute('aria-hidden', 'true');
				nextBtn.disabled = true;
			}
			const stage = el('[data-challenge-vote-media]');
			if (stage instanceof HTMLElement) {
				stage.innerHTML =
					'<p class="challenge-vote-modal-media-fallback challenge-vote-modal-media-fallback--empty" role="status">No other entries to score here yet (for example, you may be the only submitter, or every peer entry is already scored). Open Challenges for the full view.</p>';
			}
			return;
		}

		const row = slides[slideIdx];
		const prevBtn = el('[data-challenge-vote-prev]');
		const nextBtn = el('[data-challenge-vote-next]');

		const multi = slides.length > 1;
		if (prevBtn instanceof HTMLButtonElement) {
			prevBtn.hidden = !multi;
			prevBtn.setAttribute('aria-hidden', multi ? 'false' : 'true');
			prevBtn.disabled = !multi || slideIdx <= 0;
			prevBtn.tabIndex = multi ? 0 : -1;
		}
		if (nextBtn instanceof HTMLButtonElement) {
			nextBtn.hidden = !multi;
			nextBtn.setAttribute('aria-hidden', multi ? 'false' : 'true');
			nextBtn.disabled = !multi || slideIdx >= slides.length - 1;
			nextBtn.tabIndex = multi ? 0 : -1;
		}

		syncHeatAndBusyOnly();

		if (reloadMedia) {
			void renderMedia(/** @type {HTMLElement} */ (el('[data-challenge-vote-media]')), row);
		}
		prefetchNeighborSlides();
	}

	async function commitSliderScoreImmediate(nextScore) {
		const row = slides[slideIdx];
		if (!row || !row.messageId) return;
		let score = nextScore;
		if (score === 0 && scoreFromChallengeRow(row) >= 1) {
			score = 1;
		}
		const mid = Number(row.messageId);
		const prevScore = scoreFromChallengeRow(row);
		if (score === prevScore) return;

		pendingHeatScore = score;
		sliderBusy = true;
		syncChrome({ reloadMedia: false });
		try {
			await applyChallengeVoteScore(mid, score, row, toggleReaction);
			if (typeof onAfterVote === 'function') onAfterVote();
		} catch {
			pendingHeatScore = null;
			paintHeatUi(prevScore);
			syncHintForLiveScore(prevScore);
		} finally {
			sliderBusy = false;
			pendingHeatScore = null;
			syncChrome({ reloadMedia: false });
		}
	}

	function go(delta) {
		const next = slideIdx + delta;
		if (next < 0 || next >= slides.length) return;
		cancelVoteCommitDebounce();
		pendingHeatScore = null;
		const vid = overlay?.querySelector('.challenge-vote-modal-video');
		if (vid instanceof HTMLVideoElement) {
			try {
				vid.pause();
			} catch {
				// ignore
			}
		}
		slideIdx = next;
		heatNeedsSeedFromRow = true;
		syncChrome();
	}

	/** Continuous 1–10 along the track (no rounding). */
	function continuousScoreFromPointer(track, clientX) {
		const r = track.getBoundingClientRect();
		const padRaw = getComputedStyle(track).getPropertyValue('--heat-pad').trim();
		const pad = Number.parseFloat(padRaw) || 18;
		const usable = Math.max(1, r.width - pad * 2);
		const x = Math.min(Math.max(clientX - r.left - pad, 0), usable);
		const raw = 1 + (x / usable) * 9;
		return Math.min(10, Math.max(1, raw));
	}

	/** Maps pointer to committed integer scores 1–10 for API / keyboard parity. */
	function scoreFromPointer(track, clientX) {
		return Math.round(continuousScoreFromPointer(track, clientX));
	}

	function bindHeatControl() {
		const rootEl = overlay?.querySelector('[data-challenge-vote-slider]');
		const track = overlay?.querySelector('[data-challenge-vote-track]');
		if (!(rootEl instanceof HTMLElement && track instanceof HTMLElement)) return;

		let dragPid = /** @type {number | null} */ (null);

		function endDrag(ev) {
			if (dragPid == null || ev.pointerId !== dragPid) return;
			rootEl.classList.remove('challenge-vote-modal-heat--dragging');
			try {
				track.releasePointerCapture(ev.pointerId);
			} catch {
				// ignore
			}
			dragPid = null;
			track.removeEventListener('pointermove', moveDrag);
			track.removeEventListener('pointerup', endDrag);
			track.removeEventListener('pointercancel', endDrag);
			const continuous = continuousScoreFromPointer(track, ev.clientX);
			const committed = scoreFromPointer(track, ev.clientX);
			const row = slides[slideIdx];
			const prevScore = row ? scoreFromChallengeRow(row) : 0;
			paintHeatUi(continuous);
			syncHintForLiveScore(continuous);
			if (committed === prevScore) {
				paintHeatUi(committed);
				syncHintForLiveScore(committed);
				return;
			}
			scheduleVoteCommit(committed);
		}

		function moveDrag(ev) {
			if (dragPid == null || ev.pointerId !== dragPid || sliderBusy) return;
			ev.preventDefault();
			const continuous = continuousScoreFromPointer(track, ev.clientX);
			paintHeatUi(continuous);
			syncHintForLiveScore(continuous);
		}

		const onTrackDown = (ev) => {
			if (sliderBusy || !(ev.isPrimary ?? true)) return;
			ev.preventDefault();
			rootEl.classList.add('challenge-vote-modal-heat--dragging');
			const continuous = continuousScoreFromPointer(track, ev.clientX);
			paintHeatUi(continuous);
			syncHintForLiveScore(continuous);
			dragPid = ev.pointerId;
			try {
				track.setPointerCapture(ev.pointerId);
			} catch {
				// ignore
			}
			track.addEventListener('pointermove', moveDrag);
			track.addEventListener('pointerup', endDrag);
			track.addEventListener('pointercancel', endDrag);
		};

		track.addEventListener('pointerdown', onTrackDown);

		heatDragCleanup = () => {
			rootEl.classList.remove('challenge-vote-modal-heat--dragging');
			track.removeEventListener('pointerdown', onTrackDown);
			track.removeEventListener('pointermove', moveDrag);
			track.removeEventListener('pointerup', endDrag);
			track.removeEventListener('pointercancel', endDrag);
			if (dragPid != null) {
				try {
					track.releasePointerCapture(dragPid);
				} catch {
					// ignore
				}
				dragPid = null;
			}
		};
	}

	/**
	 * Vertical swipe on the media frame (Pointer Events — touch + mouse).
	 * Swipe up → older submission (same as on-screen “down” nav); swipe down → newer (“up” nav).
	 * Arrow/Page keys stay ↑ newer / ↓ older. pointerup on document ends gestures outside the frame.
	 */
	function bindMediaSwipeNav() {
		const mediaEl = overlay?.querySelector('.challenge-vote-modal-media');
		if (!(mediaEl instanceof HTMLElement)) return;

		/** @type {{ x: number, y: number, pid: number } | null} */
		let swipeStart = null;

		const clearStart = (ev) => {
			if (swipeStart && ev.pointerId === swipeStart.pid) swipeStart = null;
		};

		const onPointerDown = (ev) => {
			if (slides.length <= 1) return;
			if (!(ev.isPrimary ?? true)) return;
			swipeStart = { x: ev.clientX, y: ev.clientY, pid: ev.pointerId };
		};

		const onPointerUp = (ev) => {
			if (!swipeStart || ev.pointerId !== swipeStart.pid) return;
			if (slides.length <= 1) {
				swipeStart = null;
				return;
			}
			const dx = ev.clientX - swipeStart.x;
			const dy = ev.clientY - swipeStart.y;
			swipeStart = null;
			const threshold = 28;
			if (Math.abs(dy) < threshold) return;
			if (Math.abs(dx) > Math.abs(dy) * 1.2) return;
			/*
			 * Mobile swipe vs chevrons (same as nextBtn/prevBtn click handlers ~30 lines below):
			 * - Finger moves UP on screen → dy < 0 → go(+1) → older submission → lower chevron “down”.
			 * - Finger moves DOWN → dy > 0 → go(-1) → newer submission → upper chevron “up”.
			 * (Arrow keys unchanged: ↑ newer, ↓ older.)
			 */
			const fingerMovedUp = dy < 0;
			if (fingerMovedUp) go(1);
			else go(-1);
		};

		mediaEl.addEventListener('pointerdown', onPointerDown, { passive: true });
		document.addEventListener('pointerup', onPointerUp, true);
		document.addEventListener('pointercancel', clearStart, true);

		mediaSwipeCleanup = () => {
			mediaEl.removeEventListener('pointerdown', onPointerDown);
			document.removeEventListener('pointerup', onPointerUp, true);
			document.removeEventListener('pointercancel', clearStart, true);
			swipeStart = null;
			mediaSwipeCleanup = null;
		};
	}

	function bindOverlay() {
		if (!overlay) return;

		document.addEventListener('keydown', onVoteModalDocumentKeydown, true);

		const dismiss = overlay.querySelector('[data-challenge-vote-dismiss]');
		if (dismiss instanceof HTMLButtonElement) {
			dismiss.addEventListener('click', () => destroy(false));
		}

		if (slides.length > 0) {
			const prevBtn = overlay.querySelector('[data-challenge-vote-prev]');
			if (prevBtn instanceof HTMLButtonElement) {
				prevBtn.addEventListener('click', () => go(-1));
			}
			const nextBtn = overlay.querySelector('[data-challenge-vote-next]');
			if (nextBtn instanceof HTMLButtonElement) {
				nextBtn.addEventListener('click', () => go(1));
			}

			bindHeatControl();
			bindMediaSwipeNav();
		}
	}

	function voteModalHeadingText(challengeTitle) {
		const t = typeof challengeTitle === 'string' ? challengeTitle.trim() : '';
		return t || 'Vote';
	}

	return {
		/**
		 * @param {object[]} nextSlides — ranked rows, newest-first order
		 * @param {{ challengeTitle?: string }} [openOpts]
		 */
		open(nextSlides, openOpts = {}) {
			slides = Array.isArray(nextSlides) ? nextSlides : [];
			cacheByCreationId = new Map();
			creationFetchInflight = new Map();
			mediaWarmByCreationId = new Set();
			prefetchKeepAlive.length = 0;
			lastVoteMediaCreationId = null;
			heatNeedsSeedFromRow = true;
			lastPaintedHeatScore = 0;
			destroy();

			const headingText = voteModalHeadingText(openOpts.challengeTitle);

			overlay = document.createElement('div');
			overlay.className = 'challenge-vote-modal-overlay';
			overlay.innerHTML = `
				<div class="challenge-vote-modal" role="dialog" aria-modal="true" aria-labelledby="challenge-vote-modal-title" tabindex="-1">
					<div class="challenge-vote-modal-top">
						<h2 id="challenge-vote-modal-title" class="challenge-vote-modal-title"></h2>
						<button type="button" class="modal-dismiss challenge-vote-modal-close" data-challenge-vote-dismiss aria-label="Close">${MODAL_DISMISS_ICON_SVG}</button>
					</div>
					<div class="challenge-vote-modal-main">
						<div class="challenge-vote-modal-media-column">
							<button type="button" class="feed-card-group-nav challenge-vote-nav-out challenge-vote-nav-up" data-challenge-vote-prev aria-label="Newer submission" hidden>${navUpSvg}</button>
							<div class="challenge-vote-modal-media">
								<div class="challenge-vote-modal-media-stage" data-challenge-vote-media></div>
							</div>
							<button type="button" class="feed-card-group-nav challenge-vote-nav-out challenge-vote-nav-down" data-challenge-vote-next aria-label="Older submission" hidden>${navDownSvg}</button>
						</div>
					</div>
					<div class="challenge-vote-modal-controls">
						<div class="challenge-vote-modal-heat" data-challenge-vote-slider tabindex="0" role="slider"
							aria-valuemin="0" aria-valuemax="10" aria-valuenow="0"
							aria-label="Vote score: neutral until you move. Arrow Left and Right adjust score (cooler vs warmer). Arrow Up, Down, Page Up, and Page Down switch submissions when there is more than one. Swipe up on the image for the next submission down the list; swipe down for the newer submission.">
							<div class="challenge-vote-modal-heat-track" data-challenge-vote-track>
								<div class="challenge-vote-modal-heat-fill" data-challenge-vote-heat-fill aria-hidden="true"></div>
								<div class="challenge-vote-modal-heat-glow" data-challenge-vote-heat-glow aria-hidden="true"></div>
								<div class="challenge-vote-modal-heat-thumb" data-challenge-vote-thumb>
									<span class="challenge-vote-modal-heat-thumb-inner" aria-hidden="true"></span>
								</div>
							</div>
						</div>
						<p class="challenge-vote-modal-hint-wrap" aria-live="polite">
							<span class="challenge-vote-modal-hint" data-challenge-vote-new-hint></span>
						</p>
					</div>
				</div>
			`;

			document.body.appendChild(overlay);
			overlay.classList.toggle('challenge-vote-modal-overlay--empty', slides.length === 0);
			const titleEl = overlay.querySelector('#challenge-vote-modal-title');
			if (titleEl instanceof HTMLElement) titleEl.textContent = headingText;

			document.body.classList.add('modal-open');
			document.documentElement.classList.add('modal-open');
			slideIdx = 0;
			bindOverlay();
			syncChrome();
			const panelFocus = overlay.querySelector('.challenge-vote-modal');
			if (panelFocus instanceof HTMLElement) {
				requestAnimationFrame(() => panelFocus.focus());
			}

			voteModalHistoryPushed = true;
			const prevState =
				typeof history.state === 'object' && history.state !== null ? history.state : {};
			history.pushState({ ...prevState, psChallengeVoteModal: 1 }, '', window.location.href);
			challengeVoteModalPopstateDismiss = () => destroy(true);
		},
		destroy
	};
}
