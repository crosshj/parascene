import { createBulkActions } from '../../components/BulkActions/BulkActions.js';
import { copyBulkLinks } from '../../components/BulkActions/copyLinks.js';
import { addToMutateQueue } from '../../shared/mutateQueue.js';
import { bindRefs, mountTemplate } from '../../utils/dom.js';
import { formatDate, formatFileSize } from '../../utils/format.js';
import template from './FileManagerView.html';
import './FileManagerView.css';
import { createMediaLightbox } from '../../components/MediaLightbox/MediaLightbox.js';
import { creationTypeBadgeMarkup } from '../../shared/creationGrid.js';
import { gridSkeletonMarkup } from '../../components/CreationGrid/skeleton.js';
import { openImagePickerModal } from '../../components/ProviderFields/ProviderFields.js';
import '../../components/CreationGrid/CreationGrid.css';

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

export function renderFileManagerView({ outlet, filesApi, filesQuery, onUnauthorized, setHeaderMenu, setHeaderAccessories, actions }) {
	const controller = new AbortController();
	const root = mountTemplate(outlet, template);
	const refs = bindRefs(root);
	document.title = 'My Files · parascene beta';
	const { dialog, dialogTitle, dismiss, grid, loadMore, message, progress, status } = refs;
	const lightbox = createMediaLightbox();
	const cardOptions = { filesApi, onViewFile: viewFile };
	setHeaderAccessories?.([
		{ kind: 'pin', label: 'Upload', onClick: openUploadPicker },
	]);
	setHeaderMenu?.({
		label: 'My Files',
		items: [{ label: 'Bulk actions', action: 'bulk' }, { label: 'Refresh', action: 'refresh' }],
		onSelect: ({ action }) => { if (action === 'bulk') bulk.enter(); if (action === 'refresh') void load(); }
	});
	let nextOffset = null;
	let destroyed = false;
	let dragDepth = 0;
	let busy = false;
	let loadingMore = false;
	let disposeUploadPicker = null;
	const uploadedNames = new Map();
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
  if (!grid.querySelector('[data-file-id]')) showEmptyState();
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
 function showSkeleton() { grid.innerHTML = gridSkeletonMarkup(); grid.hidden = false; grid.setAttribute('aria-busy', 'true'); status.hidden = true; }

	function showEmptyState() {
		grid.hidden = true;
		status.hidden = false;
		status.textContent = 'No files are stored in your personal folder yet.';
	}
	function insertFile(file) {
		file = normalizeFileRecord(file);
		const displayFile = !file.display_name && uploadedNames.has(file.id) ? { ...file, display_name: uploadedNames.get(file.id) } : file;
		const current = filesQuery?.data;
		if (current && Array.isArray(current.files)) {
			const files = [displayFile, ...current.files.filter((row) => String(row.id) !== String(displayFile.id))];
			filesQuery.setData({ ...current, files, pagination: {...current.pagination,next_offset:Number.isInteger(current.pagination?.next_offset)?current.pagination.next_offset+(current.files.some(row=>String(row.id)===String(displayFile.id))?0:1):null} });
		} else {
			const card = createFileCard(displayFile, cardOptions);
			card.dataset.fileId = String(file.id);
			grid.prepend(card);
   bulk.sync();
		}
		status.hidden = true;
		grid.hidden = false;
	}

	function setBusy(value) {
		busy = value;
	}
	function openUploadPicker() {
		if (busy || destroyed) return;
		disposeUploadPicker = openImagePickerModal({
			modalParent: document.body,
			allowAnyFile: true,
			onSelect(value) {
				disposeUploadPicker = null;
				if (value instanceof File) return uploadFiles([value]);
				if (Array.isArray(value)) return uploadFiles(value);
				showUploadError('My Files stores uploaded files. Choose a file or paste an image from your clipboard.');
			},
		});
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
		if (destroyed) return;
		grid.removeAttribute('aria-busy');
  grid.querySelectorAll('.skeleton-grid-tile').forEach(tile => tile.remove());
		const files = (Array.isArray(data?.files) ? data.files : []).filter(file => !removedIds.has(String(file.id)));
		const existing = new Map([...grid.children].map((card) => [card.dataset.fileId, card]));
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
		for (const card of existing.values()) card.remove();
		nextOffset = Number.isInteger(data?.pagination?.next_offset) ? data.pagination.next_offset : null;
		loadMore.hidden = nextOffset === null;
		grid.hidden = files.length === 0;
		if (!files.length) {
			status.hidden = false;
			status.classList.remove('is-error', 'is-stale');
			status.textContent = 'No files are stored in your personal folder yet.';
		} else status.hidden = true;
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
	async function uploadFile(file) {
		if (file.size > MAX_UPLOAD_BYTES) { showUploadError('This file exceeds the 50 MB upload limit.'); return; }
		setBusy(true); dialog.classList.remove('is-error'); dialogTitle.textContent = 'Uploading file'; dismiss.hidden = true; progress.hidden = false; progress.value = 0; message.textContent = `Uploading ${file.name}…`; showDialog();
		try {
			const result = await filesApi.upload(file, { signal: controller.signal, onProgress(loaded, total) { progress.value = total ? Math.round((loaded / total) * 100) : 0; message.textContent = `Uploading ${file.name} — ${formatFileSize(loaded)} of ${formatFileSize(total)}`; } });
			if (destroyed) return;
			if (result?.file?.id) {
				uploadedNames.set(result.file.id, file.name);
				insertFile(result.file);
			}
			progress.value = 100; dialogTitle.textContent = 'Upload complete'; message.textContent = `${file.name} uploaded successfully.`; dismiss.hidden = false;
		} catch (error) { if (error?.name === 'AbortError') return; if (error?.status === 401) return onUnauthorized(); showUploadError(error?.message || 'Unable to upload the file.'); }
		finally { setBusy(false); }
	}
	loadMore.addEventListener('click', () => load({ append: true }));
	dismiss.addEventListener('click', () => dialog.close());
	dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
	async function uploadFiles(files) { if (busy || destroyed) return; for (const file of files) { if (destroyed) break; await uploadFile(file); } }
	root.addEventListener('dragenter', event => { if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); dragDepth++; root.classList.add('is-dragging'); });
	root.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
	root.addEventListener('dragleave', () => { if (--dragDepth <= 0) root.classList.remove('is-dragging'); });
	root.addEventListener('drop', event => { if (!event.dataTransfer?.files.length) return; event.preventDefault(); dragDepth = 0; root.classList.remove('is-dragging'); void uploadFiles([...event.dataTransfer.files]); });
	const loadObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting) && nextOffset !== null && !loadingMore && !busy && !status.classList.contains('is-error')) void load({ append: true }); }, { root: root.closest('.beta-outlet__scroll'), rootMargin: '1000px' }) : null;
	loadObserver?.observe(loadMore);
	const unsubscribeQuery = filesQuery?.subscribe(onQueryState);
	if (filesQuery) void filesQuery.loadIfNeeded().catch(() => undefined);
	else { showSkeleton(); void filesApi.list({ signal: controller.signal }).then((data) => renderSnapshot(data)).catch((error) => { if (!destroyed && error?.name !== 'AbortError') { grid.querySelectorAll('.skeleton-grid-tile').forEach(tile => tile.remove()); grid.removeAttribute('aria-busy'); status.hidden = false; status.classList.add('is-error'); status.textContent = error?.message || 'Unable to load your files.'; } }); }
	return () => {
		destroyed = true;
  bulk.destroy();
		disposeUploadPicker?.();
		disposeUploadPicker = null;
		setHeaderAccessories?.([]);
		setHeaderMenu?.();
		loadObserver?.disconnect();
		if (dialog.open) dialog.close();
  lightbox.destroy();
  unsubscribeQuery?.();
  controller.abort();
	};
}
