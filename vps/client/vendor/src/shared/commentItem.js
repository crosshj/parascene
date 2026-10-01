/**
 * Shared comment avatar HTML. Used by creation-detail (comments + tips) and servers (Connect).
 */

function escapeHtml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/**
 * Build the comment avatar block HTML (link or div + img/initial/founder flair).
 * @param {{
 *   avatarUrl?: string,
 *   displayName: string,
 *   color: string,
 *   href?: string,
 *   isFounder?: boolean,
 *   flairSize?: 'sm' | 'xs'
 * }} options
 * @returns {string}
 */
export function renderCommentAvatarHtml(options) {
	const {
		avatarUrl = '',
		displayName,
		color,
		href = '',
		isFounder = false,
		flairSize = 'sm',
	} = options;

	const initial = (displayName || '?').charAt(0).toUpperCase();
	const safeName = escapeHtml(displayName || 'User');
	const innerContent = avatarUrl
		? `<img class="comment-avatar-img" src="${escapeHtml(avatarUrl)}" alt="">`
		: escapeHtml(initial);
	const innerStyle = `background: ${avatarUrl ? 'var(--surface-strong)' : color};`;
	const flairInner = isFounder
		? `<div class="avatar-with-founder-flair avatar-with-founder-flair--${flairSize}"><div class="founder-flair-avatar-ring"><div class="founder-flair-avatar-inner" style="${innerStyle}" aria-hidden="true">${innerContent}</div></div></div>`
		: innerContent;

	const wrapperStyle = !isFounder ? ` style="background: ${color};"` : '';
	if (href) {
		return `<a class="user-link user-avatar-link comment-avatar" href="${escapeHtml(href)}" aria-label="View ${safeName} profile"${wrapperStyle}>${flairInner}</a>`;
	}
	return `<div class="comment-avatar"${wrapperStyle}>${flairInner}</div>`;
}
