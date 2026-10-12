import markup from './Composer.html';
import './Composer.css';
import { createTemplateFactory } from '../../utils/dom.js';
import { sendIcon } from '../../icons/svg-strings.js';
import { uploadChatFile } from '../../shared/chatFileUpload.js';
import { openChatInlineImageLightbox } from '../../shared/chatInlineImageLightbox.js';
import { openImagePickerModal } from '../ProviderFields/ProviderFields.js';
import {
	attachChatComposerSuggest,
	disposeTriggeredSuggestFields,
	isTriggeredSuggestPopupOpen,
} from '../../shared/triggeredSuggest.js';
import { composerEnterShouldSend } from '../../shared/composerEnterGuard.js';
import {
	COMPOSER_GEN_POLL_MS,
	COMPOSER_GEN_PREVIEW_PLACEHOLDER,
	parseGenCommand,
	pollComposerGenOnce,
	startComposerGenFromPrompt,
} from '../../shared/composerGen.js';

const clone = createTemplateFactory(markup);
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_BODY_CHARS = 4000;

export function createMessageComposerElement() {
	const form = clone('message-composer');
	form.querySelector('[type="submit"]').innerHTML = sendIcon('chat-page-send-icon');
	return form;
}

function clipboardImageFiles(clipboardData) {
	const files = [];
	const seen = new Set();
	for (const item of Array.from(clipboardData?.items || [])) {
		if (item?.kind !== 'file' || !String(item.type || '').startsWith('image/')) continue;
		const file = item.getAsFile?.();
		if (file && !seen.has(file)) {
			seen.add(file);
			files.push(file);
		}
	}
	// Clipboard images are commonly exposed through both `items` and `files`.
	// getAsFile() can return a different File object for the same payload, so
	// identity-based de-duplication across both collections still uploads twice.
	if (!files.length) {
		for (const file of Array.from(clipboardData?.files || [])) {
			if (file?.type?.startsWith('image/')) files.push(file);
		}
	}
	return files;
}

