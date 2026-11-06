/**
 * Shared "Add Image" modal DOM + behavior for provider image fields.
 * Single implementation — embedded under a field wrapper or portaled to document.body.
 */

/**
 * @param {string} linkPanelInputClassName - e.g. form-input for URL field in link/upload flows
 */
export function createImagePickerModalDom(linkPanelInputClassName) {
	const modalOverlay = document.createElement('div');
	modalOverlay.className = 'image-picker-modal-overlay';
	modalOverlay.setAttribute('data-image-picker-modal', '');
	const modal = document.createElement('div');
	modal.className = 'image-picker-modal';
	const modalHeader = document.createElement('div');
	modalHeader.className = 'modal-header';
	const modalTitle = document.createElement('h3');
	modalTitle.textContent = 'Add Image';
	const modalClose = document.createElement('button');
	modalClose.type = 'button';
	modalClose.className = 'modal-close';
	modalClose.setAttribute('aria-label', 'Close');
	modalClose.textContent = '×';
	modalHeader.appendChild(modalTitle);
	modalHeader.appendChild(modalClose);
	modal.appendChild(modalHeader);
	const modalBody = document.createElement('div');
	modalBody.className = 'image-picker-modal-body';

	const methodButtons = document.createElement('div');
	methodButtons.className = 'image-picker-methods';
	const methodIntro = document.createElement('p');
	methodIntro.className = 'image-picker-method-intro';
	methodIntro.textContent = 'Use one of these methods:';
	const methodHelp = document.createElement('p');
	methodHelp.className = 'image-picker-method-help';
	methodHelp.innerHTML = [
		'<span class="image-picker-method-help-item">Use <strong>+</strong> to upload an image.</span>',
		'<span class="image-picker-method-help-item">Paste an image in the input.</span>',
		'<span class="image-picker-method-help-item">Enter an image URL in the input.</span>'
	].join('');
	const composerRow = document.createElement('div');
	composerRow.className = 'image-picker-composer-row';
	const addFromFileBtn = document.createElement('button');
	addFromFileBtn.type = 'button';
	addFromFileBtn.className = 'image-picker-composer-add';
	addFromFileBtn.setAttribute('aria-label', 'Choose image file');
	addFromFileBtn.textContent = '+';
	const pasteInput = document.createElement('input');
	pasteInput.type = 'url';
	pasteInput.className = 'image-url-input image-picker-composer-input';
	pasteInput.placeholder = 'Paste image or enter URL';
	pasteInput.setAttribute('aria-label', 'Paste image or enter image URL');
	const pasteSubmitBtn = document.createElement('button');
	pasteSubmitBtn.type = 'button';
	pasteSubmitBtn.className = 'image-picker-composer-send';
	pasteSubmitBtn.setAttribute('aria-label', 'Use this image URL');
	pasteSubmitBtn.innerHTML = '&#10148;';
	pasteSubmitBtn.hidden = true;
	pasteSubmitBtn.disabled = true;
	const pasteUrlHint = document.createElement('p');
	pasteUrlHint.className = 'image-picker-url-hint';
	pasteUrlHint.textContent = 'Enter a valid image URL (http:// or https://).';
	composerRow.appendChild(addFromFileBtn);
	composerRow.appendChild(pasteInput);
	composerRow.appendChild(pasteSubmitBtn);
	methodButtons.appendChild(methodIntro);
	methodButtons.appendChild(methodHelp);
	methodButtons.appendChild(pasteUrlHint);
	methodButtons.appendChild(composerRow);

	const pastePanel = document.createElement('div');
	pastePanel.className = 'image-picker-panel';
	pastePanel.setAttribute('data-image-picker-panel', 'paste_image');
	pastePanel.hidden = true;
	const pasteZone = document.createElement('div');
	pasteZone.setAttribute('tabindex', '0');
	pasteZone.setAttribute('role', 'button');
	pasteZone.setAttribute('aria-label', 'Paste image here. Focus then Ctrl+V or Cmd+V.');
	pasteZone.className = 'image-picker-paste-zone';
	pasteZone.textContent = 'Paste image here — focus this box, then Ctrl+V (or Cmd+V)';
	const pasteReady = document.createElement('div');
	pasteReady.className = 'image-picker-ready';
	pasteReady.hidden = true;
	const pasteReadyThumb = document.createElement('img');
	pasteReadyThumb.className = 'image-picker-ready-thumb';
	pasteReadyThumb.alt = '';
	const pasteReadyText = document.createElement('span');
	pasteReadyText.className = 'image-picker-ready-text';
	pasteReady.appendChild(pasteReadyThumb);
	pasteReady.appendChild(pasteReadyText);
	const pasteAttachBtn = document.createElement('button');
	pasteAttachBtn.type = 'button';
	pasteAttachBtn.className = 'btn-secondary image-picker-attach-btn';
	pasteAttachBtn.textContent = 'Attach';
	pasteAttachBtn.disabled = true;
	pastePanel.appendChild(pasteZone);
	pastePanel.appendChild(pasteReady);
	pastePanel.appendChild(pasteAttachBtn);

	const linkPanel = document.createElement('div');
	linkPanel.className = 'image-picker-panel';
	linkPanel.setAttribute('data-image-picker-panel', 'paste_link');
	linkPanel.hidden = true;
	const urlInput = document.createElement('input');
	urlInput.type = 'url';
	urlInput.className = `${linkPanelInputClassName} image-url-input`.trim();
	urlInput.placeholder = 'Paste image or enter URL';
	urlInput.setAttribute('data-image-url-input', '');
	const linkAttachBtn = document.createElement('button');
	linkAttachBtn.type = 'button';
	linkAttachBtn.className = 'btn-secondary image-picker-attach-btn';
	linkAttachBtn.textContent = 'Attach';
	linkAttachBtn.disabled = true;
	pastePanel.appendChild(urlInput);
	pastePanel.appendChild(linkAttachBtn);
	linkPanel.appendChild(urlInput);
	linkPanel.appendChild(linkAttachBtn);

	const uploadPanel = document.createElement('div');
	uploadPanel.className = 'image-picker-panel';
	uploadPanel.setAttribute('data-image-picker-panel', 'upload_file');
	uploadPanel.hidden = true;
	const chooseLabel = document.createElement('label');
	chooseLabel.className = 'image-choose-label';
	const chooseSpan = document.createElement('span');
	chooseSpan.className = 'image-choose-btn';
	chooseSpan.textContent = 'Choose file';
	const fileInput = document.createElement('input');
	fileInput.type = 'file';
	fileInput.className = 'image-file-input';
	fileInput.accept = 'image/*';
	fileInput.style.position = 'absolute';
	fileInput.style.left = '-9999px';
	fileInput.style.width = '1px';
	fileInput.style.height = '1px';
	fileInput.style.opacity = '0';
	fileInput.style.pointerEvents = 'none';
	chooseLabel.appendChild(chooseSpan);
	chooseLabel.appendChild(fileInput);
	const uploadReady = document.createElement('div');
	uploadReady.className = 'image-picker-ready';
	uploadReady.hidden = true;
	const uploadReadyText = document.createElement('span');
	uploadReadyText.className = 'image-picker-ready-text';
	uploadReady.appendChild(uploadReadyText);
	const uploadAttachBtn = document.createElement('button');
	uploadAttachBtn.type = 'button';
	uploadAttachBtn.className = 'btn-secondary image-picker-attach-btn';
	uploadAttachBtn.textContent = 'Attach';
	uploadAttachBtn.disabled = true;
	uploadPanel.appendChild(chooseLabel);
	uploadPanel.appendChild(uploadReady);
	uploadPanel.appendChild(uploadAttachBtn);

	const modalError = document.createElement('p');
	modalError.className = 'image-field-error image-picker-modal-error';
	modalError.setAttribute('role', 'alert');
	modalError.hidden = true;
	modalBody.appendChild(methodButtons);
	modalBody.appendChild(pastePanel);
	modalBody.appendChild(linkPanel);
	modalBody.appendChild(uploadPanel);
	modalBody.appendChild(modalError);
	modal.appendChild(modalBody);
	modalOverlay.appendChild(modal);

	return {
		modalOverlay,
		modal,
		modalHeader,
		modalClose,
		modalBody,
		methodButtons,
		methodIntro,
		methodHelp,
		composerRow,
		addFromFileBtn,
		pasteInput,
		pasteSubmitBtn,
		pasteUrlHint,
		pastePanel,
		pasteZone,
		pasteReady,
		pasteReadyThumb,
		pasteReadyText,
		pasteAttachBtn,
		linkPanel,
		urlInput,
		linkAttachBtn,
		uploadPanel,
		chooseLabel,
		fileInput,
		uploadReady,
		uploadReadyText,
		uploadAttachBtn,
		modalError
	};
}

