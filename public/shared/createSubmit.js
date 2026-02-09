export function generateCreationToken() {
	const ts = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 10);
	return `crt_${ts}_${rand}`;
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
 * Upload a file to the generic image endpoint; returns the image URL on success.
 * Used when Create is clicked and args contain a File (paste/upload) so we upload first, then submit with the URL.
 */
export async function uploadImageFile(file) {
	if (!file || !(file instanceof File)) throw new Error('Invalid file');
	const res = await fetch('/api/images/generic', {
		method: 'POST',
		headers: {
			'Content-Type': file.type || 'image/png',
			'X-upload-kind': 'edited',
			'X-upload-name': file.name || 'image.png'
		},
		body: file,
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
 * Shared submit helper for /create and /creations/:id/mutate.
 * - Adds a pending creation entry (sessionStorage)
 * - Navigates to creations immediately (optimistic)
 * - POSTs /api/create with { server_id, method, args, creation_token } (JSON).
 *   image_url in args must be a string URL (client uploads the image before submit via /api/images/generic).
 */
export function submitCreationWithPending({
	serverId,
	methodKey,
	args,
	mutateOfId,
	creditCost,
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

	const payload = {
		server_id: serverId,
		method: methodKey,
		args: args || {},
		creation_token: creationToken,
		...(Number.isFinite(Number(mutateOfId)) && Number(mutateOfId) > 0 ? { mutate_of_id: Number(mutateOfId) } : {}),
		...(Number.isFinite(Number(creditCost)) && Number(creditCost) > 0 ? { credit_cost: Number(creditCost) } : {})
	};

	const doFetch = () =>
		fetch('/api/create', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify(payload)
		});

	// Full navigate: use sendBeacon so request survives page unload.
	if (navigate === 'full') {
		try {
			if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
				const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
				navigator.sendBeacon('/api/create', blob);
			} else {
				fetch('/api/create', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify(payload),
					keepalive: true
				}).catch(() => null);
			}
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

