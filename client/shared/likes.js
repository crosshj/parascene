import { applyWhoTooltipAttr } from './whoLabels.js';
import { projectCreationEngagement, toggleCreationLike } from './creationEngagement.js';
import { setupWhoTooltips } from './reactionTooltipTap.js';

function getCreationLikeId(creation) {
	if (!creation) return null;

	const id = creation.created_image_id
		?? creation.creation_id
		?? creation.id
		?? creation.image_id
		?? creation.slug;

	if (id === null || id === undefined) return null;
	return String(id);
}

function toSafeInt(value, fallback = 0) {
	const n = Number.parseInt(String(value ?? ''), 10);
	return Number.isFinite(n) ? n : fallback;
}

export function getCreationBaseLikeCount(creation) {
	if (!creation) return 0;

	// Prefer API-like naming, but allow a few variants.
	if (creation.like_count !== undefined && creation.like_count !== null) {
		const full = Math.max(0, toSafeInt(creation.like_count, 0));
		// If API also provides viewer_liked, treat like_count as "full count"
		// and compute a base that excludes the viewer's own like so optimistic
		// toggles work and counts don't double-increment in detail views.
		if (typeof creation.viewer_liked === 'boolean') {
			return Math.max(0, full - (creation.viewer_liked ? 1 : 0));
		}
		return full;
	}

	if (creation.likeCount !== undefined && creation.likeCount !== null) {
		return Math.max(0, toSafeInt(creation.likeCount, 0));
	}

	if (creation.likes !== undefined && creation.likes !== null) {
		return Math.max(0, toSafeInt(creation.likes, 0));
	}

	return 0;
}

// What the UI should show given our local like state.
export function getCreationLikeCount(creation) {
	const base = getCreationBaseLikeCount(creation);
	return base + (isCreationLiked(creation) ? 1 : 0);
}

export function isCreationLiked(creation) {
	if (creation && typeof creation.viewer_liked === 'boolean') {
		return creation.viewer_liked;
	}

	return false;
}

export function setCreationLiked(creation, liked) {
	if (!creation) return false;
	creation.viewer_liked = Boolean(liked);
	return creation.viewer_liked;
}

export function toggleCreationLiked(creation) {
	if (!creation) return false;
	const next = !Boolean(creation.viewer_liked);
	creation.viewer_liked = next;
	return next;
}

export function applyLikeButtonState(buttonEl, liked, animate = false) {
	if (!(buttonEl instanceof HTMLElement)) return;

	buttonEl.setAttribute('aria-pressed', liked ? 'true' : 'false');
	buttonEl.classList.toggle('is-liked', Boolean(liked));

	if (!animate) return;

	// Restart animation even if clicked rapidly.
	buttonEl.classList.remove('is-like-animating');
	// eslint-disable-next-line no-unused-expressions
	buttonEl.offsetWidth;
	buttonEl.classList.add('is-like-animating');

	const svg = buttonEl.querySelector('svg');
	if (!(svg instanceof SVGElement)) return;

	svg.addEventListener('animationend', () => {
		buttonEl.classList.remove('is-like-animating');
	}, { once: true });
}

function getLikeCountEl(buttonEl) {
	if (!(buttonEl instanceof HTMLElement)) return null;

	const preferred = buttonEl.querySelector('[data-like-count]');
	if (preferred instanceof HTMLElement) return preferred;

	// Back-compat for existing markup (feed uses this class today)
	const fallback = buttonEl.querySelector('.feed-card-action-count');
	if (fallback instanceof HTMLElement) return fallback;

	return null;
}

function setDisplayedLikeCount(buttonEl, creation, likedOverride) {
	const countEl = getLikeCountEl(buttonEl);
	if (!countEl) return;

	const base = getCreationBaseLikeCount(creation);
	const liked = typeof likedOverride === 'boolean'
		? likedOverride
		: isCreationLiked(creation);
	const displayed = Math.max(0, base + (liked ? 1 : 0));
	countEl.textContent = String(displayed);
}

