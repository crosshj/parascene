import markup from './MessageRow.html';
import { createTemplateFactory } from '../../utils/dom.js';
// Active WWW SPA message builders, ported into the shared VPS messages component.
import { processUserText } from '../../shared/userText.js';
import { formatRelativeTime } from '../../shared/datetime.js';
import { renderCommentAvatarHtml } from '../../shared/commentItem.js';
import { getAvatarColor } from '../../shared/avatar.js';
import { buildProfilePath } from '../../shared/profileLinks.js';
import { createReplyIndicatorElement } from '../../shared/replyIndicatorUi.js';
import { formatWhoTooltip } from '../../shared/whoLabels.js';
import { REACTION_ORDER, REACTION_ICONS, smileIcon, replyTurnIcon, pencilIcon, copyIcon, trashIcon, pinIcon } from '../../icons/svg-strings.js';

const clone = createTemplateFactory(markup);

const CHAT_MESSAGE_GROUP_GAP_MS = 7 * 60 * 1000;
const CHAT_HOVER_QUICK_REACTION_KEYS = REACTION_ORDER.slice(0, 3);
const activePseudoChannelSlug = '';
const activeThreadPinnedMessageId = null;
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]); }

export function parseChatMessageCreatedMs(m) {
	if (!m || m.created_at == null) return NaN;
	const t = Date.parse(String(m.created_at));
	return Number.isFinite(t) ? t : NaN;
}

export function isChannelInviteSystemBoundaryMessage(m) {
	const meta = m?.meta;
	const systemEventRaw =
		meta && typeof meta === 'object' && !Array.isArray(meta) ? meta.system_event : null;
	const systemEvent =
		systemEventRaw && typeof systemEventRaw === 'object' && !Array.isArray(systemEventRaw)
			? systemEventRaw
			: null;
	if (String(systemEvent?.kind || '').trim().toLowerCase() === 'channel_invite_sent') return true;
	const bodyTextRaw = String(m?.body ?? '').trim();
	return (
		Boolean(bodyTextRaw) &&
		/^\s*@?[a-z0-9_]+\s+invited\s+@?[a-z0-9_]+(?:\s*,\s*@?[a-z0-9_]+)*\s+to the channel\s*$/i.test(
			bodyTextRaw
		)
	);
}

export function isChatMessageGroupContinue(prev, current) {
	if (prev == null || current == null) return false;
	if (isChannelInviteSystemBoundaryMessage(prev) || isChannelInviteSystemBoundaryMessage(current)) {
		return false;
	}
	if (Number(prev.sender_id) !== Number(current.sender_id)) return false;
	const prevMs = parseChatMessageCreatedMs(prev);
	const curMs = parseChatMessageCreatedMs(current);
	if (!Number.isFinite(prevMs) || !Number.isFinite(curMs)) return false;
	const delta = curMs - prevMs;
	if (delta < 0) return false;
	return delta <= CHAT_MESSAGE_GROUP_GAP_MS;
}

export function getChatCanvasMetaFromMessage(m) {
	const meta = m?.meta;
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
	const canvas = meta.canvas;
	if (!canvas || typeof canvas !== 'object') return null;
	const title = typeof canvas.title === 'string' ? canvas.title.trim() : '';
	if (!title) return null;
	return { title };
}

