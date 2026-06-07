import { buildChallengesChannelModel } from './model/buildChannelModel.js';
import { summarizeLatestChallengeConfigs } from './model/organizerSummaries.js';
import {
	mergeFullChallengeConfigForChallenge,
	normalizeChallengeHeroRefForSave,
	parseDatetimeLocalToIso,
	REWARD_FIELD_KEYS,
	normalizeChallengeOrganizerUserNames,
	pickLatestChallengesGlobalConfig,
	resolveChallengeOrganizerAllowlistFromMessages
} from './challengeAdmin.js';
import {
	renderChallengeOrganizerSidebarMarkup,
	renderChallengeOrganizerModalInnerHtml,
	renderChallengeOrganizerStatsModalInnerHtml,
	bindChallengeResultsToggle
} from './views/adminView.js';
import {
	openChatAttachmentPreviewLightbox,
	openChatInlineImageLightbox
} from '../../shared/chatInlineImageLightbox.js';

/** Creation payload from GET /api/create/images/:id (with optional challenge_message_id). */
function statsThumbSrcFromCreationPayload(c) {
	if (!c || c._error) return '';
	const mediaType = typeof c.media_type === 'string' ? c.media_type : 'image';
	const videoUrl = typeof c.video_url === 'string' ? c.video_url.trim() : '';
	const url = typeof c.url === 'string' ? c.url.trim() : '';
	const thumb = typeof c.thumbnail_url === 'string' ? c.thumbnail_url.trim() : '';
	if (mediaType === 'video') return (thumb || url || videoUrl).trim();
	return (url || thumb).trim();
}

