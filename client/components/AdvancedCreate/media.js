import { uploadImageFile } from '../../providers/create/transport.js';

function httpUrl(value) {
	const raw = String(value || '').trim();
	if (!raw) return '';
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
		return raw;
	} catch {
		return '';
	}
}

function absoluteUrl(value) {
	const raw = String(value || '').trim();
	if (!raw) return '';
	if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
	if (raw.startsWith('/') && typeof window !== 'undefined') return `${window.location.origin}${raw}`;
	return raw;
}

function clipDuration(seconds) {
	const total = Math.round(Number(seconds));
	if (!Number.isFinite(total) || total <= 0) return '';
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function mountShell(title) {
	const overlay = document.createElement('div');
	overlay.className = 'advanced-create__picker';
	overlay.hidden = true;
	overlay.setAttribute('data-advanced-create-picker', '');
	overlay.setAttribute('aria-hidden', 'true');
	const panel = document.createElement('div');
	panel.className = 'advanced-create__picker-panel';
	panel.setAttribute('role', 'dialog');
	panel.setAttribute('aria-modal', 'true');
	panel.setAttribute('aria-label', title);
	const header = document.createElement('div');
	header.className = 'advanced-create__picker-header';
	const heading = document.createElement('h3');
	heading.textContent = title;
	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'advanced-create__picker-close';
	closeBtn.setAttribute('aria-label', 'Close');
	closeBtn.textContent = '×';
	header.append(heading, closeBtn);
	const body = document.createElement('div');
	body.className = 'advanced-create__picker-body';
	const alert = document.createElement('p');
	alert.className = 'advanced-create__media-error';
	alert.hidden = true;
	panel.append(header, body, alert);
	overlay.append(panel);

	function onKey(event) {
		if (event.key !== 'Escape' || overlay.hidden) return;
		event.preventDefault();
		event.stopPropagation();
		close();
	}

	function show() {
		document.body.append(overlay);
		overlay.hidden = false;
		overlay.classList.add('open');
		overlay.setAttribute('aria-hidden', 'false');
		document.addEventListener('keydown', onKey, true);
	}

	function close() {
		document.removeEventListener('keydown', onKey, true);
		overlay.classList.remove('open');
		overlay.hidden = true;
		overlay.setAttribute('aria-hidden', 'true');
	}

	closeBtn.addEventListener('click', close);
	overlay.addEventListener('click', (event) => {
		if (event.target === overlay) close();
	});
	panel.addEventListener('click', (event) => event.stopPropagation());

	function setError(message) {
		alert.textContent = message || '';
		alert.hidden = !message;
	}

	return {
		overlay,
		body,
		setError,
		open() {
			setError('');
			show();
		},
		close,
		destroy() {
			close();
			overlay.remove();
		},
	};
}

function bindValue(root, hidden, apply) {
	Object.defineProperty(root, 'value', {
		get() { return hidden.value; },
		set(next) { apply(String(next ?? '').trim(), false); },
	});
}

export function mountImageControl(field) {
	const root = document.createElement('div');
	root.className = 'advanced-create__media';
	root.setAttribute('data-advanced-create-media', '');
	const hidden = document.createElement('input');
	hidden.type = 'hidden';
	hidden.name = field?.key || 'input_images';
	const choose = document.createElement('button');
	choose.type = 'button';
	choose.className = 'advanced-create__media-choose';
	choose.textContent = 'Click to choose';
	const selected = document.createElement('div');
	selected.className = 'advanced-create__media-selected';
	selected.hidden = true;
	const thumb = document.createElement('img');
	thumb.className = 'advanced-create__media-thumb';
	thumb.alt = '';
	const remove = document.createElement('button');
	remove.type = 'button';
	remove.className = 'advanced-create__media-remove';
	remove.textContent = 'Remove';
	selected.append(thumb, remove);
	const error = document.createElement('p');
	error.className = 'advanced-create__media-error';
	error.hidden = true;
	root.append(hidden, choose, selected, error);

	const shell = mountShell('Image');
	const row = document.createElement('div');
	row.className = 'advanced-create__picker-row';
	const file = document.createElement('input');
	file.type = 'file';
	file.accept = 'image/*';
	file.hidden = true;
	const add = document.createElement('button');
	add.type = 'button';
	add.className = 'advanced-create__picker-add';
	add.setAttribute('aria-label', 'Choose image file');
	add.textContent = '+';
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'advanced-create__picker-input';
	input.placeholder = 'Paste image or enter URL';
	input.setAttribute('aria-label', 'Paste image or enter image URL');
	const send = document.createElement('button');
	send.type = 'button';
	send.className = 'advanced-create__picker-send';
	send.textContent = 'Use';
	send.hidden = true;
	row.append(add, input, send, file);
	const hint = document.createElement('p');
	hint.className = 'advanced-create__picker-hint';
	hint.textContent = 'Use + to upload, paste an image, or enter an image URL.';
	shell.body.append(row, hint);

	function showError(message) {
		error.textContent = message || '';
		error.hidden = !message;
	}

	function apply(url, notify) {
		hidden.value = url;
		const on = Boolean(url);
		choose.hidden = on;
		selected.hidden = !on;
		if (on) thumb.src = url;
		else thumb.removeAttribute('src');
		if (notify) hidden.dispatchEvent(new Event('input', { bubbles: true }));
	}

	async function useFile(next) {
		if (!next || !String(next.type || '').startsWith('image/')) {
			shell.setError('Please choose an image file.');
			return;
		}
		choose.textContent = 'Uploading…';
		choose.disabled = true;
		showError('');
		shell.close();
		try {
			apply(await uploadImageFile(next), true);
		} catch (err) {
			showError(err?.message || 'Upload failed.');
		} finally {
			choose.textContent = 'Click to choose';
			choose.disabled = false;
			file.value = '';
		}
	}

	function useUrl(raw) {
		const url = httpUrl(raw);
		if (!url) {
			shell.setError('Enter an image URL (http:// or https://).');
			return;
		}
		showError('');
		shell.close();
		apply(url, true);
	}

	function syncSend() {
		const raw = input.value.trim();
		send.hidden = !raw;
		send.disabled = !httpUrl(raw);
	}

	add.addEventListener('click', () => file.click());
	file.addEventListener('change', () => useFile(file.files?.[0]));
	input.addEventListener('input', syncSend);
	input.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		useUrl(input.value);
	});
	input.addEventListener('paste', (event) => {
		const items = event.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (!item.type.startsWith('image/')) continue;
			event.preventDefault();
			const pasted = item.getAsFile();
			if (pasted) useFile(pasted);
			return;
		}
	});
	send.addEventListener('click', () => useUrl(input.value));
	choose.addEventListener('click', () => {
		input.value = hidden.value;
		syncSend();
		showError('');
		shell.open();
		input.focus();
	});
	remove.addEventListener('click', () => {
		showError('');
		apply('', true);
	});
	bindValue(root, hidden, (url) => apply(url, false));
	root.mediaPicker = shell;
	return root;
}

