import { buildChallengesChannelModel } from './model/buildChannelModel.js';
import { summarizeLatestChallengeConfigs } from './model/organizerSummaries.js';
import {
	normalizeChallengeHeroRefForSave,
	parseDatetimeLocalToIso,
	REWARD_FIELD_KEYS
} from './challengeAdmin.js';
import {
	renderChallengeOrganizerSidebarMarkup,
	renderChallengeOrganizerModalInnerHtml
} from './views/adminView.js';

/**
 * Challenge organizer UI in the chat right sidebar (same panel chrome as canvases).
 *
 * @param {HTMLElement} host — `[data-chat-challenges-organizer-sidebar]`
 * @param {{
 *   messages: object[],
 *   viewerId: number | null,
 *   threadId: number,
 *   postMessage: (body: string) => Promise<{ ok: boolean, error?: string }>,
 *   patchMessage?: (messageId: number, body: string) => Promise<{ ok: boolean, error?: string }>,
 *   reload: () => Promise<void>,
 *   gearIcon: (className?: string) => string,
 * }} opts — `gearIcon` must come from the same versioned `svg-strings` import as `chat.js` (avoid an extra uncached static import here).
 */
export function mountChallengesOrganizerSidebar(host, opts) {
	const gearIcon =
		typeof opts.gearIcon === 'function'
			? opts.gearIcon
			: /** @param {string} [cls] */ (cls) =>
					`<svg class="${String(cls || '').trim()}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /></svg>`;
	let rowByChallengeId = new Map();

	const closeModal = () => {
		const modalEl = host.querySelector('[data-challenges-organizer-modal]');
		if (!(modalEl instanceof HTMLElement)) return;
		modalEl.classList.remove('open');
		modalEl.setAttribute('aria-hidden', 'true');
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
		const adminForm = e.target;
		if (!(adminForm instanceof HTMLFormElement)) return;
		const modalEl = host.querySelector('[data-challenges-organizer-modal]');
		if (!modalEl?.contains(adminForm)) return;

		const errEl = adminForm.querySelector('[data-challenge-admin-error]');
		const submitBtn = adminForm.querySelector('.challenge-pane-admin-submit');

		const fd = new FormData(adminForm);
		const challengeId = String(fd.get('challenge_id') || '').trim();
		const title = String(fd.get('title') || '').trim();
		const details = String(fd.get('details') || '').trim();
		const heroRef = normalizeChallengeHeroRefForSave(fd.get('hero_image_url'));

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
		host.innerHTML = renderChallengeOrganizerSidebarMarkup({
			rows: summaries,
			gearIconSvg: gearSvg
		});
	};

	paint();

	host.addEventListener('click', onHostClick);
	host.addEventListener('keydown', onHostKeydown);
	host.addEventListener('submit', onAdminConfigSubmit);
	document.addEventListener('keydown', onDocEscape);

	return {
		destroy: () => {
			document.removeEventListener('keydown', onDocEscape);
			host.removeEventListener('click', onHostClick);
			host.removeEventListener('keydown', onHostKeydown);
			host.removeEventListener('submit', onAdminConfigSubmit);
			host.innerHTML = '';
		}
	};
}
