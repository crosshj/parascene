import { bindRefs, cloneTemplateElement, mountTemplate } from '../../utils/dom.js';
import { formatDate, formatFileSize } from '../../utils/format.js';
import template from './FileManagerView.html';
import './FileManagerView.css';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function mediaKind(contentType) {
	const value = String(contentType || '').toLowerCase();
	if (value.startsWith('image/') && value !== 'image/svg+xml') return 'image';
	if (value.startsWith('video/')) return 'video';
	if (value.startsWith('audio/')) return 'audio';
	return 'file';
}

function artworkUrlFor(publicUrl) {
	try {
		const url = new URL(publicUrl, window.location.href);
		const match = url.pathname.match(/^\/s\/([^/]+)\/(.+)$/i);
		return match ? `${url.origin}/api/files/artwork/${match[1]}/${match[2]}?v=native-aspect-1` : '';
	} catch {
		return '';
	}
}

function fileContentUrl(file, filesApi) {
	return file.public_url || filesApi.url(file.content_path);
}

function previewKey(file, filesApi) {
	const kind = mediaKind(file.content_type);
	return `${kind}|${fileContentUrl(file, filesApi)}|${artworkUrlFor(file.public_url)}`;
}

function createPreview(file, previewTemplate, { filesApi, getFile, onPlayAudio, onPlayVideo }) {
	const kind = mediaKind(file.content_type);
	const refs = bindRefs(cloneTemplateElement(previewTemplate).firstElementChild);
	refs.preview.dataset.previewKey = previewKey(file, filesApi);
	refs.preview.classList.add(`file-preview--${kind}`);
	if (kind === 'image') { refs.image.src = fileContentUrl(file, filesApi); refs.image.hidden = false; }
	else if (kind === 'video') {
		const title = file.display_name || file.id || 'Video';
		const thumbnailUrl = artworkUrlFor(file.public_url);
		refs.videoTrigger.setAttribute('aria-label', `Play ${title}`);
		if (thumbnailUrl) refs.videoPoster.poster = thumbnailUrl;
		refs.videoTrigger.addEventListener('click', () => {
			const current = getFile();
			onPlayVideo(fileContentUrl(current, filesApi), current.display_name || current.id || 'Video');
		});
		refs.videoPoster.hidden = false;
		refs.videoTrigger.hidden = false;
	}
	else if (kind === 'audio') {
		const title = file.display_name || file.id || 'Audio';
		const artworkUrl = artworkUrlFor(file.public_url);
		refs.audioTrigger.setAttribute('aria-label', `Play ${title}`);
		if (artworkUrl) {
			refs.audioThumbnail.addEventListener('error', () => { refs.audioThumbnail.hidden = true; }, { once: true });
			refs.audioThumbnail.src = artworkUrl;
		} else refs.audioThumbnail.hidden = true;
		refs.audioTrigger.addEventListener('click', () => {
			const current = getFile();
			onPlayAudio(fileContentUrl(current, filesApi), current.display_name || current.id || 'Audio', artworkUrlFor(current.public_url));
		});
		refs.audioSizer.hidden = false;
		refs.audioTrigger.hidden = false;
	}
	else refs.file.hidden = false;
	return refs.preview;
}

function createFileCard(file, { cardTemplate, previewTemplate, filesApi, onDelete, onPlayAudio, onPlayVideo }) {
	const root = cloneTemplateElement(cardTemplate).firstElementChild;
	root.__fileRecord = file;
	const refs = bindRefs(root);
	refs.preview.replaceWith(createPreview(file, previewTemplate, { filesApi, getFile: () => root.__fileRecord, onPlayAudio, onPlayVideo }));
	refs.copy.addEventListener('click', async () => {
		const current = root.__fileRecord;
		if (!current.public_url) return;
		try { await navigator.clipboard.writeText(current.public_url); refs.copy.textContent = 'Copied'; setTimeout(() => { if (refs.copy.isConnected) refs.copy.textContent = 'Copy link'; }, 1800); }
		catch { window.prompt('Copy this public link', current.public_url); }
	});
	refs.remove.addEventListener('click', () => onDelete(root.__fileRecord, refs.remove, root));
	updateFileCard(root, file, { previewTemplate, filesApi, onPlayAudio, onPlayVideo });
	return root;
}

