export function generateCreationToken() {
	const ts = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 10);
	return `crt_${ts}_${rand}`;
}

function invalidateRelatedDataCaches() {
	if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
	const msg = {
		type: 'PRSN_SW_INVALIDATE',
		tags: ['creations', 'feed', 'explore']
	};
	if (navigator.serviceWorker.controller) {
		navigator.serviceWorker.controller.postMessage(msg);
		return;
	}
	navigator.serviceWorker.ready
		.then((registration) => {
			registration?.active?.postMessage(msg);
		})
		.catch(() => {});
}

function safeUploadHeaderFilename(name, fallback = 'upload.bin') {
	const raw = String(name || '').trim();
	if (!raw) return fallback;
	const cleaned = raw
		.replace(/[^\x20-\x7e]/g, '_')
		.replace(/[\r\n]/g, '_')
		.slice(0, 180)
		.trim();
	return cleaned || fallback;
}

/**
 * Edge/CDN body limits (e.g. Vercel serverless) can reject POST bodies below Express `limit`.
 * Keep uploads under that cap so /api/images/generic is reachable.
 */
const CLIENT_IMAGE_UPLOAD_TARGET_BYTES = 3 * 1024 * 1024;

/** Max longest edge before client-side resize (paste/screenshots). */
const CLIENT_IMAGE_UPLOAD_MAX_EDGE_PX = 2048;

/** @type {boolean | null} */
let canvasWebpEncodeSupported = null;

function canvasSupportsWebpEncode() {
	if (canvasWebpEncodeSupported !== null) return canvasWebpEncodeSupported;
	try {
		const c = document.createElement('canvas');
		c.width = 1;
		c.height = 1;
		const u = c.toDataURL('image/webp');
		canvasWebpEncodeSupported = /^data:image\/webp/i.test(u);
	} catch {
		canvasWebpEncodeSupported = false;
	}
	return canvasWebpEncodeSupported;
}

function basenameWithoutExtension(name) {
	const raw = String(name || '').trim();
	const i = raw.lastIndexOf('.');
	if (i <= 0) return raw || 'image';
	return raw.slice(0, i) || 'image';
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} type
 * @param {number} quality
 * @returns {Promise<Blob | null>}
 */
function blobFromCanvas(canvas, type, quality) {
	return new Promise((resolve) => {
		canvas.toBlob((b) => resolve(b || null), type, quality);
	});
}

/**
 * @param {HTMLCanvasElement} src
 * @param {number} targetW
 * @param {number} targetH
 * @returns {HTMLCanvasElement}
 */
function copyCanvasToSize(src, targetW, targetH) {
	const out = document.createElement('canvas');
	out.width = Math.max(1, Math.round(targetW));
	out.height = Math.max(1, Math.round(targetH));
	const ctx = out.getContext('2d');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(src, 0, 0, out.width, out.height);
	return out;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} maxBytes
 * @returns {Promise<{ blob: Blob, type: string } | null>}
 */
async function encodeRasterCanvasUnderByteBudget(canvas, maxBytes) {
	const tries = [];
	if (canvasSupportsWebpEncode()) {
		for (let q = 0.88; q >= 0.42; q -= 0.06) {
			tries.push(['image/webp', q]);
		}
	}
	for (let q = 0.9; q >= 0.46; q -= 0.06) {
		tries.push(['image/jpeg', q]);
	}
	for (const [type, q] of tries) {
		const blob = await blobFromCanvas(canvas, type, q);
		if (blob && blob.size > 0 && blob.size <= maxBytes) {
			return { blob, type };
		}
	}
	return null;
}

/**
 * Downscale / re-encode raster images so POST bodies stay under edge payload limits.
 * HEIC and other undecodable types are returned unchanged.
 *
 * @param {File} file
 * @returns {Promise<File>}
 */
