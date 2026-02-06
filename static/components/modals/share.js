const html = String.raw;

async function copyTextToClipboard(text) {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// ignore
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.left = "-9999px";
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		const ok = document.execCommand("copy");
		document.body.removeChild(ta);
		return ok;
	} catch {
		return false;
	}
}

function openShareUrl(url) {
	try {
		window.open(url, "_blank", "noopener,noreferrer");
	} catch {
		window.location.href = url;
	}
}

function buildSmsHref(body) {
	const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || "");
	const sep = isIOS ? "&" : "?";
	return `sms:${sep}body=${encodeURIComponent(body)}`;
}

class AppModalShare extends HTMLElement {
	constructor() {
		super();
		this._isOpen = false;
		this._creationId = null;
		this._shareUrl = null;
		this._loading = false;
		this._openRequestId = 0;
		this._ctaTimers = new Set();

		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpen = this.handleOpen.bind(this);
		this.handleCloseAllModals = this.handleCloseAllModals.bind(this);
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();
		this.setupEventListeners();
		this.updateButtons();
	}

	disconnectedCallback() {
		document.removeEventListener("keydown", this.handleEscape);
		document.removeEventListener("open-share-modal", this.handleOpen);
		document.removeEventListener("close-all-modals", this.handleCloseAllModals);

		for (const t of this._ctaTimers) clearTimeout(t);
		this._ctaTimers.clear();
	}

