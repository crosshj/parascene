import markup from './Composer.html';
import { createTemplateFactory } from '../../utils/dom.js';

const clone = createTemplateFactory(markup);

// Shared shell composer binding. Controllers supply intent and own its lifetime.
export function bindMessageComposer({ form, onSend, onReplyChange }) {
	const input = form.querySelector('textarea');
	const send = form.querySelector('[type="submit"]');
	const attachment = form.querySelector('[aria-label="Add attachment"]');
	let ready = false;
	let reply = null;
	const replyBar = clone('reply');
	const replyText = replyBar.querySelector('.chat-page-composer-reply-text');
	const dismiss = replyBar.querySelector('button');
	form.prepend(replyBar);
	const resize = new ResizeObserver(() => form.parentElement?.style.setProperty('--messages-composer-height', `${form.getBoundingClientRect().height + 16}px`));
	resize.observe(form);
	function clearReply() { reply = null; replyBar.hidden = true; onReplyChange?.(null); }
	dismiss.addEventListener('click', clearReply);
	function sync() { input.disabled = !ready; send.disabled = !ready || !input.value.trim(); input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; }
	function submit(event) {
		event.preventDefault();
		const body = input.value.trim();
		if (!ready || !body) return;
		if (onSend(body, reply) !== false) { input.value = ''; clearReply(); sync(); input.focus(); }
	}
	function keydown(event) {
		if (event.key === 'Escape' && reply) { event.preventDefault(); clearReply(); return; }
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && matchMedia('(hover: hover) and (pointer: fine)').matches) submit(event);
	}
	input.maxLength = 4000;
	if (attachment) attachment.hidden = true;
	input.addEventListener('input', sync);
	input.addEventListener('keydown', keydown);
	form.addEventListener('submit', submit);
	sync();
	return {
		setReply(value) { reply = value; onReplyChange?.(value.referenced_id); replyText.textContent = `Replying to ${value.sender_user_name ? '@' + value.sender_user_name : 'User ' + value.sender_id}: ${value.preview_text || ''}`; replyBar.hidden = false; input.focus(); },
		setReady(value) { ready = value; sync(); },
		destroy() {
			resize.disconnect(); form.parentElement?.style.removeProperty('--messages-composer-height');
			dismiss.removeEventListener('click', clearReply); replyBar.remove(); reply = null;
			input.removeEventListener('input', sync); input.removeEventListener('keydown', keydown); form.removeEventListener('submit', submit);
			input.disabled = false; input.value = ''; input.style.height = ''; input.removeAttribute('maxlength'); send.disabled = true;
			if (attachment) attachment.hidden = false;
		},
	};
}