async function shrinkRasterImageFileForGenericUpload(file) {
	if (!file || !(file instanceof File)) return file;
	const mime = String(file.type || '').toLowerCase();
	if (!mime.startsWith('image/') || mime === 'image/svg+xml') return file;

	let bitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return file;
	}

	try {
		const w = bitmap.width;
		const h = bitmap.height;
		const maxEdge = Math.max(w, h);
		const tooBigBytes = file.size > CLIENT_IMAGE_UPLOAD_TARGET_BYTES;
		const tooBigPixels = maxEdge > CLIENT_IMAGE_UPLOAD_MAX_EDGE_PX;
		if (!tooBigBytes && !tooBigPixels) {
			return file;
		}

		const pixelScale = Math.min(1, CLIENT_IMAGE_UPLOAD_MAX_EDGE_PX / maxEdge);
		let cw = Math.max(1, Math.round(w * pixelScale));
		let ch = Math.max(1, Math.round(h * pixelScale));

		let canvas = document.createElement('canvas');
		canvas.width = cw;
		canvas.height = ch;
		const ctx = canvas.getContext('2d');
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(bitmap, 0, 0, cw, ch);

		const baseName = basenameWithoutExtension(file.name);

		for (let attempt = 0; attempt < 14; attempt += 1) {
			const encoded = await encodeRasterCanvasUnderByteBudget(
				canvas,
				CLIENT_IMAGE_UPLOAD_TARGET_BYTES
			);
			if (encoded) {
				const ext = encoded.type === 'image/webp' ? '.webp' : '.jpg';
				return new File([encoded.blob], `${baseName}${ext}`, { type: encoded.type });
			}
			const nw = Math.max(1, Math.round(canvas.width * 0.82));
			const nh = Math.max(1, Math.round(canvas.height * 0.82));
			if (nw >= canvas.width && nh >= canvas.height) break;
			canvas = copyCanvasToSize(canvas, nw, nh);
		}

		const cap = 320;
		const tinyScale = Math.min(cap / canvas.width, cap / canvas.height, 1);
		const tw = Math.max(1, Math.round(canvas.width * tinyScale));
		const th = Math.max(1, Math.round(canvas.height * tinyScale));
		const tiny = copyCanvasToSize(canvas, tw, th);
		const lastBlob = await blobFromCanvas(tiny, 'image/jpeg', 0.34);
		if (lastBlob && lastBlob.size > 0 && lastBlob.size <= CLIENT_IMAGE_UPLOAD_TARGET_BYTES) {
			return new File([lastBlob], `${baseName}.jpg`, { type: 'image/jpeg' });
		}

		return file;
	} finally {
		bitmap.close();
	}
}

function addPendingCreation({ creationToken }) {
	const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
	const pendingItem = {
		id: pendingId,
		status: 'pending',
		created_at: new Date().toISOString(),
		creation_token: creationToken
	};

	const pendingKey = 'pendingCreations';
	const pendingList = JSON.parse(sessionStorage.getItem(pendingKey) || '[]');
	pendingList.unshift(pendingItem);
	sessionStorage.setItem(pendingKey, JSON.stringify(pendingList));
	document.dispatchEvent(new CustomEvent('creations-pending-updated'));

	return { pendingKey, pendingId };
}

function removePendingCreation({ pendingKey, pendingId }) {
	try {
		const current = JSON.parse(sessionStorage.getItem(pendingKey) || '[]');
		const next = Array.isArray(current) ? current.filter(item => item?.id !== pendingId) : [];
		sessionStorage.setItem(pendingKey, JSON.stringify(next));
	} catch {
		// ignore
	}
	document.dispatchEvent(new CustomEvent('creations-pending-updated'));
}

function navigateToCreations({ mode }) {
	if (mode === 'full') {
		window.location.href = '/creations';
		return;
	}

	// SPA navigation (used by /create route).
	const header = document.querySelector('app-navigation');
	if (header && typeof header.handleRouteChange === 'function') {
		window.history.pushState({ route: 'creations' }, '', '/creations');
		header.handleRouteChange();
		return;
	}

	// Fallback: hash-based routing
	window.location.hash = 'creations';
}

