/**
 * Shared audio clip library picker modal — browse clips or paste a URL.
 */

import { audioClipMusicIcon } from '../icons/svg-strings.js';

const AUDIO_ICON_SVG = audioClipMusicIcon('audio-clip-picker-icon');

function escapeHtml(text) {
	return String(text ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function formatClipDuration(sec) {
	const n = Number(sec);
	if (!Number.isFinite(n) || n <= 0) return '';
	const total = Math.round(n);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${String(s).padStart(2, '0')}`;
}

function isValidAudioUrl(value) {
	const raw = typeof value === 'string' ? value.trim() : '';
	if (!raw) return false;
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
		const host = (parsed.hostname || '').toLowerCase();
		return Boolean(host);
	} catch {
		return false;
	}
}

function audioClipsListErrorMessage(res, data) {
	if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
	if (res.status === 401) return 'Sign in to load your audio clips.';
	if (res.status === 404) return 'Audio clips are not available on this server yet.';
	if (res.status === 501) return 'Audio clips are not configured on this server.';
	if (res.status >= 500) return 'Could not load clips. Try again in a moment.';
	return 'Could not load clips.';
}

export function createAudioClipPickerModalDom(inputClassName = 'form-input') {
	const modalOverlay = document.createElement('div');
	modalOverlay.className = 'audio-clip-picker-modal-overlay';
	modalOverlay.setAttribute('data-audio-clip-picker-modal', '');

	const modal = document.createElement('div');
	modal.className = 'audio-clip-picker-modal';

	const modalHeader = document.createElement('div');
	modalHeader.className = 'modal-header';
	const modalTitle = document.createElement('h3');
	modalTitle.textContent = 'Select audio';
	const modalClose = document.createElement('button');
	modalClose.type = 'button';
	modalClose.className = 'modal-close';
	modalClose.setAttribute('aria-label', 'Close');
	modalClose.innerHTML =
		'<svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
	modalHeader.append(modalTitle, modalClose);

	const modalBody = document.createElement('div');
	modalBody.className = 'audio-clip-picker-modal-body';

	const listEl = document.createElement('div');
	listEl.className = 'audio-clip-picker-list';
	listEl.setAttribute('role', 'listbox');
	listEl.setAttribute('aria-label', 'Audio clips');

	const pagerEl = document.createElement('div');
	pagerEl.className = 'audio-clip-picker-pager';

	const prevBtn = document.createElement('button');
	prevBtn.type = 'button';
	prevBtn.className = 'btn-secondary audio-clip-picker-pager-btn';
	prevBtn.textContent = 'Previous';
	prevBtn.disabled = true;

	const pageLabel = document.createElement('span');
	pageLabel.className = 'audio-clip-picker-pager-label';

	const nextBtn = document.createElement('button');
	nextBtn.type = 'button';
	nextBtn.className = 'btn-secondary audio-clip-picker-pager-btn';
	nextBtn.textContent = 'Next';
	nextBtn.disabled = true;

	pagerEl.append(prevBtn, pageLabel, nextBtn);
	pagerEl.hidden = true;

	const urlSection = document.createElement('div');
	urlSection.className = 'audio-clip-picker-url-section';

	const urlToggle = document.createElement('button');
	urlToggle.type = 'button';
	urlToggle.className = 'audio-clip-picker-url-toggle';
	urlToggle.textContent = 'Paste URL instead';

	const urlPanel = document.createElement('div');
	urlPanel.className = 'audio-clip-picker-url-panel';
	urlPanel.hidden = true;

	const urlRow = document.createElement('div');
	urlRow.className = 'audio-clip-picker-url-row';

	const urlInput = document.createElement('input');
	urlInput.type = 'url';
	urlInput.className = `${inputClassName} audio-clip-picker-url-input`.trim();
	urlInput.placeholder = 'https://…';
	urlInput.autocomplete = 'off';

	const urlUseBtn = document.createElement('button');
	urlUseBtn.type = 'button';
	urlUseBtn.className = 'btn-primary audio-clip-picker-url-use';
	urlUseBtn.textContent = 'Use URL';
	urlUseBtn.disabled = true;

	urlRow.append(urlInput, urlUseBtn);
	urlPanel.append(urlRow);
	urlSection.append(urlToggle, urlPanel);

	const modalError = document.createElement('p');
	modalError.className = 'audio-clip-picker-modal-error';
	modalError.setAttribute('role', 'alert');
	modalError.hidden = true;

	modalBody.append(listEl, pagerEl, urlSection, modalError);
	modal.append(modalHeader, modalBody);
	modalOverlay.append(modal);

	return {
		modalOverlay,
		modal,
		modalClose,
		listEl,
		prevBtn,
		nextBtn,
		pageLabel,
		pagerEl,
		urlToggle,
		urlPanel,
		urlInput,
		urlUseBtn,
		modalError
	};
}

/**
 * @param {ReturnType<createAudioClipPickerModalDom>} refs
 * @param {{ detachOnClose?: boolean, onPick: (value: { type: 'clip', clip: object } | { type: 'url', url: string }) => void }} options
 */
export function wireAudioClipPickerModal(refs, options) {
	const {
		modalOverlay,
		modalClose,
		listEl,
		prevBtn,
		nextBtn,
		pageLabel,
		pagerEl,
		urlToggle,
		urlPanel,
		urlInput,
		urlUseBtn,
		modalError
	} = refs;

	const detachOnClose = options.detachOnClose === true;
	const onPick = options.onPick;

	let offset = 0;
	const limit = 10;
	let total = 0;
	let loading = false;
	let highlightedId = null;

	function setError(msg) {
		modalError.textContent = msg || '';
		modalError.hidden = !msg;
	}

	function updateUrlUseState() {
		const raw = (urlInput.value || '').trim();
		urlUseBtn.disabled = !isValidAudioUrl(raw);
	}

	function handleEscape(e) {
		if (e.key === 'Escape' && modalOverlay.classList.contains('open')) {
			closeModal();
			e.preventDefault();
		}
	}

	function closeModal() {
		modalOverlay.classList.remove('open');
		urlPanel.hidden = true;
		urlToggle.textContent = 'Paste URL instead';
		urlInput.value = '';
		updateUrlUseState();
		setError('');
		highlightedId = null;
		if (detachOnClose) {
			document.removeEventListener('keydown', handleEscape);
			modalOverlay.remove();
		}
	}

	function resetPager() {
		pageLabel.textContent = '';
		prevBtn.disabled = true;
		nextBtn.disabled = true;
		pagerEl.hidden = true;
	}

	function showListError(message) {
		listEl.innerHTML = `<div class="audio-clip-picker-empty">
			<p>${escapeHtml(message)}</p>
			<p class="audio-clip-picker-empty-hint">You can paste an audio URL below instead.</p>
			<button type="button" class="btn-secondary audio-clip-picker-retry">Try again</button>
		</div>`;
		const retryBtn = listEl.querySelector('.audio-clip-picker-retry');
		if (retryBtn) {
			retryBtn.addEventListener('click', () => {
				void loadPage({ reset: true });
			});
		}
		resetPager();
	}

	function pickClip(clip) {
		if (!clip) return;
		onPick({ type: 'clip', clip });
		closeModal();
	}

	function pickUrl(url) {
		const raw = typeof url === 'string' ? url.trim() : '';
		if (!isValidAudioUrl(raw)) {
			setError('Enter a valid audio URL (http:// or https://).');
			return;
		}
		onPick({ type: 'url', url: raw });
		closeModal();
	}

	function renderRows(items) {
		if (!items.length) {
			listEl.innerHTML =
				'<div class="audio-clip-picker-empty"><p>No clips yet.</p><p class="audio-clip-picker-empty-hint">Record or upload clips under Prompt Library → Audio clips.</p></div>';
			return;
		}
		listEl.innerHTML = items
			.map((row) => {
				const id = Number(row.id);
				const title = String(row.title || '').trim() || `Clip #${id}`;
				const dur = formatClipDuration(row.duration_sec);
				const src = String(row.source_type || '').replace(/_/g, ' ');
				const meta = [dur, src].filter(Boolean).join(' · ');
				const selected = id === highlightedId;
				return `<button type="button" class="audio-clip-picker-item${selected ? ' is-highlighted' : ''}" data-audio-clip-pick="${id}" role="option" aria-selected="${selected ? 'true' : 'false'}">
					<span class="audio-clip-picker-item-icon">${AUDIO_ICON_SVG}</span>
					<span class="audio-clip-picker-item-body">
						<span class="audio-clip-picker-item-title">${escapeHtml(title)}</span>
						${meta ? `<span class="audio-clip-picker-item-meta">${escapeHtml(meta)}</span>` : ''}
					</span>
				</button>`;
			})
			.join('');
		for (const btn of listEl.querySelectorAll('[data-audio-clip-pick]')) {
			btn.addEventListener('click', () => {
				const id = Number(btn.getAttribute('data-audio-clip-pick'));
				const item = items.find((r) => Number(r.id) === id);
				pickClip(item);
			});
		}
	}

	async function loadPage({ reset = false } = {}) {
		if (loading) return;
		if (reset) offset = 0;
		loading = true;
		listEl.innerHTML = '<p class="audio-clip-picker-loading">Loading clips…</p>';
		setError('');
		try {
			const params = new URLSearchParams({
				limit: String(limit),
				offset: String(offset),
				sort: 'last_used_at'
			});
			const res = await fetch(`/api/audio-clips?${params}`, { credentials: 'include' });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				showListError(audioClipsListErrorMessage(res, data));
				return;
			}
			const items = Array.isArray(data.items) ? data.items : [];
			total = Number(data.total) || items.length;
			renderRows(items);
			if (!items.length) {
				resetPager();
			} else {
				const page = Math.floor(offset / limit) + 1;
				const pageCount = Math.max(1, Math.ceil(total / limit));
				pageLabel.textContent = `Page ${page} of ${pageCount}`;
				prevBtn.disabled = offset <= 0;
				nextBtn.disabled = offset + limit >= total;
				pagerEl.hidden = total <= limit;
			}
		} catch {
			showListError('Network error while loading clips.');
		} finally {
			loading = false;
		}
	}

	prevBtn.addEventListener('click', () => {
		offset = Math.max(0, offset - limit);
		void loadPage();
	});
	nextBtn.addEventListener('click', () => {
		if (offset + limit < total) {
			offset += limit;
			void loadPage();
		}
	});
	urlToggle.addEventListener('click', () => {
		const show = urlPanel.hidden;
		urlPanel.hidden = !show;
		urlToggle.textContent = show ? 'Browse library instead' : 'Paste URL instead';
		if (show) {
			urlInput.focus();
		} else {
			setError('');
		}
	});
	urlInput.addEventListener('input', updateUrlUseState);
	urlInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !urlUseBtn.disabled) {
			e.preventDefault();
			pickUrl(urlInput.value);
		}
	});
	urlUseBtn.addEventListener('click', () => pickUrl(urlInput.value));
	modalClose.addEventListener('click', closeModal);
	modalOverlay.addEventListener('click', (e) => {
		if (e.target === modalOverlay) closeModal();
	});

	function openModal({ highlightClipId = null } = {}) {
		highlightedId = Number.isFinite(Number(highlightClipId)) && Number(highlightClipId) > 0 ? Number(highlightClipId) : null;
		modalOverlay.classList.add('open');
		urlPanel.hidden = true;
		urlToggle.textContent = 'Paste URL instead';
		urlInput.value = '';
		updateUrlUseState();
		setError('');
		document.addEventListener('keydown', handleEscape);
		void loadPage({ reset: true });
	}

	return { openModal, closeModal, loadPage };
}