export function messageRowSupportsReply(m) {
		if (!m || m.id == null) return false;
		const systemEventRaw =
			m?.meta && typeof m.meta === 'object' && !Array.isArray(m.meta) ? m.meta.system_event : null;
		const systemEvent =
			systemEventRaw && typeof systemEventRaw === 'object' && !Array.isArray(systemEventRaw)
				? systemEventRaw
				: null;
		const isLegacyInviteSystemLine = isChannelInviteSystemBoundaryMessage(m);
		const isChannelInviteSystemEvent =
			String(systemEvent?.kind || '').trim().toLowerCase() === 'channel_invite_sent';
		if (isChannelInviteSystemEvent || isLegacyInviteSystemLine) return false;
		if (getChatCanvasMetaFromMessage(m)) return false;
		const timedMetaRaw =
			m?.meta && typeof m.meta === 'object' && !Array.isArray(m.meta) ? m.meta.time_sensitive : null;
		const timedMeta =
			timedMetaRaw && typeof timedMetaRaw === 'object' && !Array.isArray(timedMetaRaw)
				? timedMetaRaw
				: null;
		if (timedMeta && String(timedMeta.kind || '').trim().toLowerCase() === 'channel_invite') {
			return false;
		}
		return true;
	}

export function getChatMessageEditedAt(m) {
		const meta = m?.meta;
		if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return '';
		const raw = meta.edited_at;
		if (typeof raw !== 'string') return '';
		const t = raw.trim();
		return t || '';
	}

export function buildChatMessageEditedLabelElement(m) {
		if (!getChatMessageEditedAt(m)) return null;
		const inline = document.createElement('span');
		inline.className = 'connect-chat-msg-edited-inline';
		inline.textContent = ' (edited)';
		return inline;
	}

export function buildConnectChatMsgMetaElement(m, opts = {}) {
		if (!m || typeof m !== 'object') return null;
		const viewerId = opts.viewerId != null ? Number(opts.viewerId) : null;
		const senderId = Number(m.sender_id);
		const isSelf = Number.isFinite(viewerId) && Number.isFinite(senderId) && senderId === viewerId;
		const handleRaw = m.sender_user_name != null ? String(m.sender_user_name).trim() : '';
		const handleLabel = handleRaw ? `@${handleRaw}` : isSelf ? 'You' : `User ${senderId}`;
		const when = m.created_at ? formatRelativeTime(m.created_at) || '' : '';
		const displayForAvatar = handleRaw || (isSelf ? 'You' : `User ${senderId}`);
		const profileHref = buildProfilePath({
			userName: handleRaw || undefined,
			userId: Number.isFinite(senderId) ? senderId : undefined,
		});
		const senderIsFounder = m.sender_plan === 'founder';

		const metaLine = clone('meta');
		const avatarWrap = document.createElement('div');
		avatarWrap.innerHTML = renderCommentAvatarHtml({
			avatarUrl: m.sender_avatar_url || '',
			displayName: displayForAvatar,
			color: getAvatarColor(handleRaw || String(Number.isFinite(senderId) ? senderId : 'user')),
			href: profileHref || undefined,
			isFounder: senderIsFounder,
			flairSize: 'sm',
		});
		while (avatarWrap.firstChild) metaLine.appendChild(avatarWrap.firstChild);

		const textSpan = metaLine.querySelector('.connect-chat-msg-meta-text');
		const nameSpan = textSpan.firstElementChild;
		nameSpan.className = `comment-author-name${senderIsFounder ? ' founder-name' : ''}`;
		nameSpan.textContent = handleLabel;
		if (profileHref) {
			const nameLink = document.createElement('a');
			nameLink.className = 'user-link connect-chat-msg-profile-link';
			nameLink.href = profileHref;
			nameLink.dataset.profileLink = '';
			nameLink.setAttribute('aria-label', `View ${handleLabel} profile`);
			nameLink.appendChild(nameSpan);
			textSpan.appendChild(nameLink);
		} else {
			textSpan.appendChild(nameSpan);
		}
		if (when) {
			const sepSpan = clone('separator');
			textSpan.appendChild(sepSpan);
			const whenSpan = clone('when');
			whenSpan.textContent = when;
			textSpan.appendChild(whenSpan);
		}
		metaLine.appendChild(textSpan);

		if (opts.showPinMark === true) {
			const mark = document.createElement('span');
			mark.className = 'connect-chat-msg-pin-mark';
			mark.setAttribute('aria-hidden', 'true');
			mark.innerHTML = pinIcon('connect-chat-msg-pin-mark-icon');
			metaLine.appendChild(mark);
		}
		return metaLine;
	}

