/**
 * Drag a creation image from explore/creations browse grids onto the create composer.
 */

export const PRSN_FEED_CREATION_DRAG_MIME = 'application/x-parascene-creation+json';

/**
 * @param {HTMLElement} card
 */
export function attachFeedCardCreationDragSource(card) {
	if (!(card instanceof HTMLElement)) return;
	const idRaw = card.dataset.imageId;
	const imageUrl = (
		card.dataset.imageUrlFull ||
		card.dataset.imageUrl ||
		''
	).trim();
	const mediaType = (card.dataset.mediaType || 'image').trim().toLowerCase();
	const status = (card.dataset.creationStatus || '').trim().toLowerCase();
	const creationId = idRaw != null && idRaw !== '' ? Number(idRaw) : NaN;
	if (!Number.isFinite(creationId) || creationId <= 0 || !imageUrl) return;
	if (mediaType === 'video') return;
	if (status === 'creating' || status === 'pending') return;

	card.setAttribute('draggable', 'true');
	card.setAttribute('aria-grabbed', 'false');

	const img = card.querySelector('.feed-card-img');
	if (img instanceof HTMLImageElement) {
		img.draggable = false;
	}

	const published = card.dataset.published === '1';

	card.addEventListener('dragstart', (e) => {
		if (!e.dataTransfer) return;
		const payload = JSON.stringify({
			creationId,
			imageUrl,
			published,
		});
		e.dataTransfer.setData(PRSN_FEED_CREATION_DRAG_MIME, payload);
		e.dataTransfer.setData('text/plain', imageUrl);
		e.dataTransfer.effectAllowed = 'copy';
		card.setAttribute('aria-grabbed', 'true');
		document.body.classList.add('prsn-creation-composer-drag-active');
		if (img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0) {
			try {
				e.dataTransfer.setDragImage(img, img.naturalWidth / 2, img.naturalHeight / 2);
			} catch {
				// ignore setDragImage failures
			}
		}
	});

	card.addEventListener('dragend', () => {
		card.setAttribute('aria-grabbed', 'false');
		document.body.classList.remove('prsn-creation-composer-drag-active');
		document.querySelectorAll('.create-composer.is-drop-target').forEach((el) => {
			el.classList.remove('is-drop-target');
		});
	});
}

/**
 * @param {DataTransfer | null} dt
 * @returns {{ creationId?: number, imageUrl: string, published?: boolean } | null}
 */
export function parseCreationDragDataTransfer(dt) {
	if (!dt) return null;
	try {
		const raw = dt.getData(PRSN_FEED_CREATION_DRAG_MIME);
		if (raw) {
			const parsed = JSON.parse(raw);
			const imageUrl =
				typeof parsed?.imageUrl === 'string' ? parsed.imageUrl.trim() : '';
			if (!imageUrl) return null;
			const cid = Number(parsed?.creationId);
			const published = parsed?.published === true || parsed?.published === 1;
			return {
				...(Number.isFinite(cid) && cid > 0 ? { creationId: cid } : {}),
				imageUrl,
				...(published ? { published: true } : {}),
			};
		}
	} catch {
		// fall through
	}
	const plain = (dt.getData('text/plain') || dt.getData('text/uri-list') || '').trim();
	if (plain && /^https?:\/\//i.test(plain)) {
		return { imageUrl: plain.split(/\s/)[0] };
	}
	return null;
}

function dataTransferHasCreationPayload(dt) {
	if (!dt) return false;
	const types = Array.from(dt.types || []);
	if (types.includes(PRSN_FEED_CREATION_DRAG_MIME)) return true;
	return types.includes('text/plain') || types.includes('text/uri-list');
}

/**
 * @param {HTMLElement} composerRoot `.create-composer`
 * @param {HTMLElement} dropSurface drop target (usually `.create-composer-input-shell`)
 * @param {{
 *   onAttachImageUrl: (url: string, detail: { creationId?: number, published?: boolean }) => void,
 *   isDisabled?: () => boolean,
 * }} handlers
 * @returns {() => void} teardown
 */
export function bindCreateComposerCreationDropTargets(composerRoot, dropSurface, handlers) {
	if (!(composerRoot instanceof HTMLElement) || !(dropSurface instanceof HTMLElement)) {
		return () => {};
	}
	const onAttach = handlers?.onAttachImageUrl;
	if (typeof onAttach !== 'function') return () => {};

	let dragDepth = 0;

	const allowDrop = (e) => {
		if (typeof handlers.isDisabled === 'function' && handlers.isDisabled()) return false;
		return dataTransferHasCreationPayload(e.dataTransfer);
	};

	const onDragEnter = (e) => {
		if (!allowDrop(e)) return;
		e.preventDefault();
		dragDepth += 1;
		composerRoot.classList.add('is-drop-target');
	};

	const onDragLeave = (e) => {
		if (!composerRoot.classList.contains('is-drop-target')) return;
		const related = e.relatedTarget;
		if (related instanceof Node && dropSurface.contains(related)) return;
		dragDepth = 0;
		composerRoot.classList.remove('is-drop-target');
	};

	const onDragOver = (e) => {
		if (!allowDrop(e)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
	};

	const onDrop = (e) => {
		e.preventDefault();
		dragDepth = 0;
		composerRoot.classList.remove('is-drop-target');
		if (typeof handlers.isDisabled === 'function' && handlers.isDisabled()) return;
		const parsed = parseCreationDragDataTransfer(e.dataTransfer);
		if (!parsed?.imageUrl) return;
		onAttach(parsed.imageUrl, {
			creationId: parsed.creationId,
			published: parsed.published,
		});
	};

	dropSurface.addEventListener('dragenter', onDragEnter);
	dropSurface.addEventListener('dragleave', onDragLeave);
	dropSurface.addEventListener('dragover', onDragOver);
	dropSurface.addEventListener('drop', onDrop);

	return () => {
		dropSurface.removeEventListener('dragenter', onDragEnter);
		dropSurface.removeEventListener('dragleave', onDragLeave);
		dropSurface.removeEventListener('dragover', onDragOver);
		dropSurface.removeEventListener('drop', onDrop);
		composerRoot.classList.remove('is-drop-target');
	};
}
