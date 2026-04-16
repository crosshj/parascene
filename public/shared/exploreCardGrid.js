/**
 * Shared explore-style creation grid cards (same markup as `app-route-explore`).
 */

import { formatDateTime, formatRelativeTime } from './datetime.js';
import { buildProfilePath } from './profileLinks.js';
import { processUserText, hydrateUserTextLinks } from './userText.js';
import { setRouteMediaBackgroundImage } from './routeMedia.js';
import { buildCreationCardShell } from './creationCard.js';

const html = String.raw;

/**
 * @param {HTMLElement} container
 * @param {object[]} items
 * @param {{
 *   startIndex?: number,
 *   eagerImageCount?: number,
 *   imageObserver?: IntersectionObserver | null,
 *   lowPriority?: boolean,
 * }} [options]
 */
export function appendExploreGridCards(container, items, options = {}) {
	if (!(container instanceof HTMLElement) || !Array.isArray(items)) return;

	const startIndex = typeof options.startIndex === 'number' && options.startIndex >= 0 ? options.startIndex : 0;
	const eagerImageCount =
		typeof options.eagerImageCount === 'number' && options.eagerImageCount >= 0 ? options.eagerImageCount : 6;
	const imageObserver = options.imageObserver || null;
	const lowPriority = options.lowPriority === true;

	items.forEach((item, i) => {
		if (!item || typeof item !== 'object') return;
		const card = document.createElement('div');
		card.className = 'route-card route-card-image';

		const authorUserName = typeof item.author_user_name === 'string' ? item.author_user_name.trim() : '';
		const authorUserId = item.user_id != null ? Number(item.user_id) : null;
		const profileHref = buildProfilePath({ userName: authorUserName, userId: authorUserId });
		const authorDisplayName = typeof item.author_display_name === 'string' ? item.author_display_name.trim() : '';
		const emailPrefix =
			typeof item.author === 'string' && item.author.includes('@') ? item.author.split('@')[0] : '';
		const authorLabel = authorDisplayName || authorUserName || emailPrefix || item.author || 'User';
		const handleText = authorUserName || emailPrefix || '';
		const handle = handleText ? `@${handleText}` : '';

		card.style.cursor = 'pointer';
		if (item.searchScore != null && Number.isFinite(Number(item.searchScore))) {
			card.title = `Score: ${Number(item.searchScore).toFixed(4)}`;
		}
		card.addEventListener('click', () => {
			if (item.created_image_id) {
				window.location.href = `/creations/${item.created_image_id}`;
			}
		});

		const detailsContent = html`
				<div class="route-title">${item.title != null ? item.title : 'Untitled'}</div>
				<div class="route-summary">${processUserText(item.summary != null ? item.summary : '')}</div>
				<div class="route-meta" title="${formatDateTime(item.created_at)}">${formatRelativeTime(item.created_at)}</div>
				<div class="route-meta">
					By ${profileHref ? html`<a class="user-link" href="${profileHref}" data-profile-link>${authorLabel}</a>` : authorLabel}${handle ? html` <span>(${handle})</span>` : ''}
				</div>
				<div class="route-meta route-meta-spacer"></div>
				<div class="route-tags">${processUserText(item.tags || '')}</div>`;
		const mediaType = typeof item.media_type === 'string' ? item.media_type : 'image';
		const mediaAttrs = {
			'data-image-id': item.created_image_id ?? '',
			'data-status': 'completed',
		};
		if (mediaType === 'video') {
			mediaAttrs['data-media-type'] = 'video';
		}
		card.innerHTML = buildCreationCardShell({
			mediaAttrs,
			detailsContentHtml: detailsContent,
			nsfw: Boolean(item.nsfw),
		});

		if (typeof hydrateUserTextLinks === 'function') {
			hydrateUserTextLinks(card);
		}

		const mediaEl = card.querySelector('.route-media');
		const url = item.thumbnail_url || item.image_url;
		if (mediaEl && url) {
			mediaEl.dataset.bgUrl = url;
			mediaEl.dataset.bgQueued = '0';
			const index = startIndex + i;
			if (index < eagerImageCount) {
				void setRouteMediaBackgroundImage(mediaEl, url, { lowPriority });
			} else if (imageObserver) {
				imageObserver.observe(mediaEl);
			}
		}

		const profileLink = card.querySelector('[data-profile-link]');
		if (profileLink) {
			profileLink.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				window.location.href = profileLink.getAttribute('href') || '#';
			});
		}

		container.appendChild(card);
	});
}