export function chatReactionGetCount(val) {
		if (typeof val === 'number' && Number.isFinite(val)) return Math.max(0, val);
		if (!Array.isArray(val) || val.length === 0) return 0;
		const last = val[val.length - 1];
		const others = typeof last === 'number' ? last : 0;
		const strings = typeof last === 'number' ? val.slice(0, -1) : val;
		return strings.filter((s) => typeof s === 'string').length + others;
	}

export function chatReactionWhoTooltipAttr(raw, actionLabel) {
		let tooltipAttr = '';
		let titleAttr = ` title="${escapeHtml(actionLabel)}"`;
		if (typeof raw !== 'number' && Array.isArray(raw) && raw.length > 0) {
			const tooltip = formatWhoTooltip(raw);
			if (tooltip) {
				tooltipAttr = ` data-tooltip="${escapeHtml(tooltip)}"`;
				// Native title steals attention and hides that who-list exists.
				titleAttr = '';
			}
		}
		return { tooltipAttr, titleAttr };
	}

export function buildChatReactionMetaRowHtml(m) {
		const reactions = m?.reactions && typeof m.reactions === 'object' ? m.reactions : {};
		const viewerReactions = Array.isArray(m?.viewer_reactions) ? m.viewer_reactions : [];
		const messageId = m?.id != null ? String(m.id) : '';
		if (!messageId) return '';
		const keysWithReactions = REACTION_ORDER.filter((key) => chatReactionGetCount(reactions[key]) > 0);
		const hasAnyReactions = keysWithReactions.length > 0;
		if (!hasAnyReactions) {
			return '';
		}
		const hasUnusedReactions = REACTION_ORDER.some((key) => chatReactionGetCount(reactions[key]) === 0);
		const reactionPills = keysWithReactions
			.map((key) => {
				const raw = reactions[key];
				const count = chatReactionGetCount(raw);
				const countLabel = count > 99 ? '99+' : String(count);
				const hasViewer = viewerReactions.includes(key);
				const iconFn = REACTION_ICONS[key];
				const iconHtml = iconFn ? iconFn('comment-reaction-icon') : '';
				const actionLabel = hasViewer ? `Remove ${key}` : `Add ${key}`;
				const { tooltipAttr, titleAttr } = chatReactionWhoTooltipAttr(raw, actionLabel);
				return `<button type="button" class="comment-reaction-pill${hasViewer ? ' is-viewer' : ''}" data-emoji-key="${escapeHtml(key)}" data-chat-message-id="${escapeHtml(messageId)}" aria-label="${escapeHtml(actionLabel)}"${titleAttr}${tooltipAttr}><span class="comment-reaction-icon-wrap" aria-hidden="true">${iconHtml}</span><span class="comment-reaction-count">${escapeHtml(countLabel)}</span></button>`;
			})
			.join('');
		const addReactionBtn = hasUnusedReactions
			? `<button type="button" class="comment-reaction-add" data-chat-message-id="${escapeHtml(messageId)}" aria-label="Add reaction" title="Add reaction"><span class="comment-reaction-icon-wrap" aria-hidden="true">${smileIcon('comment-reaction-add-icon')}</span></button>`
			: '';
		return `<div class="comment-meta-row connect-chat-msg-reaction-row">
			<div class="comment-meta-top">
				<div class="comment-meta-right">
					<div class="comment-reaction-pills">
						<div class="comment-reaction-pills-inner">${reactionPills}${addReactionBtn}</div>
					</div>
				</div>
			</div>
		</div>`;
	}

export function messageHasAnyReactions(m) {
		const reactions = m?.reactions && typeof m.reactions === 'object' ? m.reactions : {};
		return REACTION_ORDER.some((key) => chatReactionGetCount(reactions[key]) > 0);
	}