/**
 * Upload a file to the generic image endpoint; returns the image URL path on success (e.g. `/api/images/generic/...`).
 * Large pasted images are downscaled / re-encoded client-side so POST bodies stay under edge payload limits (e.g. Vercel).
 * @param {File} file
 * @param {{ uploadKind?: 'edited' | 'generic' }} [options] — `generic` uses miscellaneous profile storage (`generic_*` keys); `edited` resizes to 1024² PNG (create inputs).
 */
export async function uploadImageFile(file, options = {}) {
	if (!file || !(file instanceof File)) throw new Error('Invalid file');
	const uploadKind = options.uploadKind === 'generic' ? 'generic' : 'edited';
	const prepared = await shrinkRasterImageFileForGenericUpload(file);
	const defaultName = uploadKind === 'generic' ? 'paste.png' : 'image.png';
	const safeName = safeUploadHeaderFilename(prepared.name || file.name, defaultName);
	const res = await fetch('/api/images/generic', {
		method: 'POST',
		headers: {
			'Content-Type': prepared.type || file.type || 'image/png',
			'X-upload-kind': uploadKind,
			'X-upload-name': safeName
		},
		body: prepared,
		credentials: 'include'
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err.message || err.error || `Upload failed (${res.status})`);
	}
	const data = await res.json();
	if (!data?.url) throw new Error('No URL in response');
	return data.url;
}

/**
 * Upload any file to chat misc endpoint namespace (`/api/images/generic`).
 * Server stores image/video as `generic_*` and other files as `misc_*`.
 * Raster images are shrunk client-side when needed so uploads clear edge body limits.
 * @param {File} file
 * @returns {Promise<{ url: string, displayAsFile: boolean }>}
 */
export async function uploadChatFile(file) {
	if (!file || !(file instanceof File)) throw new Error('Invalid file');
	const mime = String(file.type || '').toLowerCase();
	const prepared =
		mime.startsWith('image/') ? await shrinkRasterImageFileForGenericUpload(file) : file;
	const safeName = safeUploadHeaderFilename(prepared.name || file.name, 'upload.bin');
	const res = await fetch('/api/images/generic', {
		method: 'POST',
		headers: {
			'Content-Type': prepared.type || file.type || 'application/octet-stream',
			'X-upload-kind': 'generic',
			'X-upload-name': safeName
		},
		body: prepared,
		credentials: 'include'
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err.message || err.error || `Upload failed (${res.status})`);
	}
	const data = await res.json();
	if (!data?.url) throw new Error('No URL in response');
	return {
		url: data.url,
		displayAsFile: data.display_as_file === true
	};
}

const MENTION_FAILURE_LABELS = {
	user_not_found: 'User not found',
	mention_not_found: 'User or persona not found',
	no_character_description: 'No character description set',
	invalid_username: 'Invalid username',
	profiles_unavailable: 'Profiles unavailable'
};

/**
 * Format mention validation failure for the "submit anyway?" dialog.
 * Returns a single string with newlines; use with white-space: pre-line or in window.confirm.
 */
export function formatMentionsFailureForDialog(data) {
	const failed = Array.isArray(data?.failed_mentions) ? data.failed_mentions : [];
	if (failed.length === 0) {
		const fallback = data?.message || data?.error || 'Mentions could not be validated.';
		return `${fallback}\n\nIf you submit, @mentions will not be expanded or understood by the image generator.`;
	}
	const lines = failed.map((f) => {
		const m = typeof f?.mention === 'string' ? f.mention : '';
		const r = MENTION_FAILURE_LABELS[f?.reason] || f?.reason || 'Unknown';
		return m ? `• ${m} — ${r}` : `• ${r}`;
	}).filter(Boolean);
	return `Some @mentions couldn't be validated:\n\n${lines.join('\n')}\n\nIf you submit, @mentions will not be expanded or understood by the image generator.`;
}

