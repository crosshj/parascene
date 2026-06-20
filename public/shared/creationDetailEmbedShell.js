/**
 * Creation detail embed iframe ↔ overlay shell sync.
 * Iframe posts `prsn-creation-detail-overlay-shell-sync`; parent dispatches
 * `prsn-creation-detail-overlay-shell-sync` for lane components to handle.
 */

import { publishedBadgeHtml } from './creationBadges.js';

export const CREATION_DETAIL_SHELL_SYNC_MESSAGE = 'prsn-creation-detail-overlay-shell-sync';
export const CREATION_DETAIL_SHELL_SYNC_EVENT = 'prsn-creation-detail-overlay-shell-sync';

/** @typedef {'published'|'unpublished'|'edited'|'deleted'|'refreshed'|'status-changed'} CreationDetailShellSyncReason */

export const CREATION_DETAIL_SHELL_SCOPE = {
	CREATIONS: 'creations',
	FEED: 'feed',
	EXPLORE: 'explore',
	CHAT_CREATIONS: 'chat-creations',
	CHAT_FEED: 'chat-feed',
	CHAT_EXPLORE: 'chat-explore',
	CREATION: 'creation',
};

const ALL_LANE_SCOPES = [
	CREATION_DETAIL_SHELL_SCOPE.CREATIONS,
	CREATION_DETAIL_SHELL_SCOPE.FEED,
	CREATION_DETAIL_SHELL_SCOPE.EXPLORE,
	CREATION_DETAIL_SHELL_SCOPE.CHAT_CREATIONS,
	CREATION_DETAIL_SHELL_SCOPE.CHAT_FEED,
	CREATION_DETAIL_SHELL_SCOPE.CHAT_EXPLORE,
	CREATION_DETAIL_SHELL_SCOPE.CREATION,
];

/**
 * @param {CreationDetailShellSyncReason|string} reason
 * @returns {string[]}
 */
export function defaultScopesForCreationShellSyncReason(reason) {
	const r = String(reason || '').trim();
	switch (r) {
		case 'published':
		case 'unpublished':
		case 'deleted':
			return ALL_LANE_SCOPES.slice();
		case 'edited':
			return [
				CREATION_DETAIL_SHELL_SCOPE.CREATIONS,
				CREATION_DETAIL_SHELL_SCOPE.CHAT_CREATIONS,
				CREATION_DETAIL_SHELL_SCOPE.CREATION,
			];
		case 'profile-updated':
			return [
				CREATION_DETAIL_SHELL_SCOPE.CREATIONS,
				CREATION_DETAIL_SHELL_SCOPE.CREATION,
			];
		case 'status-changed':
			return [
				CREATION_DETAIL_SHELL_SCOPE.CREATIONS,
				CREATION_DETAIL_SHELL_SCOPE.CHAT_CREATIONS,
				CREATION_DETAIL_SHELL_SCOPE.CREATION,
			];
		default:
			return [
				CREATION_DETAIL_SHELL_SCOPE.CREATIONS,
				CREATION_DETAIL_SHELL_SCOPE.CREATION,
			];
	}
}

/**
 * @param {unknown} scopes
 * @returns {string[]}
 */
export function normalizeCreationDetailShellSyncScopes(scopes) {
	if (!Array.isArray(scopes)) return [];
	const out = [];
	for (const raw of scopes) {
		const s = String(raw || '').trim();
		if (!s || out.includes(s)) continue;
		out.push(s);
	}
	return out;
}

/**
 * @param {unknown} payload
 * @returns {{ creationId: number, reason: string, scopes: string[] } | null}
 */
export function normalizeCreationDetailShellSyncDetail(payload) {
	if (!payload || typeof payload !== 'object') return null;
	const creationId = Number(payload.creationId);
	if (!Number.isFinite(creationId) || creationId <= 0) return null;
	const reason = String(payload.reason || 'refreshed').trim() || 'refreshed';
	let scopes = normalizeCreationDetailShellSyncScopes(payload.scopes);
	if (!scopes.length) {
		scopes = defaultScopesForCreationShellSyncReason(reason);
	}
	return { creationId, reason, scopes };
}

/**
 * @param {{ creationId?: number|string, reason?: CreationDetailShellSyncReason|string, scopes?: string[] }} [options]
 * @returns {boolean}
 */