function isValidImageUrl(value) {
	const raw = typeof value === 'string' ? value.trim() : '';
	if (!raw) return false;
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
		const host = (parsed.hostname || '').toLowerCase();
		if (!host) return false;
		const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
		const isIpv6 = host.includes(':');
		const isLocalhost = host === 'localhost';
		const hasDot = host.includes('.');
		return hasDot || isLocalhost || isIpv4 || isIpv6;
	} catch {
		return false;
	}
}

/**
 * @param {ReturnType<createImagePickerModalDom>} refs
 * @param {{ detachOnClose: boolean, onPick: (value: string | File) => void, setModalAlert?: (msg: string) => void }} options
 */
export function wireImagePickerModal(refs, options) {
	const {
		modalOverlay,
		modal,
		modalClose,
		methodButtons,
		pastePanel,
		linkPanel,
		uploadPanel,
		addFromFileBtn,
		pasteInput,
		pasteSubmitBtn,
		pasteUrlHint,
		pasteAttachBtn,
		linkAttachBtn,
		uploadAttachBtn,
		pasteReady,
		pasteZone,
		uploadReady,
		fileInput,
		urlInput,
		modalError,
		uploadReadyText
	} = refs;

	const detachOnClose = options.detachOnClose === true;
	const onPick = options.onPick;
	const setModalAlert =
		typeof options.setModalAlert === 'function'
			? options.setModalAlert
			: (msg) => {
					modalError.textContent = msg || '';
					modalError.hidden = !msg;
			  };

	let pastePreviewUrl = null;
	let pendingPasteFile = null;
	let pendingUploadFile = null;

	function revokePastePreview() {
		if (pastePreviewUrl) {
			URL.revokeObjectURL(pastePreviewUrl);
			pastePreviewUrl = null;
		}
	}

	function updatePasteSubmitState() {
		const raw = (pasteInput.value || '').trim();
		const hasText = raw.length > 0;
		const valid = isValidImageUrl(raw);
		pasteSubmitBtn.hidden = !hasText;
		pasteSubmitBtn.disabled = !valid;
		pasteUrlHint.classList.toggle('is-visible', hasText && !valid);
	}

	function handleEscape(e) {
		if (e.key === 'Escape' && modalOverlay.classList.contains('open')) {
			closeModal();
			e.preventDefault();
		}
	}

	function closeModal() {
		modalOverlay.classList.remove('open');
		pastePanel.hidden = true;
		linkPanel.hidden = true;
		uploadPanel.hidden = true;
		pasteAttachBtn.disabled = true;
		linkAttachBtn.disabled = true;
		uploadAttachBtn.disabled = true;
		pasteInput.value = '';
		urlInput.value = '';
		fileInput.value = '';
		pendingPasteFile = null;
		pendingUploadFile = null;
		revokePastePreview();
		pasteReady.hidden = true;
		pasteZone.hidden = false;
		uploadReady.hidden = true;
		updatePasteSubmitState();
		if (detachOnClose) {
			methodButtons.hidden = false;
			modalError.textContent = '';
			modalError.hidden = true;
			document.removeEventListener('keydown', handleEscape);
			modalOverlay.remove();
		}
	}

	function openModal() {
		modalOverlay.classList.add('open');
		methodButtons.hidden = false;
		pastePanel.hidden = true;
		linkPanel.hidden = true;
		uploadPanel.hidden = true;
		setModalAlert('');
		pasteInput.focus();
		updatePasteSubmitState();
	}

	document.addEventListener('keydown', handleEscape);

	modalClose.addEventListener('click', () => closeModal());
	modalOverlay.addEventListener('click', (e) => {
		if (e.target === modalOverlay) closeModal();
	});
	modal.addEventListener('click', (e) => e.stopPropagation());

	addFromFileBtn.addEventListener('click', () => {
		setModalAlert('');
		fileInput.click();
	});

	pasteInput.addEventListener('paste', (e) => {
		const items = e.clipboardData?.items;
		if (items) {
			for (const item of items) {
				if (!item.type.startsWith('image/')) continue;
				e.preventDefault();
				const file = item.getAsFile();
				if (file) {
					setModalAlert('');
					onPick(file);
					closeModal();
				}
				return;
			}
		}
		const text = e.clipboardData?.getData?.('text/plain');
		const next = typeof text === 'string' ? text.trim() : '';
		if (next) {
			e.preventDefault();
			pasteInput.value = next;
			updatePasteSubmitState();
		}
	});
	pasteInput.addEventListener('input', () => {
		updatePasteSubmitState();
	});
	pasteInput.addEventListener('keydown', (e) => {
		if (e.key !== 'Enter') return;
		const v = (pasteInput.value || '').trim();
		if (!isValidImageUrl(v)) return;
		e.preventDefault();
		onPick(v);
		closeModal();
	});
	pasteSubmitBtn.addEventListener('click', () => {
		const v = (pasteInput.value || '').trim();
		if (!isValidImageUrl(v)) return;
		onPick(v);
		closeModal();
	});

	urlInput.addEventListener('paste', (e) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				const file = item.getAsFile();
				if (file) {
					setModalAlert('');
					onPick(file);
					closeModal();
				}
				return;
			}
		}
		const text = e.clipboardData?.getData?.('text/plain');
		const next = typeof text === 'string' ? text.trim() : '';
		if (next) {
			e.preventDefault();
			onPick(next);
			closeModal();
		}
	});
	urlInput.addEventListener('keydown', (e) => {
		if (e.key !== 'Enter') return;
		const v = (urlInput.value || '').trim();
		if (!v) return;
		e.preventDefault();
		onPick(v);
		closeModal();
	});
	pasteAttachBtn.addEventListener('click', () => {
		if (pendingPasteFile) {
			onPick(pendingPasteFile);
			closeModal();
		}
	});

	urlInput.addEventListener('input', () => {
		linkAttachBtn.disabled = !(urlInput.value || '').trim();
		setModalAlert('');
	});
	urlInput.addEventListener('change', () => {
		linkAttachBtn.disabled = !(urlInput.value || '').trim();
	});
	linkAttachBtn.addEventListener('click', () => {
		const v = (urlInput.value || '').trim();
		if (v) {
			onPick(v);
			closeModal();
		}
	});

	fileInput.addEventListener('change', () => {
		const file = fileInput.files?.[0];
		if (!file || !file.type.startsWith('image/')) {
			if (file) {
				setModalAlert('Please choose an image file.');
			}
			uploadAttachBtn.disabled = true;
			pendingUploadFile = null;
			uploadReady.hidden = true;
			return;
		}
		pendingUploadFile = file;
		uploadReadyText.textContent = `Selected: ${file.name}`;
		uploadReady.hidden = false;
		uploadAttachBtn.disabled = false;
		setModalAlert('');
		onPick(file);
		closeModal();
	});
	uploadAttachBtn.addEventListener('click', () => {
		if (pendingUploadFile) {
			onPick(pendingUploadFile);
			closeModal();
		}
	});

	return { openModal, closeModal };
}