export function mountAudioControl(field) {
	const root = document.createElement('div');
	root.className = 'advanced-create__media';
	root.setAttribute('data-advanced-create-media', '');
	const hidden = document.createElement('input');
	hidden.type = 'hidden';
	hidden.name = field?.key || 'input_audio_urls';
	const choose = document.createElement('button');
	choose.type = 'button';
	choose.className = 'advanced-create__audio-choose';
	choose.textContent = 'Choose audio clip';
	const selected = document.createElement('div');
	selected.className = 'advanced-create__audio-selected';
	selected.hidden = true;
	const chip = document.createElement('button');
	chip.type = 'button';
	chip.className = 'advanced-create__audio-chip';
	const title = document.createElement('span');
	title.className = 'advanced-create__audio-title';
	const meta = document.createElement('span');
	meta.className = 'advanced-create__audio-meta';
	chip.append(title, meta);
	const remove = document.createElement('button');
	remove.type = 'button';
	remove.className = 'advanced-create__media-remove';
	remove.textContent = 'Remove';
	selected.append(chip, remove);
	const error = document.createElement('p');
	error.className = 'advanced-create__media-error';
	error.hidden = true;
	root.append(hidden, choose, selected, error);

	const shell = mountShell('Audio');
	const search = document.createElement('input');
	search.type = 'search';
	search.className = 'advanced-create__picker-input';
	search.placeholder = 'Search clips';
	search.setAttribute('aria-label', 'Search audio clips');
	const list = document.createElement('div');
	list.className = 'advanced-create__clip-list';
	list.setAttribute('role', 'listbox');
	list.setAttribute('aria-label', 'Audio clips');
	const urlToggle = document.createElement('button');
	urlToggle.type = 'button';
	urlToggle.className = 'advanced-create__clip-toggle';
	urlToggle.textContent = 'Paste URL instead';
	const urlPanel = document.createElement('div');
	urlPanel.className = 'advanced-create__picker-row';
	urlPanel.hidden = true;
	const urlInput = document.createElement('input');
	urlInput.type = 'text';
	urlInput.className = 'advanced-create__picker-input';
	urlInput.placeholder = 'Audio URL';
	urlInput.setAttribute('aria-label', 'Audio URL');
	const urlUse = document.createElement('button');
	urlUse.type = 'button';
	urlUse.className = 'advanced-create__picker-send';
	urlUse.textContent = 'Use';
	urlUse.disabled = true;
	urlPanel.append(urlInput, urlUse);
	shell.body.append(search, list, urlToggle, urlPanel);

	let clips = [];
	let label = 'Custom URL';
	let detail = 'Pasted link';

	function showError(message) {
		error.textContent = message || '';
		error.hidden = !message;
	}

	function apply(url, notify) {
		hidden.value = url;
		const on = Boolean(url);
		choose.hidden = on;
		selected.hidden = !on;
		title.textContent = label;
		meta.textContent = detail;
		meta.hidden = !detail;
		if (notify) hidden.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function selectUrl(raw, nextLabel, nextDetail) {
		const url = httpUrl(absoluteUrl(raw));
		if (!url) {
			shell.setError('Enter an audio URL (http:// or https://).');
			return;
		}
		label = nextLabel;
		detail = nextDetail;
		showError('');
		shell.close();
		apply(url, true);
	}

	function renderList() {
		const query = search.value.trim().toLowerCase();
		const rows = query ? clips.filter((clip) => String(clip.title || '').toLowerCase().includes(query)) : clips;
		list.replaceChildren();
		if (!rows.length) {
			const empty = document.createElement('p');
			empty.className = 'advanced-create__clip-empty';
			empty.textContent = clips.length ? 'No clips match your search.' : 'No clips yet. Paste an audio URL instead.';
			list.append(empty);
			return;
		}
		for (const clip of rows) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'advanced-create__clip';
			button.setAttribute('role', 'option');
			const name = document.createElement('span');
			name.className = 'advanced-create__audio-title';
			name.textContent = String(clip.title || '').trim() || `Clip #${clip.id}`;
			const info = document.createElement('span');
			info.className = 'advanced-create__audio-meta';
			info.textContent = [clipDuration(clip.duration_sec), String(clip.source_type || '').replace(/_/g, ' ')].filter(Boolean).join(' · ');
			info.hidden = !info.textContent;
			button.append(name, info);
			button.addEventListener('click', () => selectUrl(clip.audio_url, name.textContent, info.textContent));
			list.append(button);
		}
	}

	async function loadClips() {
		list.textContent = 'Loading clips…';
		try {
			const params = new URLSearchParams({ limit: '100', offset: '0', sort: 'last_used_at' });
			const response = await fetch(`/api/audio-clips?${params}`, { credentials: 'include' });
			const data = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(data.message || data.error || 'Could not load clips.');
			clips = Array.isArray(data.items) ? data.items : [];
			renderList();
		} catch (err) {
			list.textContent = '';
			shell.setError(err?.message || 'Could not load clips.');
		}
	}

	search.addEventListener('input', () => {
		if (clips.length) renderList();
	});
	urlToggle.addEventListener('click', () => {
		urlPanel.hidden = !urlPanel.hidden;
		urlToggle.textContent = urlPanel.hidden ? 'Paste URL instead' : 'Hide URL';
		if (!urlPanel.hidden) urlInput.focus();
	});
	urlInput.addEventListener('input', () => {
		urlUse.disabled = !httpUrl(urlInput.value);
	});
	urlUse.addEventListener('click', () => selectUrl(urlInput.value, 'Custom URL', 'Pasted link'));
	urlInput.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter' || urlUse.disabled) return;
		event.preventDefault();
		selectUrl(urlInput.value, 'Custom URL', 'Pasted link');
	});
	function open() {
		showError('');
		shell.open();
		search.focus();
		loadClips();
	}
	choose.addEventListener('click', open);
	chip.addEventListener('click', open);
	remove.addEventListener('click', () => {
		label = 'Custom URL';
		detail = '';
		showError('');
		apply('', true);
	});
	bindValue(root, hidden, (url) => {
		if (!url) {
			label = 'Custom URL';
			detail = '';
			apply('', false);
			return;
		}
		label = 'Custom URL';
		detail = 'Pasted link';
		apply(url, false);
	});
	root.mediaPicker = shell;
	return root;
}