export function notifyCreationDetailEmbedShellSync(options = {}) {
	if (typeof window === 'undefined') return false;
	if (window.__ps_creation_detail_embed !== true || window.parent === window) return false;
	const creationId = Number(options.creationId);
	if (!Number.isFinite(creationId) || creationId <= 0) return false;
	const reason = String(options.reason || 'refreshed').trim() || 'refreshed';
	const scopes = normalizeCreationDetailShellSyncScopes(options.scopes);
	const detail = normalizeCreationDetailShellSyncDetail({
		creationId,
		reason,
		scopes: scopes.length ? scopes : defaultScopesForCreationShellSyncReason(reason),
	});
	if (!detail) return false;
	try {
		window.parent.postMessage(
			{
				type: CREATION_DETAIL_SHELL_SYNC_MESSAGE,
				creationId: detail.creationId,
				reason: detail.reason,
				scopes: detail.scopes,
			},
			window.location.origin
		);
		return true;
	} catch {
		return false;
	}
}

/** @param {unknown} root */
function resolveDomPatchRoot(root) {
	if (root && typeof root.querySelectorAll === 'function') return root;
	return document;
}

/**
 * @param {unknown} payload
 * @param {Document | Element | DocumentFragment} [root]
 */
export function removeCreationCardsFromDocument(creationId, root = document) {
	const id = String(creationId);
	if (!id) return;
	const scopeRoot = resolveDomPatchRoot(root);
	scopeRoot.querySelectorAll(`.feed-card[data-creation-id="${id}"]`).forEach((el) => el.remove());
	scopeRoot.querySelectorAll(`.feed-card[data-image-id="${id}"]`).forEach((el) => el.remove());
	scopeRoot.querySelectorAll(`.route-card[data-image-id="${id}"]`).forEach((el) => el.remove());
}

/**
 * @param {number|string} creationId
 * @param {boolean} published
 * @param {Document | Element | DocumentFragment} [root]
 */
export function patchCreationCardPublishedInDocument(creationId, published, root = document) {
	const id = String(creationId);
	if (!id) return;
	const val = published ? '1' : '0';
	const scopeRoot = resolveDomPatchRoot(root);
	scopeRoot
		.querySelectorAll(
			`.route-card[data-image-id="${id}"], .feed-card[data-creation-id="${id}"], .feed-card[data-image-id="${id}"]`
		)
		.forEach((card) => {
			if (!(card instanceof HTMLElement)) return;
			card.dataset.published = val;
			const badges = card.querySelectorAll('.creation-published-badge');
			if (published) {
				if (badges.length === 0) {
					const media = card.querySelector('.route-media');
					if (media instanceof HTMLElement) {
						media.insertAdjacentHTML('afterend', publishedBadgeHtml());
					}
				}
				return;
			}
			badges.forEach((el) => el.remove());
		});
}

/**
 * @param {{ creationId: number, reason: string, scopes: string[] }} detail
 * @param {Document | Element | DocumentFragment} [root]
 */
export function applyCreationDetailShellSyncDomPatches(detail, root = document) {
	if (!detail || typeof detail !== 'object') return;
	const { creationId, reason } = detail;
	if (reason === 'deleted') {
		removeCreationCardsFromDocument(creationId, root);
		return;
	}
	if (reason === 'published') {
		patchCreationCardPublishedInDocument(creationId, true, root);
		return;
	}
	if (reason === 'unpublished') {
		patchCreationCardPublishedInDocument(creationId, false, root);
		removePublicLaneCreationCardsFromDocument(creationId, root);
	}
}

/**
 * Remove a creation from public lanes (feed / explore), not My Creations.
 * @param {unknown} creationId
 * @param {Document | Element | DocumentFragment} [root]
 */
export function removePublicLaneCreationCardsFromDocument(creationId, root = document) {
	const id = String(creationId);
	if (!id) return;
	const scopeRoot = resolveDomPatchRoot(root);
	scopeRoot.querySelectorAll(`.feed-card[data-creation-id="${id}"]`).forEach((el) => el.remove());
	scopeRoot.querySelectorAll(`.feed-card[data-image-id="${id}"]`).forEach((el) => el.remove());
	scopeRoot.querySelectorAll(`.explore-route .route-card[data-image-id="${id}"]`).forEach((el) => el.remove());
}

/**
 * @param {unknown} detail
 * @param {...string} scopeNames
 * @returns {boolean}
 */
export function creationDetailShellSyncHasScope(detail, ...scopeNames) {
	const scopes = normalizeCreationDetailShellSyncScopes(detail?.scopes);
	if (!scopes.length || !scopeNames.length) return false;
	return scopeNames.some((name) => scopes.includes(String(name || '').trim()));
}

/**
 * Parent overlay: normalize payload, patch DOM, dispatch document event for lanes.
 * @param {unknown} payload
 */
export function applyCreationDetailEmbedShellSync(payload) {
	const detail = normalizeCreationDetailShellSyncDetail(payload);
	if (!detail) return;
	applyCreationDetailShellSyncDomPatches(detail);
	try {
		document.dispatchEvent(
			new CustomEvent(CREATION_DETAIL_SHELL_SYNC_EVENT, {
				detail,
			})
		);
	} catch {
		// ignore
	}
}
