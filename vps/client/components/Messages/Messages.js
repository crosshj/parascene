import markup from './Messages.html';
import { createTemplateFactory } from '../../utils/dom.js';
import './Messages.css';
import './MessagesLayout.css';
import { hydrateRichUserTextEmbeds } from '../../shared/userText.js';
import { createMessagesScroll } from './scroll.js';
import { bindMessageReactions } from './Reactions.js';
import { renderChatThreadSkeleton } from '../../shared/skeleton.js';
import { renderPaneLoadError } from '../../shared/emptyState.js';
import { setupFloatingWhoTooltips, hideFloatingWhoTooltip } from '../../shared/whoLabels.js';
import {
 bindChatInlineImageLightboxClickDelegation, chatAttachmentPreviewKindFromHref,
 openChatAttachmentPreviewLightbox, closeChatInlineImageLightbox,
 closeChatInlineImageLightboxFromPopstateIfOpen,
} from '../../shared/chatInlineImageLightbox.js';
import {
 createChatMessageRowElement, isChatMessageGroupContinue as continues,
 trimTrailingWhitespaceAfterChatEmbed, trimChatCreationEmbedWhitespace,
} from './MessageRow.js';

const clone = createTemplateFactory(markup);

function createRow(message, previous, viewerId, canEdit = false, canReply = true, replyOptions = {}) {
 const index = previous ? 1 : 0;
 // The WWW builder requires a numeric identity to construct its toolbar.
 // Render the full structure now; reconciliation assigns every control its
 // real client/server identity before the row is hydrated or interactive.
 const presentation = message.delivery ? { ...message, id: 1 } : message;
 const row = createChatMessageRowElement(presentation, index, previous ? [previous, presentation] : [presentation], viewerId, {
  effectiveUnread: false, vStart: -1, vEnd: -1, showAdminDelete: canEdit,
  showHoverBar: canReply, replyOptions,
 });

 return row;
}

