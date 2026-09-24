const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function formatFileSize(value) {
	const bytes = Number(value);
	if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let size = bytes / 1024;
	let unit = units[0];
	for (let i = 1; i < units.length && size >= 1024; i += 1) {
		size /= 1024;
		unit = units[i];
	}
	return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${unit}`;
}

function formatDate(value) {
	if (!value) return 'Unknown date';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return 'Unknown date';
	return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function mediaKind(contentType) {
	const value = String(contentType || '').toLowerCase();
	if (value.startsWith('image/') && value !== 'image/svg+xml') return 'image';
	if (value.startsWith('video/')) return 'video';
	if (value.startsWith('audio/')) return 'audio';
	return 'file';
}

function createPreview(file, contentUrl) {
	const kind = mediaKind(file.content_type);
	const frame = document.createElement('div');
	frame.className = `file-preview file-preview--${kind}`;
	if (kind === 'image') {
		const image = document.createElement('img');
		image.src = contentUrl;
		image.alt = '';
		image.loading = 'lazy';
		frame.append(image);
	} else if (kind === 'video') {
		const video = document.createElement('video');
		video.src = contentUrl;
		video.controls = true;
		video.preload = 'metadata';
		frame.append(video);
	} else if (kind === 'audio') {
		const audio = document.createElement('audio');
		audio.src = contentUrl;
		audio.controls = true;
		audio.preload = 'metadata';
		frame.append(audio);
	} else {
		const icon = document.createElement('span');
		icon.className = 'file-icon';
		icon.textContent = 'FILE';
		frame.append(icon);
	}
	return frame;
}

function createFileCard(file, filesApi, onDelete) {
	// The private content endpoint is authenticated and cross-origin from beta;
	// media elements do not send the beta session cookie there. Use the signed
	// share URL for playback/opening, falling back only for legacy list rows.
	const contentUrl = file.public_url || filesApi.url(file.content_path);
	const article = document.createElement('article');
	article.className = 'file-card';
	article.append(createPreview(file, contentUrl));

	const body = document.createElement('div');
	body.className = 'file-card-body';
	const title = document.createElement('h2');
	title.textContent = file.display_name || file.id;
	title.title = title.textContent;
	const meta = document.createElement('p');
	meta.className = 'file-meta';
	meta.textContent = `${formatFileSize(file.size)} · ${formatDate(file.created_at || file.updated_at)}`;
	const type = document.createElement('p');
	type.className = 'file-type';
	type.textContent = file.content_type || 'application/octet-stream';
	const open = document.createElement('a');
	open.className = 'file-open';
	open.href = contentUrl;
	open.target = '_blank';
	open.rel = 'noopener';
	open.textContent = 'Open';
	open.title = 'Open file';
	const copyLink = document.createElement('button');
	copyLink.className = 'file-copy-link';
	copyLink.type = 'button';
	copyLink.textContent = 'Copy link';
	copyLink.disabled = !file.public_url;
	copyLink.title = 'Any signed-in Parascene user with this link can view the file';
	copyLink.addEventListener('click', async () => {
		if (!file.public_url) return;
		try {
			await navigator.clipboard.writeText(file.public_url);
			copyLink.textContent = 'Copied';
			setTimeout(() => { copyLink.textContent = 'Copy link'; }, 1800);
		} catch {
			window.prompt('Copy this public link', file.public_url);
		}
	});
	const remove = document.createElement('button');
	remove.className = 'file-delete';
	remove.type = 'button';
	remove.textContent = 'Delete';
	remove.addEventListener('click', () => onDelete(file, remove));
	const actions = document.createElement('div');
	actions.className = 'file-actions';
	actions.append(open, copyLink, remove);
	body.append(title, meta, type, actions);
	article.append(body);
	return article;
}

export async function renderFilesPage({ outlet, filesApi, onUnauthorized }) {
	const controller = new AbortController();
	outlet.innerHTML = `
		<section class="files-page">
			<div class="page-heading">
				<div>
					<p class="eyebrow">Private files</p>
					<h1>Your files</h1>
					<p class="state">Files stored in your personal Parascene folder.</p>
				</div>
				<div class="page-actions">
					<label class="upload-button">
						<input class="file-input" type="file" />
						<span>Upload file</span>
					</label>
					<button class="refresh-button" type="button">Refresh</button>
				</div>
			</div>
			<dialog class="upload-dialog" aria-labelledby="upload-dialog-title">
				<h2 id="upload-dialog-title">Uploading file</h2>
				<p class="upload-message" role="status" aria-live="polite"></p>
				<progress max="100" value="0"></progress>
				<button class="upload-dismiss" type="button" hidden>Dismiss</button>
			</dialog>
			<div class="files-status" role="status">Loading your files…</div>
			<div class="files-grid" hidden></div>
			<button class="load-more-button" type="button" hidden>Load more</button>
		</section>
	`;
	document.title = 'Your files · parascene beta';
	const status = outlet.querySelector('.files-status');
	const grid = outlet.querySelector('.files-grid');
	const refresh = outlet.querySelector('.refresh-button');
	const loadMore = outlet.querySelector('.load-more-button');
	const fileInput = outlet.querySelector('.file-input');
	const uploadButton = outlet.querySelector('.upload-button');
	const uploadDialog = outlet.querySelector('.upload-dialog');
	const uploadMessage = uploadDialog.querySelector('.upload-message');
	const uploadProgress = uploadDialog.querySelector('progress');
	const uploadDismiss = uploadDialog.querySelector('.upload-dismiss');
	let nextOffset = null;
	let uploadInProgress = false;
	const uploadedNames = new Map();

	function setUploadBusy(busy) {
		uploadInProgress = busy;
		fileInput.disabled = busy;
		uploadButton.classList.toggle('is-disabled', busy);
	}

	function showUploadDialog() {
		if (!uploadDialog.open) uploadDialog.showModal();
	}

	function showUploadError(message) {
		uploadDialog.classList.add('is-error');
		uploadDialog.querySelector('h2').textContent = 'Upload failed';
		uploadMessage.textContent = message;
		uploadProgress.hidden = true;
		uploadDismiss.hidden = false;
		showUploadDialog();
	}

	async function load({ append = false, uploadedFile = null } = {}) {
		refresh.disabled = true;
		loadMore.disabled = true;
		status.hidden = false;
		status.classList.remove('is-error');
		status.textContent = append ? 'Loading more files…' : 'Loading your files…';
		if (!append) {
			nextOffset = null;
			grid.hidden = true;
			grid.replaceChildren();
			loadMore.hidden = true;
		}
		try {
			const data = await filesApi.list({ offset: append ? nextOffset : 0, signal: controller.signal });
			let files = Array.isArray(data.files) ? data.files : [];
			if (!append && uploadedFile?.id && !files.some((file) => file.id === uploadedFile.id)) {
				files = [uploadedFile, ...files];
			}
			if (!append && files.length === 0) {
				status.textContent = 'No files are stored in your personal folder yet.';
				return;
			}
			for (const file of files) {
				const uploadedName = uploadedNames.get(file.id);
				const displayFile = !file.display_name && uploadedName
					? { ...file, display_name: uploadedName }
					: file;
				grid.append(createFileCard(displayFile, filesApi, deleteFile));
			}
			nextOffset = Number.isInteger(data?.pagination?.next_offset) ? data.pagination.next_offset : null;
			status.hidden = true;
			grid.hidden = false;
			loadMore.hidden = nextOffset === null;
		} catch (error) {
			if (error?.name === 'AbortError') return;
			if (error?.status === 401) {
				onUnauthorized();
				return;
			}
			status.classList.add('is-error');
			status.textContent = error?.message || 'Unable to load your files.';
		} finally {
			refresh.disabled = false;
			loadMore.disabled = false;
		}
	}

	async function deleteFile(file, button) {
		const name = file.display_name || file.id;
		if (!confirm(`Permanently delete “${name}”?`)) return;
		button.disabled = true;
		try {
			await filesApi.remove(file.id, { signal: controller.signal });
			await load();
		} catch (error) {
			if (error?.name === 'AbortError') return;
			if (error?.status === 401) return onUnauthorized();
			button.disabled = false;
			alert(error?.message || 'Unable to delete the file.');
		}
	}

	async function uploadFile(file) {
		if (file.size > MAX_UPLOAD_BYTES) {
			showUploadError('This file exceeds the 50 MB upload limit.');
			fileInput.value = '';
			return;
		}
		setUploadBusy(true);
		uploadDialog.classList.remove('is-error');
		uploadDialog.querySelector('h2').textContent = 'Uploading file';
		uploadDismiss.hidden = true;
		uploadProgress.hidden = false;
		uploadProgress.value = 0;
		uploadMessage.textContent = `Uploading ${file.name}…`;
		showUploadDialog();
		try {
			const result = await filesApi.upload(file, {
				signal: controller.signal,
				onProgress(loaded, total) {
					uploadProgress.value = total ? Math.round((loaded / total) * 100) : 0;
					uploadMessage.textContent = `Uploading ${file.name} — ${formatFileSize(loaded)} of ${formatFileSize(total)}`;
				}
			});
			if (result?.file?.id) uploadedNames.set(result.file.id, file.name);
			uploadProgress.value = 100;
			uploadDialog.querySelector('h2').textContent = 'Upload complete';
			uploadMessage.textContent = `${file.name} uploaded successfully.`;
			uploadDismiss.hidden = false;
			await load({ uploadedFile: result?.file || null });
		} catch (error) {
			if (error?.name === 'AbortError') return;
			if (error?.status === 401) return onUnauthorized();
			showUploadError(error?.message || 'Unable to upload the file.');
		} finally {
			setUploadBusy(false);
			fileInput.value = '';
		}
	}

	refresh.addEventListener('click', () => load());
	loadMore.addEventListener('click', () => load({ append: true }));
	uploadDismiss.addEventListener('click', () => uploadDialog.close());
	uploadDialog.addEventListener('cancel', (event) => {
		if (uploadInProgress) event.preventDefault();
	});
	fileInput.addEventListener('change', () => {
		const file = fileInput.files?.[0];
		if (file) void uploadFile(file);
	});
	void load();
	return () => controller.abort();
}
