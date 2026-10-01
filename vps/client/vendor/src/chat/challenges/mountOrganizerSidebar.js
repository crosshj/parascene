import {
	mergeFullChallengeConfigForChallenge,
	normalizeChallengeHeroRefForSave,
	normalizeChallengeOrganizerUserNames,
	organizersWithoutImplied,
	pickLatestChallengesGlobalConfig,
	pickChallengeResultsCreationUrl,
	resolveChallengeOrganizerAllowlistFromMessages,
	resolveOrganizersByTrackFromGlobalPayload,
	tracksViewerCanOrganize,
	viewerOrganizesTrack,
	isImpliedChallengeOrganizer,
	viewerCanManageChallengePayouts,
	applyChallengeListed,
	applyChallengeUnlisted
} from './challengeAdmin.js';
import { challengeConfigBodyFingerprint } from './challengesChannelCache.js';
import {
	renderChallengeOrganizerPageMarkup,
	renderChallengeOrganizerModalInnerHtml,
	renderChallengeOrganizerStatsModalInnerHtml,
	renderChallengeOrganizerStatsBodyHtml,
	renderOrganizeSoftDeleteConfirmHtml,
	bindChallengeResultsToggle,
	bindChallengeListingToggle,
	bindChallengePrizeCategoryToggles
} from './views/adminView.js';
import { deriveChallengePhase } from './model/phases.js';
import {
	renderOrganizeCalendarHtml,
	resolveCalendarClick,
	occupiedRangesForTrack,
	getChallengeTrackTemplate
} from './views/organizeBoardView.js';
import { applyPinSlotsToPayload, buildPinSyncOps, pinWindowsForCalendar } from './model/pinSlots.js';
import {
	dateToLocalYmd,
	localEndOfDayToIso,
	localStartOfDayToIso,
	majorityMonthYmdFromRange
} from './model/dayBounds.js';
import {
	findNextFreeRange,
	normalizeChallengeTrack,
	pickChallengeTrack,
	rangeConflictsWithOccupied,
	timelineIsoFromDayRange
} from './model/tracks.js';
import {
	readPrizesFromFormData,
	resolveCreatePrizePrefills,
	resolveCreateAcceptedMedia
} from './model/prizes.js';
import { summarizeLatestChallengeConfigs } from './model/organizerSummaries.js';
import { buildChallengesChannelModel } from './model/buildChannelModel.js';
import {
	openChatAttachmentPreviewLightbox,
	openChatInlineImageLightbox
} from '../../shared/chatInlineImageLightbox.js';
import { hydrateChallengeHistoryThumbnails } from '../../shared/challengeHistoryThumb.js';
import {
	hydrateChallengeOrganizerStatsThumbs,
	statsThumbSrcFromCreationPayload
} from './statsThumbs.js';
import { mountOrganizeResultsPanel } from './organizeResults.js';
import {
	eyeIcon,
	gearIcon,
	slidersIcon,
	statsBarsIcon
} from '/icons/svg-strings.js';

/**
 * Legacy chat right-rail host (unused). Organize lives at `/challenges/organize` in the SPA.
 * @param {HTMLElement} host — formerly `[data-chat-challenges-organizer-sidebar]`
 */
export function mountChallengesOrganizerSidebar(host) {
	host.innerHTML = '';
	return {
		destroy: () => {
			host.innerHTML = '';
		}
	};
}

// Thumb hydration + src helpers live in statsThumbs.js (shared with the payout tab).

/**
 * Full challenge organizer tools for the standalone `/challenges/organize` page.
 *
 * @param {HTMLElement} host
 * @param {{
 *   messages: object[],
 *   viewerId: number | null,
 *   viewerUserName?: string | null,
 *   organizerUserNames?: string[],
 *   globalConfigMessageId?: number | null,
 *   threadId: number,
 *   postMessage: (body: string) => Promise<{ ok: boolean, error?: string, message?: object }>,
 *   patchMessage?: (messageId: number, body: string) => Promise<{ ok: boolean, error?: string, message?: object }>,
 *   fetchMessage?: (messageId: number) => Promise<{ ok: boolean, error?: string, message?: object }>,
 *   reload: () => Promise<void>,
 *   gearIcon: (className?: string) => string,
 *   statsIcon?: (className?: string) => string,
 *   plusIcon?: (className?: string) => string,
 * }} opts
 */
