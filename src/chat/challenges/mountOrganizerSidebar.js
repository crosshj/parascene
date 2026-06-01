import { buildChallengesChannelModel } from './model/buildChannelModel.js';
import { summarizeLatestChallengeConfigs } from './model/organizerSummaries.js';
import {
	normalizeChallengeHeroRefForSave,
	parseDatetimeLocalToIso,
	REWARD_FIELD_KEYS
} from './challengeAdmin.js';
import {
	renderChallengeOrganizerSidebarMarkup,
	renderChallengeOrganizerModalInnerHtml,
	renderChallengeOrganizerStatsModalInnerHtml
} from './views/adminView.js';

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
	let activeStatsRequestToken = 0;
	/** @type {{ challengeTitle: string, data: { topCreations?: object[], topSubmitters?: object[], topVoters?: object[] }, excludedUserNames: string[] } | null} */
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
			mode === 'edit' ? 'Edit challenge' : 'New challenge';
		modalBody.innerHTML = renderChallengeOrganizerModalInnerHtml(
			mode,
			editPayload,
			configMessageId
		);
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
					topVoters: data.topVoters
				},
				excludedUserNames: defaultExcludedUserNames
			};
			modalBody.innerHTML = renderChallengeOrganizerStatsModalInnerHtml({
				challengeTitle: activeStatsModalState.challengeTitle,
				topCreations: activeStatsModalState.data.topCreations,
				topSubmitters: activeStatsModalState.data.topSubmitters,
				topVoters: activeStatsModalState.data.topVoters,
				excludedUserNames: activeStatsModalState.excludedUserNames
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
				excludedUserNames: activeStatsModalState.excludedUserNames
			});
			void hydrateChallengeOrganizerStatsThumbs(modalBody);
			return;
		}
		const adminForm = form;
		const modalEl = host.querySelector('[data-challenges-organizer-modal]');
		if (!modalEl?.contains(adminForm)) return;

		const errEl = adminForm.querySelector('[data-challenge-admin-error]');
		const submitBtn = adminForm.querySelector('.challenge-pane-admin-submit');

		const fd = new FormData(adminForm);
		const challengeId = String(fd.get('challenge_id') || '').trim();
		const title = String(fd.get('title') || '').trim();
		const details = String(fd.get('details') || '').trim();
		const heroRef = normalizeChallengeHeroRefForSave(fd.get('hero_image_url'));
		const resultsPublishNow = String(fd.get('results_publish_now') || '').trim() === '1';
		const resultsPublishedExisting = String(fd.get('results_published_at_existing') || '').trim();

		if (!challengeId || !title) return;

		const payload = {
			kind: 'challenge_config',
			challenge_id: challengeId,
			title,
			...(details ? { details } : {}),
			...(heroRef ? { hero_image_url: heroRef } : {})
		};
		for (const key of REWARD_FIELD_KEYS) {
			const s = String(fd.get(key) || '').trim();
			if (s) payload[key] = s;
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
		}

		if (resultsPublishNow && !resultsPublishedExisting) {
			payload.results_published_at = new Date().toISOString();
		}

		if (errEl instanceof HTMLElement) {
			errEl.hidden = true;
			errEl.textContent = '';
			errEl.replaceChildren();
		}
		if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;
		const formRole = adminForm.getAttribute('data-challenge-admin-form');
		const isEditForm = formRole === 'edit';

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
			const body = JSON.stringify(payload);
			let r;
			if (isEditForm) {
				const midRaw = fd.get('config_message_id');
				const mid = Number(midRaw);
				const hasMid = Number.isFinite(mid) && mid > 0;
				const patch = opts.patchMessage;
				if (typeof patch === 'function' && hasMid) {
					r = await patch(mid, body);
				} else {
					throw new Error(
						hasMid
							? 'Updates are not available (missing patch handler).'
							: 'Could not resolve challenge message to update — reload and try again.'
					);
				}
			} else {
				r = await opts.postMessage(body);
			}
			if (!r.ok) {
				throw new Error(
					r.error ||
						(isEditForm ? 'Could not update challenge.' : 'Could not publish challenge.')
				);
			}
			postSucceeded = true;
			await opts.reload();
			if (!isEditForm) {
				adminForm.reset();
			}
			closeModal();
		} catch (err) {
			if (errEl instanceof HTMLElement) {
				if (postSucceeded) {
					setReloadFailedError(
						'Your changes were saved, but this view could not be refreshed. Check your connection, or use Retry refresh.'
					);
				} else {
					setFormError(
						err?.message ||
							(isEditForm ? 'Could not update challenge.' : 'Could not publish challenge.')
					);
				}
			}
		} finally {
			if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
		}
	};

	const onHostClick = (e) => {
		const t = e.target;
		if (!(t instanceof Element)) return;

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
				openModal('edit', row.payload, row.configMessageId);
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
		const summaries = summarizeLatestChallengeConfigs(model.raw.configs);
		rowByChallengeId = new Map(summaries.map((s) => [s.challenge_id, s]));

		const gearSvg = gearIcon('challenge-pane-organizer-gear-svg');
		const statsSvg = statsIcon('challenge-pane-organizer-stats-trigger-svg');
		const plusSvg = plusIcon('challenge-pane-organizer-plus-svg');
		host.innerHTML = renderChallengeOrganizerSidebarMarkup({
			rows: summaries,
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
