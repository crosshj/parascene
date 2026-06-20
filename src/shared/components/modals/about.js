import { formatDateTime } from '../../datetime.js';
import { MODAL_DISMISS_ICON_SVG } from '../../modalDismiss.js';
import { getClientBuildInfo, formatBuildCommit } from '/shared/buildInfo.js';

const html = String.raw;

function formatDeployedAt(iso) {
	const value = String(iso || '').trim();
	if (!value) return 'Unknown';
	const formatted = formatDateTime(value, { dateStyle: 'long', timeStyle: 'short' });
	return formatted || value;
}

class AppModalAbout extends HTMLElement {
	constructor() {
		super();
		this._isOpen = false;
		this._initialized = false;
		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpenEvent = this.handleOpenEvent.bind(this);
		this.handleCloseAllModals = this.handleCloseAllModals.bind(this);
	}

	connectedCallback() {
		void this.initModal();
	}

	disconnectedCallback() {
		document.removeEventListener('keydown', this.handleEscape);
		document.removeEventListener('open-about-modal', this.handleOpenEvent);
		document.removeEventListener('close-all-modals', this.handleCloseAllModals);
	}

	setupEventListeners() {
		document.addEventListener('keydown', this.handleEscape);
		document.addEventListener('open-about-modal', this.handleOpenEvent);
		document.addEventListener('close-all-modals', this.handleCloseAllModals);

		const overlay = this.querySelector('.about-overlay');
		const closeButton = this.querySelector('.modal-dismiss');
		const okButton = this.querySelector('[data-about-close]');

		overlay?.addEventListener('click', (e) => {
			if (e.target === overlay) this.close();
		});
		closeButton?.addEventListener('click', () => this.close());
		okButton?.addEventListener('click', () => this.close());
	}

	handleOpenEvent() {
		this.open();
	}

	handleCloseAllModals() {
		this.close();
	}

	handleEscape(e) {
		if (e.key === 'Escape' && this.isOpen()) {
			this.close();
		}
	}

	isOpen() {
		return this._isOpen;
	}

	async initModal() {
		this.setAttribute('data-modal', '');
		if (this._initialized) return;
		this._initialized = true;
		this.render();
		this.setupEventListeners();
	}

	updateContent() {
		const info = getClientBuildInfo();
		const versionEl = this.querySelector('[data-about-version]');
		const commitEl = this.querySelector('[data-about-commit]');
		const deployedEl = this.querySelector('[data-about-deployed]');

		if (versionEl) {
			versionEl.textContent = info.version ? `Version ${info.version}` : 'Version unknown';
		}
		if (commitEl) {
			const short = formatBuildCommit(info.commit);
			commitEl.textContent = info.commit ? `Build ${short}` : 'Build unknown';
			commitEl.title = info.commit || '';
		}
		if (deployedEl) {
			const when = formatDeployedAt(info.deployedAt);
			deployedEl.textContent = when === 'Unknown' ? 'Deployed unknown' : `Deployed ${when}`;
		}
	}

	async open() {
		await this.initModal();
		if (this._isOpen) return;
		this._isOpen = true;
		this.updateContent();
		const overlay = this.querySelector('.about-overlay');
		overlay?.classList.add('open');
		document.dispatchEvent(new CustomEvent('close-notifications'));
		document.dispatchEvent(new CustomEvent('modal-opened'));
	}

	close() {
		if (!this._isOpen) return;
		this._isOpen = false;
		const overlay = this.querySelector('.about-overlay');
		overlay?.classList.remove('open');
		document.dispatchEvent(new CustomEvent('modal-closed'));
	}