export function mountChallengesOrganizerTools(host, opts) {
	const parseExcludedUsernames = (raw) => {
		const seen = new Set();
		return String(raw || '')
			.split(',')
			.map((part) => part.trim().replace(/^@+/, '').toLowerCase())
			.filter((name) => {
				if (!name || seen.has(name)) return false;
				seen.add(name);
				return true;
			});
	};

	const setOrganizerModalOpenClass = (on) => {
		try {
			document.body?.classList.toggle('chat-page--challenges-organizer-modal-open', Boolean(on));
			document.documentElement?.classList.toggle('chat-page--challenges-organizer-modal-open', Boolean(on));
			document.body?.classList.toggle('challenges-organize-page--modal-open', Boolean(on));
		} catch {
			// ignore
		}
	};

	const statsIcon =
		typeof opts.statsIcon === 'function'
			? opts.statsIcon
			: /** @param {string} [cls] */ (cls) => statsBarsIcon(String(cls || '').trim());
	let rowByChallengeId = new Map();
	let challengeConfigEntries = [];
	const upsertLocalMessage = (message) => {
		if (!message || typeof message !== 'object') return;
		const mid = Number(message.id);
		if (!Number.isFinite(mid) || mid <= 0) return;
		const idx = opts.messages.findIndex((m) => Number(m?.id) === mid);
		if (idx >= 0) {
			opts.messages[idx] = { ...opts.messages[idx], ...message };
			return;
		}
		opts.messages.push(message);
		opts.messages.sort((a, b) => {
			const aid = Number(a?.id);
			const bid = Number(b?.id);
			if (Number.isFinite(aid) && Number.isFinite(bid) && aid !== bid) return aid - bid;
			const at = Date.parse(String(a?.created_at || ''));
			const bt = Date.parse(String(b?.created_at || ''));
			if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
			return 0;
		});
	};
	let globalConfigMessageId =
		Number.isFinite(Number(opts.globalConfigMessageId)) && Number(opts.globalConfigMessageId) > 0
			? Number(opts.globalConfigMessageId)
			: null;
	let organizerUserNames = normalizeChallengeOrganizerUserNames(opts.organizerUserNames || []);
	let activeStatsRequestToken = 0;
	/** @type {{ challengeTitle: string, data: { topCreations?: object[], topSubmitters?: object[], topVoters?: object[], globalAverage?: number }, excludedUserNames: string[], sortMode: 'weighted' | 'average' } | null} */
	let activeStatsModalState = null;
	/** @type {string} */
	let createTrack = 'monthly';
	/** @type {string | null} */
	let calendarPendingStart = null;
	/** @type {string} */
	let calendarMonthYmd = dateToLocalYmd();
	/** Baseline body fingerprint when edit modal opened (save-conflict check). */
	let editBodyBaselineFp = /** @type {string | null} */ (null);
	let editBaselineMessageId = /** @type {number | null} */ (null);

	/**
	 * @param {number} messageId
	 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
	 */
	const assertConfigMessageUnchanged = async (messageId) => {
		const mid = Number(messageId);
		if (!Number.isFinite(mid) || mid <= 0) return { ok: true };
		if (typeof opts.fetchMessage !== 'function') return { ok: true };

		let baselineFp = null;
		if (
			editBaselineMessageId != null &&
			Number(editBaselineMessageId) === mid &&
			editBodyBaselineFp
		) {
			baselineFp = editBodyBaselineFp;
		} else {
			const localMsg = (opts.messages || []).find((m) => Number(m?.id) === mid);
			if (localMsg) baselineFp = challengeConfigBodyFingerprint(localMsg.body);
		}
		if (!baselineFp) return { ok: true };

		const remote = await opts.fetchMessage(mid);
		if (!remote?.ok || !remote.message) {
			return {
				ok: false,
				error: remote?.error || 'Could not verify the latest challenge data before saving.'
			};
		}
		const fp = challengeConfigBodyFingerprint(remote.message.body);
		if (fp !== baselineFp) {
			return {
				ok: false,
				error:
					'Someone else updated this challenge. Reload before saving so you do not overwrite their changes.'
			};
		}
		return { ok: true };
	};

	const captureEditBaseline = (configMessageId) => {
		const mid = Number(configMessageId);
		editBaselineMessageId = Number.isFinite(mid) && mid > 0 ? mid : null;
		editBodyBaselineFp = null;
		if (!editBaselineMessageId) return;
		const msg = (opts.messages || []).find((m) => Number(m?.id) === editBaselineMessageId);
		if (msg) editBodyBaselineFp = challengeConfigBodyFingerprint(msg.body);
	};

	const organizersByTrackNow = () => {
		const globalCfg = pickLatestChallengesGlobalConfig(opts.messages);
		return resolveOrganizersByTrackFromGlobalPayload(globalCfg?.payload);
	};

	const allowedTracksForViewer = () =>
		tracksViewerCanOrganize(opts.viewerUserName, organizersByTrackNow());

	const defaultCreateTrack = () => {
		const allowed = allowedTracksForViewer();
		if (allowed.includes(normalizeChallengeTrack(createTrack))) {
			return normalizeChallengeTrack(createTrack);
		}
		return allowed[0] || 'monthly';
	};

	const boardSummaries = () => {
		const model = buildChallengesChannelModel(opts.messages, {
			viewerId: opts.viewerId,
			nowMs: Date.now()
		});
		return summarizeLatestChallengeConfigs(model.raw.configs).map((s) => ({
			...s,
			merged: mergeFullChallengeConfigForChallenge(model.raw.configs, s.challenge_id),
			latest: s.payload
		}));
	};

	/**
	 * Apply structured prizes + free-text Custom from the form onto payload.
	 * Legacy reward_first/second/third/participation are deprecated: scrubbed on save
	 * so the config converges on the `prizes` block.
	 * @param {object} payload
	 * @param {FormData} fd
	 * @param {HTMLFormElement} adminForm
	 */
	const applyRewardsAndPrizesFromForm = (payload, fd, adminForm) => {
		if (adminForm.querySelector('[name="reward_custom"]')) {
			const raw = String(fd.get('reward_custom') || '').trim();
			if (raw) payload.reward_custom = raw;
			else delete payload.reward_custom;
		}
		if (adminForm.querySelector('[name="prize_main_first"]')) {
			payload.prizes = readPrizesFromFormData(fd);
			delete payload.reward_first;
			delete payload.reward_second;
			delete payload.reward_third;
			delete payload.reward_participation;
		}
	};

	const syncCreatePrefills = (modalBody, track) => {
		const tpl = getChallengeTrackTemplate(track);
		const occupied = occupiedRangesForTrack(boardSummaries(), track);
		const range = findNextFreeRange(dateToLocalYmd(), tpl.defaultLengthDays, occupied);
		const titleEl = modalBody.querySelector('[data-organize-title]');
		const idEl = modalBody.querySelector('[data-organize-challenge-id]');
		const startEl = modalBody.querySelector('[data-organize-start-ymd]');
		const endEl = modalBody.querySelector('[data-organize-end-ymd]');
		const trackEl = modalBody.querySelector('[data-organize-track-field]');
		const title =
			titleEl instanceof HTMLInputElement && titleEl.value.trim()
				? titleEl.value.trim()
				: tpl.suggestTitle(range.start);
		if (titleEl instanceof HTMLInputElement) titleEl.value = title;
		if (idEl instanceof HTMLInputElement) idEl.value = tpl.suggestId(range.start);
		if (startEl instanceof HTMLInputElement) startEl.value = range.start;
		if (endEl instanceof HTMLInputElement) endEl.value = range.end;
		if (trackEl instanceof HTMLInputElement) trackEl.value = track;

		const prefills = resolveCreatePrizePrefills(track, boardSummaries());
		for (const [key, val] of Object.entries(prefills.rewardFields)) {
			const input = modalBody.querySelector(`[name="${key}"]`);
			if (input instanceof HTMLInputElement) {
				input.value = String(val || '');
			}
		}
		const setPrizeNum = (name, value) => {
			const input = modalBody.querySelector(`[name="${name}"]`);
			if (input instanceof HTMLInputElement) {
				input.value = String(value);
			}
		};
		const ps = prefills.prizeStructure;
		setPrizeNum('prize_main_first', ps.main.first);
		setPrizeNum('prize_main_second', ps.main.second);
		setPrizeNum('prize_main_third', ps.main.third);
		for (const [catKey, cat] of [
			['top_submitters', ps.top_submitters],
			['top_voters', ps.top_voters]
		]) {
			const checkbox = modalBody.querySelector(`[name="prize_${catKey}_enabled"]`);
			if (checkbox instanceof HTMLInputElement) {
				checkbox.checked = cat.enabled !== false;
			}
			for (let i = 0; i < 3; i += 1) {
				setPrizeNum(`prize_${catKey}_${i}`, cat.amounts[i] ?? 0);
			}
			const amountsEl = modalBody.querySelector(
				`[data-prize-category="${catKey}"] .challenge-pane-admin-prize-amounts`
			);
			if (amountsEl instanceof HTMLElement) {
				amountsEl.hidden = cat.enabled === false;
			}
		}

		calendarPendingStart = null;
		calendarMonthYmd =
			majorityMonthYmdFromRange(range.start, range.end) || range.start || dateToLocalYmd();
		mountCalendarInModal(modalBody, track, '', range.start, range.end);
	};

	const mountCalendarInModal = (
		modalBody,
		track,
		excludeChallengeId,
		startYmd,
		endYmd,
		calOpts = {}
	) => {
		const mount = modalBody.querySelector('[data-organize-calendar-mount]');
		if (!(mount instanceof HTMLElement)) return;
		const readOnly =
			calOpts.readOnly === true ||
			Boolean(modalBody.querySelector('[data-challenges-organize-view]'));
		const occupied = occupiedRangesForTrack(boardSummaries(), track, excludeChallengeId);
		const cidForPins = String(excludeChallengeId || '').trim();
		const pinWindows = cidForPins
			? pinWindowsForCalendar(
					mergeFullChallengeConfigForChallenge(challengeConfigEntries, cidForPins)
				)
			: [];
		mount.innerHTML = renderOrganizeCalendarHtml({
			track,
			monthYmd: calendarMonthYmd,
			startYmd,
			endYmd,
			occupied,
			readOnly,
			pinWindows
		});
	};

	const calendarFieldsFromModal = (modalBody) => {
		const startEl = modalBody?.querySelector?.('[data-organize-start-ymd]');
		const endEl = modalBody?.querySelector?.('[data-organize-end-ymd]');
		const trackEl = modalBody?.querySelector?.('[data-organize-track-field]');
		const form = modalBody?.querySelector?.('[data-challenge-admin-form]');
		const cidInput = form?.querySelector?.('[name="challenge_id"]');
		const viewCidEl = modalBody?.querySelector?.('[data-organize-view-challenge-id]');
		const startYmd = startEl instanceof HTMLInputElement ? startEl.value : '';
		const endYmd = endEl instanceof HTMLInputElement ? endEl.value : '';
		const trackVal = trackEl instanceof HTMLInputElement ? trackEl.value : createTrack;
		const exclude =
			form?.getAttribute('data-challenge-admin-form') === 'edit' &&
			cidInput instanceof HTMLInputElement
				? String(cidInput.value || '').trim()
				: viewCidEl instanceof HTMLInputElement
					? String(viewCidEl.value || '').trim()
					: '';
		const readOnly = Boolean(modalBody?.querySelector?.('[data-challenges-organize-view]'));
		return {
			startYmd,
			endYmd,
			track: normalizeChallengeTrack(trackVal),
			exclude,
			readOnly
		};
	};

	/**
	 * Announce-tab creation thumbs: hydrate on open; refresh when the URL input changes.
	 * Also toggles pin date fields when "Pin to feed" is checked/unchecked.
	 * @param {HTMLElement} modalBody
	 */
	const bindOrganizePinThumbs = (modalBody) => {
		if (!(modalBody instanceof HTMLElement)) return;
		const syncPinEnableUi = (checkbox) => {
			if (!(checkbox instanceof HTMLInputElement)) return;
			const slot = checkbox.closest('.challenges-organize-pin-slot');
			if (!(slot instanceof HTMLElement)) return;
			slot.classList.toggle('is-pin-disabled', !checkbox.checked);
		};
		const syncThumbFromInput = (input) => {
			if (!(input instanceof HTMLInputElement)) return;
			const slot = input.closest('.challenges-organize-pin-slot');
			if (!(slot instanceof HTMLElement)) return;
			const wrap = slot.querySelector('.challenges-organize-pin-thumb-wrap');
			if (!(wrap instanceof HTMLElement)) return;
			const ref = String(input.value || '').trim();
			const img = wrap.querySelector('[data-challenge-history-thumb-img]');
			const fallback = wrap.querySelector('[data-challenge-history-thumb-fallback]');
			wrap.setAttribute('data-challenge-history-thumb-ref', ref);
			wrap.setAttribute('data-challenge-history-thumb-pending', '');
			if (img instanceof HTMLImageElement) {
				img.removeAttribute('src');
				img.hidden = true;
			}
			if (fallback instanceof HTMLElement) fallback.hidden = false;
			if (!ref) {
				wrap.removeAttribute('data-challenge-history-thumb-pending');
				return;
			}
			void hydrateChallengeHistoryThumbnails(slot);
		};
		if (!modalBody.dataset.organizePinThumbsBound) {
			modalBody.dataset.organizePinThumbsBound = '1';
			modalBody.addEventListener('input', (e) => {
				const t = e.target;
				if (!(t instanceof HTMLInputElement)) return;
				if (!t.hasAttribute('data-organize-pin-url')) return;
				syncThumbFromInput(t);
			});
			modalBody.addEventListener('change', (e) => {
				const t = e.target;
				if (!(t instanceof HTMLInputElement)) return;
				if (!t.hasAttribute('data-organize-pin-enable')) return;
				syncPinEnableUi(t);
			});
		}
		modalBody.querySelectorAll('[data-organize-pin-enable]').forEach((el) => {
			if (el instanceof HTMLInputElement) syncPinEnableUi(el);
		});
		void hydrateChallengeHistoryThumbnails(modalBody);
	};

	const closeModal = () => {
		activeStatsRequestToken += 1;
		activeStatsModalState = null;
		calendarPendingStart = null;
		const modalEl = host.querySelector('[data-challenges-organizer-modal]');
		if (!(modalEl instanceof HTMLElement)) {
			setOrganizerModalOpenClass(false);
			return;
		}
		modalEl.classList.remove('open');
		modalEl.setAttribute('aria-hidden', 'true');
		setOrganizerModalOpenClass(false);
	};

	const openModal = (mode, editPayload, configMessageId, createOpts) => {
		const modalEl = host.querySelector('[data-challenges-organizer-modal]');
		const modalTitle = host.querySelector('[data-challenges-organizer-modal-title]');
		const modalBody = host.querySelector('[data-challenges-organizer-modal-body]');
		if (
			!(modalEl instanceof HTMLElement) ||
			!(modalTitle instanceof HTMLElement) ||
			!(modalBody instanceof HTMLElement)
		) {
			return;
		}
		if (mode === 'edit') {
			captureEditBaseline(configMessageId);
			modalTitle.textContent = 'Edit challenge';
		} else if (mode === 'view') {
			captureEditBaseline(configMessageId);
			modalTitle.textContent = 'View challenge';
		} else if (mode === 'global') {
			captureEditBaseline(globalConfigMessageId);
			modalTitle.textContent = 'Organizers';
		} else {
			editBodyBaselineFp = null;
			editBaselineMessageId = null;
			modalTitle.textContent = 'New challenge';
		}
		const track =
			mode === 'create'
				? normalizeChallengeTrack(createOpts?.track || defaultCreateTrack())
				: pickChallengeTrack(editPayload);
		createTrack = track;
		const editSection =
			mode === 'edit' && createOpts && typeof createOpts.section === 'string'
				? String(createOpts.section).trim()
				: mode === 'edit'
					? 'all'
					: '';
		const allowedTracks = allowedTracksForViewer();
		const globalCfgForModal =
			mode === 'global' ? pickLatestChallengesGlobalConfig(opts.messages) : null;
		modalBody.innerHTML = renderChallengeOrganizerModalInnerHtml(
			mode,
			editPayload,
			configMessageId,
			{
				organizersByTrack: resolveOrganizersByTrackFromGlobalPayload(
					globalCfgForModal?.payload
				),
				configMessageId: globalConfigMessageId
			},
			mode === 'create'
				? { ...(createOpts || {}), track, allowedTracks }
				: mode === 'edit' || mode === 'view'
					? {
							section: editSection || 'all',
							activeTab:
								typeof createOpts?.activeTab === 'string'
									? createOpts.activeTab
									: 'details',
							allowedTracks
						}
					: undefined
		);
		bindChallengeResultsToggle(modalBody);
		bindChallengeListingToggle(modalBody);
		bindChallengePrizeCategoryToggles(modalBody);
		bindOrganizePinThumbs(modalBody);
		if (mode === 'create') {
			syncCreatePrefills(modalBody, track);
		} else if (mode === 'edit' && editPayload) {
			const startEl = modalBody.querySelector('[data-organize-start-ymd]');
			const endEl = modalBody.querySelector('[data-organize-end-ymd]');
			const startYmd = startEl instanceof HTMLInputElement ? startEl.value : '';
			const endYmd = endEl instanceof HTMLInputElement ? endEl.value : '';
			const cid =
				editPayload.challenge_id != null ? String(editPayload.challenge_id).trim() : '';
			calendarMonthYmd =
				majorityMonthYmdFromRange(startYmd, endYmd) || startYmd || dateToLocalYmd();
			mountCalendarInModal(modalBody, track, cid, startYmd, endYmd);
		} else if (mode === 'view' && editPayload) {
			const fields = calendarFieldsFromModal(modalBody);
			const cid =
				editPayload.challenge_id != null ? String(editPayload.challenge_id).trim() : '';
			calendarMonthYmd =
				majorityMonthYmdFromRange(fields.startYmd, fields.endYmd) ||
				fields.startYmd ||
				dateToLocalYmd();
			mountCalendarInModal(
				modalBody,
				fields.track || track,
				cid || fields.exclude,
				fields.startYmd,
				fields.endYmd,
				{ readOnly: true }
			);
		}
		modalEl.classList.add('open');
		modalEl.setAttribute('aria-hidden', 'false');
		setOrganizerModalOpenClass(true);
	};

	/**
	 * @param {string} challengeId
	 * @param {string} challengeTitle
	 * @param {{ activeTab?: 'stats' | 'payout' }} [openOpts]
	 */
	const openStatsModal = async (challengeId, challengeTitle, openOpts = {}) => {
		const cid = String(challengeId || '').trim();
		if (!cid) return;
		const modalEl = host.querySelector('[data-challenges-organizer-modal]');
		const modalTitle = host.querySelector('[data-challenges-organizer-modal-title]');
		const modalBody = host.querySelector('[data-challenges-organizer-modal-body]');
		if (
			!(modalEl instanceof HTMLElement) ||
			!(modalTitle instanceof HTMLElement) ||
			!(modalBody instanceof HTMLElement)
		) {
			return;
		}
		const merged = mergeFullChallengeConfigForChallenge(challengeConfigEntries, cid);
		const phase = deriveChallengePhase(merged, Date.now());
		const showPayoutTab =
			(phase === 'finalizing' || phase === 'results') &&
			viewerCanManageChallengePayouts(opts.viewerUserName);
		const activeTab =
			openOpts.activeTab === 'payout' && showPayoutTab ? 'payout' : 'stats';

		const requestToken = ++activeStatsRequestToken;
		modalTitle.textContent = challengeTitle?.trim() || 'Results';
		modalBody.innerHTML = renderChallengeOrganizerStatsModalInnerHtml({
			challengeTitle,
			loading: true
		});
		modalEl.classList.add('open');
		modalEl.setAttribute('aria-hidden', 'false');
		setOrganizerModalOpenClass(true);

		const paintStatsBody = () => {
			if (!activeStatsModalState) return;
			const panel = modalBody.querySelector('[data-challenge-results-panel="stats"]');
			if (!(panel instanceof HTMLElement)) return;
			panel.innerHTML = renderChallengeOrganizerStatsBodyHtml({
				challengeTitle: activeStatsModalState.challengeTitle,
				topCreations: activeStatsModalState.data.topCreations,
				topSubmitters: activeStatsModalState.data.topSubmitters,
				topVoters: activeStatsModalState.data.topVoters,
				globalAverage: activeStatsModalState.data.globalAverage,
				excludedUserNames: activeStatsModalState.excludedUserNames,
				sortMode: activeStatsModalState.sortMode
			});
			void hydrateChallengeOrganizerStatsThumbs(panel);
		};

		const mountPayoutIfNeeded = () => {
			const mount = modalBody.querySelector('[data-organize-results-mount]');
			if (!(mount instanceof HTMLElement) || !showPayoutTab) return;
			const liveMerged = mergeFullChallengeConfigForChallenge(challengeConfigEntries, cid);
			mountOrganizeResultsPanel(mount, {
				threadId: opts.threadId,
				challengeId: cid,
				config: liveMerged || merged || {},
				viewerUserName: opts.viewerUserName || '',
				reload: opts.reload
			});
		};

		try {
			const endpoint = `/api/chat/threads/${encodeURIComponent(String(opts.threadId))}/challenges/${encodeURIComponent(cid)}/stats`;
			const res = await fetch(endpoint, { credentials: 'include' });
			const data = await res.json().catch(() => ({}));
			if (requestToken !== activeStatsRequestToken) return;
			if (!res.ok || data?.ok !== true) {
				const msg =
					typeof data?.message === 'string' && data.message.trim()
						? data.message.trim()
						: 'Could not load challenge results.';
				modalBody.innerHTML = renderChallengeOrganizerStatsModalInnerHtml({
					challengeTitle,
					error: msg
				});
				return;
			}
			const defaultExcludedUserNames = parseExcludedUsernames(opts.viewerUserName || '');
			activeStatsModalState = {
				challengeId: cid,
				challengeTitle,
				showPayoutTab,
				activeTab,
				paintStatsBody,
				data: {
					topCreations: data.topCreations,
					topSubmitters: data.topSubmitters,
					topVoters: data.topVoters,
					globalAverage: Number(data.globalAverage)
				},
				excludedUserNames: defaultExcludedUserNames,
				sortMode: 'weighted'
			};
			modalBody.innerHTML = renderChallengeOrganizerStatsModalInnerHtml({
				challengeTitle: activeStatsModalState.challengeTitle,
				topCreations: activeStatsModalState.data.topCreations,
				topSubmitters: activeStatsModalState.data.topSubmitters,
				topVoters: activeStatsModalState.data.topVoters,
				globalAverage: activeStatsModalState.data.globalAverage,
				excludedUserNames: activeStatsModalState.excludedUserNames,
				sortMode: activeStatsModalState.sortMode,
				showPayoutTab,
				activeTab
			});
			if (requestToken !== activeStatsRequestToken) return;
			void hydrateChallengeOrganizerStatsThumbs(modalBody);
			mountPayoutIfNeeded();
		} catch (err) {
			if (requestToken !== activeStatsRequestToken) return;
			modalBody.innerHTML = renderChallengeOrganizerStatsModalInnerHtml({
				challengeTitle,
				error:
					err instanceof Error && err.message
						? err.message
						: 'Could not load challenge results.'
			});
		}
	};

	const onDocEscape = (e) => {
		if (e.key !== 'Escape') return;
		const modalEl = host.querySelector('[data-challenges-organizer-modal]');
		if (!(modalEl instanceof HTMLElement) || !modalEl.classList.contains('open')) {
			return;
		}
		e.preventDefault();
		closeModal();
	};

	const onAdminConfigSubmit = async (e) => {
		e.preventDefault();
		const form = e.target;
		if (!(form instanceof HTMLFormElement)) return;
		if (form.matches('[data-challenge-stats-filter-form]')) {
			if (!activeStatsModalState) return;
			const input = form.querySelector('[data-challenge-stats-filter-input]');
			if (!(input instanceof HTMLInputElement)) return;
			activeStatsModalState.excludedUserNames = parseExcludedUsernames(input.value);
			if (typeof activeStatsModalState.paintStatsBody === 'function') {
				activeStatsModalState.paintStatsBody();
			}
			return;
		}
		const adminForm = form;
		const formRole = adminForm.getAttribute('data-challenge-admin-form');
		const isEditForm = formRole === 'edit';
		const isGlobalForm = formRole === 'global';
		const modalEl = host.querySelector('[data-challenges-organizer-modal]');
		if (!isGlobalForm && !modalEl?.contains(adminForm)) return;

		const errEl = adminForm.querySelector('[data-challenge-admin-error]');
		const successEl = adminForm.querySelector('[data-challenge-admin-success]');
		const submitBtn = adminForm.querySelector('.challenge-pane-admin-submit');

		const fd = new FormData(adminForm);
		const organizersMonthlyCsv = String(fd.get('organizers_monthly_csv') || '').trim();
		const organizersWeeklyCsv = String(fd.get('organizers_weekly_csv') || '').trim();
		const organizersSunoCsv = String(fd.get('organizers_suno_csv') || '').trim();
		let challengeId = String(fd.get('challenge_id') || '').trim();
		const title = String(fd.get('title') || '').trim();
		const details = String(fd.get('details') || '').trim();
		const heroRef = normalizeChallengeHeroRefForSave(fd.get('hero_image_url'));
		const resultsRef = normalizeChallengeHeroRefForSave(fd.get('results_creation_url'));
		const topicVoteRef = normalizeChallengeHeroRefForSave(fd.get('topic_vote_creation_url'));
		const resultsPublishedExisting = String(fd.get('results_published_at_existing') || '').trim();
		const editSection = String(adminForm.getAttribute('data-challenge-admin-edit-section') || '').trim();

		if (errEl instanceof HTMLElement) {
			errEl.hidden = true;
			errEl.textContent = '';
			errEl.replaceChildren();
		}
		if (successEl instanceof HTMLElement) {
			successEl.hidden = true;
			successEl.textContent = '';
		}
		if (submitBtn instanceof HTMLButtonElement) {
			const originalLabel = submitBtn.getAttribute('data-default-label') || submitBtn.textContent || 'Save';
			submitBtn.setAttribute('data-default-label', originalLabel);
			submitBtn.disabled = true;
			submitBtn.classList.add('is-loading');
			submitBtn.textContent = 'Saving';
		}

		/** @param {string} text */
		const setFormError = (text) => {
			if (!(errEl instanceof HTMLElement)) return;
			errEl.hidden = false;
			errEl.replaceChildren();
			const span = document.createElement('span');
			span.textContent = text;
			errEl.appendChild(span);
		};

		/** @param {string} text */
		const setReloadFailedError = (text) => {
			if (!(errEl instanceof HTMLElement)) return;
			errEl.hidden = false;
			errEl.replaceChildren();
			const span = document.createElement('span');
			span.textContent = text;
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'btn-outlined challenge-pane-admin-error-retry';
			btn.textContent = 'Retry refresh';
			btn.addEventListener('click', () => {
				void (async () => {
					try {
						await opts.reload();
						if (!isEditForm) adminForm.reset();
						if (errEl instanceof HTMLElement) {
							errEl.hidden = true;
							errEl.replaceChildren();
						}
						closeModal();
					} catch (e2) {
						const msg =
							e2 instanceof Error && e2.message
								? e2.message
								: 'Still could not refresh. Try reloading the page.';
						setReloadFailedError(
							`We still couldn’t refresh the channel. ${msg}`
						);
					}
				})();
			});
			errEl.appendChild(span);
			errEl.appendChild(btn);
		};

		let postSucceeded = false;
		/** When true, after config save sync editorial pins from the Announce tab. */
		let shouldSyncPins = false;
		try {
			let payload;
			if (isGlobalForm) {
				if (!isImpliedChallengeOrganizer(opts.viewerUserName)) {
					setFormError('Only oceanman can edit organizer settings.');
					return;
				}
				/** @param {string} csv */
				const parseCsv = (csv) =>
					organizersWithoutImplied(
						normalizeChallengeOrganizerUserNames(String(csv || '').split(','))
					);
				const organizersByTrack = {
					monthly: parseCsv(organizersMonthlyCsv),
					weekly: parseCsv(organizersWeeklyCsv),
					suno: parseCsv(organizersSunoCsv)
				};
				payload = {
					kind: 'challenges_global_config',
					organizers_by_track: organizersByTrack,
					organizer_user_names: organizersWithoutImplied([
						...organizersByTrack.monthly,
						...organizersByTrack.weekly,
						...organizersByTrack.suno
					])
				};
			} else {
				// Create: `{startDate}-{track}-{token}` from final schedule/track.
				if (!isEditForm) {
					const trackForId = normalizeChallengeTrack(
						String(fd.get('track') || createTrack || 'monthly')
					);
					const startForId =
						String(fd.get('schedule_start_ymd') || '').trim() || dateToLocalYmd();
					challengeId = getChallengeTrackTemplate(trackForId).suggestId(startForId);
					const idEl = adminForm.querySelector('[data-organize-challenge-id]');
					if (idEl instanceof HTMLInputElement) idEl.value = challengeId;
				}
				if (!challengeId) {
					if (!isEditForm) {
						setFormError('Could not create a challenge id. Try again.');
					}
					return;
				}
				const base = isEditForm
					? mergeFullChallengeConfigForChallenge(challengeConfigEntries, challengeId)
					: {};

				if (isEditForm && editSection === 'all') {
					if (!title) {
						setFormError('Title is required.');
						const detailsTab = adminForm.querySelector('[data-organize-edit-tab="details"]');
						if (detailsTab instanceof HTMLButtonElement) detailsTab.click();
						return;
					}
					const track = normalizeChallengeTrack(
						String(fd.get('track') || base.track || 'monthly')
					);
					const startYmd = String(fd.get('schedule_start_ymd') || '').trim();
					const endYmd = String(fd.get('schedule_end_ymd') || '').trim() || startYmd;
					if (!startYmd) {
						setFormError('Pick start and end days on the calendar.');
						const scheduleTab = adminForm.querySelector('[data-organize-edit-tab="schedule"]');
						if (scheduleTab instanceof HTMLButtonElement) scheduleTab.click();
						return;
					}
					const occupied = occupiedRangesForTrack(
						boardSummaries(),
						track,
						challengeId
					);
					const conflict = rangeConflictsWithOccupied(
						{ start: startYmd, end: endYmd },
						occupied
					);
					if (conflict) {
						setFormError(
							`Those days overlap “${conflict.title || conflict.challenge_id}” on the ${track} track. Pick a free range.`
						);
						return;
					}
					const timeline = timelineIsoFromDayRange(
						startYmd,
						endYmd,
						localStartOfDayToIso,
						localEndOfDayToIso
					);
					payload = {
						...base,
						kind: 'challenge_config',
						challenge_id: challengeId,
						title,
						track,
						...timeline
					};
					if (details) payload.details = details;
					else delete payload.details;
					// Pin fields live on the Announce tab. Saving from Details/Schedule/Prizes must not
					// clear hero/results/theme-vote or pin windows just because those inputs weren't the focus.
					const activeEditTab = String(
						adminForm
							.querySelector('.challenges-organize-edit-tab.is-active')
							?.getAttribute('data-organize-edit-tab') || 'details'
					)
						.trim()
						.toLowerCase();
					const applyPinsFromForm = activeEditTab === 'pins';
					if (applyPinsFromForm) {
						applyPinSlotsToPayload(payload, fd, {
							heroRef,
							resultsRef,
							topicVoteRef
						});
						shouldSyncPins = true;
					}
					applyRewardsAndPrizesFromForm(payload, fd, adminForm);
				} else if (isEditForm && editSection === 'results-late') {
					if (!resultsRef) {
						setFormError('Paste a creation URL for the results post.');
						return;
					}
					if (pickChallengeResultsCreationUrl(base)) {
						setFormError('A results post is already attached.');
						return;
					}
					payload = {
						...base,
						kind: 'challenge_config',
						challenge_id: challengeId,
						results_creation_url: resultsRef
					};
				} else if (isEditForm && editSection && editSection !== 'schedule') {
					payload = {
						...base,
						kind: 'challenge_config',
						challenge_id: challengeId
					};
					if (editSection === 'details' || editSection === 'media' || editSection === 'pins') {
						if (!title) {
							setFormError('Title is required.');
							return;
						}
						payload.title = title;
						if (details) payload.details = details;
						else delete payload.details;
						if (editSection === 'media' || editSection === 'pins') {
							applyPinSlotsToPayload(payload, fd, {
								heroRef,
								resultsRef,
								topicVoteRef
							});
							shouldSyncPins = true;
						} else {
							if (topicVoteRef) payload.topic_vote_creation_url = topicVoteRef;
							else delete payload.topic_vote_creation_url;
							if (heroRef) payload.hero_image_url = heroRef;
							else delete payload.hero_image_url;
							if (resultsRef) payload.results_creation_url = resultsRef;
							else delete payload.results_creation_url;
						}
					} else if (editSection === 'prizes') {
						applyRewardsAndPrizesFromForm(payload, fd, adminForm);
					}
				} else {
					const track = normalizeChallengeTrack(String(fd.get('track') || base.track || 'monthly'));
					const startYmd = String(fd.get('schedule_start_ymd') || '').trim();
					const endYmd = String(fd.get('schedule_end_ymd') || '').trim() || startYmd;
					if (!startYmd) {
						setFormError('Pick start and end days on the calendar.');
						const scheduleTab = adminForm.querySelector('[data-organize-edit-tab="schedule"]');
						if (scheduleTab instanceof HTMLButtonElement) scheduleTab.click();
						return;
					}
					const occupied = occupiedRangesForTrack(
						boardSummaries(),
						track,
						isEditForm ? challengeId : ''
					);
					const conflict = rangeConflictsWithOccupied(
						{ start: startYmd, end: endYmd },
						occupied
					);
					if (conflict) {
						setFormError(
							`Those days overlap “${conflict.title || conflict.challenge_id}” on the ${track} track. Pick a free range.`
						);
						const scheduleTab = adminForm.querySelector('[data-organize-edit-tab="schedule"]');
						if (scheduleTab instanceof HTMLButtonElement) scheduleTab.click();
						return;
					}
					const timeline = timelineIsoFromDayRange(
						startYmd,
						endYmd,
						localStartOfDayToIso,
						localEndOfDayToIso
					);
					if (isEditForm && editSection === 'schedule') {
						payload = {
							...base,
							kind: 'challenge_config',
							challenge_id: challengeId,
							track,
							...timeline
						};
					} else {
						if (!title) {
							setFormError('Title is required.');
							const detailsTab = adminForm.querySelector('[data-organize-edit-tab="details"]');
							if (detailsTab instanceof HTMLButtonElement) detailsTab.click();
							return;
						}
						payload = {
							...base,
							kind: 'challenge_config',
							challenge_id: challengeId,
							title,
							track,
							...timeline
						};
						if (details) payload.details = details;
						else delete payload.details;
						const createActiveTab = String(
							adminForm
								.querySelector('.challenges-organize-edit-tab.is-active')
								?.getAttribute('data-organize-edit-tab') || 'details'
						)
							.trim()
							.toLowerCase();
						const hasPinsFields = Boolean(
							adminForm.querySelector('[name="pin_open_start_ymd"]')
						);
						if (hasPinsFields && (createActiveTab === 'pins' || createActiveTab === 'details')) {
							// Create form includes Announce fields; persist URLs/windows + sync pins when
							// saving from Details (defaults) or Announce.
							applyPinSlotsToPayload(payload, fd, {
								heroRef,
								resultsRef,
								topicVoteRef
							});
							shouldSyncPins =
								createActiveTab === 'pins' ||
								Boolean(heroRef || resultsRef || topicVoteRef);
						} else {
							if (topicVoteRef) payload.topic_vote_creation_url = topicVoteRef;
							else delete payload.topic_vote_creation_url;
							if (heroRef) payload.hero_image_url = heroRef;
							else delete payload.hero_image_url;
							const publishCheckbox = adminForm.querySelector('[name="results_publish_now"]');
							if (publishCheckbox instanceof HTMLInputElement) {
								if (publishCheckbox.checked) {
									if (resultsPublishedExisting) {
										payload.results_published_at = resultsPublishedExisting;
									} else {
										payload.results_published_at = new Date().toISOString();
									}
									const resultsUrlInput = adminForm.querySelector(
										'[name="results_creation_url"]'
									);
									if (resultsUrlInput instanceof HTMLInputElement) {
										if (resultsRef) payload.results_creation_url = resultsRef;
										else delete payload.results_creation_url;
									}
								} else {
									delete payload.results_published_at;
									delete payload.results_creation_url;
								}
							} else if (resultsRef) {
								payload.results_creation_url = resultsRef;
							} else {
								delete payload.results_creation_url;
							}
						}
						applyRewardsAndPrizesFromForm(payload, fd, adminForm);
						if (!isEditForm) {
							payload.accepted_media = resolveCreateAcceptedMedia(track, boardSummaries());
						}
					}
				}
			}
			if (!isGlobalForm && payload && typeof payload === 'object' && payload.track != null) {
				const nextTrack = normalizeChallengeTrack(payload.track);
				const prevTrack = isEditForm
					? pickChallengeTrack(
							mergeFullChallengeConfigForChallenge(
								challengeConfigEntries,
								challengeId
							)
						)
					: null;
				const trackUnchanged = isEditForm && prevTrack === nextTrack;
				if (
					!trackUnchanged &&
					!viewerOrganizesTrack(
						opts.viewerUserName,
						organizersByTrackNow(),
						nextTrack
					)
				) {
					setFormError(
						'You can only set the challenge type to a type you organize.'
					);
					return;
				}
			}
			if (!isGlobalForm && payload && typeof payload === 'object') {
				const listVal = String(fd.get('challenge_list_as_upcoming') ?? '').trim();
				if (listVal === '1') {
					applyChallengeListed(payload);
				} else if (listVal === '0') {
					applyChallengeUnlisted(payload);
				} else if (!isEditForm) {
					applyChallengeUnlisted(payload);
				}
			}
			const body = JSON.stringify(payload);
			let r;
			if (
				isGlobalForm &&
				Number.isFinite(Number(fd.get('global_config_message_id'))) &&
				Number(fd.get('global_config_message_id')) > 0
			) {
				const mid = Number(fd.get('global_config_message_id'));
				const conflict = await assertConfigMessageUnchanged(mid);
				if (!conflict.ok) {
					setFormError(conflict.error);
					const reloadBtn = document.createElement('button');
					reloadBtn.type = 'button';
					reloadBtn.className = 'btn-outlined challenge-pane-admin-error-retry';
					reloadBtn.textContent = 'Reload';
					reloadBtn.addEventListener('click', () => {
						void (async () => {
							await opts.reload();
							closeModal();
						})();
					});
					if (errEl instanceof HTMLElement) errEl.appendChild(reloadBtn);
					return;
				}
				const patch = opts.patchMessage;
				if (typeof patch === 'function' && Number.isFinite(mid) && mid > 0) {
					r = await patch(mid, body);
				} else {
					throw new Error('Updates are not available (missing patch handler).');
				}
			} else if (
				isEditForm &&
				Number.isFinite(Number(fd.get('config_message_id'))) &&
				Number(fd.get('config_message_id')) > 0 &&
				typeof opts.patchMessage === 'function'
			) {
				const mid = Number(fd.get('config_message_id'));
				const conflict = await assertConfigMessageUnchanged(mid);
				if (!conflict.ok) {
					setFormError(conflict.error);
					const reloadBtn = document.createElement('button');
					reloadBtn.type = 'button';
					reloadBtn.className = 'btn-outlined challenge-pane-admin-error-retry';
					reloadBtn.textContent = 'Reload';
					reloadBtn.addEventListener('click', () => {
						void (async () => {
							await opts.reload();
							closeModal();
						})();
					});
					if (errEl instanceof HTMLElement) errEl.appendChild(reloadBtn);
					return;
				}
				r = await opts.patchMessage(mid, body);
			} else {
				r = await opts.postMessage(body);
			}
			if (!r.ok) {
				throw new Error(
					r.error ||
						(isGlobalForm
							? 'Could not save global settings.'
							: isEditForm
								? 'Could not update challenge.'
								: 'Could not save challenge.')
				);
			}
			postSucceeded = true;
			// Re-sync editorial pins on any successful challenge save when Announce fields exist,
			// so older pins (show_metadata: true) heal to image-only — not only when saving from Announce.
			const hasPinFields = Boolean(adminForm.querySelector('[name="pin_open_start_ymd"]'));
			if ((shouldSyncPins || hasPinFields) && !isGlobalForm && challengeId) {
				const pinEnabled = (name) => {
					const v = fd.get(name);
					if (v == null) return false;
					const s = String(v).trim().toLowerCase();
					return s === '1' || s === 'on' || s === 'true' || s === 'yes';
				};
				const ops = buildPinSyncOps(challengeId, {
					heroRef,
					resultsRef,
					topicVoteRef,
					openStart: String(fd.get('pin_open_start_ymd') || '').trim(),
					openUntil: String(fd.get('pin_open_until_ymd') || '').trim(),
					winnersStart: String(fd.get('pin_winners_start_ymd') || '').trim(),
					winnersUntil: String(fd.get('pin_winners_until_ymd') || '').trim(),
					topicStart: String(fd.get('pin_topic_vote_start_ymd') || '').trim(),
					topicUntil: String(fd.get('pin_topic_vote_until_ymd') || '').trim(),
					openEnabled: pinEnabled('pin_open_enabled'),
					winnersEnabled: pinEnabled('pin_winners_enabled'),
					topicEnabled: pinEnabled('pin_topic_vote_enabled'),
					localStartOfDayToIso,
					localEndOfDayToIso
				});
				/** @type {string[]} */
				const pinSyncErrors = [];
				for (const op of ops) {
					const body = op.clear
						? {
								kind: op.kind,
								challenge_id: challengeId,
								clear: true
							}
						: {
								kind: op.kind,
								challenge_id: challengeId,
								created_image_id: op.created_image_id,
								creation_ref: op.creation_ref,
								starts_at: op.starts_at,
								until: op.until
							};
					try {
						const pinRes = await fetch('/api/chat/challenges/organize/pins', {
							method: 'POST',
							credentials: 'include',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(body)
						});
						if (!pinRes.ok) {
							const data = await pinRes.json().catch(() => ({}));
							const msg =
								typeof data?.error === 'string' && data.error.trim()
									? data.error.trim()
									: typeof data?.message === 'string' && data.message.trim()
										? data.message.trim()
										: `Could not sync ${op.kind} pin.`;
							pinSyncErrors.push(msg);
						}
					} catch {
						pinSyncErrors.push(`Could not sync ${op.kind} pin.`);
					}
				}
				if (pinSyncErrors.length) {
					setFormError(pinSyncErrors[0]);
					if (successEl instanceof HTMLElement) {
						successEl.hidden = false;
						successEl.textContent =
							'Challenge saved, but a pin window conflicted — adjust Announce dates.';
					}
					if (r.message) upsertLocalMessage(r.message);
					await opts.reload();
					return;
				}
			}
			if (successEl instanceof HTMLElement) {
				successEl.hidden = false;
				successEl.textContent = isGlobalForm ? 'Organizers saved.' : 'Saved.';
			}
			if (isGlobalForm) {
				upsertLocalMessage(r.message);
				organizerUserNames = resolveChallengeOrganizerAllowlistFromMessages(opts.messages);
				const globalCfg = pickLatestChallengesGlobalConfig(opts.messages);
				globalConfigMessageId =
					Number.isFinite(Number(globalCfg?.messageId)) && Number(globalCfg?.messageId) > 0
						? Number(globalCfg.messageId)
						: null;
				closeModal();
			} else {
				if (r.message) upsertLocalMessage(r.message);
				await opts.reload();
			}
			if (!isEditForm && !isGlobalForm) {
				adminForm.reset();
			}
			if (!isGlobalForm) {
				closeModal();
			}
		} catch (err) {
			if (errEl instanceof HTMLElement) {
				if (postSucceeded) {
					setReloadFailedError(
						'Your changes were saved, but this view could not be refreshed. Check your connection, or use Retry refresh.'
					);
				} else {
					setFormError(
						err?.message ||
							(isGlobalForm
								? 'Could not save global settings.'
								: isEditForm
									? 'Could not update challenge.'
									: 'Could not save challenge.')
					);
				}
			}
		} finally {
			if (submitBtn instanceof HTMLButtonElement) {
				submitBtn.disabled = false;
				submitBtn.classList.remove('is-loading');
				submitBtn.textContent = submitBtn.getAttribute('data-default-label') || 'Save';
			}
		}
	};

	const onHostClick = (e) => {
		const t = e.target;
		if (!(t instanceof Element)) return;

		const statsCreationPreview = t.closest('[data-challenge-stats-creation-lightbox]');
		if (statsCreationPreview instanceof HTMLElement) {
			e.preventDefault();
			e.stopPropagation();
			const creationId = Number(statsCreationPreview.getAttribute('data-challenge-stats-creation-id'));
			if (!Number.isFinite(creationId) || creationId <= 0) return;
			const challengeMessageId = Number(
				statsCreationPreview.getAttribute('data-challenge-message-id')
			);
			const thumbImg = statsCreationPreview.querySelector('img.challenge-pane-organizer-stats-thumb');
			const thumbSrc =
				thumbImg instanceof HTMLImageElement
					? String(thumbImg.currentSrc || thumbImg.src || '').trim()
					: '';
			const qs =
				Number.isFinite(challengeMessageId) && challengeMessageId > 0
					? `?challenge_message_id=${encodeURIComponent(String(challengeMessageId))}`
					: '';
			const openStatsCreationLightbox = (src, mediaType = 'image', videoUrl = '') => {
				if (mediaType === 'video' && videoUrl) {
					openChatAttachmentPreviewLightbox(videoUrl, 'video');
					return;
				}
				const imageUrl = String(src || '').trim();
				if (!imageUrl) return;
				openChatInlineImageLightbox(imageUrl, {
					...(thumbImg instanceof HTMLImageElement ? { sourceImg: thumbImg } : {})
				});
			};
			void (async () => {
				try {
					const res = await fetch(
						`/api/create/images/${encodeURIComponent(String(creationId))}${qs}`,
						{ credentials: 'include' }
					);
					const payload = res.ok ? await res.json().catch(() => null) : null;
					if (payload && !payload._error) {
						const mediaType =
							typeof payload.media_type === 'string' ? payload.media_type : 'image';
						const videoUrl =
							typeof payload.video_url === 'string' ? payload.video_url.trim() : '';
						const imageUrl = statsThumbSrcFromCreationPayload(payload);
						if (mediaType === 'video' && videoUrl) {
							openStatsCreationLightbox(imageUrl, mediaType, videoUrl);
							return;
						}
						if (imageUrl) {
							openStatsCreationLightbox(imageUrl);
							return;
						}
					}
				} catch {
					// fall through to hydrated thumb
				}
				if (thumbSrc) {
					openStatsCreationLightbox(thumbSrc);
				}
			})();
			return;
		}

		const statsSortSwitch = t.closest('[data-challenge-stats-sort-switch]');
		if (statsSortSwitch instanceof HTMLButtonElement) {
			const nextSortMode =
				activeStatsModalState?.sortMode === 'weighted' ? 'average' : 'weighted';
			if (!activeStatsModalState) return;
			if (activeStatsModalState.sortMode === nextSortMode) return;
			activeStatsModalState.sortMode = nextSortMode;
			if (typeof activeStatsModalState.paintStatsBody === 'function') {
				activeStatsModalState.paintStatsBody();
			}
			return;
		}

		const resultsTabBtn = t.closest('[data-challenge-results-tab]');
		if (resultsTabBtn instanceof HTMLButtonElement) {
			const tabId = resultsTabBtn.getAttribute('data-challenge-results-tab') || '';
			const scope = resultsTabBtn.closest('[data-challenge-results-modal]');
			if (!tabId || !(scope instanceof HTMLElement)) return;
			const tabs = scope.querySelectorAll('[data-challenge-results-tab]');
			const panels = scope.querySelectorAll('[data-challenge-results-panel]');
			for (const btn of tabs) {
				if (!(btn instanceof HTMLButtonElement)) continue;
				const on = btn.getAttribute('data-challenge-results-tab') === tabId;
				btn.classList.toggle('is-active', on);
				btn.setAttribute('aria-selected', on ? 'true' : 'false');
				btn.tabIndex = on ? 0 : -1;
			}
			for (const panel of panels) {
				if (!(panel instanceof HTMLElement)) continue;
				panel.hidden = panel.getAttribute('data-challenge-results-panel') !== tabId;
			}
			if (activeStatsModalState) activeStatsModalState.activeTab = tabId;
			return;
		}

		if (t.closest('[data-challenges-organizer-modal-close]')) {
			closeModal();
			return;
		}

		const modalEl = host.querySelector('[data-challenges-organizer-modal]');
		if (modalEl instanceof HTMLElement && t === modalEl) {
			closeModal();
			return;
		}

		const addRow = t.closest('[data-challenges-organizer-add-row]');
		if (addRow) {
			openModal('create', null, null, { track: defaultCreateTrack() });
			return;
		}

		const newTrackBtn = t.closest('[data-organize-new-track]');
		if (newTrackBtn instanceof HTMLElement) {
			const requested = normalizeChallengeTrack(
				newTrackBtn.getAttribute('data-organize-new-track')
			);
			const track = allowedTracksForViewer().includes(requested)
				? requested
				: defaultCreateTrack();
			createTrack = track;
			const tpl = getChallengeTrackTemplate(track);
			const occupied = occupiedRangesForTrack(boardSummaries(), track);
			const range = findNextFreeRange(dateToLocalYmd(), tpl.defaultLengthDays, occupied);
			const prefills = resolveCreatePrizePrefills(track, boardSummaries());
			openModal('create', null, null, {
				track,
				title: tpl.suggestTitle(range.start),
				challenge_id: tpl.suggestId(range.start),
				startYmd: range.start,
				endYmd: range.end,
				prizes: prefills.rewardFields,
				prizeStructure: prefills.prizeStructure
			});
			return;
		}

		const settingsBtn = t.closest('[data-organize-settings]');
		if (settingsBtn instanceof HTMLElement) {
			if (!isImpliedChallengeOrganizer(opts.viewerUserName)) return;
			openModal('global');
			return;
		}

		const templateBtn = t.closest('[data-organize-template]');
		if (templateBtn instanceof HTMLElement) {
			if (templateBtn.disabled || templateBtn.getAttribute('aria-disabled') === 'true') {
				return;
			}
			const track = normalizeChallengeTrack(templateBtn.getAttribute('data-organize-template'));
			if (!viewerOrganizesTrack(opts.viewerUserName, organizersByTrackNow(), track)) {
				return;
			}
			createTrack = track;
			const modalBody = host.querySelector('[data-challenges-organizer-modal-body]');
			if (!(modalBody instanceof HTMLElement)) return;
			const form = modalBody.querySelector('[data-challenge-admin-form]');
			const formRole = form?.getAttribute('data-challenge-admin-form') || '';
			if (formRole === 'edit') {
				const trackEl = modalBody.querySelector('[data-organize-track-field]');
				if (trackEl instanceof HTMLInputElement) trackEl.value = track;
				const chips = modalBody.querySelectorAll('[data-organize-template]');
				for (const chip of chips) {
					if (!(chip instanceof HTMLElement)) continue;
					const on = normalizeChallengeTrack(chip.getAttribute('data-organize-template')) === track;
					chip.classList.toggle('is-active', on);
				}
				const startEl = modalBody.querySelector('[data-organize-start-ymd]');
				const endEl = modalBody.querySelector('[data-organize-end-ymd]');
				const cidInput = form.querySelector('[name="challenge_id"]');
				const exclude =
					cidInput instanceof HTMLInputElement ? String(cidInput.value || '').trim() : '';
				mountCalendarInModal(
					modalBody,
					track,
					exclude,
					startEl instanceof HTMLInputElement ? startEl.value : '',
					endEl instanceof HTMLInputElement ? endEl.value : ''
				);
				return;
			}
			modalBody.innerHTML = renderChallengeOrganizerModalInnerHtml(
				'create',
				null,
				null,
				null,
				{ track, allowedTracks: allowedTracksForViewer() }
			);
			bindChallengeResultsToggle(modalBody);
			bindChallengeListingToggle(modalBody);
			bindChallengePrizeCategoryToggles(modalBody);
			syncCreatePrefills(modalBody, track);
			return;
		}

		const calMonthBtn = t.closest('[data-organize-cal-month]');
		if (calMonthBtn instanceof HTMLElement) {
			calendarMonthYmd = calMonthBtn.getAttribute('data-organize-cal-month') || calendarMonthYmd;
			const modalBody = host.querySelector('[data-challenges-organizer-modal-body]');
			if (modalBody instanceof HTMLElement) {
				const fields = calendarFieldsFromModal(modalBody);
				mountCalendarInModal(
					modalBody,
					fields.track,
					fields.exclude,
					fields.startYmd,
					fields.endYmd,
					{ readOnly: fields.readOnly }
				);
			}
			return;
		}

		const calDayBtn = t.closest('[data-organize-cal-day]');
		if (calDayBtn instanceof HTMLButtonElement && !calDayBtn.disabled) {
			if (calDayBtn.closest('[data-organize-calendar-readonly]')) return;
			const ymd = calDayBtn.getAttribute('data-organize-cal-day') || '';
			const modalBody = host.querySelector('[data-challenges-organizer-modal-body]');
			const fields = calendarFieldsFromModal(modalBody);
			const track = fields.track;
			const exclude = fields.exclude;
			const occupied = occupiedRangesForTrack(boardSummaries(), track, exclude);
			const tpl = getChallengeTrackTemplate(track);
			const result = resolveCalendarClick(
				calendarPendingStart,
				ymd,
				occupied,
				tpl.defaultLengthDays
			);
			if (result.blocked) return;
			calendarPendingStart = result.pendingStart;
			const startEl = modalBody?.querySelector?.('[data-organize-start-ymd]');
			const endEl = modalBody?.querySelector?.('[data-organize-end-ymd]');
			const form = modalBody?.querySelector?.('[data-challenge-admin-form]');
			const cidInput = form?.querySelector?.('[name="challenge_id"]');
			if (startEl instanceof HTMLInputElement) startEl.value = result.startYmd || '';
			if (endEl instanceof HTMLInputElement) endEl.value = result.endYmd || '';
			if (
				form?.getAttribute('data-challenge-admin-form') === 'create' &&
				cidInput instanceof HTMLInputElement &&
				result.startYmd
			) {
				cidInput.value = tpl.suggestId(result.startYmd);
			}
			if (modalBody instanceof HTMLElement) {
				mountCalendarInModal(
					modalBody,
					track,
					exclude,
					result.startYmd || '',
					result.endYmd || ''
				);
			}
			return;
		}

		const organizeAction = t.closest('[data-organize-action]');
		if (organizeAction instanceof HTMLElement) {
			const action = organizeAction.getAttribute('data-organize-action') || '';
			const cid = organizeAction.getAttribute('data-challenge-id') || '';
			void runOrganizeLifecycleAction(action, cid, organizeAction);
			return;
		}

		const editTabBtn = t.closest('[data-organize-edit-tab]');
		if (editTabBtn instanceof HTMLButtonElement) {
			const tabId = editTabBtn.getAttribute('data-organize-edit-tab') || '';
			const scope =
				editTabBtn.closest('[data-challenge-admin-config-form]') ||
				editTabBtn.closest('[data-challenges-organize-view]');
			if (!tabId || !(scope instanceof HTMLElement)) return;
			const tabs = scope.querySelectorAll('[data-organize-edit-tab]');
			const panels = scope.querySelectorAll('[data-organize-edit-panel]');
			for (const btn of tabs) {
				if (!(btn instanceof HTMLButtonElement)) continue;
				const on = btn.getAttribute('data-organize-edit-tab') === tabId;
				btn.classList.toggle('is-active', on);
				btn.setAttribute('aria-selected', on ? 'true' : 'false');
				btn.tabIndex = on ? 0 : -1;
			}
			for (const panel of panels) {
				if (!(panel instanceof HTMLElement)) continue;
				const on = panel.getAttribute('data-organize-edit-panel') === tabId;
				panel.hidden = !on;
			}
			if (tabId === 'pins') {
				const pinsPanel = scope.querySelector('[data-organize-edit-panel="pins"]');
				if (pinsPanel instanceof HTMLElement) {
					void hydrateChallengeHistoryThumbnails(pinsPanel);
				}
			}
			return;
		}

		const editSectionBtn = t.closest('[data-challenges-organizer-edit-section]');
		if (editSectionBtn instanceof HTMLButtonElement) {
			const cid = editSectionBtn.getAttribute('data-challenges-organizer-edit-section') || '';
			const section =
				editSectionBtn.getAttribute('data-organize-edit-section') || 'all';
			const activeTab =
				editSectionBtn.getAttribute('data-organize-edit-tab-open') || 'details';
			const row = rowByChallengeId.get(cid);
			const merged = mergeFullChallengeConfigForChallenge(challengeConfigEntries, cid);
			openModal(
				'edit',
				{ ...(row?.payload || {}), ...merged, challenge_id: cid },
				row?.configMessageId,
				{ section, activeTab }
			);
			return;
		}

		const editBtn = t.closest('[data-challenges-organizer-edit]');
		if (editBtn instanceof HTMLButtonElement) {
			const cid = editBtn.getAttribute('data-challenges-organizer-edit') || '';
			const row = rowByChallengeId.get(cid);
			const merged = mergeFullChallengeConfigForChallenge(challengeConfigEntries, cid);
			openModal(
				'edit',
				{ ...(row?.payload || {}), ...merged, challenge_id: cid },
				row?.configMessageId,
				{ section: 'all', activeTab: 'details' }
			);
			return;
		}

		const viewBtn = t.closest('[data-challenges-organizer-view]');
		if (viewBtn instanceof HTMLButtonElement) {
			const cid = viewBtn.getAttribute('data-challenges-organizer-view') || '';
			const row = rowByChallengeId.get(cid);
			const merged = mergeFullChallengeConfigForChallenge(challengeConfigEntries, cid);
			const resultsUrl = pickChallengeResultsCreationUrl(merged);
			openModal(
				'view',
				{ ...(row?.payload || {}), ...merged, challenge_id: cid },
				row?.configMessageId,
				{ activeTab: resultsUrl ? 'details' : 'pins' }
			);
			return;
		}

		const softDeleteBtn = t.closest('[data-organize-soft-delete]');
		if (softDeleteBtn instanceof HTMLElement) {
			const modalBody = host.querySelector('[data-challenges-organizer-modal-body]');
			const form = modalBody?.querySelector?.('[data-challenge-admin-form="edit"]');
			if (!(modalBody instanceof HTMLElement) || !(form instanceof HTMLFormElement)) return;
			const titleEl = form.querySelector('[name="title"]');
			const title =
				titleEl instanceof HTMLInputElement && titleEl.value.trim()
					? titleEl.value.trim()
					: 'this challenge';
			const templates = modalBody.querySelector('.challenges-organize-templates');
			if (templates instanceof HTMLElement) templates.hidden = true;
			form.hidden = true;
			let confirmEl = modalBody.querySelector('[data-organize-soft-delete-confirm]');
			if (confirmEl) confirmEl.remove();
			modalBody.insertAdjacentHTML(
				'beforeend',
				renderOrganizeSoftDeleteConfirmHtml({ title })
			);
			const modalTitle = host.querySelector('[data-challenges-organizer-modal-title]');
			if (modalTitle instanceof HTMLElement) modalTitle.textContent = 'Delete challenge';
			return;
		}

		const softDeleteCancel = t.closest('[data-organize-soft-delete-cancel]');
		if (softDeleteCancel instanceof HTMLElement) {
			const modalBody = host.querySelector('[data-challenges-organizer-modal-body]');
			const form = modalBody?.querySelector?.('[data-challenge-admin-form="edit"]');
			const confirmEl = modalBody?.querySelector?.('[data-organize-soft-delete-confirm]');
			const templates = modalBody?.querySelector?.('.challenges-organize-templates');
			if (confirmEl instanceof HTMLElement) confirmEl.remove();
			if (templates instanceof HTMLElement) templates.hidden = false;
			if (form instanceof HTMLFormElement) form.hidden = false;
			const modalTitle = host.querySelector('[data-challenges-organizer-modal-title]');
			if (modalTitle instanceof HTMLElement) modalTitle.textContent = 'Edit challenge';
			return;
		}

		const softDeleteConfirm = t.closest('[data-organize-soft-delete-confirm-yes]');
		if (softDeleteConfirm instanceof HTMLElement) {
			const modalBody = host.querySelector('[data-challenges-organizer-modal-body]');
			const form = modalBody?.querySelector?.('[data-challenge-admin-form="edit"]');
			if (!(form instanceof HTMLFormElement)) return;
			const cidInput = form.querySelector('[name="challenge_id"]');
			const midInput = form.querySelector('[name="config_message_id"]');
			const cid =
				cidInput instanceof HTMLInputElement ? String(cidInput.value || '').trim() : '';
			const mid =
				midInput instanceof HTMLInputElement ? Number(midInput.value) : NaN;
			if (!cid) return;
			softDeleteConfirm.disabled = true;
			void (async () => {
				try {
					const merged = mergeFullChallengeConfigForChallenge(
						challengeConfigEntries,
						cid
					);
					const payload = {
						...merged,
						kind: 'challenge_config',
						challenge_id: cid,
						deleted_at: new Date().toISOString()
					};
					delete payload.purged_at;
					delete payload.purged;
					const body = JSON.stringify(payload);
					if (!(Number.isFinite(mid) && mid > 0 && typeof opts.patchMessage === 'function')) {
						throw new Error('Missing challenge config message to update.');
					}
					const r = await opts.patchMessage(mid, body);
					if (!r?.ok) {
						throw new Error(r?.error || 'Could not move challenge to Deleted.');
					}
					closeModal();
					await opts.reload();
				} catch (err) {
					softDeleteConfirm.disabled = false;
					window.alert(
						err instanceof Error && err.message
							? err.message
							: 'Could not move challenge to Deleted.'
					);
				}
			})();
			return;
		}

		const restoreBtn = t.closest('[data-organize-restore]');
		if (restoreBtn instanceof HTMLElement) {
			if (!isImpliedChallengeOrganizer(opts.viewerUserName)) return;
			const cid = restoreBtn.getAttribute('data-organize-restore') || '';
			if (!cid) return;
			restoreBtn.setAttribute('disabled', 'true');
			void (async () => {
				try {
					const row = rowByChallengeId.get(cid);
					const merged = mergeFullChallengeConfigForChallenge(
						challengeConfigEntries,
						cid
					);
					const payload = {
						...merged,
						kind: 'challenge_config',
						challenge_id: cid
					};
					delete payload.deleted_at;
					delete payload.deletedAt;
					delete payload.deleted;
					delete payload.purged_at;
					delete payload.purged;
					const mid = Number(row?.configMessageId);
					const body = JSON.stringify(payload);
					if (!(Number.isFinite(mid) && mid > 0 && typeof opts.patchMessage === 'function')) {
						throw new Error('Missing challenge config message to update.');
					}
					const r = await opts.patchMessage(mid, body);
					if (!r?.ok) throw new Error(r?.error || 'Could not restore challenge.');
					await opts.reload();
				} catch (err) {
					restoreBtn.removeAttribute('disabled');
					window.alert(
						err instanceof Error && err.message
							? err.message
							: 'Could not restore challenge.'
					);
				}
			})();
			return;
		}

		const purgeBtn = t.closest('[data-organize-purge]');
		if (purgeBtn instanceof HTMLElement) {
			if (!isImpliedChallengeOrganizer(opts.viewerUserName)) return;
			const cid = purgeBtn.getAttribute('data-organize-purge') || '';
			if (!cid) return;
			const titleRaw =
				rowByChallengeId.get(cid)?.title ||
				mergeFullChallengeConfigForChallenge(challengeConfigEntries, cid)?.title ||
				cid;
			const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : cid;
			const ok = window.confirm(
				`Permanently delete “${title}”?\n\nThis cannot be undone. It will leave the Deleted list forever. Title, schedule, prizes, and media config will no longer be recoverable from this page.`
			);
			if (!ok) return;
			purgeBtn.setAttribute('disabled', 'true');
			void (async () => {
				try {
					const row = rowByChallengeId.get(cid);
					const merged = mergeFullChallengeConfigForChallenge(
						challengeConfigEntries,
						cid
					);
					const nowIso = new Date().toISOString();
					const payload = {
						...merged,
						kind: 'challenge_config',
						challenge_id: cid,
						deleted_at: merged.deleted_at || nowIso,
						purged_at: nowIso
					};
					const mid = Number(row?.configMessageId);
					const body = JSON.stringify(payload);
					if (!(Number.isFinite(mid) && mid > 0 && typeof opts.patchMessage === 'function')) {
						throw new Error('Missing challenge config message to update.');
					}
					const r = await opts.patchMessage(mid, body);
					if (!r?.ok) throw new Error(r?.error || 'Could not permanently delete.');
					await opts.reload();
				} catch (err) {
					purgeBtn.removeAttribute('disabled');
					window.alert(
						err instanceof Error && err.message
							? err.message
							: 'Could not permanently delete.'
					);
				}
			})();
			return;
		}

		const statsBtn = t.closest('[data-challenges-organizer-stats]');
		if (statsBtn instanceof HTMLButtonElement) {
			const cid = statsBtn.getAttribute('data-challenges-organizer-stats') || '';
			const row = rowByChallengeId.get(cid);
			const title =
				(row?.payload && typeof row.payload.title === 'string' && row.payload.title.trim()) ||
				(typeof row?.title === 'string' && row.title.trim()) ||
				cid;
			void openStatsModal(cid, title);
		}
	};

	const onHostKeydown = (e) => {
		const addRow =
			e.target instanceof Element
				? e.target.closest('[data-challenges-organizer-add-row]')
				: null;
		if (!addRow) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openModal('create', null);
		}
	};

	/** @type {ResizeObserver | null} */
	let cardHeroResizeObserver = null;

	const syncOrganizeCardHeroSquares = () => {
		const cards = host.querySelectorAll('[data-organize-card]');
		for (const card of cards) {
			if (!(card instanceof HTMLElement)) continue;
			const media = card.querySelector('.challenges-organize-card-media');
			if (!(media instanceof HTMLElement)) continue;
			const h = Math.round(card.getBoundingClientRect().height);
			if (h <= 0) continue;
			media.style.setProperty('--organize-hero-side', `${h}px`);
		}
	};

	const observeOrganizeCardHeroSquares = () => {
		if (typeof ResizeObserver === 'undefined') {
			syncOrganizeCardHeroSquares();
			return;
		}
		if (cardHeroResizeObserver) {
			cardHeroResizeObserver.disconnect();
		}
		cardHeroResizeObserver = new ResizeObserver(() => {
			syncOrganizeCardHeroSquares();
		});
		const cards = host.querySelectorAll('[data-organize-card]');
		for (const card of cards) {
			if (card instanceof HTMLElement) cardHeroResizeObserver.observe(card);
		}
		syncOrganizeCardHeroSquares();
	};

	const paint = () => {
		const model = buildChallengesChannelModel(opts.messages, {
			viewerId: opts.viewerId,
			nowMs: Date.now()
		});
		organizerUserNames = resolveChallengeOrganizerAllowlistFromMessages(opts.messages);
		const globalCfg = pickLatestChallengesGlobalConfig(opts.messages);
		globalConfigMessageId =
			Number.isFinite(Number(globalCfg?.messageId)) && Number(globalCfg?.messageId) > 0
				? Number(globalCfg.messageId)
				: null;
		const summaries = summarizeLatestChallengeConfigs(model.raw.configs);
		challengeConfigEntries = model.raw.configs;
		rowByChallengeId = new Map(summaries.map((s) => [s.challenge_id, s]));

		const statsSvg = statsIcon('challenge-pane-organizer-stats-trigger-svg');
		const contentSvg = slidersIcon('challenges-organize-section-svg');
		const viewSvg = eyeIcon('challenges-organize-section-svg');
		const settingsSvg = gearIcon('challenges-organize-settings-svg');
		host.innerHTML = renderChallengeOrganizerPageMarkup({
			rows: summaries,
			configEntries: challengeConfigEntries,
			statsIconSvg: statsSvg,
			contentIconSvg: contentSvg,
			viewIconSvg: viewSvg,
			settingsIconSvg: settingsSvg,
			nowMs: Date.now(),
			isOceanman: isImpliedChallengeOrganizer(opts.viewerUserName)
		});
		observeOrganizeCardHeroSquares();
		void hydrateChallengeHistoryThumbnails(host);
	};

	/**
	 * @param {string} action
	 * @param {string} challengeId
	 * @param {HTMLElement} [btn]
	 */
	const runOrganizeLifecycleAction = async (action, challengeId, btn) => {
		const cid = String(challengeId || '').trim();
		if (!cid) return;
		const merged = mergeFullChallengeConfigForChallenge(challengeConfigEntries, cid);
		const row = rowByChallengeId.get(cid);
		const mid = Number(row?.configMessageId);
		const setBusy = (on) => {
			if (btn instanceof HTMLButtonElement) btn.disabled = Boolean(on);
		};
		setBusy(true);
		try {
			if (Number.isFinite(mid) && mid > 0) {
				const conflict = await assertConfigMessageUnchanged(mid);
				if (!conflict.ok) {
					window.alert(conflict.error);
					await opts.reload();
					return;
				}
			}
			if (action === 'close-voting') {
				const yesterday = dateToLocalYmd(new Date(Date.now() - 86400000));
				const endIso = localEndOfDayToIso(yesterday);
				const payload = {
					...merged,
					kind: 'challenge_config',
					challenge_id: cid,
					submission_end_at: endIso,
					voting_end_at: endIso
				};
				const body = JSON.stringify(payload);
				if (!(Number.isFinite(mid) && mid > 0 && typeof opts.patchMessage === 'function')) {
					throw new Error('Missing challenge config message to update.');
				}
				const r = await opts.patchMessage(mid, body);
				if (!r?.ok) throw new Error(r?.error || 'Could not close voting');
				await opts.reload();
				return;
			}
			if (action === 'publish-winners') {
				const payload = {
					...merged,
					kind: 'challenge_config',
					challenge_id: cid,
					results_published_at:
						merged.results_published_at || new Date().toISOString()
				};
				const body = JSON.stringify(payload);
				if (!(Number.isFinite(mid) && mid > 0 && typeof opts.patchMessage === 'function')) {
					throw new Error('Missing challenge config message to update.');
				}
				const r = await opts.patchMessage(mid, body);
				if (!r?.ok) throw new Error(r?.error || 'Could not publish winners');
				const resultsUrl =
					typeof merged.results_creation_url === 'string'
						? merged.results_creation_url.trim()
						: '';
				const hero =
					typeof merged.hero_image_url === 'string' ? merged.hero_image_url.trim() : '';
				const pinRef = resultsUrl || hero;
				const creationMatch = pinRef.match(/\/creations\/(\d+)/);
				const createdImageId = creationMatch ? Number(creationMatch[1]) : 0;
				if (Number.isFinite(createdImageId) && createdImageId > 0) {
					await fetch('/api/chat/challenges/organize/pins', {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							kind: 'winners',
							challenge_id: cid,
							created_image_id: createdImageId,
							creation_ref: pinRef,
							title: merged.title || cid
						})
					}).catch(() => null);
				}
				await opts.reload();
				return;
			}
		} catch (err) {
			console.error('[organize]', action, err);
			window.alert(
				err instanceof Error && err.message ? err.message : `Could not ${action}`
			);
		} finally {
			setBusy(false);
		}
	};

	paint();

	host.addEventListener('click', onHostClick);
	host.addEventListener('keydown', onHostKeydown);
	host.addEventListener('submit', onAdminConfigSubmit);
	document.addEventListener('keydown', onDocEscape);

	return {
		destroy: () => {
			if (cardHeroResizeObserver) {
				cardHeroResizeObserver.disconnect();
				cardHeroResizeObserver = null;
			}
			setOrganizerModalOpenClass(false);
			document.removeEventListener('keydown', onDocEscape);
			host.removeEventListener('click', onHostClick);
			host.removeEventListener('keydown', onHostKeydown);
			host.removeEventListener('submit', onAdminConfigSubmit);
			host.innerHTML = '';
		},
		openGlobalSettings: () => {
			if (!isImpliedChallengeOrganizer(opts.viewerUserName)) return;
			openModal('global');
		},
		isOceanman: () => isImpliedChallengeOrganizer(opts.viewerUserName)
	};
}