export function mountMessages({ outlet, viewerId, onLoadOlder, onRetry, onRetrySend, onRead, onEdit, onReply, onReplyJump, onReact, onDelete }) {
	const root = clone('stream');
	const sentinel = clone('history');
	const errorLine = clone('error');
	const status = errorLine.querySelector('span');
	const retry = errorLine.querySelector('button');
	outlet.append(root, errorLine);
	const viewport = root;
	const lifetime = new AbortController();
	const shellScroll = outlet.closest('.beta-outlet__scroll'); shellScroll?.classList.add('chat-page-thread-body');
	let hasMore = false;
	let loadingOlder = false;
	let historyObserver = null;
	function requestOlderIfNear() {
		if (!hasMore || loadingOlder || !records.size || destroyed) return;
		const margin = Math.max(1200, Math.round(viewport.clientHeight * .75));
		if (sentinel.getBoundingClientRect().bottom >= viewport.getBoundingClientRect().top - margin) onLoadOlder?.();
	}
	function syncHistoryObserver() {
		if (!hasMore) { historyObserver?.disconnect(); historyObserver = null; sentinel.remove(); return; }
		if (!sentinel.isConnected) root.prepend(sentinel);
		if (!historyObserver) {
			historyObserver = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) requestOlderIfNear(); }, { root: viewport, rootMargin: `${Math.max(1200, Math.round(viewport.clientHeight * .75))}px 0px 0px 0px` });
			historyObserver.observe(sentinel);
		}
	}
	function acknowledgeVisibleLatest() {
		if (document.visibilityState !== 'visible' || document.body.classList.contains('beta-creation-overlay-open')) return;
		const last = [...root.querySelectorAll('.connect-chat-msg[data-chat-message-id]')].filter((row) => Number.isSafeInteger(Number(row.dataset.chatMessageId)) && Number(row.dataset.chatMessageId) > 0).at(-1);
		if (!last) return;
		const bounds = viewport.getBoundingClientRect();
		const rect = last.getBoundingClientRect();
		if (rect.bottom > bounds.top && rect.top < bounds.bottom) onRead?.(Number(last.dataset.chatMessageId));
	}
	const scroll = createMessagesScroll({ viewport, content: root, onLatestVisible: acknowledgeVisibleLatest });
	let records = new Map();
	const deleting = new Set();
	let initial = true;
	let editing = null;
	let destroyed = false;
	let replyTargetId = null;
	let unreadBoundary = null;
	let clearedThrough = 0;
	let unreadFade = 0;
	function applyUnreadState(row, index, messages) {
		const isUnread = (at) => unreadBoundary != null && Number(messages[at]?.id) > unreadBoundary && Number(messages[at]?.sender_id) !== Number(viewerId);
		row.classList.remove('is-unread', 'is-unread-solo', 'is-unread-first', 'is-unread-middle', 'is-unread-last', 'is-unread-clearing');
		if (!isUnread(index)) return;
		row.classList.add('is-unread');
		row.classList.add(!isUnread(index - 1) ? (isUnread(index + 1) ? 'is-unread-first' : 'is-unread-solo') : (isUnread(index + 1) ? 'is-unread-middle' : 'is-unread-last'));
		if (Number(messages[index].id) <= clearedThrough) row.classList.add('is-unread-clearing');
	}
	const replyOptions = { root, onJump: (id) => { if (!jumpToMessage(id)) onReplyJump?.(id); } };
	const reactions = bindMessageReactions({ root, getRecord: (id) => records.get(String(id)), onReact });
	const lightboxHooks = { beforeOpen: () => reactions.close() };
	const unbindLightbox = bindChatInlineImageLightboxClickDelegation(root, {
		bubbleSelector: '.connect-chat-msg-bubble', openHooks: lightboxHooks,
	});
	function onLightboxPopstate() { closeChatInlineImageLightboxFromPopstateIfOpen(); }
	window.addEventListener('popstate', onLightboxPopstate);
	function hydrateMessages(container) {
		hydrateRichUserTextEmbeds(container);
		for (const bubble of container.querySelectorAll('.connect-chat-msg-bubble')) trimTrailingWhitespaceAfterChatEmbed(bubble);
		for (const embed of container.querySelectorAll('.connect-chat-creation-embed')) trimChatCreationEmbedWhitespace(embed);
	}
	function finishEdit() {
		if (!editing) return;
		const record = records.get(editing.key);
		editing = null;
		if (record) {
			const node = createRow(record.message, record.previous, viewerId, record.canEdit, record.canReply, replyOptions);
			record.node.replaceWith(node); record.node = node;
			reactions.update(node, record.message, record.canReply);
			node.classList.toggle('connect-chat-msg--reply-target', String(record.message.id) === replyTargetId);
			applyDeleting(node, record.message.id);
			const messages = [...records.values()].map((item) => item.message);
			applyUnreadState(node, messages.indexOf(record.message), messages);
			hydrateMessages(node);
			scroll.observeRows();
		}
	}
	function applyDeleting(node, key) {
		const pending = deleting.has(String(key));
		node.classList.toggle('is-deleting', pending);
		if (pending) {
			node.setAttribute('aria-busy', 'true');
			node.classList.remove('connect-chat-msg--toolbar-open');
		} else node.removeAttribute('aria-busy');
	}
	function beginEdit(key) {
		if (editing?.saving) return;
		finishEdit();
		const record = records.get(key);
		if (!record?.canEdit) return;
		const state = { key, saving: false }; editing = state; record.node.dataset.chatMessageEditing = '1';
		const bubble = record.node.querySelector('.connect-chat-msg-bubble');
		const dialog = clone('edit');
		const input = dialog.querySelector('textarea');
		input.value = record.message.body || '';
		const error = dialog.querySelector('[data-chat-message-edit-error]');
		const cancel = dialog.querySelector('[data-chat-message-edit-cancel]');
		const save = dialog.querySelector('[data-chat-message-edit-save]');
		cancel.addEventListener('click', finishEdit);
		input.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !state.saving) { event.preventDefault(); finishEdit(); } });
		save.addEventListener('click', async () => {
			const body = input.value.trim(); if (!body || state.saving) return;
			state.saving = true; record.node.dataset.chatMessageEditSaving = '1'; input.disabled = cancel.disabled = save.disabled = true; error.hidden = true;
			try { if (await onEdit?.(key, body) && !destroyed && editing === state) finishEdit(); }
			catch (reason) { if (!destroyed && editing === state) { error.textContent = reason.message || 'Could not save message.'; error.hidden = false; } }
			finally { if (!destroyed && editing === state) { state.saving = false; delete record.node.dataset.chatMessageEditSaving; input.disabled = cancel.disabled = save.disabled = false; } }
		});
		bubble.replaceChildren(dialog); input.focus();
	}
	function retryLoad() { onRetry?.(); }
	function rowAction(event) {
		if (event.target.closest('.connect-chat-msg.is-deleting')) return;
		const fileLink = event.target.closest('a.user-text-inline-file-link[href]');
		if (fileLink && fileLink.closest('.connect-chat-msg-bubble') && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
			const kind = chatAttachmentPreviewKindFromHref(fileLink.getAttribute('href') || fileLink.href);
			if (kind === 'video' || kind === 'html') {
				event.preventDefault(); event.stopPropagation();
				openChatAttachmentPreviewLightbox(fileLink.href, kind, lightboxHooks);
				return;
			}
		}
		const retry = event.target.closest('[data-chat-optimistic-resend]'); if (retry) onRetrySend?.(retry.dataset.chatOptimisticResend);
		const edit = event.target.closest('[data-chat-hover-edit]'); if (edit) beginEdit(edit.dataset.chatMessageId);
		const reply = event.target.closest('[data-chat-hover-reply]'); if (reply) onReply?.(reply.dataset.chatMessageId);
		const copy = event.target.closest('[data-chat-hover-copy]');
		if (copy) navigator.clipboard.writeText(records.get(copy.dataset.chatMessageId)?.message.body || '').catch((reason) => { if (!destroyed) { status.textContent = reason.message || 'Could not copy message.'; errorLine.hidden = false; } });
		const remove = event.target.closest('[data-chat-hover-delete]');
		if (remove && !deleting.has(remove.dataset.chatMessageId) && confirm('Delete this message?')) {
			const key = remove.dataset.chatMessageId;
			deleting.add(key);
			const record = records.get(key);
			if (record) applyDeleting(record.node, key);
			Promise.resolve(onDelete?.(key)).catch((reason) => { if (!destroyed) { status.textContent = reason.message || 'Could not delete message.'; errorLine.hidden = false; } }).finally(() => { deleting.delete(key); if (!destroyed) { const current = records.get(key); if (current) applyDeleting(current.node, key); } });
		}
		if (matchMedia('(hover: none), (pointer: coarse)').matches && !event.target.closest('button, a, textarea, input, video, audio, iframe')) {
			const row = event.target.closest('.connect-chat-msg');
			const open = row && !row.classList.contains('connect-chat-msg--toolbar-open');
			for (const item of root.querySelectorAll('.connect-chat-msg--toolbar-open')) item.classList.remove('connect-chat-msg--toolbar-open');
			if (open) row.classList.add('connect-chat-msg--toolbar-open');
		}
	}
	function onVisibility() { scroll.capture(); scroll.restore(); }
	root.addEventListener('click', rowAction);
	viewport.addEventListener('scroll', requestOlderIfNear, { passive: true });
	setupFloatingWhoTooltips(root, { signal: lifetime.signal });
	function jumpToMessage(id) {
		const target = records.get(String(id))?.node;
		if (!target) return false;
		scroll.jumpTo(target, () => {
			target.classList.remove('msg-reply-jump-flash'); void target.offsetWidth;
			target.classList.add('msg-reply-jump-flash');
			target.addEventListener('animationend', () => target.classList.remove('msg-reply-jump-flash'), { once: true });
		});
		return true;
	}
	document.addEventListener('visibilitychange', onVisibility);
	retry.addEventListener('click', retryLoad);
	return {
		jumpToMessage,
		setUnreadBoundary(id) { unreadBoundary = Number(id) || 0; },
		clearUnread(id) {
			clearedThrough = Math.max(clearedThrough, Number(id) || 0);
			for (const record of records.values()) if (Number(record.message.id) <= clearedThrough && record.node.classList.contains('is-unread')) record.node.classList.add('is-unread-clearing');
			clearTimeout(unreadFade);
			unreadFade = setTimeout(() => {
				unreadBoundary = Math.max(unreadBoundary || 0, clearedThrough);
				const messages = [...records.values()].map((record) => record.message);
				[...records.values()].forEach((record, index) => applyUnreadState(record.node, index, messages));
			}, 2200);
		},
		setReplyTarget(id) {
			replyTargetId = id == null ? null : String(id);
			for (const [key, record] of records) record.node.classList.toggle('connect-chat-msg--reply-target', key === replyTargetId);
		},
		setStatus(snapshot) {
			root.setAttribute('aria-busy', String(snapshot.isLoading || snapshot.isRefreshing || false));
			errorLine.hidden = !snapshot.error;
			if (snapshot.error) status.textContent = snapshot.error.message || 'Could not load messages.';
			if (snapshot.isLoading && !records.size) {
				root.dataset.chatMessagesScrollLock = '1';
				if (!root.querySelector('.chat-thread-channel-loading')) {
					root.innerHTML = `<div class="chat-thread-channel-loading" aria-busy="true" aria-label="Loading">${renderChatThreadSkeleton()}</div>`;
				}
				root.scrollTop = 0;
			}
			if (snapshot.error && !records.size) {
				root.innerHTML = renderPaneLoadError(snapshot.error.message, { title: "Couldn't load this view" });
				root.querySelector('.route-empty-message')?.insertAdjacentElement('afterend', retry);
				errorLine.hidden = true; delete root.dataset.chatMessagesScrollLock;
			}
		},
		setLoadingOlder(loading) { loadingOlder = loading; if (!loading) requestOlderIfNear(); },
		render(data) {
			scroll.capture();
			delete root.dataset.chatMessagesScrollLock;
			if (!errorLine.contains(retry)) errorLine.append(retry);
			const messages = data.messages || [];
			for (const child of [...root.children]) if (!child.matches('.connect-chat-msg, .chat-page-thread-load-sentinel')) child.remove();
			hasMore = data.hasMore === true; syncHistoryObserver();
			let position = sentinel.isConnected ? sentinel.nextSibling : root.firstChild;
			const next = new Map();
			for (let index = 0; index < messages.length; index++) {
				const message = messages[index];
				const key = String(message.id);
				const canEdit = data.editable !== false && (data.viewerIsAdmin || Number(message.sender_id) === Number(viewerId));
				const { id, clientKey, delivery, reactions: bucket, viewer_reactions: selected, ...body } = message;
				const signature = JSON.stringify([body, continues(messages[index - 1], message), canEdit, data.editable !== false]);
				const reactionSignature = JSON.stringify([bucket, selected, data.editable !== false, !!message.delivery]);
				let record = records.get(key) || (message.clientKey ? [...records.values()].find((item) => item.message.clientKey === message.clientKey) : null);
				// A send acknowledgement adopts the server identity without replacing
				// the body, hydrated media, avatar, or timestamp already on screen.
				if (record?.message.delivery && !message.delivery && message.clientKey === record.message.clientKey) record.signature = signature;
				if (record?.signature !== signature && editing?.key !== key) {
					const node = createRow(message, messages[index - 1], viewerId, canEdit, data.editable !== false, replyOptions);
					if (position === record?.node) position = node;
					record?.node.replaceWith(node);
					record = { node, signature };
				}
				record.node.dataset.chatMessageId = key;
				for (const control of record.node.querySelectorAll('[data-chat-message-id]')) control.dataset.chatMessageId = key;
				const failed = message.delivery?.status === 'failed';
				record.node.classList.toggle('is-optimistic-failed', failed);
				let failureLine = record.node.querySelector('.chat-page-optimistic-failed-line');
				if (failed && !failureLine) {
					failureLine = clone('failed');
					failureLine.querySelector('button').dataset.chatOptimisticResend = key;
					record.node.querySelector('.connect-chat-msg-inner').insertBefore(failureLine, record.node.querySelector('.connect-chat-msg-bubble'));
				} else if (!failed) failureLine?.remove();
				for (const control of record.node.querySelectorAll('[data-chat-hover-edit], [data-chat-hover-delete], [data-chat-hover-reply]')) control.disabled = !!message.delivery;
				record.message = message; record.previous = messages[index - 1]; record.canEdit = canEdit;
				record.canReply = data.editable !== false;
				record.node.classList.toggle('connect-chat-msg--reply-target', key === replyTargetId);
				applyDeleting(record.node, key);
				applyUnreadState(record.node, index, messages);
				if (record.reactionSignature !== reactionSignature) {
					reactions.update(record.node, message, record.canReply);
					record.reactionSignature = reactionSignature;
				}
				if (position !== record.node) root.insertBefore(record.node, position || null);
				position = record.node.nextSibling;
				next.set(key, record);
			}
			for (const [key, record] of records) if (!next.has(key) && ![...next.values()].some((item) => item.node === record.node)) record.node.remove();
			if (editing && !next.has(editing.key)) editing = null;
			records = next;
			if (!messages.length) root.append(clone('empty'));
			for (const row of root.querySelectorAll('[data-chat-latest]')) row.removeAttribute('data-chat-latest');
			[...root.querySelectorAll('.connect-chat-msg')].at(-1)?.setAttribute('data-chat-latest', '1');
			hydrateMessages(root);
			scroll.observeRows();
			if (initial) { initial = false; scroll.latest(); } else scroll.restore();
		},
		destroy() {
			destroyed = true; editing = null;
			clearTimeout(unreadFade);
			lifetime.abort();
			reactions.destroy();
			unbindLightbox();
			window.removeEventListener('popstate', onLightboxPopstate);
			closeChatInlineImageLightbox();
			scroll.destroy();
			for (const media of root.querySelectorAll('video, audio')) media.pause();
			historyObserver?.disconnect();
			viewport.removeEventListener('scroll', requestOlderIfNear);
			hideFloatingWhoTooltip();
			retry.removeEventListener('click', retryLoad);
			root.removeEventListener('click', rowAction);
			document.removeEventListener('visibilitychange', onVisibility);
			shellScroll?.classList.remove('chat-page-thread-body');
			errorLine.remove();
			root.remove();
		},
	};
}
