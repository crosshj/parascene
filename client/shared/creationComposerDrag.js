/**
 * Drag a creation image from explore/creations browse grids onto the create composer.
 */

export const PRSN_FEED_CREATION_DRAG_MIME = 'application/x-parascene-creation+json';

const DRAG_START_PX = 4;
const dropTargets = new Set();
let dragOverlay = null;
let dragFocusWatch = null;

/**
 * @param {HTMLElement} card
 */
export function attachFeedCardCreationDragSource(card) {
	if (!(card instanceof HTMLElement)) return;
	const idRaw = card.dataset.imageId || card.getAttribute('data-creation-id');
	const imageUrl = (card.dataset.imageUrlFull || '').trim();
	const mediaType = (card.dataset.mediaType || 'image').trim().toLowerCase();
	const status = (card.dataset.creationStatus || '').trim().toLowerCase();
	const creationId = idRaw != null && idRaw !== '' ? Number(idRaw) : NaN;
	const hasId = Number.isFinite(creationId) && creationId > 0;
	if ((!hasId && !imageUrl) || (hasId && !imageUrl && card.dataset.groupCreation !== '1')) return;
	if (mediaType === 'video' || mediaType === 'audio') return;
	if (status === 'creating' || status === 'pending' || status === 'queued' || status === 'processing' || status === 'running') return;

	card.dataset.creationDragSource = '1';
	card.querySelectorAll('img').forEach((img) => {
		if (!(img instanceof HTMLImageElement)) return;
		img.draggable = false;
		img.style.setProperty('-webkit-user-drag', 'none');
	});
	// Card updates copy attributes from fresh markup and wipe the marker.
	// The listener stays on the element, so a later call only restores the marker.
	if (card.__composerDragBound) return;
	card.__composerDragBound = true;

	const highlight = dragHighlightElement(card);
	card.addEventListener('dragstart', (event) => event.preventDefault());
	card.addEventListener('click', (event) => {
		if (!card.__suppressCreationClick) return;
		card.__suppressCreationClick = false;
		event.preventDefault();
		event.stopPropagation();
	}, true);
	card.addEventListener('pointerdown', (event) => {
		if (event.button !== 0 || pointerStartedOnControl(event.target, card)) return;
		const pointerId = event.pointerId;
		const startX = event.clientX;
		const startY = event.clientY;
		let dragging = false;
		const move = (next) => {
			if (next.pointerId !== pointerId) return;
			if (!dragging) {
				if (Math.hypot(next.clientX - startX, next.clientY - startY) < DRAG_START_PX) return;
				dragging = true;
				beginCreationPointerDrag(card, highlight);
			}
			next.preventDefault();
			placeDragOverlay(highlight);
			markComposerUnderPoint(next.clientX, next.clientY);
		};
		const end = (next) => {
			if (next.pointerId !== pointerId) return;
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', end);
			window.removeEventListener('pointercancel', end);
			if (!dragging) return;
			const target = dropTargetAt(next.clientX, next.clientY);
			endCreationPointerDrag(card);
			card.__suppressCreationClick = true;
			setTimeout(() => { card.__suppressCreationClick = false; }, 0);
			if (!target) return;
			const payload = readCreationDragPayload(card);
			if (!payload?.imageUrl) return;
			target.handlers.onAttachImageUrl(payload.imageUrl, {
				creationId: payload.creationId,
				groupId: payload.groupId,
				published: payload.published,
			});
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', end);
		window.addEventListener('pointercancel', end);
	});
}

function dragHighlightElement(card) {
	const imageBox = card.querySelector('.feed-card-image');
	if (imageBox instanceof HTMLElement && imageBox.tagName !== 'IMG') return imageBox;
	return card;
}

function pointerStartedOnControl(target, card) {
	const ElementCtor = globalThis.Element;
	if (!ElementCtor || !(target instanceof ElementCtor)) return false;
	const control = target.closest('button, input, textarea, select, label');
	return control instanceof ElementCtor && control !== card && card.contains(control);
}

export function readCreationDragPayload(card) {
	if (!(card instanceof HTMLElement)) return null;
	const idRaw = card.dataset.imageId || card.getAttribute('data-creation-id');
	const imageUrl = (card.dataset.imageUrlFull || '').trim();
	const creationId = idRaw != null && idRaw !== '' ? Number(idRaw) : NaN;
	const hasId = Number.isFinite(creationId) && creationId > 0;
	const selectedSourceId = Number(card.dataset.selectedGroupSourceId);
	const selectedImageUrl = Number.isFinite(selectedSourceId) && selectedSourceId > 0
		? (card.dataset.selectedGroupSourceUrl || '').trim() : imageUrl;
	if (!selectedImageUrl) return null;
	const draggedId = Number.isFinite(selectedSourceId) && selectedSourceId > 0 ? selectedSourceId : creationId;
	const published = card.dataset.published === '1';
	const groupId = hasId && card.dataset.groupCreation === '1' ? creationId : Number(card.dataset.groupId) || null;
	return {
		...(Number.isFinite(draggedId) && draggedId > 0 ? { creationId: draggedId } : {}),
		imageUrl: selectedImageUrl,
		...(published ? { published: true } : {}),
		...(groupId ? { groupId } : {}),
	};
}

function beginCreationPointerDrag(card, highlight) {
	document.documentElement.classList.add('prsn-creation-composer-drag-active');
	document.body.classList.add('prsn-creation-composer-drag-active');
	dragOverlay?.remove();
	dragOverlay = document.createElement('div');
	dragOverlay.className = 'creation-drag-highlight';
	dragOverlay.setAttribute('aria-hidden', 'true');
	document.body.append(dragOverlay);
	placeDragOverlay(highlight);
	blurDragSource(card);
	dragFocusWatch = (event) => {
		const target = event.target;
		if (target instanceof HTMLElement && (target === card || card.contains(target))) target.blur();
	};
	document.addEventListener('focusin', dragFocusWatch, true);
}

function placeDragOverlay(highlight) {
	if (!dragOverlay) return;
	const box = highlight.getBoundingClientRect();
	dragOverlay.style.left = `${box.left}px`;
	dragOverlay.style.top = `${box.top}px`;
	dragOverlay.style.width = `${box.width}px`;
	dragOverlay.style.height = `${box.height}px`;
	const styleOf = window.getComputedStyle;
	dragOverlay.style.borderRadius = typeof styleOf === 'function' ? styleOf(highlight).borderRadius : '';
}

function endCreationPointerDrag(card) {
	dragOverlay?.remove();
	dragOverlay = null;
	if (dragFocusWatch) document.removeEventListener('focusin', dragFocusWatch, true);
	dragFocusWatch = null;
	document.documentElement.classList.remove('prsn-creation-composer-drag-active');
	document.body.classList.remove('prsn-creation-composer-drag-active');
	for (const entry of dropTargets) entry.composerRoot.classList.remove('is-drop-target');
	blurDragSource(card);
	if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => blurDragSource(card));
}

