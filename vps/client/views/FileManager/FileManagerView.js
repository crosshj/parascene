import { createBulkActions } from '../../components/BulkActions/BulkActions.js';
import { copyBulkLinks } from '../../components/BulkActions/copyLinks.js';
import { addToMutateQueue } from '../../shared/mutateQueue.js';
import { bindRefs, mountTemplate } from '../../utils/dom.js';
import { formatDate, formatFileSize } from '../../utils/format.js';
import template from './FileManagerView.html';
import './FileManagerView.css';
import { createMediaLightbox } from '../../components/MediaLightbox/MediaLightbox.js';
import { creationGridStatusMarkup, creationTypeBadgeMarkup } from '../../shared/creationGrid.js';
import { gridSkeletonMarkup } from '../../components/CreationGrid/skeleton.js';
import { openImagePickerModal } from '../../components/ProviderFields/ProviderFields.js';
import '../../components/CreationGrid/CreationGrid.css';
import '../../components/Modal/Modal.css';
import { createModalDismissButton } from '../../shared/modalDismiss.js';

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

function providerImageUrl(publicUrl) {
	try {
		const url = new URL(publicUrl, window.location.href);
		// My Files signed-file links are served by the CDN host. Older file records
		// can carry the share host, where /s/ is handled by creation-share routes.
		if (url.hostname.toLowerCase() === 'sh.parascene.com') url.hostname = 'cdn.parascene.com';
		return url.href;
	} catch {
		return '';
	}
}

function normalizeFileRecord(file) {
	if (!file || typeof file !== 'object') return file;
	const publicUrl = providerImageUrl(file.public_url);
	return publicUrl && publicUrl !== file.public_url ? { ...file, public_url: publicUrl } : file;
}

function createFileCard(file, options) {
 const card = document.createElement('div'); card.setAttribute('role', 'button'); card.tabIndex = 0; card.className = 'file-card creation-grid__card';
 card.addEventListener('click', () => options.onViewFile(card.__fileRecord));
 card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); options.onViewFile(card.__fileRecord); } });
 updateFileCard(card, file, options); return card;
}
function updateFileCard(card, file, { filesApi }) {
 file = normalizeFileRecord(file);
 card.__fileRecord = file; card.setAttribute('aria-label', `View ${file.display_name || file.id}`);
 const key = `${file.content_type}|${fileContentUrl(file, filesApi)}|${artworkUrlFor(file.public_url)}`;
 if (card.dataset.previewKey === key) return; card.dataset.previewKey = key;
 const preview = document.createElement('div'); preview.className = 'file-preview';
 const kind = mediaKind(file.content_type), artwork = kind === 'audio' || kind === 'video' ? artworkUrlFor(file.public_url) : '';
 if (kind === 'image' || artwork) {
  const image = document.createElement('img'); image.src = kind === 'image' ? fileContentUrl(file, filesApi) : artwork; image.alt = ''; image.loading = 'lazy';
  image.addEventListener('error', () => image.remove(), { once: true }); preview.append(image);
 }
 preview.insertAdjacentHTML('beforeend', creationTypeBadgeMarkup(kind));
 if (kind === 'file') { const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = 'FILE'; preview.append(icon); }
 card.replaceChildren(preview);
}

