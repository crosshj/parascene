/**
 * Single "Connect / Latest comments" row: thumbnail, creation title + creator, comment text,
 * reactions, commenter footer. Shared by Connect tab and chat #comments pseudo-channel.
 */

import { formatRelativeTime } from './datetime.js';
import { getAvatarColor } from './avatar.js';
import { buildProfilePath } from './profileLinks.js';
import { renderCommentAvatarHtml } from './commentItem.js';
import { processUserText } from './userText.js';
import { REACTION_ORDER, REACTION_ICONS } from '../icons/svg-strings.js';

function escapeHtml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/**
 * @param {object} comment — row from GET /api/comments/latest (plus reactions from API)
 * @param {{ extraRootClass?: string }} [opts]
 * @returns {HTMLDivElement}
 */
export function createConnectCommentRowElement(comment, opts = {}) {
	const extraRootClass = typeof opts.extraRootClass === 'string' ? opts.extraRootClass.trim() : '';

	const createdImageId = Number(comment?.created_image_id);
	const href = (Number.isFinite(createdImageId) && createdImageId > 0) ? `/creations/${createdImageId}` : null;

	const displayName = (typeof comment?.display_name === 'string' && comment.display_name.trim())
		? comment.display_name.trim()
		: '';
	const userName = (typeof comment?.user_name === 'string' && comment.user_name.trim())
		? comment.user_name.trim()
		: '';
	const fallbackName = userName ? userName : 'User';
	const commenterName = displayName || fallbackName;
	const commenterHandle = userName ? `@${userName}` : '';

	const createdImageTitle = (typeof comment?.created_image_title === 'string' && comment.created_image_title.trim())
		? comment.created_image_title.trim()
		: (Number.isFinite(createdImageId) && createdImageId > 0 ? `Creation ${createdImageId}` : 'Creation');

	const creatorDisplayName = (typeof comment?.created_image_display_name === 'string' && comment.created_image_display_name.trim())
		? comment.created_image_display_name.trim()
		: '';
	const creatorUserName = (typeof comment?.created_image_user_name === 'string' && comment.created_image_user_name.trim())
		? comment.created_image_user_name.trim()
		: '';

	const row = document.createElement('div');
	const rootClasses = ['connect-comment'];
	if (extraRootClass) {
		rootClasses.push(extraRootClass);
	}
	if (!href) {
		rootClasses.push('is-disabled');
	}
	row.className = rootClasses.join(' ');
	if (href) {
		row.setAttribute('role', 'link');
		row.tabIndex = 0;
		row.dataset.href = href;
		row.setAttribute('aria-label', `Open creation ${createdImageTitle}`);
		row.addEventListener('click', (e) => {
			const target = e.target;
			if (target instanceof HTMLElement && target.closest('a')) return;
			window.location.href = href;
		});
		row.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				window.location.href = href;
			}
		});
	}

	const thumbWrap = document.createElement('div');
	thumbWrap.className = `connect-comment-thumb${comment.nsfw ? ' nsfw' : ''}`;
	if (comment.created_image_media_type === 'video') {
		thumbWrap.setAttribute('data-media-type', 'video');
	}
	thumbWrap.setAttribute('aria-hidden', 'true');
	const thumbUrl = typeof comment?.created_image_thumbnail_url === 'string' ? comment.created_image_thumbnail_url.trim() : '';
	const imageUrl = typeof comment?.created_image_url === 'string' ? comment.created_image_url.trim() : '';
	const resolvedThumb = thumbUrl || imageUrl || '';
	if (resolvedThumb) {
		const img = document.createElement('img');
		img.src = resolvedThumb;
		img.alt = '';
		img.loading = 'lazy';
		img.decoding = 'async';
		img.className = 'connect-comment-thumb-img';
		thumbWrap.appendChild(img);
	}

	const creationTitle = document.createElement('div');
	creationTitle.className = 'connect-comment-creation-title';
	creationTitle.textContent = createdImageTitle;

	const creatorRow = document.createElement('div');
	creatorRow.className = 'connect-comment-creator';

	const creatorId = Number(comment?.created_image_user_id ?? 0);
	const creatorProfileHref = buildProfilePath({ userName: creatorUserName, userId: creatorId });
	const creatorName = creatorDisplayName || (creatorUserName ? creatorUserName : 'User');
	const creatorHandle = creatorUserName ? `@${creatorUserName}` : '';
	const creatorSeed = creatorUserName || String(creatorId || '') || creatorName;
	const creatorColor = getAvatarColor(creatorSeed);
	const creatorAvatarUrl = typeof comment?.created_image_avatar_url === 'string' ? comment.created_image_avatar_url.trim() : '';
	const creatorPlan = comment?.created_image_owner_plan === 'founder';
	const creatorAvatarHtml = renderCommentAvatarHtml({
		avatarUrl: creatorAvatarUrl,
		displayName: creatorName,
		color: creatorColor,
		href: creatorProfileHref,
		isFounder: creatorPlan,
		flairSize: 'xs',
	});

	creatorRow.innerHTML = `
		<div class="connect-comment-creator-left">
			${creatorAvatarHtml}
			<div class="connect-comment-creator-who">
				<span class="comment-author-name${creatorPlan ? ' founder-name' : ''}">${escapeHtml(creatorName)}</span>
				${creatorHandle ? `<span class="comment-author-handle${creatorPlan ? ' founder-name' : ''}">${escapeHtml(creatorHandle)}</span>` : ''}
			</div>
		</div>
	`;

	const commenterId = Number(comment?.user_id ?? 0);
	const profileHref = buildProfilePath({ userName, userId: commenterId });
	const seed = userName || String(comment?.user_id ?? '') || commenterName;
	const color = getAvatarColor(seed);
	const avatarUrl = typeof comment?.avatar_url === 'string' ? comment.avatar_url.trim() : '';
	const commenterPlan = comment?.plan === 'founder';
	const avatarHtml = renderCommentAvatarHtml({
		avatarUrl,
		displayName: commenterName,
		color,
		href: profileHref,
		isFounder: commenterPlan,
		flairSize: 'xs',
	});

	const timeAgo = comment?.created_at ? (formatRelativeTime(comment.created_at) || '') : '';
	const safeText = processUserText(comment?.text ?? '');

	const commentText = document.createElement('div');
	commentText.className = 'comment-text';
	commentText.innerHTML = safeText;

	const reactions = comment?.reactions && typeof comment.reactions === 'object' ? comment.reactions : {};
	let chipsWithCount = [];
	let reactionsEl = null;
	try {
		chipsWithCount = Array.isArray(REACTION_ORDER) ? REACTION_ORDER.filter((key) => {
			const arr = Array.isArray(reactions[key]) ? reactions[key] : [];
			const last = arr[arr.length - 1];
			const others = typeof last === 'number' ? last : 0;
			const strings = typeof last === 'number' ? arr.slice(0, -1) : arr;
			return strings.length + others > 0;
		}) : [];
	} catch (e) {
		console.error('[connectCommentCard] Error filtering reaction chips:', e);
	}
	if (chipsWithCount.length > 0) {
		reactionsEl = document.createElement('div');
		reactionsEl.className = 'comment-reactions comment-reactions-readonly';
		try {
			const pillsHtml = chipsWithCount.map((key) => {
				const arr = Array.isArray(reactions[key]) ? reactions[key] : [];
				const last = arr[arr.length - 1];
				const others = typeof last === 'number' ? last : 0;
				const strings = (typeof last === 'number' ? arr.slice(0, -1) : arr).filter((s) => typeof s === 'string');
				const count = strings.length + others;
				const countLabel = count > 99 ? '99+' : String(count);
				const tooltip = strings.length > 0 || others > 0
					? [...strings, others > 0 ? `and ${others} ${others === 1 ? 'other' : 'others'}` : ''].filter(Boolean).join(', ')
					: '';
				const iconFn = REACTION_ICONS?.[key];
				const iconHtml = (typeof iconFn === 'function' ? iconFn('comment-reaction-icon') : '') || '';
				const tooltipAttr = tooltip ? ` data-tooltip="${escapeHtml(tooltip)}"` : '';
				return `<span class="comment-reaction-pill" aria-label="${escapeHtml(key)}: ${escapeHtml(countLabel)}"${tooltipAttr}><span class="comment-reaction-icon-wrap" aria-hidden="true">${iconHtml}</span><span class="comment-reaction-count">${escapeHtml(countLabel)}</span></span>`;
			}).join('');
			reactionsEl.innerHTML = `<div class="comment-reaction-pills"><div class="comment-reaction-pills-inner">${pillsHtml}</div></div>`;
		} catch (e) {
			console.error('[connectCommentCard] Error rendering reaction chips for comment:', comment?.id, e);
		}
	}

	const footer = document.createElement('div');
	footer.className = 'connect-comment-footer';
	footer.innerHTML = `
		<div class="connect-comment-footer-left">
			${avatarHtml}
			<div class="connect-comment-footer-who">
				<span class="connect-comment-footer-name-handle-time">
					<span class="comment-author-name${commenterPlan ? ' founder-name' : ''}">${escapeHtml(commenterName)}</span>
					${commenterHandle ? `<span class="comment-author-handle${commenterPlan ? ' founder-name' : ''}">${escapeHtml(commenterHandle)}</span>` : ''}
					${timeAgo ? `<span class="comment-time">&nbsp;·&nbsp;${escapeHtml(timeAgo)}</span>` : ''}
				</span>
			</div>
		</div>
	`;

	row.appendChild(thumbWrap);
	row.appendChild(creationTitle);
	row.appendChild(creatorRow);
	row.appendChild(commentText);
	row.appendChild(footer);
	if (reactionsEl?.innerHTML) {
		row.classList.add('has-reactions');
		row.appendChild(reactionsEl);
	}

	return row;
}