	render() {
		this.innerHTML = html`
			<div class="modal-overlay" data-overlay>
				<div class="modal modal-medium">
					<div class="modal-header">
						<h3>Share</h3>
						<button class="modal-close" type="button" aria-label="Close">
							<svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
								stroke-linecap="round" stroke-linejoin="round">
								<line x1="18" y1="6" x2="6" y2="18"></line>
								<line x1="6" y1="6" x2="18" y2="18"></line>
							</svg>
						</button>
					</div>

					<div class="modal-body share-modal-body">
						<!--
						<p class="share-modal-note">
							<span class="share-modal-note-strong">You may be rewarded if someone joins after viewing.</span>
						</p>
						-->

						<div class="share-action-list" role="list">
							<button type="button" class="share-action-row" data-share-x>
								<span class="share-action-left">
									<span class="share-option-icon share-option-icon-x is-brand">
										<svg viewBox="0 0 24 24" aria-hidden="true">
											<g>
												<path
													d="M21.742 21.75l-7.563-11.179 7.056-8.321h-2.456l-5.691 6.714-4.54-6.714H2.359l7.29 10.776L2.25 21.75h2.456l6.035-7.118 4.818 7.118h6.191-.008zM7.739 3.818L18.81 20.182h-2.447L5.29 3.818h2.447z">
												</path>
											</g>
										</svg>
									</span>
									<span class="share-action-text">
										<span class="share-action-title">Share on X</span>
										<span class="share-action-subtitle">Formerly known as Twitter</span>
									</span>
								</span>
								<span class="share-action-cta share-action-cta-x" data-cta><span class="share-action-cta-label">Post</span></span>
							</button>

							<button type="button" class="share-action-row" data-share-facebook>
								<span class="share-action-left">
									<span class="share-option-icon share-option-icon-facebook is-brand">
										<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
											<path
												d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H7v3h3v7h3v-7h3l1-3h-4v-2c0-.6.4-1 1-1z">
											</path>
										</svg>
									</span>
									<span class="share-action-text">
										<span class="share-action-title">Share on Facebook</span>
										<span class="share-action-subtitle">Show your friends</span>
									</span>
								</span>
								<span class="share-action-cta share-action-cta-facebook" data-cta><span class="share-action-cta-label">Share</span></span>
							</button>

							<button type="button" class="share-action-row" data-share-reddit>
								<span class="share-action-left">
									<span class="share-option-icon share-option-icon-reddit is-brand">
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
											stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
											<circle cx="12" cy="13" r="5"></circle>
											<circle cx="10.2" cy="13" r="0.8" fill="currentColor" stroke="none"></circle>
											<circle cx="13.8" cy="13" r="0.8" fill="currentColor" stroke="none"></circle>
											<path d="M10.3 15.2c.7.7 1.5 1.1 1.7 1.1s1-.4 1.7-1.1"></path>
											<path d="M13.9 8.6l2.2-1.1"></path>
											<circle cx="18.1" cy="7.2" r="1.2"></circle>
										</svg>
									</span>
									<span class="share-action-text">
										<span class="share-action-title">Post to Reddit</span>
										<span class="share-action-subtitle">Share to a subreddit</span>
									</span>
								</span>
								<span class="share-action-cta share-action-cta-reddit" data-cta><span class="share-action-cta-label">Post</span></span>
							</button>

							<button type="button" class="share-action-row" data-share-linkedin>
								<span class="share-action-left">
									<span class="share-option-icon share-option-icon-linkedin is-brand">
										<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
											<path
												d="M6.5 9.5H3.8V21h2.7V9.5zM5.2 3C4.2 3 3.4 3.8 3.4 4.8s.8 1.8 1.8 1.8S7 5.8 7 4.8 6.2 3 5.2 3zM20.6 21h-2.7v-5.9c0-1.4 0-3.2-2-3.2s-2.3 1.5-2.3 3.1V21H10.9V9.5h2.6v1.6h.04c.36-.7 1.24-1.5 2.56-1.5 2.74 0 3.25 1.8 3.25 4.2V21z">
											</path>
										</svg>
									</span>
									<span class="share-action-text">
										<span class="share-action-title">Share on LinkedIn</span>
										<span class="share-action-subtitle">Share with your network</span>
									</span>
								</span>
								<span class="share-action-cta share-action-cta-linkedin" data-cta><span class="share-action-cta-label">Share</span></span>
							</button>

							<button type="button" class="share-action-row" data-share-sms>
								<span class="share-action-left">
									<span class="share-option-icon">
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
											stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
											<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
										</svg>
									</span>
									<span class="share-action-text">
										<span class="share-action-title">Text message</span>
										<span class="share-action-subtitle">Send via Messages</span>
									</span>
								</span>
								<span class="share-action-cta" data-cta><span class="share-action-cta-label">Send</span></span>
							</button>

							<button type="button" class="share-action-row" data-share-email>
								<span class="share-action-left">
									<span class="share-option-icon">
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
											stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
											<path d="M4 6h16v12H4z"></path>
											<path d="M4 7l8 6 8-6"></path>
										</svg>
									</span>
									<span class="share-action-text">
										<span class="share-action-title">Email</span>
										<span class="share-action-subtitle">Send a message with the link</span>
									</span>
								</span>
								<span class="share-action-cta" data-cta><span class="share-action-cta-label">Send</span></span>
							</button>

							<button type="button" class="share-action-row" data-copy-link>
								<span class="share-action-left">
									<span class="share-option-icon">
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
											stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
											<path
												d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1"></path>
											<path
												d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1"></path>
										</svg>
									</span>
									<span class="share-action-text">
										<span class="share-action-title">Copy link</span>
										<span class="share-action-subtitle">Share it anywhere</span>
									</span>
								</span>
								<span class="share-action-cta" data-cta><span class="share-action-cta-label">Copy</span></span>
							</button>

							<button type="button" class="share-action-row" data-native-share style="display: none;">
								<span class="share-action-left">
									<span class="share-option-icon">
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
											stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
											<circle cx="18" cy="5" r="2"></circle>
											<circle cx="6" cy="12" r="2"></circle>
											<circle cx="18" cy="19" r="2"></circle>
											<path d="M8 12l8-6"></path>
											<path d="M8 12l8 6"></path>
										</svg>
									</span>
									<span class="share-action-text">
										<span class="share-action-title">More options</span>
										<span class="share-action-subtitle">Open your device share menu</span>
									</span>
								</span>
								<span class="share-action-cta" data-cta><span class="share-action-cta-label">Open</span></span>
							</button>
						</div>

						<button type="button" class="share-modal-cancel" data-cancel>Cancel</button>
					</div>
				</div>
			</div>
		`;
	}

