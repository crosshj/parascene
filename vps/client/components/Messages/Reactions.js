import markup from './Reactions.html';
import { createTemplateFactory } from '../../utils/dom.js';

const clone = createTemplateFactory(markup);

import { REACTION_ORDER, REACTION_ICONS } from '../../icons/svg-strings.js';
import { buildChatReactionMetaRowHtml, messageHasAnyReactions } from './MessageRow.js';

function label(key) { return key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); }

// WWW reaction pills and picker. Patch only this footer, preserving the body,
// rich embeds, editing drafts, and any playing media in the message row.
export function bindMessageReactions({ root, getRecord, onReact }) {
	const abort = new AbortController();
	const pending = new Set();
	const errors = new Map();
	let picker = null;
	let opener = null;
	let destroyed = false;
	function close(restoreFocus = false) {
		picker?.remove(); picker = null;
		if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
		opener = null;
	}
	function update(row, message, enabled) {
		enabled = enabled && !message.delivery && !message.meta?.system_event;
		const id = String(message.id);
		let footer = row.querySelector('.connect-chat-msg-footer');
		const focusedKey = footer?.contains(document.activeElement) ? document.activeElement.dataset.emojiKey : null;
		const html = buildChatReactionMetaRowHtml(message);
		row.classList.toggle('connect-chat-msg--reaction-empty', !messageHasAnyReactions(message));
		if (html || errors.has(id)) {
			if (!footer) { footer = clone('footer'); row.querySelector('.connect-chat-msg-inner').append(footer); }
			footer.innerHTML = html;
			if (errors.has(id)) { const error = clone('error'); error.textContent = errors.get(id); footer.append(error); }
		} else footer?.remove();
		for (const button of row.querySelectorAll('.comment-reaction-pill, .comment-reaction-add, .connect-chat-msg-hover-react, .connect-chat-msg-hover-add-react')) {
			button.disabled = !enabled || pending.has(id);
			if (button.dataset.emojiKey) button.classList.toggle('is-viewer', !!message.viewer_reactions?.includes(button.dataset.emojiKey));
		}
		if (focusedKey) footer?.querySelector(`[data-emoji-key="${focusedKey}"]`)?.focus({ preventScroll: true });
	}
	function refresh(id) { const record = getRecord(id); if (record) update(record.node, record.message, record.canReply); }
	async function react(id, key) {
		if (pending.has(id) || destroyed) return;
		close(); pending.add(id); errors.delete(id); refresh(id);
		try { await onReact?.(id, key); }
		catch (error) { if (!destroyed) errors.set(id, error.message || 'Could not save reaction.'); }
		finally { pending.delete(id); if (!destroyed) refresh(id); }
	}
	function open(button) {
		close(); opener = button;
		picker = clone('picker');
		const grid = picker.firstElementChild;
		for (const key of REACTION_ORDER) {
			const choice = clone('choice');
			choice.setAttribute('aria-label', label(key)); choice.title = label(key); choice.firstElementChild.innerHTML = REACTION_ICONS[key]('comment-reaction-icon');
			choice.addEventListener('click', () => { const id = button.dataset.chatMessageId; close(true); void react(id, key); }); grid.append(choice);
		}
		picker.append(grid); document.body.append(picker);
		grid.addEventListener('keydown', (event) => {
			const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 };
			if (!(event.key in steps)) return;
			event.preventDefault();
			const choices = [...grid.children]; const index = choices.indexOf(document.activeElement);
			choices[(index + steps[event.key] + choices.length) % choices.length]?.focus({ preventScroll: true });
		});
		const rect = button.getBoundingClientRect(); const bounds = picker.getBoundingClientRect();
		picker.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8))}px`;
		picker.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - bounds.height - 8))}px`;
		grid.firstChild.focus({ preventScroll: true });
	}
	root.addEventListener('click', (event) => {
		const pill = event.target.closest('.comment-reaction-pill, .connect-chat-msg-hover-react'); if (pill && !pill.disabled) void react(pill.dataset.chatMessageId, pill.dataset.emojiKey);
		const add = event.target.closest('.comment-reaction-add, .connect-chat-msg-hover-add-react'); if (add && !add.disabled) open(add);
	}, { signal: abort.signal });
	document.addEventListener('pointerdown', (event) => { if (picker && !picker.contains(event.target) && !opener?.contains(event.target)) close(); }, { signal: abort.signal });
	document.addEventListener('keydown', (event) => { if (picker && event.key === 'Escape') { event.preventDefault(); close(true); } }, { signal: abort.signal });
	document.addEventListener('focusin', (event) => { if (picker && !picker.contains(event.target) && event.target !== opener) close(); }, { signal: abort.signal });
	window.addEventListener('resize', () => close(), { signal: abort.signal });
	document.addEventListener('scroll', () => close(), { capture: true, passive: true, signal: abort.signal });
	return { update, close, destroy() { destroyed = true; abort.abort(); close(); pending.clear(); errors.clear(); } };
}