function applyLikedByTooltip(buttonEl, likedBy) {
	if (!(buttonEl instanceof HTMLElement)) return;
	// Whole control (heart + count) — matches feed comment-button hover target.
	applyWhoTooltipAttr(buttonEl, likedBy);
	const countEl = getLikeCountEl(buttonEl);
	if (countEl) {
		countEl.removeAttribute('data-tooltip');
		countEl.removeAttribute('data-who-tap');
		countEl.classList.remove('who-tooltip', 'is-tooltip-visible');
	}
	if (buttonEl.hasAttribute('data-tooltip')) {
		buttonEl.setAttribute('data-who-longpress', '1');
	} else {
		buttonEl.removeAttribute('data-who-longpress');
	}
}

const likeButtonCreations = new WeakMap();

export function initLikeButton(buttonEl, creation) {
	if (buttonEl && creation) likeButtonCreations.set(buttonEl, creation);
	if (!(buttonEl instanceof HTMLElement)) return false;
	const live = projectCreationEngagement({
		created_image_id: creation?.created_image_id ?? creation?.creation_id ?? creation?.id,
		like_count: creation?.like_count,
		viewer_liked: creation?.viewer_liked,
		liked_by: creation?.liked_by
	}, { incoming: true });
	if (creation && live) {
		creation.like_count = live.like_count;
		creation.viewer_liked = live.viewer_liked;
		if (Array.isArray(live.liked_by)) creation.liked_by = live.liked_by;
		creation.comment_count = live.comment_count;
		if (Array.isArray(live.commented_by)) creation.commented_by = live.commented_by;
	}

	const id = getCreationLikeId(creation);
	if (id) buttonEl.dataset.likeId = id;
	buttonEl.dataset.likeButton = 'true';
	buttonEl.dataset.likeBaseCount = String(getCreationBaseLikeCount(creation));
	const liked = isCreationLiked(creation);
	applyLikeButtonState(buttonEl, liked, false);
	setDisplayedLikeCount(buttonEl, creation, liked);
	applyLikedByTooltip(buttonEl, creation?.liked_by);
	return liked;
}

function showLikeSnapshot(buttonEl, snapshot) {
	const countEl = getLikeCountEl(buttonEl);
	const full = Math.max(0, Number(snapshot?.like_count) || 0);
	if (countEl) countEl.textContent = String(full);
	const liked = snapshot?.viewer_liked === true;
	buttonEl.dataset.likeBaseCount = String(Math.max(0, full - (liked ? 1 : 0)));
}

const rootsWithListener = new WeakSet();

export function enableLikeButtons(root = document) {
	const target = root instanceof Document ? root : (root instanceof HTMLElement ? root : null);
	if (!target) return;
	if (rootsWithListener.has(target)) return;
	rootsWithListener.add(target);

	setupWhoTooltips(target instanceof Document ? target.body || target.documentElement : target);

	target.addEventListener('click', (e) => {
		const el = e.target;
		if (!(el instanceof Element)) return;

		const button = el.closest('button[data-like-button], button[data-like-id]');
		if (!(button instanceof HTMLButtonElement)) return;

		const id = button.dataset.likeId;
		if (!id) return;

		if (button.dataset.likeBusy === '1') return;
		// Long-press who-tooltip just fired — don't toggle.
		if (button.dataset.whoLongPressSuppressClick === '1') return;

		e.preventDefault();
		e.stopPropagation();

		const shown = toSafeInt(getLikeCountEl(button)?.textContent, 0);
		const creation = likeButtonCreations.get(button) || {
			id,
			like_count: shown,
			viewer_liked: button.getAttribute('aria-pressed') === 'true'
		};
		const result = toggleCreationLike(creation);
		if (!result) return;

		showLikeSnapshot(button, result);
		applyLikeButtonState(button, result.viewer_liked, result.viewer_liked);
		button.dataset.likeBusy = '1';
		result.done.then((settled) => {
			if (!settled) return;
			showLikeSnapshot(button, settled);
			applyLikeButtonState(button, settled.viewer_liked, false);
			if (settled.ok) applyLikedByTooltip(button, settled.liked_by);
		}).finally(() => {
			delete button.dataset.likeBusy;
		});
	}, { capture: true });
}
