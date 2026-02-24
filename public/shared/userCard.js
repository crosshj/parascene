/**
 * Shared user list row HTML. Used by user-profile (follows/following lists).
 */

import { getAvatarColor } from './avatar.js';
import { buildProfilePath } from './profileLinks.js';

const html = String.raw;

function escapeHtml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/**
 * Build one user list row HTML (avatar + name + handle + optional follow/unfollow).
 * Uses .user-profile-list-* classes; styles live in user-profile.css.
 * @param {{ user_id?: number, id?: number, display_name?: string, user_name?: string, avatar_url?: string }} user
 * @param {{ showUnfollow?: boolean, showFollow?: boolean, viewerFollowsByUserId?: Set<number>|Record<number, boolean>, viewerUserId?: number|null }} options
 * @returns {string} HTML for the contents of one <li class="user-profile-list-item"> (link + optional buttons)
 */
export function buildUserListRowHtml(user, options = {}) {
	const {
		showUnfollow = false,
		showFollow = false,
		viewerFollowsByUserId = new Set(),
		viewerUserId = null,
	} = options;

	const id = user?.user_id ?? user?.id;
	const name = (user?.display_name || user?.user_name || '').trim() || 'User';
	const handle = user?.user_name ? `@${user.user_name}` : '';
	const avatarUrl = typeof user?.avatar_url === 'string' ? user.avatar_url.trim() : '';
	const color = getAvatarColor(user?.user_name || user?.user_id || name);
	const initial = name.charAt(0).toUpperCase() || '?';
	const href = buildProfilePath({ userName: user?.user_name, userId: id }) || '#';

	const avatarContent = avatarUrl
		? html`<img class="user-profile-list-avatar-img" src="${escapeHtml(avatarUrl)}" alt="">`
		: html`<div class="user-profile-list-avatar-fallback" style="--user-profile-avatar-bg: ${color};" aria-hidden="true">${escapeHtml(initial)}</div>`;

	const viewerFollows = (uid) => viewerFollowsByUserId instanceof Set
		? viewerFollowsByUserId.has(uid)
		: Boolean(viewerFollowsByUserId[uid]);
	const isSelf = (uid) => viewerUserId != null && Number(uid) === Number(viewerUserId);
	const hideActions = isSelf(id);
	const showUnfollowBtn = showUnfollow && id != null && !hideActions;
	const showFollowBtn = showFollow && id != null && !viewerFollows(Number(id)) && !hideActions;

	return html`<a href="${escapeHtml(href)}" class="user-profile-list-link">
		<span class="user-profile-list-avatar">${avatarContent}</span>
		<span class="user-profile-list-info">
			<span class="user-profile-list-name">${escapeHtml(name)}</span>
			${handle ? html`<span class="user-profile-list-handle">${escapeHtml(handle)}</span>` : ''}
		</span>
	</a>
	${showUnfollowBtn ? html`<button type="button" class="btn-secondary user-profile-list-action" data-action="unfollow" data-user-id="${escapeHtml(String(id ?? ''))}">Unfollow</button>` : ''}
	${showFollowBtn ? html`<button type="button" class="btn-secondary user-profile-list-action" data-action="follow" data-user-id="${escapeHtml(String(id ?? ''))}">Follow</button>` : ''}`;
}
