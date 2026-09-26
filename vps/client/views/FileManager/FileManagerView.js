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

function createPreview(file, contentUrl, previewTemplate, { onPlayAudio, onPlayVideo }) {
	const kind = mediaKind(file.content_type);
	const refs = bindRefs(cloneTemplateElement(previewTemplate).firstElementChild);
	refs.preview.classList.add(`file-preview--${kind}`);
	if (kind === 'image') { refs.image.src = contentUrl; refs.image.hidden = false; }
	else if (kind === 'video') {
		const title = file.display_name || file.id || 'Video';
		const thumbnailUrl = artworkUrlFor(file.public_url);
		refs.videoTrigger.setAttribute('aria-label', `Play ${title}`);
		if (thumbnailUrl) refs.videoPoster.poster = thumbnailUrl;
		refs.videoTrigger.addEventListener('click', () => onPlayVideo(contentUrl, title));
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
		refs.audioTrigger.addEventListener('click', () => onPlayAudio(contentUrl, title, artworkUrl));
		refs.audioSizer.hidden = false;
		refs.audioTrigger.hidden = false;
	}
	else refs.file.hidden = false;
	return refs.preview;
}

function createFileCard(file, { cardTemplate, previewTemplate, filesApi, onDelete, onPlayAudio, onPlayVideo }) {
	const contentUrl = file.public_url || filesApi.url(file.content_path);
	const root = cloneTemplateElement(cardTemplate).firstElementChild;
	const refs = bindRefs(root);
	const title = file.display_name || file.id;
	refs.preview.replaceWith(createPreview(file, contentUrl, previewTemplate, { onPlayAudio, onPlayVideo }));
	refs.title.textContent = title;
	refs.title.title = title;
	refs.meta.textContent = `${formatFileSize(file.size)} · ${formatDate(file.created_at || file.updated_at)}`;
	refs.type.textContent = file.content_type || 'application/octet-stream';
	refs.open.href = contentUrl;
	refs.copy.disabled = !file.public_url;
	refs.copy.addEventListener('click', async () => {
		if (!file.public_url) return;
		try { await navigator.clipboard.writeText(file.public_url); refs.copy.textContent = 'Copied'; setTimeout(() => { refs.copy.textContent = 'Copy link'; }, 1800); }
		catch { window.prompt('Copy this public link', file.public_url); }
	});
	refs.remove.addEventListener('click', () => onDelete(file, refs.remove, root));
	return root;
}

export async function renderFileManagerView({ outlet, filesApi, onUnauthorized, setHeaderMenu }) {
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
		const displayFile = !file.display_name && uploadedNames.has(file.id)
			? { ...file, display_name: uploadedNames.get(file.id) }
			: file;
		const existing = [...grid.children].find((card) => card.dataset.fileId === String(file.id));
		existing?.remove();
		const card = createFileCard(displayFile, { cardTemplate, previewTemplate, filesApi, onDelete: deleteFile, onPlayAudio: playAudio, onPlayVideo: playVideo });
		card.dataset.fileId = String(file.id);
		grid.prepend(card);
		status.hidden = true;
		grid.hidden = false;
		if (nextOffset !== null && !existing) nextOffset += 1;
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
	async function load({ append = false, uploadedFile = null } = {}) {
		status.hidden = false;
		status.classList.remove('is-error');
		status.textContent = append ? 'Loading more files…' : 'Loading your files…';
		if (!append) { nextOffset = null; grid.hidden = true; grid.replaceChildren(); loadMore.hidden = true; }
		try {
			const data = await filesApi.list({ offset: append ? nextOffset : 0, signal: controller.signal });
			let files = Array.isArray(data.files) ? data.files : [];
			if (!append && uploadedFile?.id && !files.some((file) => file.id === uploadedFile.id)) files = [uploadedFile, ...files];
			if (!append && files.length === 0) { status.textContent = 'No files are stored in your personal folder yet.'; return; }
			for (const file of files) {
				const displayFile = !file.display_name && uploadedNames.has(file.id) ? { ...file, display_name: uploadedNames.get(file.id) } : file;
				const card = createFileCard(displayFile, { cardTemplate, previewTemplate, filesApi, onDelete: deleteFile, onPlayAudio: playAudio, onPlayVideo: playVideo });
				card.dataset.fileId = String(file.id);
				grid.append(card);
			}
			nextOffset = Number.isInteger(data?.pagination?.next_offset) ? data.pagination.next_offset : null;
			status.hidden = true;
			grid.hidden = false;
			loadMore.hidden = nextOffset === null;
		} catch (error) {
			if (error?.name === 'AbortError') return;
			if (error?.status === 401) return onUnauthorized();
			status.classList.add('is-error');
			status.textContent = error?.message || 'Unable to load your files.';
		}
	}
	async function deleteFile(file, button, card) {
		if (!confirm(`Permanently delete “${file.display_name || file.id}”?`)) return;
		button.disabled = true;
		try {
			await filesApi.remove(file.id, { signal: controller.signal });
			card.remove();
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
	void load();
	return () => {
		controller.abort();
		stopVideo();
		stopAudio();
		if (videoDialog.open) videoDialog.close();
		if (audioDialog.open) audioDialog.close();
	};
}
