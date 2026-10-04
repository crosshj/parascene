const CDN_ORIGIN = 'https://cdn.parascene.com';
const TARGET_BYTES = 3 * 1024 * 1024;
const MAX_EDGE = 2048;

function legacyUploadEnabled() {
	if (typeof window === 'undefined') return false;
	if (new URLSearchParams(window.location.search).get('legacyGenericUploads') === '1') return true;
	try { return window.localStorage?.getItem('parascene:generic-upload-transport') === 'legacy'; }
	catch { return false; }
}

function safeName(name) {
	return String(name || 'upload.bin').trim().replace(/[^\x20-\x7e]/g, '_').replace(/[\r\n]/g, '_').slice(0, 180) || 'upload.bin';
}

async function prepareImage(file) {
	if (!file.type.toLowerCase().startsWith('image/') || file.type === 'image/svg+xml') return file;
	let bitmap;
	try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
	catch { return file; }
	try {
		const maxEdge = Math.max(bitmap.width, bitmap.height);
		if (file.size <= TARGET_BYTES && maxEdge <= MAX_EDGE) return file;
		const scale = Math.min(1, MAX_EDGE / maxEdge);
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(bitmap.width * scale));
		canvas.height = Math.max(1, Math.round(bitmap.height * scale));
		const context = canvas.getContext('2d');
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = 'high';
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		for (let pass = 0; pass < 12; pass++) {
			for (const type of ['image/webp', 'image/jpeg']) {
				const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.82));
				if (blob?.size > 0 && blob.size <= TARGET_BYTES) {
					const name = safeName(file.name).replace(/\.[^.]+$/, '') || 'image';
					return new File([blob], `${name}.${type === 'image/webp' ? 'webp' : 'jpg'}`, { type });
				}
			}
			const next = document.createElement('canvas');
			next.width = Math.max(1, Math.round(canvas.width * 0.82));
			next.height = Math.max(1, Math.round(canvas.height * 0.82));
			next.getContext('2d')?.drawImage(canvas, 0, 0, next.width, next.height);
			canvas.width = next.width;
			canvas.height = next.height;
			canvas.getContext('2d')?.drawImage(next, 0, 0);
		}
		return file;
	} finally { bitmap.close(); }
}

/** Uploads a chat attachment to the same public file store used by WWW chat. */
export async function uploadChatFile(file) {
	if (!(file instanceof File)) throw new Error('Invalid file');
	const prepared = file.type.toLowerCase().startsWith('image/') ? await prepareImage(file) : file;
	const filename = safeName(prepared.name || file.name);
	const legacy = legacyUploadEnabled();
	const endpoint = legacy ? '/api/images/generic' : `${CDN_ORIGIN}/api/files?filename=${encodeURIComponent(filename)}`;
	const response = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': prepared.type || file.type || 'application/octet-stream',
			'X-upload-kind': 'generic',
			'X-upload-name': filename,
		},
		body: prepared,
		credentials: 'include',
	});
	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(error.message || error.error || `Upload failed (${response.status})`);
	}
	const data = await response.json();
	const rawUrl = legacy ? String(data?.url || '').trim() : String(data?.file?.public_url || '').trim();
	if (!rawUrl) throw new Error('Upload returned no URL');
	const url = legacy || /^https?:\/\//i.test(rawUrl) ? rawUrl : rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl.startsWith('/') ? `${CDN_ORIGIN}${rawUrl}` : `${CDN_ORIGIN}/${rawUrl}`;
	const contentType = String(data?.file?.content_type || prepared.type || file.type || '').toLowerCase();
	return { url, displayAsFile: legacy ? data.display_as_file === true : !/^(?:image|video|audio)\//.test(contentType) };
}