export function buildChatMessageHoverBarElement(m, viewerId, rowOpts) {
		const messageId = m?.id != null ? Number(m.id) : null;
		if (!Number.isFinite(messageId) || messageId <= 0) return null;

		const bar = clone('toolbar');
		const quick = bar.querySelector('.connect-chat-msg-hover-bar-quick');
		const viewerReactions = Array.isArray(m?.viewer_reactions) ? m.viewer_reactions : [];

		for (const key of CHAT_HOVER_QUICK_REACTION_KEYS) {
			const iconFn = REACTION_ICONS[key];
			const btn = clone('quick-reaction');
			btn.dataset.emojiKey = key;
			btn.dataset.chatMessageId = String(messageId);
			btn.setAttribute('aria-label', `React with ${key}`);
			btn.innerHTML = iconFn ? iconFn('connect-chat-msg-hover-react-icon') : '';
			if (viewerReactions.includes(key)) btn.classList.add('is-viewer');
			quick.appendChild(btn);
		}

		const addBtn = clone('add-reaction');
		addBtn.dataset.chatMessageId = String(messageId);
		addBtn.setAttribute('aria-label', 'Add reaction');
		addBtn.innerHTML = `<span class="comment-reaction-icon-wrap" aria-hidden="true">${smileIcon('connect-chat-hover-add-react-icon')}</span>`;

		const sep = bar.querySelector('.connect-chat-msg-hover-sep');

		const actions = bar.querySelector('.connect-chat-msg-hover-actions');

		const replyBtn =
			activePseudoChannelSlug || !messageRowSupportsReply(m)
				? null
				: (() => {
						const btn = clone('reply');
						btn.setAttribute('data-chat-hover-reply', '1');
						btn.dataset.chatMessageId = String(messageId);
						btn.setAttribute('aria-label', 'Reply');
						btn.innerHTML = replyTurnIcon('connect-chat-hover-reply-icon');
						return btn;
					})();

		const copyBtn = clone('copy');
		copyBtn.setAttribute('data-chat-hover-copy', '1');
		copyBtn.dataset.chatMessageId = String(messageId);
		copyBtn.setAttribute('aria-label', 'Copy message text');
		copyBtn.innerHTML = copyIcon('connect-chat-hover-copy-icon');

		actions.appendChild(copyBtn);

		const senderId = Number(m.sender_id);
		const isSelf = Number.isFinite(viewerId) && Number.isFinite(senderId) && senderId === viewerId;
		const canEdit = isSelf || rowOpts.showAdminDelete === true;
		if (canEdit) {
			const editBtn = clone('edit');
			editBtn.setAttribute('data-chat-hover-edit', '1');
			editBtn.dataset.chatMessageId = String(messageId);
			editBtn.setAttribute('aria-label', isSelf ? 'Edit your message' : 'Edit message (moderator)');
			editBtn.innerHTML = pencilIcon('connect-chat-hover-edit-icon');
			actions.appendChild(editBtn);
		}
		const canPin =
			rowOpts.showChannelPin === true &&
			!getChatCanvasMetaFromMessage(m) &&
			!(
				m?.meta &&
				typeof m.meta === 'object' &&
				!Array.isArray(m.meta) &&
				m.meta.system_event &&
				typeof m.meta.system_event === 'object'
			);
		if (canPin) {
			const isPinned = Number(activeThreadPinnedMessageId) === messageId;
			const pinBtn = clone('pin');
			pinBtn.setAttribute('data-chat-hover-pin', '1');
			pinBtn.dataset.chatMessageId = String(messageId);
			pinBtn.setAttribute('aria-label', isPinned ? 'Unpin from channel' : 'Pin to channel');
			pinBtn.innerHTML = pinIcon('connect-chat-hover-pin-icon');
			if (isPinned) pinBtn.classList.add('is-pinned');
			actions.appendChild(pinBtn);
		}
		const canDelete = isSelf || rowOpts.showAdminDelete === true;
		if (canDelete) {
			const delBtn = clone('delete');
			delBtn.setAttribute('data-chat-hover-delete', '1');
			delBtn.dataset.chatMessageId = String(messageId);
			delBtn.setAttribute(
				'aria-label',
				isSelf ? 'Delete your message' : 'Delete message (moderator)'
			);
			delBtn.innerHTML = trashIcon('connect-chat-hover-delete-icon');
			actions.appendChild(delBtn);
		}

		bar.appendChild(quick);
		bar.appendChild(addBtn);
		if (replyBtn) bar.appendChild(replyBtn);
		bar.appendChild(sep);
		bar.appendChild(actions);
		return bar;
	}