export function renderFileManagerView({ outlet, filesApi, filesQuery, onUnauthorized, setHeaderMenu, setHeaderAccessories, actions, setTitle = () => {} }) {
	const controller = new AbortController();
	const root = mountTemplate(outlet, template);
	const refs = bindRefs(root);
	setTitle('My Files · parascene beta');
	const { grid, loadMore, status } = refs;
	const lightbox = createMediaLightbox();
	const cardOptions = { filesApi, onViewFile: viewFile };
	setHeaderAccessories?.([
		{ label: 'Upload', onClick: openUploadPicker },
	]);
	setHeaderMenu?.({
		label: 'My Files',
		items: [{ label: 'Bulk actions', action: 'bulk' }, { label: 'Refresh', action: 'refresh' }],
		onSelect: ({ action }) => { if (action === 'bulk') bulk.enter(); if (action === 'refresh') void load(); }
	});
	let nextOffset = null;
	let destroyed = false;
	let dragDepth = 0;
	let loadingMore = false;
	let disposeUploadPicker = null;
	let applyingLocalFile = false;
	let drainingUploads = false;
	let uploadSerial = 0;
	const uploadedNames = new Map();
	const uploadQueue = [];
	const uploadJobs = new Map();
 const removedIds = new Set();
 const bulk = createBulkActions({ root, grid, cardSelector: '.file-card[data-file-id]', noun: 'files', permanent: true,
  getItem: card => { const file = card.__fileRecord; return file ? { id: file.id, label: file.display_name || file.id, file } : null; },
  actions: [
   { id: 'copy-links', label: 'Copy links', enabled: items => items.some(item => item.file.public_url), run: items => copyBulkLinks(items.map(item => providerImageUrl(item.file.public_url))) },
   { id: 'queue', label: 'Queue', enabled: items => items.some(item => mediaKind(item.file.content_type) === 'image' && item.file.public_url), run(items) {
    for (const { file } of items) if (mediaKind(file.content_type) === 'image' && file.public_url) addToMutateQueue({ imageUrl: providerImageUrl(file.public_url), published: false });
    return { exit: true };
   } },
  ],
  remove: (item, options) => filesApi.remove(item.id, options),
  onRemoved: item => removeFileRow(item.id), onUnauthorized,
 });
 function removeFileRow(id) {
  removedIds.add(String(id));
  const current = filesQuery?.data;
  if (current) {
   const count = current.files.some(row => String(row.id) === String(id)) ? 1 : 0;
   filesQuery.setData({ ...current, files: current.files.filter(row => String(row.id) !== String(id)), pagination: { ...current.pagination, next_offset: Number.isInteger(current.pagination?.next_offset) ? Math.max(0, current.pagination.next_offset - count) : null } });
  } else {
   [...grid.children].find(card => card.dataset.fileId === String(id))?.remove();
   if (nextOffset !== null) nextOffset = Math.max(0, nextOffset - 1);
  }
  bulk.sync();
  if (!grid.querySelector('[data-file-id], [data-upload-id]')) showEmptyState();
 }

 function viewFile(file) {
  file = normalizeFileRecord(file);
  const kind = mediaKind(file.content_type);
  const mutateUrl = kind === 'image' ? providerImageUrl(file.public_url) : '';
  const actionsList = [
   ...(mutateUrl ? [{ id: 'mutate', label: 'Mutate', run: async () => {
    try { sessionStorage.setItem('parascene:file-mutate-image:v1', JSON.stringify({
     url: mutateUrl,
     filename: file.display_name || file.id || 'image.png',
     contentType: file.content_type || 'image/png',
     savedAt: Date.now(),
    })); }
    catch { throw new Error('Unable to prepare this image for editing.'); }
    try { await actions?.navigate('/create'); }
    catch (error) { sessionStorage.removeItem('parascene:file-mutate-image:v1'); throw error; }
    return { close: true };
   } }] : []),
   { id: 'open', label: 'Open file', href: fileContentUrl(file, filesApi) },
   { id: 'copy', label: 'Copy link', disabled: !file.public_url, run: async () => { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(providerImageUrl(file.public_url)); else window.prompt('Copy this public link', providerImageUrl(file.public_url)); return 'Link copied'; } },
   { id: 'delete', label: 'Delete', run: async () => { if (await deleteFile(file)) return { close: true }; } },
  ];
  lightbox.open({ title: file.display_name || file.id, metadata: `${formatFileSize(file.size)} · ${formatDate(file.created_at || file.updated_at)} · ${file.content_type || 'application/octet-stream'}`, kind, url: fileContentUrl(file, filesApi), artwork: artworkUrlFor(file.public_url), actions: actionsList });
 }
 function showSkeleton() {
  const uploads = uploadCards();
  for (const card of uploads) card.remove();
  grid.innerHTML = gridSkeletonMarkup();
  if (uploads.length) grid.prepend(...uploads);
  grid.hidden = false; grid.setAttribute('aria-busy', 'true'); status.hidden = true;
 }

	function showEmptyState() {
		grid.hidden = true;
		status.hidden = false;
		status.textContent = 'No files are stored in your personal folder yet.';
	}
	function openUploadPicker() {
		if (destroyed) return;
		disposeUploadPicker = openImagePickerModal({
			modalParent: document.body,
			allowAnyFile: true,
			onSelect(value) {
				disposeUploadPicker = null;
				if (value instanceof File) return uploadFiles([value]);
				if (Array.isArray(value)) return uploadFiles(value);
				showPickerError('My Files stores uploaded files. Choose a file or paste an image from your clipboard.');
			},
		});
	}
	function uploadCards() {
		return [...grid.querySelectorAll(':scope > [data-upload-id]')];
	}
	function revealGrid() {
		grid.hidden = false;
		if (!status.classList.contains('is-error') && !status.classList.contains('is-stale')) status.hidden = true;
	}
	function syncGridVisibility() {
		const occupied = grid.querySelector('[data-file-id], [data-upload-id], .skeleton-grid-tile');
		if (occupied) revealGrid();
		else showEmptyState();
	}
	function paintUploadCard(card, { name, phase, place = null, error = '' }) {
		card.dataset.uploadPhase = phase;
		card.dataset.uploadName = name;
		const preview = card.querySelector('.feed-card-image');
		const markup = phase === 'generating'
			? creationGridStatusMarkup('creating', null, { optimistic: false, label: 'UPLOADING…' })
			: phase === 'failed'
				? creationGridStatusMarkup('failed')
				: creationGridStatusMarkup('queued', place, { optimistic: true });
		if (preview) preview.innerHTML = markup;
		const failed = phase === 'failed';
		card.classList.toggle('is-upload-pending', !failed);
		card.classList.toggle('is-upload-failed', failed);
		if (failed) {
			card.setAttribute('role', 'button');
			card.tabIndex = 0;
			card.setAttribute('aria-label', `Upload failed for ${name}`);
			card.title = error || 'Upload failed';
		} else {
			card.setAttribute('role', 'img');
			card.removeAttribute('tabindex');
			card.removeAttribute('title');
			card.setAttribute('aria-label', phase === 'generating' ? `Uploading ${name}` : `Queued ${name}`);
		}
	}
	function dismissUpload(card) {
		const id = card.dataset.uploadId;
		uploadJobs.delete(id);
		const index = uploadQueue.findIndex(item => item.id === id);
		if (index >= 0) uploadQueue.splice(index, 1);
		card.remove();
		refreshQueuedPlaces();
		syncGridVisibility();
	}
	function retryUpload(card) {
		const job = uploadJobs.get(card.dataset.uploadId);
		if (!job || destroyed || uploadQueue.some(item => item.id === job.id)) return;
		paintUploadCard(card, { name: job.file?.name || 'file', phase: 'queued' });
		uploadQueue.push(job);
		refreshQueuedPlaces();
		void drainUploads();
	}
	let failureDialog = null;
	function closeFailureDialog() {
		const dialog = failureDialog;
		if (!dialog) return;
		failureDialog = null;
		if (dialog.open) dialog.close();
		dialog.remove();
	}
	function openFailureDialog(card) {
		const job = uploadJobs.get(card.dataset.uploadId);
		if (!job || destroyed) return;
		closeFailureDialog();
		const dialog = document.createElement('dialog');
		dialog.className = 'app-dialog';
		dialog.setAttribute('aria-labelledby', 'file-upload-failed-title');
		dialog.innerHTML = '<header class="app-dialog__header"><h2 id="file-upload-failed-title" class="app-dialog__title">Upload failed</h2></header><div class="app-dialog__body"></div><footer class="app-dialog__footer"><button type="button" class="btn-secondary" data-upload-dismiss>Dismiss</button><button type="button" class="btn-primary" data-upload-retry>Retry</button></footer>';
		const body = dialog.querySelector('.app-dialog__body');
		const name = document.createElement('p');
		name.textContent = job.file?.name || 'file';
		const message = document.createElement('p');
		message.textContent = job.error || 'Unable to upload the file.';
		body.append(name, message);
		const closeBtn = createModalDismissButton();
		dialog.querySelector('header').append(closeBtn);
		closeBtn.addEventListener('click', () => closeFailureDialog());
		dialog.addEventListener('click', event => { if (event.target === dialog) closeFailureDialog(); });
		dialog.querySelector('[data-upload-dismiss]').addEventListener('click', () => { closeFailureDialog(); dismissUpload(card); });
		dialog.querySelector('[data-upload-retry]').addEventListener('click', () => { closeFailureDialog(); retryUpload(card); });
		dialog.addEventListener('close', () => { if (failureDialog === dialog) failureDialog = null; dialog.remove(); });
		document.body.append(dialog);
		failureDialog = dialog;
		dialog.showModal();
	}
	function createUploadCard(job) {
		const card = document.createElement('div');
		card.className = 'file-card creation-grid__card is-upload-pending';
		card.dataset.uploadId = job.id;
		const preview = document.createElement('div');
		preview.className = 'feed-card-image creation-grid__status-card';
		preview.setAttribute('aria-hidden', 'true');
		card.append(preview);
		paintUploadCard(card, { name: job.file.name || 'file', phase: 'queued' });
		const openIfFailed = () => { if (card.dataset.uploadPhase === 'failed') openFailureDialog(card); };
		card.addEventListener('click', event => {
			if (!card.dataset.uploadId) return;
			event.preventDefault();
			event.stopPropagation();
			openIfFailed();
		});
		card.addEventListener('keydown', event => {
			if (!card.dataset.uploadId || (event.key !== 'Enter' && event.key !== ' ')) return;
			if (card.dataset.uploadPhase !== 'failed') return;
			event.preventDefault();
			openIfFailed();
		});
		return card;
	}
	function refreshQueuedPlaces() {
		let place = 1;
		for (const job of uploadQueue) {
			const card = grid.querySelector(`[data-upload-id="${job.id}"]`);
			if (!card || card.dataset.uploadPhase === 'failed') continue;
			paintUploadCard(card, { name: job.file.name || 'file', phase: 'queued', place });
			place += 1;
		}
	}
	function showPickerError(text) {
		status.hidden = false;
		status.classList.add('is-error');
		status.textContent = text;
	}
	function renderSnapshot(data) {
		if (destroyed) return;
		if (applyingLocalFile) {
			nextOffset = Number.isInteger(data?.pagination?.next_offset) ? data.pagination.next_offset : null;
			loadMore.hidden = nextOffset === null;
			revealGrid();
			bulk.sync();
			return;
		}
		const uploads = uploadCards();
		for (const card of uploads) card.remove();
		grid.removeAttribute('aria-busy');
  grid.querySelectorAll('.skeleton-grid-tile').forEach(tile => tile.remove());
		const files = (Array.isArray(data?.files) ? data.files : []).filter(file => !removedIds.has(String(file.id)));
		const existing = new Map([...grid.children].filter(card => card.dataset.fileId).map((card) => [card.dataset.fileId, card]));
		let targetIndex = 0;
		for (const file of files) {
			const normalizedFile = normalizeFileRecord(file);
			const displayFile = !normalizedFile.display_name && uploadedNames.has(normalizedFile.id) ? { ...normalizedFile, display_name: uploadedNames.get(normalizedFile.id) } : normalizedFile;
			const key = String(displayFile.id);
			let card = existing.get(key);
			if (!card) {
				const next = createFileCard(displayFile, cardOptions);
				next.dataset.fileId = key;
				card = next;
			} else updateFileCard(card, displayFile, cardOptions);
			const atIndex = grid.children[targetIndex];
			if (atIndex !== card) grid.insertBefore(card, atIndex || null);
			targetIndex++;
			existing.delete(key);
		}
		for (const card of existing.values()) if (card.dataset.fileId) card.remove();
		if (uploads.length) grid.prepend(...uploads);
		nextOffset = Number.isInteger(data?.pagination?.next_offset) ? data.pagination.next_offset : null;
		loadMore.hidden = nextOffset === null;
		const occupied = files.length > 0 || uploads.length > 0;
		grid.hidden = !occupied;
		if (!occupied) {
			status.hidden = false;
			status.classList.remove('is-error', 'is-stale');
			status.textContent = 'No files are stored in your personal folder yet.';
		} else if (!status.classList.contains('is-error') && !status.classList.contains('is-stale')) status.hidden = true;
  bulk.sync();
	}
	function onQueryState(snapshot) {
		if (destroyed) return;
		if (snapshot.error?.status === 401) { onUnauthorized(); return; }
		const hasFiles = Array.isArray(snapshot.data?.files);
		if (hasFiles) renderSnapshot(snapshot.data);
		status.classList.toggle('is-error', snapshot.status === 'error');
		status.classList.toggle('is-stale', snapshot.status === 'stale-error');
		if (snapshot.status === 'loading' && !hasFiles) {
			showSkeleton();
		} else if (snapshot.status === 'error' && !hasFiles) {
			grid.querySelectorAll('.skeleton-grid-tile').forEach(tile => tile.remove()); grid.removeAttribute('aria-busy');
   status.hidden = false;
			status.textContent = snapshot.error?.message || 'Unable to load your files.';
		} else if (snapshot.status === 'stale-error' && hasFiles) {
			status.hidden = false;
			status.textContent = 'Showing saved files. Could not refresh just now.';
		} else if (hasFiles && snapshot.data.files.length) status.hidden = true;
	}
	async function load({ append = false } = {}) {
		if (append && loadingMore) return;
		if (!append && filesQuery) {
			try { await filesQuery.refresh({ force: true }); } catch { /* Query keeps cached data and publishes a stale error. */ }
			return;
		}
		if (append) { loadingMore = true; loadMore.disabled = true; }
		if (!append) {
			if (!grid.querySelector('[data-file-id]')) showSkeleton();
		}
		try {
			const data = await filesApi.list({ offset: append ? nextOffset : 0, signal: controller.signal });
			const current = filesQuery?.data;
			if (destroyed) return;
			const byId = new Map([...(current?.files || []), ...(Array.isArray(data.files) ? data.files : [])].map(file => [file.id, file]));
			const mergedFiles = [...byId.values()];
			filesQuery?.setData({ ...data, files: mergedFiles, pagination: data.pagination });
			if (!filesQuery) renderSnapshot({ ...data, files: mergedFiles });
		} catch (error) {
			if (error?.name === 'AbortError') return;
			if (error?.status === 401) return onUnauthorized();
			status.hidden=false;status.classList.add('is-error');
			status.textContent = error?.message || 'Unable to load your files.';
		} finally {
			if (append) { loadingMore = false; loadMore.disabled = false; }
		}
	}
	async function deleteFile(file) {
		if (!confirm(`Permanently delete “${file.display_name || file.id}”?`)) return;
		try {
			await filesApi.remove(file.id, { signal: controller.signal });
			if (destroyed) return;
   removeFileRow(file.id);
   return true;
		}
		catch (error) { if (error?.name === 'AbortError') return; if (error?.status === 401) return onUnauthorized(); throw error; }
	}
	function rememberUploadedFile(file) {
		const current = filesQuery?.data;
		if (!(current && Array.isArray(current.files))) { bulk.sync(); return; }
		const exists = current.files.some(row => String(row.id) === String(file.id));
		const files = [file, ...current.files.filter(row => String(row.id) !== String(file.id))];
		applyingLocalFile = true;
		filesQuery.setData({ ...current, files, pagination: { ...current.pagination, next_offset: Number.isInteger(current.pagination?.next_offset) ? current.pagination.next_offset + (exists ? 0 : 1) : null } });
		applyingLocalFile = false;
	}
	function finishUpload(card, file) {
		file = normalizeFileRecord(file);
		const name = card.dataset.uploadName;
		const displayFile = !file.display_name && name ? { ...file, display_name: name } : file;
		uploadJobs.delete(card.dataset.uploadId);
		if (displayFile?.id) uploadedNames.set(displayFile.id, name || displayFile.display_name || '');
		const next = createFileCard(displayFile, cardOptions);
		next.dataset.fileId = String(displayFile.id);
		card.replaceWith(next);
		rememberUploadedFile(displayFile);
		revealGrid();
	}
	function failUpload(card, job, message) {
		if (!card || !job) return;
		job.error = message;
		paintUploadCard(card, { name: job.file?.name || 'file', phase: 'failed', error: message });
	}
	async function runUpload(job) {
		const card = grid.querySelector(`[data-upload-id="${job.id}"]`);
		if (!card || destroyed) return;
		if (job.file.size > MAX_UPLOAD_BYTES) { failUpload(card, job, 'This file exceeds the 50 MB upload limit.'); return; }
		paintUploadCard(card, { name: job.file.name || 'file', phase: 'generating' });
		try {
			const result = await filesApi.upload(job.file, { signal: controller.signal });
			if (destroyed) return;
			if (result?.file?.id) finishUpload(card, result.file);
			else failUpload(card, job, 'Unable to upload the file.');
		} catch (error) {
			if (destroyed || error?.name === 'AbortError') return;
			if (error?.status === 401) { failUpload(card, job, error?.message || 'Sign in to upload files.'); onUnauthorized(); return 'auth'; }
			failUpload(card, job, error?.message || 'Unable to upload the file.');
		}
	}
	async function drainUploads() {
		if (drainingUploads) return;
		drainingUploads = true;
		try {
			while (uploadQueue.length && !destroyed) {
				const job = uploadQueue.shift();
				refreshQueuedPlaces();
				const outcome = await runUpload(job);
				if (outcome === 'auth') {
					while (uploadQueue.length) {
						const pending = uploadQueue.shift();
						failUpload(grid.querySelector(`[data-upload-id="${pending.id}"]`), pending, 'Sign in to upload files.');
					}
					break;
				}
			}
		} finally {
			drainingUploads = false;
			if (uploadQueue.length && !destroyed) void drainUploads();
		}
	}
	function uploadFiles(files) {
		if (destroyed || !files?.length) return;
		const jobs = [...files].map(file => ({ id: `upload-${++uploadSerial}`, file }));
		for (const job of jobs) uploadJobs.set(job.id, job);
		const cards = jobs.map(job => createUploadCard(job));
		const existing = uploadCards();
		const anchor = existing.length ? existing.at(-1).nextSibling : grid.firstChild;
		for (const card of cards) grid.insertBefore(card, anchor);
		revealGrid();
		uploadQueue.push(...jobs);
		void drainUploads();
	}
	loadMore.addEventListener('click', () => load({ append: true }));
	root.addEventListener('dragenter', event => { if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); dragDepth++; root.classList.add('is-dragging'); });
	root.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
	root.addEventListener('dragleave', () => { if (--dragDepth <= 0) root.classList.remove('is-dragging'); });
	root.addEventListener('drop', event => { if (!event.dataTransfer?.files.length) return; event.preventDefault(); dragDepth = 0; root.classList.remove('is-dragging'); void uploadFiles([...event.dataTransfer.files]); });
	const loadObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting) && nextOffset !== null && !loadingMore && !status.classList.contains('is-error')) void load({ append: true }); }, { root: root.closest('.beta-outlet__scroll'), rootMargin: '1000px' }) : null;
	loadObserver?.observe(loadMore);
	const unsubscribeQuery = filesQuery?.subscribe(onQueryState);
	if (filesQuery) void filesQuery.loadIfNeeded().catch(() => undefined);
	else { showSkeleton(); void filesApi.list({ signal: controller.signal }).then((data) => renderSnapshot(data)).catch((error) => { if (!destroyed && error?.name !== 'AbortError') { grid.querySelectorAll('.skeleton-grid-tile').forEach(tile => tile.remove()); grid.removeAttribute('aria-busy'); status.hidden = false; status.classList.add('is-error'); status.textContent = error?.message || 'Unable to load your files.'; } }); }
	return () => {
		destroyed = true;
  bulk.destroy();
		disposeUploadPicker?.();
		disposeUploadPicker = null;
		closeFailureDialog();
		setHeaderAccessories?.([]);
		setHeaderMenu?.();
		loadObserver?.disconnect();
  lightbox.destroy();
  unsubscribeQuery?.();
  controller.abort();
	};
}