function blurDragSource(card) {
	const active = document.activeElement;
	if (active instanceof HTMLElement && (active === card || card.contains(active))) active.blur();
}

function pointsIn(x, y) {
	if (typeof document.elementsFromPoint === 'function') return document.elementsFromPoint(x, y);
	const hit = document.elementFromPoint(x, y);
	return hit ? [hit] : [];
}

function dropTargetAt(x, y) {
	const stack = pointsIn(x, y);
	for (const entry of dropTargets) {
		if (typeof entry.handlers.isDisabled === 'function' && entry.handlers.isDisabled()) continue;
		const over = stack.some((node) => node && (entry.composerRoot.contains(node) || entry.dropSurface.contains(node)));
		if (over) return entry;
	}
	return null;
}

function markComposerUnderPoint(x, y) {
	const over = dropTargetAt(x, y);
	for (const entry of dropTargets) entry.composerRoot.classList.toggle('is-drop-target', entry === over);
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
			const groupId = Number(parsed?.groupId);
			return {
				...(Number.isFinite(cid) && cid > 0 ? { creationId: cid } : {}),
				imageUrl,
				...(published ? { published: true } : {}),
				...(Number.isFinite(groupId) && groupId > 0 ? { groupId } : {}),
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
 *   onAttachImageUrl: (url: string, detail: { creationId?: number, groupId?: number, published?: boolean }) => void,
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
	const entry = { composerRoot, dropSurface, handlers };
	dropTargets.add(entry);

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
			groupId: parsed.groupId,
			published: parsed.published,
		});
	};

	dropSurface.addEventListener('dragenter', onDragEnter);
	dropSurface.addEventListener('dragleave', onDragLeave);
	dropSurface.addEventListener('dragover', onDragOver);
	dropSurface.addEventListener('drop', onDrop);

	return () => {
		dropTargets.delete(entry);
		dropSurface.removeEventListener('dragenter', onDragEnter);
		dropSurface.removeEventListener('dragleave', onDragLeave);
		dropSurface.removeEventListener('dragover', onDragOver);
		dropSurface.removeEventListener('drop', onDrop);
		composerRoot.classList.remove('is-drop-target');
	};
}