function escapeHtmlAttr(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/**
 * Same authorization path as blind voting: `?challenge_message_id=` unlocks unpublished challenge entries.
 * @param {HTMLElement} rootEl — modal body containing `[data-challenge-stats-thumb-slot]`
 */
async function hydrateChallengeOrganizerStatsThumbs(rootEl) {
	const slots = rootEl.querySelectorAll('[data-challenge-stats-thumb-slot]');
	await Promise.all(
		[...slots].map(async (slot) => {
			const cid = Number(slot.getAttribute('data-creation-id'));
			const midRaw = slot.getAttribute('data-challenge-message-id');
			const mid = Number(midRaw);
			if (!Number.isFinite(cid) || cid <= 0) return;
			const qs =
				Number.isFinite(mid) && mid > 0
					? `?challenge_message_id=${encodeURIComponent(String(mid))}`
					: '';
			let src = '';
			try {
				const res = await fetch(`/api/create/images/${encodeURIComponent(String(cid))}${qs}`, {
					credentials: 'include'
				});
				const c = res.ok ? await res.json().catch(() => null) : null;
				src = statsThumbSrcFromCreationPayload(c);
			} catch {
				src = '';
			}
			if (src && slot.isConnected) {
				slot.innerHTML = `<img class="challenge-pane-organizer-stats-thumb" src="${escapeHtmlAttr(src)}" alt="" width="40" height="40" decoding="async" loading="lazy" />`;
			}
		})
	);
}

/**
 * Challenge organizer UI in the chat right sidebar (same panel chrome as canvases).
 *
 * @param {HTMLElement} host — `[data-chat-challenges-organizer-sidebar]`
 * @param {{
 *   messages: object[],
 *   viewerId: number | null,
 *   viewerUserName?: string | null,
 *   organizerUserNames?: string[],
 *   globalConfigMessageId?: number | null,
 *   threadId: number,
 *   postMessage: (body: string) => Promise<{ ok: boolean, error?: string }>,
 *   patchMessage?: (messageId: number, body: string) => Promise<{ ok: boolean, error?: string }>,
 *   reload: () => Promise<void>,
 *   gearIcon: (className?: string) => string,
 *   statsIcon?: (className?: string) => string,
 *   plusIcon?: (className?: string) => string,
 * }} opts — icon helpers should come from the same versioned `svg-strings` import as `chat.js` (avoid an extra uncached static import here).
 */
export function mountChallengesOrganizerSidebar(host, opts) {
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
		} catch {
			// ignore
		}
	};

	const gearIcon =
		typeof opts.gearIcon === 'function'
			? opts.gearIcon
			: /** @param {string} [cls] */ (cls) =>
					`<svg class="${String(cls || '').trim()}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /></svg>`;
	const statsIcon =
		typeof opts.statsIcon === 'function'
			? opts.statsIcon
			: /** @param {string} [cls] */ (cls) =>
					`<svg class="${String(cls || '').trim()}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 20V12M12 20V6M18 20v-8"/></svg>`;
	const plusIcon =
		typeof opts.plusIcon === 'function'
			? opts.plusIcon
			: /** @param {string} [cls] */ (cls) =>
					`<svg class="${String(cls || '').trim()}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
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

	const closeModal = () => {
		activeStatsRequestToken += 1;
		activeStatsModalState = null;
		const modalEl = host.querySelector('[data-challenges-organizer-modal]');
		if (!(modalEl instanceof HTMLElement)) {
			setOrganizerModalOpenClass(false);
			return;
		}
		modalEl.classList.remove('open');
		modalEl.setAttribute('aria-hidden', 'true');
		setOrganizerModalOpenClass(false);
	};

	const openModal = (mode, editPayload, configMessageId) => {
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
		modalTitle.textContent =
			mode === 'edit'
				? 'Edit challenge'
				: mode === 'global'
					? 'Global settings'
					: 'New challenge';
		modalBody.innerHTML = renderChallengeOrganizerModalInnerHtml(
			mode,
			editPayload,
			configMessageId,
			{
				organizerUserNames,
				configMessageId: globalConfigMessageId
			}
		);
		bindChallengeResultsToggle(modalBody);
		modalEl.classList.add('open');
		modalEl.setAttribute('aria-hidden', 'false');
		setOrganizerModalOpenClass(true);
	};

	/**
	 * @param {string} challengeId
	 * @param {string} challengeTitle
	 */
	const openStatsModal = async (challengeId, challengeTitle) => {
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
		const requestToken = ++activeStatsRequestToken;
		modalTitle.textContent = 'Challenge stats';
		modalBody.innerHTML = renderChallengeOrganizerStatsModalInnerHtml({
			challengeTitle,
			loading: true
		});
		modalEl.classList.add('open');
		modalEl.setAttribute('aria-hidden', 'false');
		setOrganizerModalOpenClass(true);
		try {
			const endpoint = `/api/chat/threads/${encodeURIComponent(String(opts.threadId))}/challenges/${encodeURIComponent(cid)}/stats`;
			const res = await fetch(endpoint, { credentials: 'include' });
			const data = await res.json().catch(() => ({}));
			if (requestToken !== activeStatsRequestToken) return;
			if (!res.ok || data?.ok !== true) {
				const msg =
					typeof data?.message === 'string' && data.message.trim()
						? data.message.trim()
						: 'Could not load challenge stats.';
				modalBody.innerHTML = renderChallengeOrganizerStatsModalInnerHtml({
					challengeTitle,
					error: msg
				});
				return;
			}
			const defaultExcludedUserNames = parseExcludedUsernames(opts.viewerUserName || '');
			activeStatsModalState = {
				challengeTitle,
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
				sortMode: activeStatsModalState.sortMode
			});
			if (requestToken !== activeStatsRequestToken) return;
			void hydrateChallengeOrganizerStatsThumbs(modalBody);
		} catch (err) {
			if (requestToken !== activeStatsRequestToken) return;
			modalBody.innerHTML = renderChallengeOrganizerStatsModalInnerHtml({
				challengeTitle,
				error:
					err instanceof Error && err.message
						? err.message
						: 'Could not load challenge stats.'
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
			const modalBody = host.querySelector('[data-challenges-organizer-modal-body]');
			if (!(modalBody instanceof HTMLElement) || !activeStatsModalState) return;
			const input = form.querySelector('[data-challenge-stats-filter-input]');
			if (!(input instanceof HTMLInputElement)) return;
			activeStatsModalState.excludedUserNames = parseExcludedUsernames(input.value);
			modalBody.innerHTML = renderChallengeOrganizerStatsModalInnerHtml({
				challengeTitle: activeStatsModalState.challengeTitle,
				topCreations: activeStatsModalState.data.topCreations,
				topSubmitters: activeStatsModalState.data.topSubmitters,
				topVoters: activeStatsModalState.data.topVoters,
				globalAverage: activeStatsModalState.data.globalAverage,
				excludedUserNames: activeStatsModalState.excludedUserNames,
				sortMode: activeStatsModalState.sortMode
			});
			void hydrateChallengeOrganizerStatsThumbs(modalBody);
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
		const organizerCsvRaw = String(fd.get('organizer_user_names_csv') || '').trim();
		const challengeId = String(fd.get('challenge_id') || '').trim();
		const title = String(fd.get('title') || '').trim();
		const details = String(fd.get('details') || '').trim();
		const heroRef = normalizeChallengeHeroRefForSave(fd.get('hero_image_url'));
		const resultsRef = normalizeChallengeHeroRefForSave(fd.get('results_creation_url'));
		const resultsPublishedExisting = String(fd.get('results_published_at_existing') || '').trim();

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
		try {
			let payload;
			if (isGlobalForm) {
				const parsedNames = normalizeChallengeOrganizerUserNames(
					organizerCsvRaw.split(',')
				);
				payload = {
					kind: 'challenges_global_config',
					organizer_user_names: parsedNames
				};
			} else {
				if (!challengeId || !title) return;
				const base = isEditForm
					? mergeFullChallengeConfigForChallenge(challengeConfigEntries, challengeId)
					: {};
				payload = {
					...base,
					kind: 'challenge_config',
					challenge_id: challengeId,
					title
				};
				if (details) payload.details = details;
				else delete payload.details;
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
						const resultsUrlInput = adminForm.querySelector('[name="results_creation_url"]');
						if (resultsUrlInput instanceof HTMLInputElement) {
							if (resultsRef) payload.results_creation_url = resultsRef;
							else delete payload.results_creation_url;
						}
					} else {
						delete payload.results_published_at;
						delete payload.results_creation_url;
					}
				}
				for (const key of REWARD_FIELD_KEYS) {
					const s = String(fd.get(key) || '').trim();
					if (s) payload[key] = s;
					else delete payload[key];
				}
				const timeFields = [
					'submission_start_at',
					'submission_end_at',
					'voting_start_at',
					'voting_end_at'
				];
				for (const key of timeFields) {
					const iso = parseDatetimeLocalToIso(String(fd.get(key) || ''));
					if (iso) payload[key] = iso;
					else delete payload[key];
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
				const patch = opts.patchMessage;
				if (typeof patch === 'function' && Number.isFinite(mid) && mid > 0) {
					r = await patch(mid, body);
				} else {
					throw new Error('Updates are not available (missing patch handler).');
				}
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
								: 'Could not publish challenge.')
				);
			}
			postSucceeded = true;
			if (successEl instanceof HTMLElement) {
				successEl.hidden = false;
				successEl.textContent = isGlobalForm ? 'Organizer team saved.' : 'Saved.';
			}
			if (isGlobalForm) {
				upsertLocalMessage(r.message);
				organizerUserNames = resolveChallengeOrganizerAllowlistFromMessages(opts.messages);
				const globalCfg = pickLatestChallengesGlobalConfig(opts.messages);
				globalConfigMessageId =
					Number.isFinite(Number(globalCfg?.messageId)) && Number(globalCfg?.messageId) > 0
						? Number(globalCfg.messageId)
						: null;
				paint();
			} else {
				if (r.message) upsertLocalMessage(r.message);
				await opts.reload();
			}
			if (!isEditForm) {
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
									: 'Could not publish challenge.')
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

		const statsCreationLink = t.closest('[data-challenge-stats-creation-lightbox]');
		if (statsCreationLink instanceof HTMLAnchorElement) {
			e.preventDefault();
			e.stopPropagation();
			const creationId = Number(statsCreationLink.getAttribute('data-challenge-stats-creation-id'));
			if (!Number.isFinite(creationId) || creationId <= 0) return;
			const challengeMessageId = Number(
				statsCreationLink.getAttribute('data-challenge-message-id')
			);
			const qs =
				Number.isFinite(challengeMessageId) && challengeMessageId > 0
					? `?challenge_message_id=${encodeURIComponent(String(challengeMessageId))}`
					: '';
			void (async () => {
				try {
					const res = await fetch(
						`/api/create/images/${encodeURIComponent(String(creationId))}${qs}`,
						{ credentials: 'include' }
					);
					const payload = res.ok ? await res.json().catch(() => null) : null;
					if (!payload || payload._error) return;
					const mediaType =
						typeof payload.media_type === 'string' ? payload.media_type : 'image';
					const imageUrl = typeof payload.url === 'string' ? payload.url.trim() : '';
					const videoUrl =
						typeof payload.video_url === 'string' ? payload.video_url.trim() : '';
					if (mediaType === 'video' && videoUrl) {
						openChatAttachmentPreviewLightbox(videoUrl, 'video', {
							creationId: String(creationId)
						});
						return;
					}
					if (!imageUrl) return;
					openChatInlineImageLightbox(imageUrl, {
						creationId: String(creationId)
					});
				} catch {
					// ignore
				}
			})();
			return;
		}

		const statsSortSwitch = t.closest('[data-challenge-stats-sort-switch]');
		if (statsSortSwitch instanceof HTMLButtonElement) {
			const nextSortMode =
				activeStatsModalState?.sortMode === 'weighted' ? 'average' : 'weighted';
			const modalBody = host.querySelector('[data-challenges-organizer-modal-body]');
			if (!(modalBody instanceof HTMLElement) || !activeStatsModalState) return;
			if (activeStatsModalState.sortMode === nextSortMode) return;
			activeStatsModalState.sortMode = nextSortMode;
			modalBody.innerHTML = renderChallengeOrganizerStatsModalInnerHtml({
				challengeTitle: activeStatsModalState.challengeTitle,
				topCreations: activeStatsModalState.data.topCreations,
				topSubmitters: activeStatsModalState.data.topSubmitters,
				topVoters: activeStatsModalState.data.topVoters,
				globalAverage: activeStatsModalState.data.globalAverage,
				excludedUserNames: activeStatsModalState.excludedUserNames,
				sortMode: activeStatsModalState.sortMode
			});
			void hydrateChallengeOrganizerStatsThumbs(modalBody);
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
			openModal('create', null);
			return;
		}

		const editBtn = t.closest('[data-challenges-organizer-edit]');
		if (editBtn instanceof HTMLButtonElement) {
			const cid = editBtn.getAttribute('data-challenges-organizer-edit') || '';
			const row = rowByChallengeId.get(cid);
			if (row?.payload) {
				const merged = mergeFullChallengeConfigForChallenge(challengeConfigEntries, cid);
				openModal('edit', merged, row.configMessageId);
			}
			return;
		}

		const statsBtn = t.closest('[data-challenges-organizer-stats]');
		if (statsBtn instanceof HTMLButtonElement) {
			const cid = statsBtn.getAttribute('data-challenges-organizer-stats') || '';
			const row = rowByChallengeId.get(cid);
			void openStatsModal(cid, row?.title || cid);
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

		const gearSvg = gearIcon('challenge-pane-organizer-gear-svg');
		const statsSvg = statsIcon('challenge-pane-organizer-stats-trigger-svg');
		const plusSvg = plusIcon('challenge-pane-organizer-plus-svg');
		host.innerHTML = renderChallengeOrganizerSidebarMarkup({
			rows: summaries,
			organizerUserNames,
			globalConfigMessageId,
			gearIconSvg: gearSvg,
			statsIconSvg: statsSvg,
			plusIconSvg: plusSvg
		});
	};

	paint();

	host.addEventListener('click', onHostClick);
	host.addEventListener('keydown', onHostKeydown);
	host.addEventListener('submit', onAdminConfigSubmit);
	document.addEventListener('keydown', onDocEscape);

	return {
		destroy: () => {
			setOrganizerModalOpenClass(false);
			document.removeEventListener('keydown', onDocEscape);
			host.removeEventListener('click', onHostClick);
			host.removeEventListener('keydown', onHostKeydown);
			host.removeEventListener('submit', onAdminConfigSubmit);
			host.innerHTML = '';
		}
	};
}