	setupEventListeners() {
		document.addEventListener("keydown", this.handleEscape);
		document.addEventListener("open-share-modal", this.handleOpen);
		document.addEventListener("close-all-modals", this.handleCloseAllModals);

		const overlay = this.querySelector("[data-overlay]");
		const closeBtn = this.querySelector(".modal-close");
		const cancelBtn = this.querySelector("[data-cancel]");
		const copyBtn = this.querySelector("[data-copy-link]");
		const nativeBtn = this.querySelector("[data-native-share]");
		const smsBtn = this.querySelector("[data-share-sms]");
		const emailBtn = this.querySelector("[data-share-email]");
		const xBtn = this.querySelector("[data-share-x]");
		const fbBtn = this.querySelector("[data-share-facebook]");
		const redditBtn = this.querySelector("[data-share-reddit]");
		const liBtn = this.querySelector("[data-share-linkedin]");

		if (overlay) {
			overlay.addEventListener("click", (e) => {
				if (e.target === overlay && !this._loading) {
					this.close();
				}
			});
		}
		if (closeBtn) closeBtn.addEventListener("click", () => this.close());
		if (cancelBtn) cancelBtn.addEventListener("click", () => this.close());

		if (copyBtn) copyBtn.addEventListener("click", (e) => void this.handleCopy(e.currentTarget));
		if (nativeBtn) nativeBtn.addEventListener("click", (e) => void this.handleNativeShare(e.currentTarget));

		if (smsBtn) smsBtn.addEventListener("click", (e) => void this.handleSms(e.currentTarget));
		if (emailBtn) emailBtn.addEventListener("click", (e) => void this.handleEmail(e.currentTarget));
		if (xBtn) xBtn.addEventListener("click", (e) => void this.handleX(e.currentTarget));
		if (fbBtn) fbBtn.addEventListener("click", (e) => void this.handleFacebook(e.currentTarget));
		if (redditBtn) redditBtn.addEventListener("click", (e) => void this.handleReddit(e.currentTarget));
		if (liBtn) liBtn.addEventListener("click", (e) => void this.handleLinkedIn(e.currentTarget));
	}

	handleEscape(e) {
		if (e.key === "Escape" && this._isOpen && !this._loading) {
			this.close();
		}
	}

	handleOpen(e) {
		const id = e.detail?.creationId ?? null;
		this.open(id);
	}

	handleCloseAllModals() {
		this.close();
	}

	resetAllCtas() {
		const ctas = Array.from(this.querySelectorAll("[data-cta]"));
		for (const cta of ctas) {
			if (!(cta instanceof HTMLElement)) continue;
			this.setCtaState(cta, "");
			const defaultLabel = cta.dataset.defaultLabel || cta.textContent?.trim() || "";
			if (!cta.dataset.defaultLabel) cta.dataset.defaultLabel = defaultLabel;
			this.setCtaLabel(cta, cta.dataset.defaultLabel || defaultLabel);
		}
	}

	open(creationId) {
		this._creationId = creationId ?? null;
		this._shareUrl = null;
		this._openRequestId++;
		this.resetAllCtas();
		this._isOpen = true;
		const overlay = this.querySelector("[data-overlay]");
		if (overlay) overlay.classList.add("open");
		this.updateButtons();
	}

	close() {
		this._isOpen = false;
		this._loading = false;
		this._creationId = null;
		this._shareUrl = null;
		this._openRequestId++;
		const overlay = this.querySelector("[data-overlay]");
		if (overlay) overlay.classList.remove("open");
		this.resetAllCtas();
	}

	updateButtons() {
		const nativeBtn = this.querySelector("[data-native-share]");
		if (nativeBtn instanceof HTMLButtonElement) {
			nativeBtn.style.display = typeof navigator.share === "function" ? "" : "none";
		}
	}

	getCtaEl(buttonEl) {
		if (!(buttonEl instanceof HTMLElement)) return null;
		return buttonEl.querySelector("[data-cta]");
	}

	setCtaLabel(ctaEl, label) {
		if (!(ctaEl instanceof HTMLElement)) return;
		const labelEl = ctaEl.querySelector(".share-action-cta-label");
		if (labelEl) labelEl.textContent = String(label || "");
	}

