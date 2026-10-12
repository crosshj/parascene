import './creation-details.css';
import { createModalDismissButton } from '../../shared/modalDismiss.js';

const html = String.raw;

class AppModalCreationDetails extends HTMLElement {
	constructor() {
		super();
		this._isOpen = false;
		this._meta = null;
		this._creationId = null;
		this._description = '';
		this._groupContext = null;
		this.handleOpen = this.handleOpen.bind(this);
		this.handleCloseAllModals = this.handleCloseAllModals.bind(this);
		this.handleDialogClose = this.handleDialogClose.bind(this);
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();
		this.setupEventListeners();
	}

	disconnectedCallback() {
		document.removeEventListener('open-creation-details-modal', this.handleOpen);
		document.removeEventListener('close-all-modals', this.handleCloseAllModals);
		const dialog = this.querySelector('dialog[data-overlay]');
		dialog?.removeEventListener('close', this.handleDialogClose);
	}

	/** @returns {HTMLDialogElement | null} */
	get dialog() {
		const el = this.querySelector('dialog[data-overlay]');
		return el?.tagName === 'DIALOG' ? /** @type {HTMLDialogElement} */ (el) : null;
	}

	render() {
		this.innerHTML = html`
			<dialog class="app-dialog creation-details-dialog" data-overlay aria-labelledby="creation-details-title">
				<header class="app-dialog__header">
					<h2 id="creation-details-title" class="app-dialog__title">More Info</h2>
				</header>
				<div class="app-dialog__body">
					<div class="field" data-group-context-field hidden>
						<div class="label">Grouped creation</div>
						<p class="creation-details-args-hint" data-group-context-hint></p>
						<pre class="creation-details-args" data-group-context></pre>
					</div>
					<div class="field" data-args-field>
						<div class="label">Sent to provider</div>
						<p class="creation-details-args-hint" data-args-hint>Exact <code>method</code> and <code>args</code> payload used for the generation job.</p>
						<pre class="creation-details-args" data-args></pre>
					</div>
					<div class="field" data-provider-error-field hidden>
						<div class="label">Provider error</div>
						<pre class="creation-details-args" data-provider-error></pre>
					</div>
				</div>
				<footer class="app-dialog__footer">
					<button type="button" class="btn-secondary" data-close-secondary>Close</button>
				</footer>
			</dialog>
		`;
		const dialog = this.dialog;
		const header = dialog?.querySelector('header');
		if (dialog && header) {
			const dismiss = createModalDismissButton();
			dismiss.addEventListener('click', () => this.close());
			header.append(dismiss);
		}
	}

	setupEventListeners() {
		document.addEventListener('open-creation-details-modal', this.handleOpen);
		document.addEventListener('close-all-modals', this.handleCloseAllModals);

		const dialog = this.dialog;
		const closeSecondary = this.querySelector('[data-close-secondary]');

		dialog?.addEventListener('click', (e) => {
			if (e.target === dialog) this.close();
		});
		dialog?.addEventListener('close', this.handleDialogClose);

		if (closeSecondary) {
			closeSecondary.addEventListener('click', () => this.close());
		}
	}

	handleDialogClose() {
		this._isOpen = false;
	}

	handleCloseAllModals() {
		this.close();
	}

	handleOpen(event) {
		const detail = event.detail || {};
		this._meta = detail.meta || null;
		this._creationId = detail.creationId || null;
		this._description = detail.description || '';
		this._groupContext = detail.groupContext && typeof detail.groupContext === 'object' ? detail.groupContext : null;
		this.updateContent();
		this.open();
	}

	updateContent() {
		const meta = this._meta || {};
		const groupContext = this._groupContext;
		const groupField = this.querySelector('[data-group-context-field]');
		const groupHint = this.querySelector('[data-group-context-hint]');
		const groupEl = this.querySelector('[data-group-context]');
		const argsEl = this.querySelector('[data-args]');
		const argsField = this.querySelector('[data-args-field]');
		const argsHint = this.querySelector('[data-args-hint]');
		const providerErrorField = this.querySelector('[data-provider-error-field]');
		const providerErrorEl = this.querySelector('[data-provider-error]');

		if (groupField instanceof HTMLElement && groupEl) {
			if (!groupContext) {
				groupField.hidden = true;
				groupEl.textContent = '';
				if (groupHint) groupHint.textContent = '';
			} else {
				groupField.hidden = false;
				const selectedTitle =
					typeof groupContext.selectedSourceTitle === 'string' && groupContext.selectedSourceTitle.trim()
						? groupContext.selectedSourceTitle.trim()
						: (groupContext.selectedSourceId != null ? `#${groupContext.selectedSourceId}` : '—');
				if (groupHint) {
					groupHint.textContent =
						`Group row #${groupContext.groupCreationId ?? '—'} · ${groupContext.sourceCount ?? 0} sources · showing generation info for the selected image (${selectedTitle}).`;
				}
				try {
					groupEl.textContent = JSON.stringify(groupContext, null, 2);
				} catch {
					groupEl.textContent = String(groupContext);
				}
			}
		}

		const args = meta.args ?? null;
		const isPlainObject = args && typeof args === 'object' && !Array.isArray(args);

		if (argsField instanceof HTMLElement) {
			argsField.hidden = !isPlainObject;
		}
		if (argsHint instanceof HTMLElement) {
			if (!isPlainObject) {
				argsHint.hidden = true;
			} else if (groupContext) {
				argsHint.textContent = 'Provider payload for the selected group source (not the group row).';
				argsHint.hidden = false;
			} else {
				argsHint.textContent = 'Exact method and args payload used for the generation job.';
				argsHint.hidden = false;
			}
		}
		if (argsEl && isPlainObject) {
			try {
				const payload = {
					method: typeof meta.method === 'string' ? meta.method : null,
					server_id: meta.server_id != null ? meta.server_id : null,
					args
				};
				argsEl.textContent = JSON.stringify(payload, null, 2);
			} catch {
				argsEl.textContent = String(args ?? '');
			}
		} else if (argsEl) {
			argsEl.textContent = '';
		}

		const providerError = meta.provider_error ?? null;
		if (providerErrorField instanceof HTMLElement && providerErrorEl) {
			if (!providerError || typeof providerError !== 'object') {
				providerErrorField.hidden = true;
				providerErrorEl.textContent = '';
			} else {
				providerErrorField.hidden = false;
				try {
					const body = providerError.body;
					const msg =
						body && typeof body === 'object'
							? (typeof body.error === 'string' ? body.error : (typeof body.message === 'string' ? body.message : ''))
							: (typeof body === 'string' ? body : '');
					if (msg) {
						providerErrorEl.textContent = msg;
					} else {
						providerErrorEl.textContent = JSON.stringify(providerError, null, 2);
					}
				} catch {
					providerErrorEl.textContent = String(providerError);
				}
			}
		}
	}

	open() {
		const dialog = this.dialog;
		if (!dialog) return;
		if (this._isOpen && dialog.open) return;
		this._isOpen = true;
		if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
	}

	close() {
		const dialog = this.dialog;
		if (!dialog) {
			this._isOpen = false;
			return;
		}
		if (!this._isOpen && !dialog.open) return;
		this._isOpen = false;
		if (dialog.open && typeof dialog.close === 'function') dialog.close();
	}
}

customElements.define('app-modal-creation-details', AppModalCreationDetails);