export function normalizeChatBubbleInlineImageSpacing(bubble) {
	if (!(bubble instanceof HTMLElement)) return;
	if (!bubble.querySelector('.user-text-inline-image-wrap')) return;

	for (const wrap of bubble.querySelectorAll('.user-text-inline-image-wrap')) {
		let prev = wrap.previousSibling;
		while (prev && prev.nodeType === Node.TEXT_NODE) {
			const raw = prev.nodeValue || '';
			const trimmed = raw.replace(/\s+$/, '');
			if (trimmed.length > 0) {
				prev.nodeValue = trimmed;
				break;
			}
			const rm = prev;
			prev = prev.previousSibling;
			rm.parentNode?.removeChild(rm);
		}
	}

	for (const wrap of bubble.querySelectorAll('.user-text-inline-image-wrap')) {
		let next = wrap.nextSibling;
		while (next && next.nodeType === Node.TEXT_NODE) {
			const raw = next.nodeValue || '';
			const trimmed = raw.replace(/^\s+/, '');
			if (trimmed.length > 0) {
				const cap = document.createElement('span');
				cap.className = 'user-text-inline-chat-caption';
				cap.textContent = trimmed;
				next.parentNode?.replaceChild(cap, next);
				break;
			}
			const rm = next;
			next = next.nextSibling;
			rm.parentNode?.removeChild(rm);
		}
	}
}

export function trimTrailingWhitespaceAfterChatEmbed(bubble) {
	if (!(bubble instanceof HTMLElement)) return;
	if (!bubble.querySelector('.connect-chat-creation-embed, .connect-chat-youtube-embed')) return;
	let n = bubble.lastChild;
	while (n && n.nodeType === Node.TEXT_NODE && /^\s*$/.test(n.textContent)) {
		const prev = n.previousSibling;
		bubble.removeChild(n);
		n = prev;
	}
}

export function trimChatCreationEmbedWhitespace(embed) {
	if (!(embed instanceof HTMLElement)) return;
	let n = embed.lastChild;
	while (n && n.nodeType === Node.TEXT_NODE && /^\s*$/.test(n.textContent)) {
		const prev = n.previousSibling;
		embed.removeChild(n);
		n = prev;
	}
}