/**
 * Shared submit helper for /create and /creations/:id/mutate.
 * - Adds a pending creation entry (sessionStorage)
 * - Navigates to creations immediately (optimistic)
 * - POSTs /api/create with { server_id, method, args, creation_token } (JSON).
 *   Image fields follow the server method `fields` config (e.g. `image_url` or `input_images` URL array). Upload via /api/images/generic when needed.
 */
export function submitCreationWithPending({
	serverId,
	methodKey,
	args,
	mutateOfId,
	mutateParentIds,
	creditCost,
	hydrateMentions,
	styleKey,
	navigate = 'spa', // 'spa' | 'full'
	onInsufficientCredits,
	onError
}) {
	if (!serverId || !methodKey) return;

	const creationToken = generateCreationToken();
	const { pendingKey, pendingId } = addPendingCreation({ creationToken });

	// Best-effort: refresh creations route if it exists (SPA only).
	try {
		const creationsRoute = document.querySelector('app-route-creations');
		if (creationsRoute && typeof creationsRoute.loadCreations === 'function') {
			void creationsRoute.loadCreations();
		}
	} catch {
		// ignore
	}

	let parentIds = [];
	if (Array.isArray(mutateParentIds)) {
		const seen = new Set();
		parentIds = mutateParentIds
			.map((v) => Number(v))
			.filter((n) => {
				if (!Number.isFinite(n) || n <= 0) return false;
				if (seen.has(n)) return false;
				seen.add(n);
				return true;
			});
	}

	const payload = {
		server_id: serverId,
		method: methodKey,
		args: args || {},
		creation_token: creationToken,
		...(Number.isFinite(Number(mutateOfId)) && Number(mutateOfId) > 0 ? { mutate_of_id: Number(mutateOfId) } : {}),
		...(parentIds.length > 0 ? { mutate_parent_ids: parentIds } : {}),
		...(Number.isFinite(Number(creditCost)) && Number(creditCost) > 0 ? { credit_cost: Number(creditCost) } : {}),
		...(typeof hydrateMentions === 'boolean' ? { hydrate_mentions: hydrateMentions } : {}),
		...(styleKey && typeof styleKey === 'string' && styleKey.trim() ? { style_key: styleKey.trim() } : {})
	};

	const doFetch = () =>
		fetch('/api/create', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify(payload)
		});

	// Full navigate: use fetch with keepalive so request survives page unload and Content-Type is set (so server parses JSON and hydrate_mentions).
	if (navigate === 'full') {
		try {
			fetch('/api/create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify(payload),
				keepalive: true
			}).catch(() => null);
		} catch {
			// ignore
		}

		navigateToCreations({ mode: navigate });
		return;
	}

	navigateToCreations({ mode: navigate });

	doFetch()
		.then(async (response) => {
			if (!response.ok) {
				let error = null;
				try {
					error = await response.json();
				} catch {
					error = null;
				}

				if (response.status === 402) {
					document.dispatchEvent(new CustomEvent('credits-updated', {
						detail: { count: Number(error?.current ?? 0) }
					}));
					if (typeof onInsufficientCredits === 'function') {
						await onInsufficientCredits(error);
					}
					throw new Error(error?.message || 'Insufficient credits');
				}

				throw new Error(error?.error || error?.message || 'Failed to create image');
			}

			const data = await response.json();
			if (typeof data?.credits_remaining === 'number') {
				document.dispatchEvent(new CustomEvent('credits-updated', {
					detail: { count: data.credits_remaining }
				}));
			}
			return null;
		})
		.then(() => {
			removePendingCreation({ pendingKey, pendingId });
			invalidateRelatedDataCaches();
		})
		.catch(async (err) => {
			removePendingCreation({ pendingKey, pendingId });
			if (typeof onError === 'function') {
				try {
					await onError(err);
				} catch {
					// ignore
				}
			}
		});
}