	setCtaState(ctaEl, state) {
		if (!(ctaEl instanceof HTMLElement)) return;
		if (!state) {
			ctaEl.removeAttribute("data-state");
			ctaEl.removeAttribute("aria-busy");
			return;
		}
		ctaEl.setAttribute("data-state", String(state));
		if (state === "loading") ctaEl.setAttribute("aria-busy", "true");
		else ctaEl.removeAttribute("aria-busy");
	}

	async runCtaAction(buttonEl, fn, opts = {}) {
		const btn = buttonEl instanceof HTMLButtonElement ? buttonEl : null;
		if (!btn) return;
		if (btn.dataset.busy === "1") return;
		btn.dataset.busy = "1";

		const cta = this.getCtaEl(btn);
		const defaultLabel = cta?.dataset?.defaultLabel || cta?.textContent?.trim() || "";
		if (cta && !cta.dataset.defaultLabel) cta.dataset.defaultLabel = defaultLabel;

		const resetMs = Number.isFinite(opts.resetMs) ? opts.resetMs : 1200;
		const successLabel = typeof opts.successLabel === "string" ? opts.successLabel : defaultLabel;
		const errorLabel = typeof opts.errorLabel === "string" ? opts.errorLabel : "Failed";

		try {
			if (cta) {
				this.setCtaLabel(cta, defaultLabel);
				this.setCtaState(cta, "loading");
			}
			await fn();
			if (cta) {
				this.setCtaState(cta, "");
				this.setCtaLabel(cta, successLabel);
			}
		} catch (err) {
			if (cta) {
				this.setCtaState(cta, "");
				this.setCtaLabel(cta, errorLabel);
			}
		} finally {
			const t = setTimeout(() => {
				if (cta) {
					this.setCtaState(cta, "");
					this.setCtaLabel(cta, cta.dataset.defaultLabel || defaultLabel);
				}
				if (btn) delete btn.dataset.busy;
				this._ctaTimers.delete(t);
			}, resetMs);
			this._ctaTimers.add(t);
		}
	}

	async ensureShareUrl() {
		if (this._shareUrl) return this._shareUrl;
		const creationId = Number(this._creationId);
		if (!Number.isFinite(creationId) || creationId <= 0) {
			throw new Error("Invalid creation");
		}

		const requestId = this._openRequestId;
		this._loading = true;
		try {
			const res = await fetch(`/api/create/images/${creationId}/share`, {
				method: "POST",
				credentials: "include"
			});
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error((data && data.error) ? String(data.error) : "Failed to create share link");
			}
			const data = await res.json().catch(() => null);
			const url = typeof data?.url === "string" ? data.url.trim() : "";
			if (!url) throw new Error("Failed to create share link");
			if (requestId !== this._openRequestId) throw new Error("Stale");
			this._shareUrl = url;
			return url;
		} finally {
			this._loading = false;
		}
	}

	shareMessage(url) {
		return `Check this out on Parascene: ${url}\n\nCreate your own for free (your friend may be rewarded if you join after viewing).`;
	}

	async handleCopy(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			const ok = await copyTextToClipboard(url);
			if (!ok) throw new Error("Copy failed");
		}, { successLabel: "Copied", errorLabel: "Copy failed", resetMs: 1600 });
	}

	async handleNativeShare(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			if (typeof navigator.share !== "function") return;
			await navigator.share({
				title: "Parascene",
				text: "A creation on Parascene",
				url
			});
		}, { resetMs: 900 });
	}

	async handleSms(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			window.location.href = buildSmsHref(this.shareMessage(url));
		}, { resetMs: 900 });
	}

	async handleEmail(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			const subject = "Parascene";
			const body = this.shareMessage(url);
			window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
		}, { resetMs: 900 });
	}

	async handleX(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			const hashtags = "parascene";
			openShareUrl(
				`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&hashtags=${encodeURIComponent(hashtags)}`
			);
		}, { resetMs: 900 });
	}

	async handleFacebook(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			openShareUrl(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
		}, { resetMs: 900 });
	}

	async handleReddit(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			const title = "Parascene";
			openShareUrl(`https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`);
		}, { resetMs: 900 });
	}

	async handleLinkedIn(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			openShareUrl(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`);
		}, { resetMs: 900 });
	}
}

customElements.define("app-modal-share", AppModalShare);

