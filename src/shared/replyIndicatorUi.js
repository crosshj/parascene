import { renderCommentAvatarHtml } from './commentItem.js';
import { getAvatarColor } from './avatar.js';
import { buildProfilePath } from './profileLinks.js';

const MSG_REPLY_JUMP_FLASH_CLASS = 'msg-reply-jump-flash';
const msgReplyJumpFlashAbortByEl = new WeakMap();

/**
 * Scroll overflow ancestors (chat pane, page) so `target` lands in view. `nearest` often no-ops inside
 * tall `[data-chat-messages]`; align with chat first-unread (center + rAF relayout retries).
 * @param {Element} target
 */
function scrollReplyJumpTargetIntoView(target) {
	const opts = { block: 'center', behavior: 'smooth', inline: 'nearest' };
	const run = () => target.scrollIntoView(opts);
	run();
	requestAnimationFrame(() => {
		run();
		requestAnimationFrame(run);
	});
}

/**
 * @param {Record<string, unknown>} reply meta.reply-shaped object from API (or optimistic copy)
 * @param {boolean} replyParentExists
 * @param {{ kind: 'chat' | 'comment', flairSize?: 'sm' | 'xs', omitAvatar?: boolean }} opts
 */
export function createReplyIndicatorElement(reply, replyParentExists, opts = {}) {
	const kind = opts?.kind === 'comment' ? 'comment' : 'chat';
	const flairSize = opts?.flairSize === 'xs' ? 'xs' : 'sm';
	const omitAvatar = opts?.omitAvatar === true;
	const refId = reply?.referenced_id != null ? Number(reply.referenced_id) : NaN;
	const preview =
		reply?.preview_text != null && typeof reply.preview_text === 'string'
			? reply.preview_text.trim().slice(0, 280)
			: '';
	const handleRaw =
		reply?.sender_user_name != null ? String(reply.sender_user_name).trim().slice(0, 64) : '';
	const senderNumeric = reply?.sender_id != null ? Number(reply.sender_id) : NaN;
	const displayFallback =
		handleRaw || (Number.isFinite(senderNumeric) ? `User ${senderNumeric}` : 'User');

	const avatarUrl =
		reply?.sender_avatar_url != null ? String(reply.sender_avatar_url).trim().slice(0, 4096) : '';
	const founder = reply?.sender_plan === 'founder';
	const profileHref = handleRaw ? buildProfilePath({ userName: handleRaw }) : '';

	const unreachable = replyParentExists === false;
	const row = document.createElement('div');
	row.className = `msg-reply-indicator${unreachable ? ' msg-reply-indicator--unreachable' : ''}`;
	row.setAttribute('role', 'group');
	row.dataset.replyKind = kind;
	if (Number.isFinite(refId) && refId > 0) {
		row.dataset.replyReferencedId = String(refId);
	}

	if (omitAvatar) {
		row.classList.add('msg-reply-indicator--compact');
	}

	const control = replyParentExists
		? document.createElement('button')
		: document.createElement('div');
	control.className = 'msg-reply-indicator-inner';
	if (replyParentExists) {
		control.type = 'button';
		const noun = kind === 'comment' ? 'comment' : 'message';
		const label = preview
			? `Jump to ${noun} from ${displayFallback}: ${preview}`
			: `Jump to ${noun} from ${displayFallback}`;
		control.setAttribute('aria-label', label);
	} else {
		control.setAttribute(
			'aria-label',
			kind === 'comment' ? 'Referenced comment is no longer available' : 'Referenced message is no longer available'
		);
	}

	if (!omitAvatar) {
		const avatarSlot = document.createElement('div');
		avatarSlot.className = 'msg-reply-indicator-avatar';
		avatarSlot.innerHTML = renderCommentAvatarHtml({
			avatarUrl,
			displayName: displayFallback,
			color: getAvatarColor(handleRaw || String(refId) || displayFallback),
			href: profileHref || undefined,
			isFounder: founder,
			flairSize
		});
		control.appendChild(avatarSlot);
	} else {
		const mark = document.createElement('span');
		mark.className = 'msg-reply-indicator-target-mark';
		mark.setAttribute('aria-hidden', 'true');
		control.appendChild(mark);
	}

	const textCol = document.createElement('div');
	textCol.className = 'msg-reply-indicator-text';

	const top = document.createElement('div');
	top.className = 'msg-reply-indicator-top';
	const nameEl = document.createElement('span');
	nameEl.className = `msg-reply-indicator-name${founder ? ' founder-name' : ''}`;
	nameEl.textContent = handleRaw ? `@${handleRaw}` : displayFallback;

	const badge = document.createElement('span');
	badge.className = 'msg-reply-indicator-badge';
	badge.textContent = unreachable ? 'Unavailable' : 'Reply to';
	top.appendChild(nameEl);
	top.appendChild(badge);

	const prev = document.createElement('div');
	prev.className = 'msg-reply-indicator-preview';
	prev.textContent =
		preview ||
		(unreachable ? (kind === 'comment' ? 'Original comment was removed.' : 'Original message was removed.') : '');

	textCol.appendChild(top);
	textCol.appendChild(prev);

	control.appendChild(textCol);
	row.appendChild(control);

	if (replyParentExists && Number.isFinite(refId) && refId > 0) {
		control.addEventListener('click', (e) => {
			e.preventDefault();
			const sel =
				kind === 'comment'
					? `[data-comment-id="${refId}"]`
					: `.connect-chat-msg[data-chat-message-id="${refId}"]`;
			const target = document.querySelector(sel);
			if (target) {
				scrollReplyJumpTargetIntoView(target);
				const prevAbort = msgReplyJumpFlashAbortByEl.get(target);
				if (prevAbort) prevAbort.abort();
				const ac = new AbortController();
				msgReplyJumpFlashAbortByEl.set(target, ac);
				target.classList.remove(MSG_REPLY_JUMP_FLASH_CLASS);
				void target.offsetWidth;
				target.classList.add(MSG_REPLY_JUMP_FLASH_CLASS);
				target.addEventListener(
					'animationend',
					(ev) => {
						if (ev.target !== target || ev.animationName !== MSG_REPLY_JUMP_FLASH_CLASS) return;
						target.classList.remove(MSG_REPLY_JUMP_FLASH_CLASS);
						if (msgReplyJumpFlashAbortByEl.get(target) === ac) {
							msgReplyJumpFlashAbortByEl.delete(target);
						}
					},
					{ signal: ac.signal }
				);
			}
		});
	}

	return row;
}
