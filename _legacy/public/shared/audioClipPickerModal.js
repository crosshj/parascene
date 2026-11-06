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

/** Thumbnail or music-note fallback (matches prompt-library clip cards). */
export function renderAudioClipThumbHtml(row) {
	const thumbUrl = typeof row?.thumb_url === 'string' ? row.thumb_url.trim() : '';
	if (thumbUrl) {
		return `<span class="audio-clip-picker-item-thumb"><img class="audio-clip-picker-item-thumb-img" src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" decoding="async" /></span>`;
	}
	return `<span class="audio-clip-picker-item-thumb audio-clip-picker-item-thumb--fallback">${AUDIO_ICON_SVG}</span>`;
}

function clipMatchesSearchQuery(row, query) {
	const q = String(query || '').trim().toLowerCase();
	if (!q) return true;
	const id = Number(row?.id);
	const title = String(row?.title ?? '').trim();
	const description = String(row?.description ?? '').trim();
	const source = String(row?.source_type ?? '').replace(/_/g, ' ');
	const haystack = [title, description, source, Number.isFinite(id) && id > 0 ? `clip #${id}` : '', String(id)]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
	return haystack.includes(q);
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

	const searchSection = document.createElement('div');
	searchSection.className = 'audio-clip-picker-search';

	const searchWrap = document.createElement('div');
	searchWrap.className = 'audio-clip-picker-search-wrap';

	const searchInput = document.createElement('input');
	searchInput.type = 'search';
	searchInput.className = `${inputClassName} audio-clip-picker-search-input`.trim();
	searchInput.placeholder = 'Search clips…';
	searchInput.autocomplete = 'off';
	searchInput.setAttribute('aria-label', 'Search audio clips');

	const searchClearBtn = document.createElement('button');
	searchClearBtn.type = 'button';
	searchClearBtn.className = 'audio-clip-picker-search-clear';
	searchClearBtn.setAttribute('aria-label', 'Clear search');
	searchClearBtn.hidden = true;
	searchClearBtn.innerHTML =
		'<svg class="audio-clip-picker-search-clear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

	searchWrap.append(searchInput, searchClearBtn);
	searchSection.append(searchWrap);

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

	modalBody.append(searchSection, listEl, pagerEl, urlSection, modalError);
	modal.append(modalHeader, modalBody);
	modalOverlay.append(modal);

	return {
		modalOverlay,
		modal,
		modalClose,
		searchInput,
		searchClearBtn,
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
		searchInput,
		searchClearBtn,
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
	const fetchLimit = 100;
	let total = 0;
	let allItems = [];
	let loading = false;
	let highlightedId = null;

	function getSearchQuery() {
		return String(searchInput?.value ?? '').trim();
	}

	function updateSearchClearVisibility() {
		if (searchClearBtn instanceof HTMLButtonElement) {
			searchClearBtn.hidden = !getSearchQuery();
		}
	}

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
		searchInput.value = '';
		updateSearchClearVisibility();
		updateUrlUseState();
		setError('');
		highlightedId = null;
		allItems = [];
		offset = 0;
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
				void loadAllClips();
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

	function renderRows(items, { emptyKind = 'none' } = {}) {
		if (!items.length) {
			if (emptyKind === 'search') {
				listEl.innerHTML =
					'<div class="audio-clip-picker-empty"><p>No clips match your search.</p></div>';
				return;
			}
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
					${renderAudioClipThumbHtml(row)}
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

	function applyView() {
		const query = getSearchQuery();
		updateSearchClearVisibility();
		const filtered = query
			? allItems.filter((row) => clipMatchesSearchQuery(row, query))
			: allItems;

		if (query) {
			pagerEl.hidden = true;
			renderRows(filtered, { emptyKind: filtered.length ? 'none' : 'search' });
			return;
		}

		if (!filtered.length) {
			renderRows([], { emptyKind: 'none' });
			resetPager();
			return;
		}

		const pageCount = Math.max(1, Math.ceil(filtered.length / limit));
		if (offset >= filtered.length) {
			offset = Math.max(0, (pageCount - 1) * limit);
		}
		const page = Math.floor(offset / limit) + 1;
		const pageItems = filtered.slice(offset, offset + limit);
		renderRows(pageItems);
		pageLabel.textContent = `Page ${page} of ${pageCount}`;
		prevBtn.disabled = offset <= 0;
		nextBtn.disabled = offset + limit >= filtered.length;
		pagerEl.hidden = filtered.length <= limit;
	}

	async function loadAllClips() {
		if (loading) return;
		loading = true;
		listEl.innerHTML = '<p class="audio-clip-picker-loading">Loading clips…</p>';
		setError('');
		allItems = [];
		offset = 0;
		try {
			let nextOffset = 0;
			let totalCount = 0;
			while (true) {
				const params = new URLSearchParams({
					limit: String(fetchLimit),
					offset: String(nextOffset),
					sort: 'last_used_at'
				});
				const res = await fetch(`/api/audio-clips?${params}`, { credentials: 'include' });
				const data = await res.json().catch(() => ({}));
				if (!res.ok) {
					showListError(audioClipsListErrorMessage(res, data));
					return;
				}
				const batch = Array.isArray(data.items) ? data.items : [];
				totalCount = Number(data.total) || batch.length;
				allItems = allItems.concat(batch);
				if (allItems.length >= totalCount || batch.length < fetchLimit) break;
				nextOffset += fetchLimit;
			}
			total = totalCount;
			applyView();
		} catch {
			showListError('Network error while loading clips.');
		} finally {
			loading = false;
		}
	}

	prevBtn.addEventListener('click', () => {
		if (getSearchQuery()) return;
		offset = Math.max(0, offset - limit);
		applyView();
	});
	nextBtn.addEventListener('click', () => {
		if (getSearchQuery()) return;
		if (offset + limit < allItems.length) {
			offset += limit;
			applyView();
		}
	});
	searchInput.addEventListener('input', () => {
		offset = 0;
		if (allItems.length) applyView();
		else updateSearchClearVisibility();
	});
	searchClearBtn.addEventListener('click', () => {
		searchInput.value = '';
		offset = 0;
		updateSearchClearVisibility();
		searchInput.focus();
		if (allItems.length) applyView();
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
		searchInput.value = '';
		updateSearchClearVisibility();
		updateUrlUseState();
		setError('');
		offset = 0;
		document.addEventListener('keydown', handleEscape);
		void loadAllClips();
	}

	return { openModal, closeModal, loadPage: loadAllClips };
}