	render() {
		this.innerHTML = html`
			<style>
				app-modal-about {
					display: block;
				}
				.about-overlay {
					position: fixed;
					inset: 0;
					background: rgba(0, 0, 0, 0.5);
					display: flex;
					align-items: center;
					justify-content: center;
					z-index: 100001;
					opacity: 0;
					visibility: hidden;
					pointer-events: none;
					transition: opacity 0.2s ease, visibility 0.2s ease;
					padding: 16px;
				}
				.about-overlay.open {
					opacity: 1;
					visibility: visible;
					pointer-events: auto;
				}
				.about-modal {
					background: var(--surface);
					border: 1px solid var(--border);
					border-radius: 14px;
					box-shadow: var(--shadow);
					width: min(100%, 380px);
					transform: scale(0.96);
					transition: transform 0.2s ease;
					overflow: hidden;
				}
				.about-overlay.open .about-modal {
					transform: scale(1);
				}
				.about-header {
					display: flex;
					align-items: center;
					justify-content: flex-end;
					padding: 10px 10px 0;
				}
				.about-body {
					padding: 8px 32px 4px;
					text-align: center;
				}
				.about-logo-wrap {
					display: flex;
					align-items: center;
					justify-content: center;
					margin: 0 auto 16px;
				}
				.about-logo {
					width: 64px;
					height: 64px;
					background: transparent;
				}
				.about-title {
					margin: 0 0 6px;
					font-size: 1.4rem;
					font-weight: 700;
					color: var(--text);
					letter-spacing: -0.01em;
				}
				.about-version {
					margin: 0 0 20px;
					font-size: 0.95rem;
					color: var(--text-muted);
				}
				.about-details {
					margin: 0 0 8px;
					padding: 0;
					text-align: center;
				}
				.about-detail-row {
					margin: 0;
					font-size: 0.88rem;
					line-height: 1.45;
					color: var(--text-muted);
				}
				.about-detail-row + .about-detail-row {
					margin-top: 6px;
				}
				.about-detail-label {
					display: none;
				}
				.about-detail-value {
					color: var(--text-muted);
					word-break: break-word;
				}
				.about-detail-value[data-about-commit] {
					font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
					font-size: 0.84rem;
				}
				.about-footer {
					padding: 20px 32px 28px;
					display: flex;
					justify-content: center;
				}
				.about-footer .btn-primary {
					min-width: 120px;
				}
				.modal-dismiss {
					background: transparent;
					border: none;
					color: var(--text-muted);
					cursor: pointer;
					padding: 6px;
					display: flex;
					align-items: center;
					justify-content: center;
					border-radius: 6px;
					transition: background-color 0.15s ease, color 0.15s ease;
				}
				.modal-dismiss:hover {
					background: var(--surface-strong);
					color: var(--text);
				}
				.modal-dismiss-icon {
					width: 22px;
					height: 22px;
				}
			</style>
			<div class="about-overlay" role="presentation">
				<div class="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-modal-title">
					<div class="about-header">
						<button type="button" class="modal-dismiss" aria-label="Close">${MODAL_DISMISS_ICON_SVG}</button>
					</div>
					<div class="about-body">
						<div class="about-logo-wrap">
							<img class="about-logo" src="/favicon.svg" width="64" height="64" alt="" aria-hidden="true" />
						</div>
						<h2 class="about-title" id="about-modal-title">Parascene</h2>
						<p class="about-version" data-about-version>Version</p>
						<div class="about-details">
							<p class="about-detail-row">
								<span class="about-detail-label">Commit</span>
								<span class="about-detail-value" data-about-commit>Unknown</span>
							</p>
							<p class="about-detail-row">
								<span class="about-detail-label">Deployed</span>
								<span class="about-detail-value" data-about-deployed>Unknown</span>
							</p>
						</div>
					</div>
					<div class="about-footer">
						<button type="button" class="btn-primary" data-about-close>OK</button>
					</div>
				</div>
			</div>
		`;
	}
}

if (!customElements.get('app-modal-about')) {
	customElements.define('app-modal-about', AppModalAbout);
}

function ensureAboutModalHost() {
	let el = document.querySelector('app-modal-about');
	if (!el) {
		el = document.createElement('app-modal-about');
		document.body.appendChild(el);
	}
	return el;
}

export async function openAboutModal() {
	await ensureAboutModalHost().open();
}

document.addEventListener('open-about-modal', () => {
	openAboutModal();
});