// Shared shell composer binding. Controllers supply send intent and own its lifetime.
export function bindMessageComposer({
	form,
	onSend,
	onReplyChange,
	isSuggestOpen = isTriggeredSuggestPopupOpen,
}) {
	const input = form.querySelector('textarea');
	const send = form.querySelector('[type="submit"]');
	const attachmentButton = form.querySelector('.chat-page-composer-attach-inline');
	const attachmentStrip = form.querySelector('.chat-page-composer-attachments');
	const attachmentList = form.querySelector('.chat-page-composer-attachments-list');
	const uploadError = form.querySelector('.chat-page-composer-upload-error');
	const replyBar = form.querySelector('.chat-page-composer-reply');
	const replyText = form.querySelector('.chat-page-composer-reply-text');
	const dismiss = replyBar.querySelector('button');
	const attachments = new Map();
	const genPollTimers = new Map();
	let ready = false;
	let reply = null;
	let submitting = false;
	let destroyed = false;

	function clearReply() {
		reply = null;
		replyBar.hidden = true;
		onReplyChange?.(null);
	}

	function stopGenPoll(id) {
		const timer = genPollTimers.get(String(id));
		if (timer != null) {
			clearInterval(timer);
			genPollTimers.delete(String(id));
		}
	}

	function stopAllGenPolls() {
		for (const timer of genPollTimers.values()) clearInterval(timer);
		genPollTimers.clear();
	}

	function sync() {
		const text = input.value.trim();
		// Match WWW: in-flight /gen attachments do not block sending other ready media.
		const pending = [...attachments.values()].some((item) => item.status === 'uploading' && item.source !== 'gen');
		const hasReadyAttachment = [...attachments.values()].some((item) => item.status === 'ready');
		const hasContent = Boolean(text || hasReadyAttachment);
		input.disabled = !ready;
		attachmentButton.disabled = !ready || submitting;
		send.hidden = !hasContent;
		send.disabled = !ready || submitting || pending || !hasContent;
		form.querySelector('.chat-page-input-shell').classList.toggle('is-at-limit', input.value.length >= MAX_BODY_CHARS);
		input.style.height = 'auto';
		input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
	}

	function renderAttachments() {
		attachmentList.replaceChildren();
		for (const item of attachments.values()) {
			const card = document.createElement('div');
			card.className = 'chat-page-composer-attachment';
			if (item.status === 'error') card.classList.add('chat-page-composer-attachment--error');
			if (item.previewUrl && item.kind === 'image') {
				if (item.status === 'ready') {
					const preview = document.createElement('button');
					preview.type = 'button';
					preview.className = 'chat-page-composer-attachment-preview-button';
					preview.setAttribute('aria-label', `View ${item.name || 'attached image'}`);
					preview.addEventListener('click', () => openChatInlineImageLightbox(item.url || item.previewUrl));
					const image = document.createElement('img');
					image.className = 'chat-page-composer-attachment-preview';
					image.alt = '';
					image.src = item.previewUrl;
					preview.append(image);
					card.append(preview);
				} else {
					const image = document.createElement('img');
					image.className = 'chat-page-composer-attachment-preview';
					image.alt = '';
					image.src = item.previewUrl;
					card.append(image);
				}
			} else {
				const preview = document.createElement('div');
				preview.className = 'chat-page-composer-attachment-preview chat-page-composer-attachment-preview--file';
				const name = document.createElement('span');
				name.className = 'chat-page-composer-attachment-file-name';
				name.textContent = item.name || item.file?.name || 'file';
				preview.append(name);
				card.append(preview);
			}
			if (item.status === 'uploading') {
				const overlay = document.createElement('div');
				overlay.className = 'chat-page-composer-attachment-uploading';
				const spinner = document.createElement('div');
				spinner.className = 'chat-page-composer-attachment-spinner';
				overlay.append(spinner);
				card.append(overlay);
			} else if (item.status === 'error') {
				const error = document.createElement('div');
				error.className = 'chat-page-composer-attachment-error';
				error.textContent = 'Failed';
				error.title = item.error || '';
				card.append(error);
			}
			const remove = document.createElement('button');
			remove.type = 'button';
			remove.className = 'chat-page-composer-attachment-remove';
			remove.setAttribute('aria-label', `Remove ${item.name || item.file?.name || 'attachment'}`);
			remove.textContent = '×';
			remove.addEventListener('click', () => removeAttachment(item.id));
			card.append(remove);
			attachmentList.append(card);
		}
		attachmentStrip.hidden = attachments.size === 0;
		attachmentStrip.classList.toggle('chat-page-composer-attachments--has-media', attachments.size > 0);
		sync();
	}

	function removeAttachment(id) {
		const item = attachments.get(id);
		if (!item) return;
		stopGenPoll(id);
		attachments.delete(id);
		if (item.previewUrl && item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
		renderAttachments();
	}

	function startGenPoll(attachmentId) {
		const idKey = String(attachmentId || '');
		if (!idKey || genPollTimers.has(idKey)) return;
		const tick = async () => {
			const item = attachments.get(idKey);
			if (!item || destroyed) {
				stopGenPoll(idKey);
				return;
			}
			if (!Number.isFinite(Number(item.generationId)) || Number(item.generationId) <= 0) return;
			const result = await pollComposerGenOnce(item.generationId);
			if (destroyed || !attachments.has(idKey)) {
				stopGenPoll(idKey);
				return;
			}
			if (result.state === 'pending') return;
			if (result.state === 'ready') {
				item.status = 'ready';
				item.url = result.url;
				item.previewUrl = result.thumbnailUrl || result.fullImageUrl || item.previewUrl;
				item.error = '';
				stopGenPoll(idKey);
				renderAttachments();
				return;
			}
			item.status = 'error';
			item.error = result.error || 'Generation failed';
			uploadError.textContent = item.error;
			uploadError.hidden = false;
			stopGenPoll(idKey);
			renderAttachments();
		};
		genPollTimers.set(idKey, setInterval(() => { void tick(); }, COMPOSER_GEN_POLL_MS));
		void tick();
	}

	async function runGenCommand(prompt) {
		const id = crypto.randomUUID();
		const item = {
			id,
			file: null,
			name: 'creation.png',
			previewUrl: COMPOSER_GEN_PREVIEW_PLACEHOLDER,
			kind: 'image',
			status: 'uploading',
			url: '',
			source: 'gen',
			generationId: null,
			error: '',
		};
		attachments.set(id, item);
		renderAttachments();
		try {
			const creationId = await startComposerGenFromPrompt(prompt);
			if (destroyed || !attachments.has(id)) return;
			item.generationId = creationId;
			startGenPoll(id);
		} catch (error) {
			if (destroyed || !attachments.has(id)) return;
			item.status = 'error';
			item.error =
				String(error?.message || '') === 'Cancelled /gen.'
					? 'Cancelled'
					: error?.message || 'Could not start /gen.';
			if (String(error?.message || '') !== 'Cancelled /gen.') {
				uploadError.textContent = item.error;
				uploadError.hidden = false;
			}
			renderAttachments();
		}
	}

	function addFiles(fileList) {
		if (!ready || submitting) return;
		uploadError.hidden = true;
		uploadError.textContent = '';
		for (const file of Array.from(fileList || [])) {
			if (!(file instanceof File)) continue;
			if (file.size > MAX_UPLOAD_BYTES) {
				uploadError.textContent = `“${file.name || 'File'}” is too large (max 50MB).`;
				uploadError.hidden = false;
				continue;
			}
			const id = crypto.randomUUID();
			const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
			const item = { id, file, name: file.name || '', previewUrl, kind: file.type.startsWith('image/') ? 'image' : 'file', status: 'uploading', url: '' };
			attachments.set(id, item);
			renderAttachments();
			void uploadChatFile(file).then((uploaded) => {
				if (destroyed || !attachments.has(id)) return;
				item.url = uploaded.url;
				if (uploaded.displayAsFile) item.kind = 'file';
				item.status = 'ready';
			}).catch((error) => {
				if (destroyed || !attachments.has(id)) return;
				item.status = 'error';
				item.error = error?.message || 'Upload failed';
				uploadError.textContent = item.error;
				uploadError.hidden = false;
			}).finally(() => {
				if (!destroyed && attachments.has(id)) renderAttachments();
			});
		}
	}

	function addUrlAttachment(value) {
		const url = String(value || '').trim();
		if (!url || !/^https?:\/\//i.test(url)) return;
		const id = crypto.randomUUID();
		attachments.set(id, { id, file: null, name: 'Image URL', previewUrl: url, kind: 'image', status: 'ready', url });
		renderAttachments();
	}

	function submit(event) {
		event.preventDefault();
		if (!ready || submitting) return;
		const text = input.value.trim();
		const genCmd = parseGenCommand(text);
		if (genCmd) {
			uploadError.hidden = true;
			uploadError.textContent = '';
			input.value = '';
			sync();
			void runGenCommand(genCmd.prompt);
			input.focus();
			return;
		}
		const pendingUpload = [...attachments.values()].some((item) => item.status === 'uploading' && item.source !== 'gen');
		if (pendingUpload || send.disabled) return;
		const urls = [...attachments.values()].filter((item) => item.status === 'ready').map((item) => item.url).filter(Boolean);
		const body = text ? (urls.length ? `${urls.join('\n')} ${text}` : text) : urls.join('\n');
		if (!body || body.length > MAX_BODY_CHARS) {
			uploadError.textContent = body ? 'Message is too long (max 4000 characters).' : '';
			uploadError.hidden = !body;
			return;
		}
		submitting = true;
		sync();
		if (onSend(body, reply) !== false) {
			input.value = '';
			// Keep in-flight /gen attachments after send (WWW clears only ready media).
			const keep = [...attachments.values()].filter((item) => item.source === 'gen' && item.status === 'uploading');
			for (const item of attachments.values()) {
				if (item.source === 'gen' && item.status === 'uploading') continue;
				if (item.previewUrl && item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
			}
			attachments.clear();
			for (const item of keep) attachments.set(item.id, item);
			clearReply();
			uploadError.hidden = true;
		} else {
			submitting = false;
		}
		submitting = false;
		renderAttachments();
		input.focus();
	}

	function keydown(event) {
		if (event.key === 'Escape' && reply) { event.preventDefault(); clearReply(); return; }
		if (
			composerEnterShouldSend(event, {
				field: input,
				isSuggestOpen,
				finePointerMatches: matchMedia('(hover: hover) and (pointer: fine)').matches,
			})
		) {
			submit(event);
		}
	}
	function paste(event) {
		if (!ready || submitting) return;
		const files = clipboardImageFiles(event.clipboardData);
		if (!files.length) return;
		event.preventDefault();
		addFiles(files);
	}
	function onPickFiles() {
		if (!ready || submitting) return;
		openImagePickerModal({
			modalParent: document.body,
			allowAnyFile: true,
			onSelect(value) {
				if (value instanceof File) addFiles([value]);
				else if (Array.isArray(value)) addFiles(value);
				else addUrlAttachment(value);
			},
		});
	}

	dismiss.addEventListener('click', clearReply);
	attachmentButton.addEventListener('click', onPickFiles);
	input.addEventListener('input', sync);
	input.addEventListener('keydown', keydown);
	input.addEventListener('paste', paste);
	form.addEventListener('submit', submit);
	input.maxLength = MAX_BODY_CHARS;
	attachChatComposerSuggest(input);
	sync();
	return {
		setReply(value) {
			reply = value;
			onReplyChange?.(value.referenced_id);
			replyText.textContent = `Replying to ${value.sender_user_name ? '@' + value.sender_user_name : 'User ' + value.sender_id}: ${value.preview_text || ''}`;
			replyBar.hidden = false;
			input.focus();
		},
		setReady(value) { ready = value; if (value) submitting = false; sync(); },
		destroy() {
			destroyed = true;
			stopAllGenPolls();
			disposeTriggeredSuggestFields(form);
			dismiss.removeEventListener('click', clearReply);
			attachmentButton.removeEventListener('click', onPickFiles);
			input.removeEventListener('input', sync);
			input.removeEventListener('keydown', keydown);
			input.removeEventListener('paste', paste);
			form.removeEventListener('submit', submit);
			for (const item of attachments.values()) {
				if (item.previewUrl && item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
			}
			attachments.clear();
			input.disabled = false;
			input.value = '';
			input.style.height = '';
			input.removeAttribute('maxlength');
			send.disabled = true;
			send.hidden = false;
			form.querySelector('.chat-page-input-shell').classList.remove('is-at-limit');
			attachmentStrip.hidden = true;
			replyBar.hidden = true;
		},
	};
}