function updateFileCard(root, file, { previewTemplate, filesApi, onPlayAudio, onPlayVideo }) {
	root.__fileRecord = file;
	const refs = bindRefs(root);
	const title = file.display_name || file.id;
	const meta = `${formatFileSize(file.size)} · ${formatDate(file.created_at || file.updated_at)}`;
	const type = file.content_type || 'application/octet-stream';
	const contentUrl = fileContentUrl(file, filesApi);
	if (refs.title.textContent !== title) refs.title.textContent = title;
	if (refs.title.title !== title) refs.title.title = title;
	if (refs.meta.textContent !== meta) refs.meta.textContent = meta;
	if (refs.type.textContent !== type) refs.type.textContent = type;
	if (refs.open.getAttribute('href') !== contentUrl) refs.open.href = contentUrl;
	refs.copy.disabled = !file.public_url;
	const kind = mediaKind(file.content_type);
	const mediaTitle = file.display_name || file.id || (kind === 'video' ? 'Video' : 'Audio');
	const mediaTrigger = kind === 'video' ? refs.preview.querySelector('[data-ref="videoTrigger"]') : kind === 'audio' ? refs.preview.querySelector('[data-ref="audioTrigger"]') : null;
	if (mediaTrigger && mediaTrigger.getAttribute('aria-label') !== `Play ${mediaTitle}`) mediaTrigger.setAttribute('aria-label', `Play ${mediaTitle}`);
	if (refs.preview.dataset.previewKey !== previewKey(file, filesApi)) {
		refs.preview.replaceWith(createPreview(file, previewTemplate, { filesApi, getFile: () => root.__fileRecord, onPlayAudio, onPlayVideo }));
	}
}

