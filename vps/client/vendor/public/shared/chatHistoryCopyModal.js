/**
 * Copy chat history modal — loading progress, then copy plain-text export.
 */

/** @type {HTMLDialogElement | null} */
let modalEl = null;
let activeLoadToken = 0;

function getModalElements() {
	if (!modalEl) {
		modalEl = document.querySelector('[data-chat-history-copy-modal]');
	}
	if (!(modalEl instanceof HTMLDialogElement)) return null;
	return {
		modal: modalEl,
		closeBtn: modalEl.querySelector('[data-chat-history-copy-close-btn]'),
		progressPanel: modalEl.querySelector('[data-chat-history-copy-panel="progress"]'),
		readyPanel: modalEl.querySelector('[data-chat-history-copy-panel="ready"]'),
		progressBar: modalEl.querySelector('[data-chat-history-copy-progress-bar]'),
		progressLabel: modalEl.querySelector('[data-chat-history-copy-progress-label]'),
		errorEl: modalEl.querySelector('[data-chat-history-copy-error]'),
		copyBtn: modalEl.querySelector('[data-chat-history-copy-btn]'),
	};
}

function setActivePanel(els, panelName) {
	const panels = {
		progress: els.progressPanel,
		ready: els.readyPanel,
	};
	for (const [name, panel] of Object.entries(panels)) {
		if (panel instanceof HTMLElement) {
			panel.classList.toggle('is-active', name === panelName);
		}
	}
}

function showError(els, message) {
	if (els.errorEl instanceof HTMLElement) {
		els.errorEl.textContent = message || '';
		els.errorEl.classList.toggle('is-visible', Boolean(message));
	}
}

function showProgressState(els) {
	setActivePanel(els, 'progress');
	showError(els, '');
	if (els.copyBtn instanceof HTMLButtonElement) {
		els.copyBtn.hidden = true;
		els.copyBtn.disabled = true;
		els.copyBtn.textContent = 'Copy text';
	}
	if (els.progressBar instanceof HTMLElement) {
		els.progressBar.classList.add('is-cycling');
		els.progressBar.style.width = '';
	}
	if (els.progressLabel instanceof HTMLElement) {
		els.progressLabel.textContent = 'Loading chat history…';
	}
}

function showReadyState(els) {
	setActivePanel(els, 'ready');
	showError(els, '');
	if (els.progressBar instanceof HTMLElement) {
		els.progressBar.classList.remove('is-cycling');
		els.progressBar.style.width = '100%';
	}
	if (els.progressLabel instanceof HTMLElement) {
		els.progressLabel.textContent = 'Chat history loaded';
	}
	if (els.copyBtn instanceof HTMLButtonElement) {
		els.copyBtn.hidden = false;
		els.copyBtn.disabled = false;
	}
}

function showLoadErrorState(els, message) {
	setActivePanel(els, 'progress');
	if (els.progressBar instanceof HTMLElement) {
		els.progressBar.classList.remove('is-cycling');
		els.progressBar.style.width = '0';
	}
	if (els.progressLabel instanceof HTMLElement) {
		els.progressLabel.textContent = 'Could not load chat history';
	}
	showError(els, message);
	if (els.copyBtn instanceof HTMLButtonElement) {
		els.copyBtn.hidden = true;
		els.copyBtn.disabled = true;
	}
}

async function copyText(text) {
	const str = String(text ?? '');
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(str);
			return true;
		}
	} catch {
		// fall through
	}
	try {
		const ta = document.createElement('textarea');
		ta.value = str;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.left = '-9999px';
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		const ok = document.execCommand('copy');
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}

function bindModalHandlers(els, onClose) {
	if (els.modal.dataset.chatHistoryCopyBound === '1') return;
	els.modal.dataset.chatHistoryCopyBound = '1';

	const closeModal = () => {
		activeLoadToken += 1;
		document.body.classList.remove('modal-open');
		els.modal.close();
		if (typeof onClose === 'function') onClose();
	};

	if (els.closeBtn instanceof HTMLButtonElement) {
		els.closeBtn.onclick = closeModal;
	}
	els.modal.addEventListener('cancel', (e) => {
		e.preventDefault();
		closeModal();
	});
	els.modal.addEventListener('click', (e) => {
		if (e.target === els.modal) closeModal();
	});
}

/**
 * @param {{ loadHistory: () => (Promise<string> | string) }} options
 */
export function openChatHistoryCopyModal(options = {}) {
	const els = getModalElements();
	if (!els) return;
	const loadHistory = typeof options.loadHistory === 'function' ? options.loadHistory : null;
	if (!loadHistory) return;

	const loadToken = ++activeLoadToken;
	let historyText = '';

	bindModalHandlers(els);
	showProgressState(els);
	document.body.classList.add('modal-open');
	els.modal.showModal();

	if (els.copyBtn instanceof HTMLButtonElement) {
		els.copyBtn.onclick = async () => {
			if (!historyText) return;
			const ok = await copyText(historyText);
			if (!ok) {
				showError(els, 'Copy failed — try again');
				return;
			}
			showError(els, '');
			const prev = els.copyBtn.textContent;
			els.copyBtn.textContent = 'Copied';
			els.copyBtn.disabled = true;
			window.setTimeout(() => {
				if (loadToken !== activeLoadToken) return;
				if (els.copyBtn instanceof HTMLButtonElement) {
					els.copyBtn.textContent = prev || 'Copy text';
					els.copyBtn.disabled = false;
				}
			}, 2000);
		};
	}

	void (async () => {
		try {
			historyText = await loadHistory();
			if (loadToken !== activeLoadToken) return;
			if (!String(historyText || '').trim()) {
				showLoadErrorState(els, 'No messages to copy.');
				return;
			}
			showReadyState(els);
		} catch (err) {
			if (loadToken !== activeLoadToken) return;
			showLoadErrorState(els, err?.message || 'Could not load chat history');
		}
	})();
}