export function createChatMessageRowElement(m, i, messages, viewerId, rowOpts) {
		const senderId = Number(m.sender_id);
		const isSelf = Number.isFinite(viewerId) && senderId === viewerId;
		const systemEventRaw =
			m?.meta && typeof m.meta === 'object' && !Array.isArray(m.meta) ? m.meta.system_event : null;
		const systemEvent =
			systemEventRaw && typeof systemEventRaw === 'object' && !Array.isArray(systemEventRaw)
				? systemEventRaw
				: null;
		const bodyTextRaw = String(m?.body ?? '').trim();
		const isLegacyInviteSystemLine = isChannelInviteSystemBoundaryMessage(m);
		const isChannelInviteSystemEvent =
			String(systemEvent?.kind || '').trim().toLowerCase() === 'channel_invite_sent';
		const shouldRenderAsSystemEvent = isChannelInviteSystemEvent || isLegacyInviteSystemLine;
		const prev = i > 0 ? messages[i - 1] : null;
		const isGroupContinue = shouldRenderAsSystemEvent ? false : isChatMessageGroupContinue(prev, m);
		const row = clone('row');
		row.className = `connect-chat-msg${isSelf ? ' is-self' : ''}${isGroupContinue ? ' is-group-continue' : ''}${shouldRenderAsSystemEvent ? ' connect-chat-msg--system-event' : ''}`;
		row.setAttribute('data-chat-message-id', String(m.id));
		const effectiveUnread = rowOpts.effectiveUnread;
		const vStart = rowOpts.vStart;
		const vEnd = rowOpts.vEnd;
		const isUnread =
			effectiveUnread &&
			!isSelf &&
			i >= vStart &&
			i <= vEnd;
		if (isUnread) {
			row.classList.add('is-unread');
			const prevMsg = i > 0 ? messages[i - 1] : null;
			const nextMsg = i + 1 < messages.length ? messages[i + 1] : null;
			const prevSender = prevMsg?.sender_id != null ? Number(prevMsg.sender_id) : null;
			const nextSender = nextMsg?.sender_id != null ? Number(nextMsg.sender_id) : null;
			const prevIsSelf = Number.isFinite(viewerId) && prevSender === viewerId;
			const nextIsSelf = Number.isFinite(viewerId) && nextSender === viewerId;
			const prevUnread =
				effectiveUnread && !prevIsSelf && i - 1 >= vStart && i - 1 <= vEnd;
			const nextUnread =
				effectiveUnread && !nextIsSelf && i + 1 >= vStart && i + 1 <= vEnd;
			if (!prevUnread && !nextUnread) {
				row.classList.add('is-unread-solo');
			} else if (!prevUnread && nextUnread) {
				row.classList.add('is-unread-first');
			} else if (prevUnread && nextUnread) {
				row.classList.add('is-unread-middle');
			} else if (prevUnread && !nextUnread) {
				row.classList.add('is-unread-last');
			}
		}
		if (!messageHasAnyReactions(m)) {
			row.classList.add('connect-chat-msg--reaction-empty');
		}
		const inner = row.firstElementChild;
		const canvasMeta = getChatCanvasMetaFromMessage(m);
		const timedMetaRaw = m?.meta && typeof m.meta === 'object' && !Array.isArray(m.meta)
			? m.meta.time_sensitive
			: null;
		const timedMeta =
			timedMetaRaw && typeof timedMetaRaw === 'object' && !Array.isArray(timedMetaRaw)
				? timedMetaRaw
				: null;
		const safeBody = processUserText(m.body ?? '', { messageMarkdown: true });
		const bubble = inner.firstElementChild;
		bubble.remove();
		if (shouldRenderAsSystemEvent) {
			bubble.classList.add('connect-chat-msg-bubble--system-event');
			const plain = escapeHtml(String(m?.body ?? '').trim() || 'Channel update');
			bubble.innerHTML = `<div class="chat-channel-system-event-line"><span class="chat-channel-system-event-text">${plain}</span></div>`;
		} else if (canvasMeta) {
			bubble.classList.add('connect-chat-msg-bubble--canvas');
			const preview = processUserText(m.body ?? '', { messageMarkdown: true });
			bubble.innerHTML = `<div class="connect-chat-canvas-inline"><div class="connect-chat-canvas-inline-title">${escapeHtml(canvasMeta.title)}</div><div class="connect-chat-canvas-inline-preview">${preview}</div></div>`;
		} else if (
			timedMeta &&
			String(timedMeta.kind || '').trim().toLowerCase() === 'channel_invite' &&
			timedMeta?.cta &&
			typeof timedMeta.cta === 'object'
		) {
			const privateInviteMetaRaw =
				timedMeta?.private_channel_invite &&
				typeof timedMeta.private_channel_invite === 'object' &&
				!Array.isArray(timedMeta.private_channel_invite)
					? timedMeta.private_channel_invite
					: null;
			const inviteeUserId = Number(privateInviteMetaRaw?.invitee_user_id);
			const isInviteForViewer =
				Number.isFinite(inviteeUserId) && Number.isFinite(viewerId) ? inviteeUserId === Number(viewerId) : true;
			const expiresAtRaw = typeof timedMeta.expires_at === 'string' ? timedMeta.expires_at.trim() : '';
			const expMs = Date.parse(expiresAtRaw);
			const nowMs = Date.now();
			const isExpired =
				timedMeta?.expired === true || (Number.isFinite(expMs) ? nowMs > expMs : false);
			const expLabel = Number.isFinite(expMs) ? (formatRelativeTime(expiresAtRaw) || '') : '';
			const ctaLabel =
				typeof timedMeta?.cta?.label === 'string' && timedMeta.cta.label.trim()
					? timedMeta.cta.label.trim()
					: 'Accept invite';
			const inviteToken =
				typeof timedMeta?.cta?.invite_token === 'string' ? timedMeta.cta.invite_token.trim() : '';
			bubble.classList.add('connect-chat-msg-bubble--timed-invite');
			if (isExpired) bubble.classList.add('connect-chat-msg-bubble--timed-invite-expired');
			bubble.innerHTML = `
				<div class="chat-timed-message">
					<div class="chat-timed-message-title">${isExpired ? 'Invite expired' : (isInviteForViewer ? 'Private channel invite' : 'Pending Invite')}</div>
					<div class="chat-timed-message-body">${safeBody}</div>
					${expLabel ? `<div class="chat-timed-message-expiry">${isExpired ? 'Expired' : 'Expires'} ${escapeHtml(expLabel)}</div>` : ''}
					<div class="chat-timed-message-actions">
						${isExpired
							? '<span class="chat-timed-message-pending">Invite expired</span>'
							: (isInviteForViewer
								? `<button type="button" class="btn-primary chat-timed-message-cta" data-chat-timed-accept-invite="${escapeHtml(inviteToken)}">${escapeHtml(ctaLabel)}</button>`
								: '<span class="chat-timed-message-pending">Waiting for recipient</span>')}
					</div>
				</div>
			`;
		} else {
			bubble.innerHTML = safeBody;
		}
		const editedLabelEl = buildChatMessageEditedLabelElement(m);
		if (editedLabelEl) {
			bubble.appendChild(editedLabelEl);
		}
		normalizeChatBubbleInlineImageSpacing(bubble);
		if (!shouldRenderAsSystemEvent) {
			const rs = m?.meta?.reply;
			if (rs && typeof rs === 'object' && Number.isFinite(Number(rs.referenced_id))) {
				const reachable = m?.reply_parent_exists !== false;
				try {
					inner.appendChild(createReplyIndicatorElement(rs, reachable, { kind: 'chat', omitAvatar: true, ...rowOpts.replyOptions }));
				} catch {
					/* ignore malformed reply meta */
				}
			}
		}
		if (!isGroupContinue && !shouldRenderAsSystemEvent) {
			const metaLine = buildConnectChatMsgMetaElement(m, { viewerId });
			if (metaLine) inner.appendChild(metaLine);
		}
		inner.appendChild(bubble);
		const reactionHtml = buildChatReactionMetaRowHtml(m);
		if (reactionHtml) {
			const footer = clone('footer');
			footer.innerHTML = reactionHtml.trim();
			inner.appendChild(footer);
		}
		row.appendChild(inner);
		if (rowOpts.showHoverBar && !shouldRenderAsSystemEvent) {
			const hoverBar = buildChatMessageHoverBarElement(m, viewerId, rowOpts);
			if (hoverBar) row.appendChild(hoverBar);
		}
		return row;
	}