export async function renderFileManagerView({ outlet, filesApi, filesResource, onUnauthorized, setHeaderMenu }) {
	const controller = new AbortController();
	const root = mountTemplate(outlet, template);
	const refs = bindRefs(root);
	document.title = 'My Files · parascene beta';
	const { audioClose, audioDialog, dialog, dialogTitle, dismiss, fileInput, grid, lightboxArtwork, lightboxAudio, lightboxVideo, loadMore, message, progress, status, videoClose, videoDialog } = refs;
	const cardTemplate = root.querySelector('template[data-template="file-card"]');
	const previewTemplate = root.querySelector('template[data-template="file-preview"]');
	setHeaderMenu?.({
		label: 'My Files',
		items: [
			{ label: 'Upload file', icon: 'files', action: 'upload' },
			{ label: 'Refresh', action: 'refresh' }
		],
		onSelect: ({ action }) => {
			if (action === 'upload' && !fileInput.disabled) fileInput.click();
			if (action === 'refresh' && !fileInput.disabled) void load();
		}
	});
	let nextOffset = null;
	let busy = false;
	let loadingMore = false;
	const uploadedNames = new Map();

	function stopVideo() {
		lightboxVideo.pause();
		lightboxVideo.removeAttribute('src');
		lightboxVideo.removeAttribute('aria-label');
		lightboxVideo.load();
	}
	function playVideo(url, title) {
		stopVideo();
		lightboxVideo.src = url;
		lightboxVideo.setAttribute('aria-label', title);
		if (!videoDialog.open) videoDialog.showModal();
		void lightboxVideo.play().catch(() => undefined);
	}
	function stopAudio() {
		lightboxAudio.pause();
		lightboxAudio.removeAttribute('src');
		lightboxAudio.removeAttribute('aria-label');
		lightboxAudio.load();
		lightboxArtwork.removeAttribute('src');
		lightboxArtwork.hidden = true;
	}
	function playAudio(url, title, artworkUrl) {
		stopAudio();
		lightboxAudio.src = url;
		lightboxAudio.setAttribute('aria-label', title);
		audioDialog.setAttribute('aria-label', `${title} audio player`);
		if (artworkUrl) {
			lightboxArtwork.src = artworkUrl;
			lightboxArtwork.hidden = false;
		}
		if (!audioDialog.open) audioDialog.showModal();
		void lightboxAudio.play().catch(() => undefined);
	}

	function showEmptyState() {
		grid.hidden = true;
		status.hidden = false;
		status.textContent = 'No files are stored in your personal folder yet.';
	}
	function insertFile(file) {
		const displayFile = !file.display_name && uploadedNames.has(file.id) ? { ...file, display_name: uploadedNames.get(file.id) } : file;
		const current = filesResource?.data;
		if (current && Array.isArray(current.files)) {
			const files = [displayFile, ...current.files.filter((row) => String(row.id) !== String(displayFile.id))];
			filesResource.setData({ ...current, files });
		} else {
			const card = createFileCard(displayFile, { cardTemplate, previewTemplate, filesApi, onDelete: deleteFile, onPlayAudio: playAudio, onPlayVideo: playVideo });
			card.dataset.fileId = String(file.id);
			grid.prepend(card);
		}
		status.hidden = true;
		grid.hidden = false;
	}

	function setBusy(value) {
		busy = value;
		fileInput.disabled = value;
	}
	function showDialog() { if (!dialog.open) dialog.showModal(); }
	function showUploadError(text) {
		dialog.classList.add('is-error');
		dialogTitle.textContent = 'Upload failed';
		message.textContent = text;
		progress.hidden = true;
		dismiss.hidden = false;
		showDialog();
	}
	function renderSnapshot(data) {
		const files = Array.isArray(data?.files) ? data.files : [];
		const existing = new Map([...grid.children].map((card) => [card.dataset.fileId, card]));
		let targetIndex = 0;
		for (const file of files) {
			const displayFile = !file.display_name && uploadedNames.has(file.id) ? { ...file, display_name: uploadedNames.get(file.id) } : file;
			const key = String(displayFile.id);
			let card = existing.get(key);
			if (!card) {
				const next = createFileCard(displayFile, { cardTemplate, previewTemplate, filesApi, onDelete: deleteFile, onPlayAudio: playAudio, onPlayVideo: playVideo });
				next.dataset.fileId = key;
				card = next;
			} else updateFileCard(card, displayFile, { previewTemplate, filesApi, onPlayAudio: playAudio, onPlayVideo: playVideo });
			const atIndex = grid.children[targetIndex];
			if (atIndex !== card) grid.insertBefore(card, atIndex || null);
			targetIndex++;
			existing.delete(key);
		}
		for (const card of existing.values()) card.remove();
		nextOffset = Number.isInteger(data?.pagination?.next_offset) ? data.pagination.next_offset : null;
		loadMore.hidden = nextOffset === null;
		grid.hidden = files.length === 0;
		if (!files.length) {
			status.hidden = false;
			status.classList.remove('is-error', 'is-stale');
			status.textContent = 'No files are stored in your personal folder yet.';
		} else status.hidden = true;
	}
	function onResourceState(snapshot) {
		if (snapshot.error?.status === 401) { onUnauthorized(); return; }
		const hasFiles = Array.isArray(snapshot.data?.files);
		if (hasFiles) renderSnapshot(snapshot.data);
		status.classList.toggle('is-error', snapshot.status === 'error');
		status.classList.toggle('is-stale', snapshot.status === 'stale-error');
		if (snapshot.status === 'loading' && !hasFiles) {
			status.hidden = false;
			status.textContent = 'Loading your files…';
		} else if (snapshot.status === 'error' && !hasFiles) {
			status.hidden = false;
			status.textContent = snapshot.error?.message || 'Unable to load your files.';
		} else if (snapshot.status === 'stale-error' && hasFiles) {
			status.hidden = false;
			status.textContent = 'Showing saved files. Could not refresh just now.';
		} else if (hasFiles && snapshot.data.files.length) status.hidden = true;
	}
	async function load({ append = false } = {}) {
		if (append && loadingMore) return;
		if (!append && filesResource) {
			try { await filesResource.refresh({ force: true }); } catch { /* Resource keeps cached data and publishes a stale error. */ }
			return;
		}
		if (append) { loadingMore = true; loadMore.disabled = true; }
		if (!append) {
			status.hidden = false;
			status.classList.remove('is-error', 'is-stale');
			status.textContent = 'Loading your files…';
		}
		try {
			const data = await filesApi.list({ offset: nextOffset, signal: controller.signal });
			const current = filesResource?.data;
			const mergedFiles = [...(current?.files || []), ...(Array.isArray(data.files) ? data.files : [])];
			filesResource?.setData({ ...data, files: mergedFiles, pagination: data.pagination });
			if (!filesResource) renderSnapshot({ ...data, files: mergedFiles });
		} catch (error) {
			if (error?.name === 'AbortError') return;
			if (error?.status === 401) return onUnauthorized();
			status.classList.add('is-error');
			status.textContent = error?.message || 'Unable to load your files.';
		} finally {
			if (append) { loadingMore = false; loadMore.disabled = false; }
		}
	}
	async function deleteFile(file, button, card) {
		if (!confirm(`Permanently delete “${file.display_name || file.id}”?`)) return;
		button.disabled = true;
		try {
			await filesApi.remove(file.id, { signal: controller.signal });
			const current = filesResource?.data;
			if (current) filesResource.setData({ ...current, files: current.files.filter((row) => String(row.id) !== String(file.id)) });
			else card.remove();
			if (nextOffset !== null) nextOffset = Math.max(0, nextOffset - 1);
			if (!grid.children.length) showEmptyState();
		}
		catch (error) { if (error?.name === 'AbortError') return; if (error?.status === 401) return onUnauthorized(); button.disabled = false; alert(error?.message || 'Unable to delete the file.'); }
	}
	async function uploadFile(file) {
		if (file.size > MAX_UPLOAD_BYTES) { showUploadError('This file exceeds the 50 MB upload limit.'); fileInput.value = ''; return; }
		setBusy(true); dialog.classList.remove('is-error'); dialogTitle.textContent = 'Uploading file'; dismiss.hidden = true; progress.hidden = false; progress.value = 0; message.textContent = `Uploading ${file.name}…`; showDialog();
		try {
			const result = await filesApi.upload(file, { signal: controller.signal, onProgress(loaded, total) { progress.value = total ? Math.round((loaded / total) * 100) : 0; message.textContent = `Uploading ${file.name} — ${formatFileSize(loaded)} of ${formatFileSize(total)}`; } });
			if (result?.file?.id) {
				uploadedNames.set(result.file.id, file.name);
				insertFile(result.file);
			}
			progress.value = 100; dialogTitle.textContent = 'Upload complete'; message.textContent = `${file.name} uploaded successfully.`; dismiss.hidden = false;
		} catch (error) { if (error?.name === 'AbortError') return; if (error?.status === 401) return onUnauthorized(); showUploadError(error?.message || 'Unable to upload the file.'); }
		finally { setBusy(false); fileInput.value = ''; }
	}
	loadMore.addEventListener('click', () => load({ append: true }));
	dismiss.addEventListener('click', () => dialog.close());
	dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
	videoClose.addEventListener('click', () => videoDialog.close());
	videoDialog.addEventListener('close', stopVideo);
	videoDialog.addEventListener('click', (event) => { if (event.target === videoDialog) videoDialog.close(); });
	audioClose.addEventListener('click', () => audioDialog.close());
	audioDialog.addEventListener('close', stopAudio);
	audioDialog.addEventListener('click', (event) => { if (event.target === audioDialog) audioDialog.close(); });
	lightboxArtwork.addEventListener('error', () => { lightboxArtwork.hidden = true; });
	fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) void uploadFile(file); });
	const unsubscribeResource = filesResource?.subscribe(onResourceState);
	if (filesResource) void load();
	else void filesApi.list({ signal: controller.signal }).then((data) => renderSnapshot(data)).catch((error) => { if (error?.name !== 'AbortError') { status.hidden = false; status.classList.add('is-error'); status.textContent = error?.message || 'Unable to load your files.'; } });
	return () => {
		unsubscribeResource?.();
		controller.abort();
		stopVideo();
		stopAudio();
		if (videoDialog.open) videoDialog.close();
		if (audioDialog.open) audioDialog.close();
	};
}
