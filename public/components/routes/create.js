import { isSystemReservedBlogCampaignId } from '../../shared/blogCampaignPath.js';

let fetchJsonWithStatusDeduped;
let submitCreationWithPending;
let uploadImageFile;
let formatMentionsFailureForDialog;
let renderFields;
let isPromptLikeField;
let isImageUrlField;
let isImageUrlArrayField;
let loadMutateQueue;
let attachAutoGrowTextarea;
let attachPromptInlineSuggest;
let renderCreateFormSkeleton;

function getAssetVersionParam() {
	const meta = document.querySelector('meta[name="asset-version"]');
	return meta?.getAttribute('content')?.trim() || '';
}

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

let _depsPromise;
async function loadDeps() {
	if (_depsPromise) return _depsPromise;
	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	_depsPromise = (async () => {
		const apiMod = await import(`../../shared/api.js${qs}`);
		fetchJsonWithStatusDeduped = apiMod.fetchJsonWithStatusDeduped;

		const createSubmitMod = await import(`../../shared/createSubmit.js${qs}`);
		submitCreationWithPending = createSubmitMod.submitCreationWithPending;
		uploadImageFile = createSubmitMod.uploadImageFile;
		formatMentionsFailureForDialog = createSubmitMod.formatMentionsFailureForDialog;

		const providerFormFieldsMod = await import(`../../shared/providerFormFields.js${qs}`);
		renderFields = providerFormFieldsMod.renderFields;
		isPromptLikeField = providerFormFieldsMod.isPromptLikeField;
		isImageUrlField = providerFormFieldsMod.isImageUrlField;
		isImageUrlArrayField = providerFormFieldsMod.isImageUrlArrayField;

		const mutateQueueMod = await import(`../../shared/mutateQueue.js${qs}`);
		loadMutateQueue = mutateQueueMod.loadMutateQueue;

		const autogrowMod = await import(`../../shared/autogrow.js${qs}`);
		attachAutoGrowTextarea = autogrowMod.attachAutoGrowTextarea;

		const suggestMod = await import(`../../shared/triggeredSuggest.js${qs}`);
		attachPromptInlineSuggest = suggestMod.attachPromptInlineSuggest;

		const skeletonMod = await import(`../../shared/skeleton.js${qs}`);
		renderCreateFormSkeleton = skeletonMod.renderCreateFormSkeleton;
	})();
	return _depsPromise;
}

const html = String.raw;

function escapeHtml(text) {
	return String(text ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Inline SVG for blog table action buttons (sized in CSS). */
const blogIcEdit = html`<svg class="create-route-blog-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;

const blogIcCampaign = html`<svg class="create-route-blog-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;

const blogIcTrash = html`<svg class="create-route-blog-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;

/** Matches server `BLOG_CAMPAIGN_TOKEN_RE` for custom campaign ids in tracked URLs. */
const BLOG_CAMPAIGN_ID_RE = /^[a-z0-9]{1,12}$/;

/** Public site origin for shareable blog links shown in the campaigns modal (not the current app host). */
const PARASCENE_BLOG_PUBLIC_ORIGIN = "https://www.parascene.com";

/** Same path rules as `api_routes/blog_admin.js` tracked-url handler. */
function buildParasceneBlogPublicUrls(slug, campaignId) {
	const enc = String(slug || "")
		.trim()
		.split("/")
		.filter(Boolean)
		.map((s) => encodeURIComponent(s))
		.join("/");
	const canonical = `${PARASCENE_BLOG_PUBLIC_ORIGIN}/blog/${enc}`;
	const tracked = `${PARASCENE_BLOG_PUBLIC_ORIGIN}/blog/${encodeURIComponent(campaignId)}/${enc}`;
	return { tracked, canonical };
}

/** Same path shape as blog editor preview — relative path for app routing. */
function blogPreviewHref(slug) {
	const s = typeof slug === "string" ? slug.trim() : String(slug ?? "").trim();
	if (!s) return "";
	const path = s
		.split("/")
		.filter(Boolean)
		.map((seg) => encodeURIComponent(seg))
		.join("/");
	return `/blog/${path}?preview=1`;
}

/** Full URL for copy/share — matches tracked/canonical links in this modal. */
function blogPreviewFullUrl(slug) {
	const path = blogPreviewHref(slug);
	return path ? `${PARASCENE_BLOG_PUBLIC_ORIGIN}${path}` : "";
}

/** Normalize image URL to a canonical form (origin + path) so queue and form values match regardless of relative/absolute. */
function normalizeImageUrlForMatch(raw) {
	if (typeof raw !== 'string') return '';
	const value = raw.trim();
	if (!value) return '';
	const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
	try {
		const parsed = new URL(value, origin);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
		return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return '';
	}
}

class AppRouteCreate extends HTMLElement {
	constructor() {
		super();
		this.creditsCount = 0;
		this.selectedServer = null;
		this.selectedMethod = null;
		this.fieldValues = {};
		this.servers = [];
		this.handleCreditsUpdated = this.handleCreditsUpdated.bind(this);
		this.storageKey = 'create-page-selections';
		this._advancedConfirm = null; // { serverId, args, cost } when cost dialog is open
		this._promptFromUrl = null; // prompt from ?prompt= (landing page); applied when Basic tab has a prompt field
		this._confirmPrimaryAction = null;
		this.showHiddenFields = false;
	}

	async connectedCallback() {
		await loadDeps();
		let showBlogTab = false;
		try {
			// Dedicated dedupe key: generic /api/profile responses can be cached from before login (401);
			// sharing that cache would hide the Blog tab until expiry even after sign-in.
			const pr = await fetchJsonWithStatusDeduped(
				"/api/profile",
				{ credentials: "include" },
				{ windowMs: 30000, dedupeKey: "app-route-create-profile-blog-gate" }
			);
			const p = pr.data;
			const plan = p?.plan ?? p?.meta?.plan;
			if (pr.ok && (p?.role === "admin" || plan === "founder")) showBlogTab = true;
			if (pr.ok) this._blogUserIsAdmin = p?.role === "admin";
		} catch (_) {
			// offline / profile unavailable
		}
		this._showBlogTab = showBlogTab;
		if (this._blogUserIsAdmin == null) this._blogUserIsAdmin = false;
		const blogTabSection = showBlogTab
			? html`
          <tab data-id="blog" label="Blog">
            <div class="create-route-blog">
              <div class="route-header">
                <p>Manage blog posts (draft, publish, archive).</p>
              </div>
              <div class="create-route-blog-toolbar">
                <button type="button" class="btn-primary create-button" data-blog-new>New draft</button>
                <button type="button" class="btn-secondary" data-blog-refresh>Refresh</button>
              </div>
              <div class="create-route-blog-table-container" data-blog-table-container></div>
              <p class="create-cost" data-blog-status aria-live="polite"></p>
              <div class="create-route-advanced-confirm create-route-blog-campaign-dialog" data-blog-campaign-dialog hidden>
                <div class="create-route-advanced-confirm-overlay" data-blog-campaign-overlay></div>
                <div class="create-route-advanced-confirm-panel create-route-blog-campaign-panel">
                  <div class="create-route-advanced-preview-header">
                    <p class="create-route-advanced-preview-title" data-blog-campaign-title>Links</p>
                    <button type="button" class="modal-close" data-blog-campaign-close-x aria-label="Close">
                      <svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                  <div class="create-route-blog-campaign-body" data-blog-campaign-body></div>
                </div>
              </div>
            </div>
          </tab>
        `
			: "";
		this._serversLoading = true;
		this.innerHTML = html`
      <div class="create-route">
        <div class="create-route-loading" data-create-loading>
          ${renderCreateFormSkeleton()}
        </div>
        <div class="create-route-content" data-create-content hidden aria-hidden="true">
        <div class="create-route-empty-wrap route-empty route-empty-state" data-create-empty hidden aria-hidden="true">
          <div class="route-empty-title">No servers available</div>
          <div class="route-empty-message">You don't have access to any servers yet. Add a server to get started.</div>
        </div>
        <div class="create-route-form-wrap" data-create-form-wrap hidden aria-hidden="true">
        <div class="route-header">
          <h3>Create</h3>
        </div>
        <app-tabs active="basic">
          <tab data-id="basic" label="Advanced" default>
            <div class="route-header">
              <p>Select a server and generation method to create a new image.</p>
            </div>
            <form class="create-form" data-create-form>
              <div class="form-group">
                <label class="form-label" for="server-select">Server</label>
                <select class="form-select" id="server-select" data-server-select required>
                  <option value="">Select a server...</option>
                </select>
              </div>
              <div class="form-group" data-method-group style="display: none;">
                <label class="form-label" for="method-select">Generation Method</label>
                <select class="form-select" id="method-select" data-method-select required>
                  <option value="">Select a method...</option>
                </select>
              </div>
              <div class="form-group" data-fields-group style="display: none;">
                <div class="create-fields-toggle" data-fields-toggle style="display: none;">
                  <a href="#" class="create-fields-toggle-link" data-toggle-hidden-fields>Show hidden fields</a>
                </div>
                <div data-fields-container></div>
              </div>
            </form>
            <div class="create-controls">
              <button type="button" class="btn-primary create-button" data-create-button disabled>
                Create
              </button>
              <p class="create-cost" data-create-cost>Select a server and method to see cost</p>
            </div>
          </tab>
          <tab data-id="advanced" label="Data Builder">
            <div class="create-route-advanced">
              <div class="create-route-advanced-server form-group">
                <label class="form-label" for="advanced-server-select">Server</label>
                <select class="form-select" id="advanced-server-select" data-advanced-server-select>
                  <option value="">Select a server...</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="advanced-prompt">Prompt</label>
                <textarea class="form-input prompt-editor" id="advanced-prompt" data-advanced-prompt rows="3" placeholder="Enter a prompt..."></textarea>
              </div>
              <div class="form-group create-route-advanced-data">
                <label class="form-label">Data Builder</label>
                <ul class="create-route-advanced-list" data-advanced-list role="list">
                <li class="create-route-advanced-item">
                  <button type="button" class="create-route-advanced-switch" role="switch" aria-checked="false" data-advanced-option="recent_comments" aria-label="Include recent comments">
                  </button>
                  <div class="create-route-advanced-item-desc">
                    <strong>Recent comments</strong>
                    Latest comments across the platform.
                  </div>
                </li>
                <li class="create-route-advanced-item">
                  <button type="button" class="create-route-advanced-switch" role="switch" aria-checked="false" data-advanced-option="recent_posts" aria-label="Include recent posts">
                  </button>
                  <div class="create-route-advanced-item-desc">
                    <strong>Newest</strong>
                    Latest published creations on the platform.
                  </div>
                </li>
                <li class="create-route-advanced-item">
                  <button type="button" class="create-route-advanced-switch" role="switch" aria-checked="false" data-advanced-option="top_likes" aria-label="Include top likes">
                  </button>
                  <div class="create-route-advanced-item-desc">
                    <strong>Most likes</strong>
                    Creations with the most likes on the platform.
                  </div>
                </li>
                <li class="create-route-advanced-item">
                  <button type="button" class="create-route-advanced-switch" role="switch" aria-checked="false" data-advanced-option="bottom_likes" aria-label="Include bottom likes">
                  </button>
                  <div class="create-route-advanced-item-desc">
                    <strong>Least likes</strong>
                    Creations with the fewest likes on the platform.
                  </div>
                </li>
                <li class="create-route-advanced-item">
                  <button type="button" class="create-route-advanced-switch" role="switch" aria-checked="false" data-advanced-option="most_mutated" aria-label="Include most mutated">
                  </button>
                  <div class="create-route-advanced-item-desc">
                    <strong>Most mutated</strong>
                    Creations that appear the most in mutation lineages (history).
                  </div>
                </li>
              </ul>
              <p class="create-route-advanced-preview-hint">
                <button type="button" class="create-route-advanced-preview-link" data-advanced-preview-payload>See what we send to the server</button>
              </p>
              </div>
              <div class="create-route-advanced-actions">
                <button type="button" class="btn-primary create-button" data-advanced-create-button disabled>
                  Query
                </button>
                <p class="create-cost" data-advanced-create-cost>Turn on at least one Data Builder option to create.</p>
                <p class="create-cost" data-advanced-create-cost-query hidden>Query the server to check support and cost.</p>
              </div>
            </div>
          </tab>
          ${blogTabSection}
        </app-tabs>
        <div class="create-route-advanced-confirm" data-advanced-confirm-dialog hidden>
          <div class="create-route-advanced-confirm-overlay" data-advanced-confirm-overlay></div>
          <div class="create-route-advanced-confirm-panel">
            <p class="create-cost" data-advanced-confirm-message></p>
            <div class="create-route-advanced-confirm-actions">
              <button type="button" class="btn-primary create-button" data-advanced-confirm-create>Create</button>
              <button type="button" class="btn-secondary" data-advanced-confirm-cancel>Cancel</button>
            </div>
          </div>
        </div>
        <div class="create-route-advanced-confirm" data-advanced-preview-dialog hidden>
          <div class="create-route-advanced-confirm-overlay" data-advanced-preview-overlay></div>
          <div class="create-route-advanced-confirm-panel create-route-advanced-preview-panel">
            <div class="create-route-advanced-preview-header">
              <p class="create-route-advanced-preview-title">Payload sent to provider</p>
              <button type="button" class="modal-close" data-advanced-preview-close-x aria-label="Close">
                <svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <pre class="create-route-advanced-preview-json" data-advanced-preview-json></pre>
            <div class="create-route-advanced-confirm-actions create-route-advanced-preview-actions">
              <button type="button" class="btn-secondary" data-advanced-preview-close>Close</button>
              <button type="button" class="btn-primary create-button" data-advanced-preview-copy>Copy</button>
            </div>
          </div>
        </div>
        </div>
        <footer class="create-page-footer">
          <nav class="create-page-footer-nav" aria-label="More create options">
            <a href="/prompt-library" class="create-page-footer-link create-page-footer-link--secondary">Prompt Library</a>
            <span class="create-page-footer-sep" aria-hidden="true">·</span>
            <a href="/create" class="create-page-footer-link create-switch-to-basic" data-create-switch-to-basic>Basic mode</a>
          </nav>
        </footer>
        </div>
      </div>
    `;
		this.setupEventListeners();
		if (this._showBlogTab) {
			this.setupBlogTab();
		}
		// Defer API calls until after first paint to improve perceived load
		const runDataLoad = () => { this.loadServers(); this.loadCredits(); };
		if (typeof requestIdleCallback !== 'undefined') {
			requestIdleCallback(runDataLoad, { timeout: 120 });
		} else {
			setTimeout(runDataLoad, 0);
		}
		// Attach autogrow and mention suggest to prompt textarea
		const promptTextarea = this.querySelector('[data-advanced-prompt]');
		if (promptTextarea) {
			attachAutoGrowTextarea(promptTextarea);
			attachPromptInlineSuggest(promptTextarea);
		}
	}

	disconnectedCallback() {
		document.removeEventListener('credits-updated', this.handleCreditsUpdated);
		if (this._boundPreviewEscape) {
			document.removeEventListener('keydown', this._boundPreviewEscape);
		}
		if (typeof this._createTabHashCleanup === 'function') {
			this._createTabHashCleanup();
		}
	}

	setupEventListeners() {
		const createButton = this.querySelector("[data-create-button]");
		if (createButton) {
			createButton.addEventListener("click", () => {
				// Apply loading state immediately, before any other code runs
				const btn = this.querySelector("[data-create-button]");
				if (!btn) return;
				btn.style.minWidth = `${btn.offsetWidth}px`;
				btn.disabled = true;
				btn.innerHTML = '<span class="create-button-spinner" aria-hidden="true"></span>';
				void btn.offsetHeight; // force reflow so the loading state is committed
				this.handleCreate(btn);
			});
		}

		const serverSelect = this.querySelector("[data-server-select]");
		if (serverSelect) {
			serverSelect.addEventListener("change", (e) => this.handleServerChange(e.target.value));
		}

		const methodSelect = this.querySelector("[data-method-select]");
		if (methodSelect) {
			methodSelect.addEventListener("change", (e) => this.handleMethodChange(e.target.value));
		}

		const toggleHiddenLink = this.querySelector("[data-toggle-hidden-fields]");
		const fieldsContainer = this.querySelector("[data-fields-container]");
		if (toggleHiddenLink && fieldsContainer) {
			toggleHiddenLink.addEventListener("click", (e) => {
				e.preventDefault();
				this.showHiddenFields = !this.showHiddenFields;
				fieldsContainer.classList.toggle("show-hidden-fields", this.showHiddenFields);
				toggleHiddenLink.textContent = this.showHiddenFields ? "Hide hidden fields" : "Show hidden fields";
			});
		}

		// Advanced tab: server select and Create button
		const advancedServerSelect = this.querySelector("[data-advanced-server-select]");
		if (advancedServerSelect) {
			advancedServerSelect.addEventListener("change", () => this.updateAdvancedCreateButton());
		}
		const advancedCreateButton = this.querySelector("[data-advanced-create-button]");
		if (advancedCreateButton) {
			advancedCreateButton.addEventListener("click", () => this.handleAdvancedCreate());
		}
		const previewPayloadBtn = this.querySelector("[data-advanced-preview-payload]");
		if (previewPayloadBtn) {
			previewPayloadBtn.addEventListener("click", () => this.handlePreviewPayload());
		}
		const previewDialog = this.querySelector("[data-advanced-preview-dialog]");
		const previewOverlay = this.querySelector("[data-advanced-preview-overlay]");
		const previewCloseBtn = this.querySelector("[data-advanced-preview-close]");
		const previewCloseX = this.querySelector("[data-advanced-preview-close-x]");
		const previewCopyBtn = this.querySelector("[data-advanced-preview-copy]");
		if (previewOverlay) previewOverlay.addEventListener("click", () => this.closePreviewPayload());
		if (previewCloseBtn) previewCloseBtn.addEventListener("click", () => this.closePreviewPayload());
		if (previewCloseX) previewCloseX.addEventListener("click", () => this.closePreviewPayload());
		if (previewCopyBtn) previewCopyBtn.addEventListener("click", () => this.copyPreviewPayload());
		this._boundPreviewEscape = (e) => {
			if (e.key === "Escape") {
				const blogD = this.querySelector("[data-blog-campaign-dialog]");
				if (blogD && !blogD.hidden && blogD.classList.contains("open")) {
					this.closeBlogCampaignModal();
					return;
				}
				const d = this.querySelector("[data-advanced-preview-dialog]");
				if (d && !d.hidden && d.classList.contains("open")) this.closePreviewPayload();
			}
		};
		document.addEventListener("keydown", this._boundPreviewEscape);
		// Advanced confirm dialog
		const confirmDialog = this.querySelector("[data-advanced-confirm-dialog]");
		const confirmOverlay = this.querySelector("[data-advanced-confirm-overlay]");
		const confirmCreateBtn = this.querySelector("[data-advanced-confirm-create]");
		const confirmCancelBtn = this.querySelector("[data-advanced-confirm-cancel]");
		if (confirmOverlay) confirmOverlay.addEventListener("click", () => this.closeAdvancedConfirm());
		if (confirmCancelBtn) confirmCancelBtn.addEventListener("click", () => this.closeAdvancedConfirm());
		if (confirmCreateBtn) confirmCreateBtn.addEventListener("click", () => this.handleConfirmPrimary());
		// Advanced tab: switch toggles
		this.querySelectorAll("[data-advanced-option]").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				const el = e.currentTarget;
				if (el.getAttribute("role") !== "switch") return;
				const checked = el.getAttribute("aria-checked") === "true";
				el.setAttribute("aria-checked", (!checked).toString());
				this.updateAdvancedCreateButton();
				this.saveAdvancedOptions();
			});
		});
		// Advanced tab: prompt field
		const promptInput = this.querySelector("[data-advanced-prompt]");
		if (promptInput) {
			promptInput.addEventListener("input", () => this.saveAdvancedOptions());
			promptInput.addEventListener("change", () => this.saveAdvancedOptions());
		}
		this.applyPromptFromUrl(); // run first so URL prompt can supersede saved state
		this.restoreAdvancedOptions();

		const switchToBasic = this.querySelector('[data-create-switch-to-basic]');
		if (switchToBasic) {
			switchToBasic.addEventListener('click', (e) => {
				e.preventDefault();
				document.cookie = 'create_editor=simple; path=/; max-age=31536000';
				window.location.href = '/create';
			});
		}

		// Restore and persist active tab (Basic / Advanced / Blog); sync with URL hash (#basic, #advanced, #blog)
		const tabsEl = this.querySelector('app-tabs');
		if (tabsEl) {
			const CREATE_TAB_IDS = this._showBlogTab ? ['basic', 'advanced', 'blog'] : ['basic', 'advanced'];
			const syncTabFromHash = () => {
				if (window.location.pathname !== '/create') return;
				const hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
				if (!CREATE_TAB_IDS.includes(hash)) return;
				tabsEl.setActiveTab(hash, { focus: false });
				try {
					const stored = sessionStorage.getItem(this.storageKey);
					const selections = stored ? JSON.parse(stored) : {};
					selections.tab = hash;
					sessionStorage.setItem(this.storageKey, JSON.stringify(selections));
				} catch (e) {
					// Ignore storage errors
				}
			};

			// Prefer URL hash over sessionStorage when present; default to basic when neither is set
			if (window.location.pathname === '/create') {
				const hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
				if (CREATE_TAB_IDS.includes(hash)) {
					tabsEl.setActiveTab(hash);
					try {
						const stored = sessionStorage.getItem(this.storageKey);
						const selections = stored ? JSON.parse(stored) : {};
						selections.tab = hash;
						sessionStorage.setItem(this.storageKey, JSON.stringify(selections));
					} catch (e) {
						// Ignore storage errors
					}
				} else {
					try {
						const stored = sessionStorage.getItem(this.storageKey);
						const selections = stored ? JSON.parse(stored) : {};
						const tab = selections?.tab;
						if (CREATE_TAB_IDS.includes(tab)) {
							tabsEl.setActiveTab(tab);
						} else {
							tabsEl.setActiveTab('basic');
						}
					} catch (e) {
						// Ignore storage errors
						tabsEl.setActiveTab('basic');
					}
				}
			}

			window.addEventListener('hashchange', syncTabFromHash);

			tabsEl.addEventListener('tab-change', (e) => {
				const id = e.detail?.id;
				if (!CREATE_TAB_IDS.includes(id)) return;
				try {
					const stored = sessionStorage.getItem(this.storageKey);
					const selections = stored ? JSON.parse(stored) : {};
					selections.tab = id;
					sessionStorage.setItem(this.storageKey, JSON.stringify(selections));
				} catch (e) {
					// Ignore storage errors
				}
				if (window.location.pathname === '/create' && window.location.hash !== `#${id}`) {
					window.history.replaceState(null, '', `/create#${id}`);
				}
			});
			this._createTabHashCleanup = () => window.removeEventListener('hashchange', syncTabFromHash);
		}

		document.addEventListener('credits-updated', this.handleCreditsUpdated);
	}

	/** True if both arrays have the same length and same id/name per index (so we can skip re-rendering). */
	serversListSame(a, b) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((s, i) => s?.id === b[i]?.id && s?.name === b[i]?.name);
	}

	/** Process raw API servers (filter + parse server_config) into form we use. */
	processServers(rawServers) {
		let list = Array.isArray(rawServers) ? rawServers : [];
		list = list.filter(server =>
			!server.suspended && (server.id === 1 || server.is_owner === true || server.is_member === true)
		);
		return list.map(server => {
			const s = { ...server };
			if (s.server_config && typeof s.server_config === 'string') {
				try {
					s.server_config = JSON.parse(s.server_config);
				} catch (e) {
					s.server_config = null;
				}
			}
			return s;
		});
	}

	/** Apply a processed server list to state and UI; then restore or auto-select. */
	applyServers(servers) {
		if (!Array.isArray(servers) || servers.length === 0) return;
		this.servers = servers;
		this.renderServerOptions();
		this.renderAdvancedServerOptions();
		const restored = this.restoreSelections();
		if (!restored && this.servers.length > 0) {
			const firstServer = this.servers[0];
			const serverSelect = this.querySelector("[data-server-select]");
			if (serverSelect) {
				serverSelect.value = firstServer.id;
				this.handleServerChange(firstServer.id);
			}
			const advancedSelect = this.querySelector("[data-advanced-server-select]");
			if (advancedSelect) {
				advancedSelect.value = firstServer.id;
				this.updateAdvancedCreateButton();
			}
		}
	}

	/** Show content only when loaded. Hide loading, show form or empty state. */
	updateCreateFormVisibility() {
		const loadingWrap = this.querySelector('[data-create-loading]');
		const contentWrap = this.querySelector('[data-create-content]');
		const formWrap = this.querySelector('[data-create-form-wrap]');
		const emptyWrap = this.querySelector('[data-create-empty]');
		if (!loadingWrap || !contentWrap || !formWrap) return;
		const hasOptions = Array.isArray(this.servers) && this.servers.length > 0;
		const loaded = this._serversLoading === false;
		if (!loaded) {
			// Move focus out before hiding so we never have focus inside an aria-hidden subtree (blur only to avoid stealing focus)
			if (contentWrap.contains(document.activeElement)) {
				document.activeElement?.blur?.();
			}
			contentWrap.setAttribute('aria-hidden', 'true');
			loadingWrap.hidden = false;
			contentWrap.hidden = true;
			return;
		}
		loadingWrap.hidden = true;
		contentWrap.hidden = false;
		contentWrap.setAttribute('aria-hidden', 'false');
		if (hasOptions) {
			// Showing form, hiding empty: blur out of empty only (do not focus form — avoids stealing focus if user focused input “too early”)
			if (emptyWrap?.contains(document.activeElement)) {
				document.activeElement?.blur?.();
			}
			emptyWrap?.setAttribute?.('aria-hidden', 'true');
			if (emptyWrap) emptyWrap.hidden = true;
			formWrap.setAttribute('aria-hidden', 'false');
			formWrap.hidden = false;
			// createAdvanced only: add body.loaded when form is visible (deferred in pageInit) so visibility transition doesn't steal focus
			if (document.body.classList.contains('create-page-advanced')) {
				document.body.classList.add('loaded');
				requestAnimationFrame(() => {
					if (formWrap.contains(document.activeElement) && typeof document.activeElement.focus === 'function') {
						document.activeElement.focus();
					}
				});
			}
		} else {
			// Showing empty, hiding form: blur out of form only (do not focus empty — avoids stealing focus from prompt)
			if (formWrap.contains(document.activeElement)) {
				document.activeElement?.blur?.();
			}
			formWrap.setAttribute('aria-hidden', 'true');
			formWrap.hidden = true;
			emptyWrap?.setAttribute?.('aria-hidden', 'false');
			if (emptyWrap) emptyWrap.hidden = false;
			// createAdvanced: body.loaded was deferred in pageInit; add when we show content (form or empty)
			if (document.body.classList.contains('create-page-advanced')) {
				document.body.classList.add('loaded');
			}
		}
	}

	/** Cache-then-refresh: show cached servers immediately if available (localStorage), then refresh in background. */
	loadServers() {
		const CACHE_KEY = 'create-servers-cache';
		const storage = typeof localStorage !== 'undefined' ? localStorage : null;
		try {
			const cached = storage?.getItem(CACHE_KEY);
			if (cached) {
				const { servers } = JSON.parse(cached);
				if (Array.isArray(servers) && servers.length > 0) {
					this.applyServers(servers);
					this._serversLoading = false;
					this.updateCreateFormVisibility();
					// Still fetch in background to refresh cache
				} else {
					this._serversLoading = false;
					this.updateCreateFormVisibility();
				}
			}
		} catch (e) {
			// ignore invalid cache
		}
		fetchJsonWithStatusDeduped('/api/servers', { credentials: 'include' }, { windowMs: 2000 })
			.then((result) => {
				this._serversLoading = false;
				if (!result?.ok || !Array.isArray(result.data?.servers)) {
					setTimeout(() => this.updateCreateFormVisibility(), 0);
					return;
				}
				const processed = this.processServers(result.data.servers);
				try {
					if (storage) {
						storage.setItem(CACHE_KEY, JSON.stringify({ servers: processed, cachedAt: Date.now() }));
					}
				} catch (e) {
					// ignore
				}
				// Skip DOM update when API returned the same list (avoids rebuild + focus steal)
				if (this.serversListSame(processed, this.servers)) return;
				// Save focus before servers update; applyServers mutates selects and can steal focus
				const promptEl = this.querySelector('[data-advanced-prompt]');
				const hadFocusOnPrompt = promptEl && document.activeElement === promptEl;
				this.applyServers(processed);
				setTimeout(() => {
					this.updateCreateFormVisibility();
					if (hadFocusOnPrompt && document.activeElement !== promptEl) {
						requestAnimationFrame(() => promptEl.focus());
					}
				}, 0);
			})
			.catch(() => {
				this._serversLoading = false;
				setTimeout(() => this.updateCreateFormVisibility(), 0);
			});
	}

	renderServerOptions() {
		const serverSelect = this.querySelector("[data-server-select]");
		if (!serverSelect) return;

		// Clear existing options except the first one
		while (serverSelect.children.length > 1) {
			serverSelect.removeChild(serverSelect.lastChild);
		}

		// Add server options
		this.servers.forEach(server => {
			const option = document.createElement('option');
			option.value = server.id;
			option.textContent = server.name;
			serverSelect.appendChild(option);
		});
	}

	renderAdvancedServerOptions() {
		const advancedSelect = this.querySelector("[data-advanced-server-select]");
		if (!advancedSelect) return;

		while (advancedSelect.children.length > 1) {
			advancedSelect.removeChild(advancedSelect.lastChild);
		}
		this.servers.forEach(server => {
			const option = document.createElement('option');
			option.value = server.id;
			option.textContent = server.name;
			advancedSelect.appendChild(option);
		});
		this.updateAdvancedCreateButton();
	}

	updateAdvancedCreateButton() {
		const advancedSelect = this.querySelector("[data-advanced-server-select]");
		const advancedCreateButton = this.querySelector("[data-advanced-create-button]");
		const costEl = this.querySelector("[data-advanced-create-cost]");
		const costQueryEl = this.querySelector("[data-advanced-create-cost-query]");
		if (!advancedSelect || !advancedCreateButton) return;
		const hasServer = advancedSelect.value !== '' && Number(advancedSelect.value) > 0;
		const hasAtLeastOneSwitch = Array.from(this.querySelectorAll("[data-advanced-option]")).some(
			(btn) => btn.getAttribute("aria-checked") === "true"
		);
		advancedCreateButton.disabled = !hasServer || !hasAtLeastOneSwitch;
		advancedCreateButton.textContent = 'Query';
		if (costEl) costEl.hidden = hasAtLeastOneSwitch;
		if (costQueryEl) costQueryEl.hidden = !hasAtLeastOneSwitch;
	}

	saveAdvancedOptions() {
		try {
			const options = {};
			this.querySelectorAll("[data-advanced-option]").forEach((btn) => {
				const key = btn.getAttribute("data-advanced-option");
				if (key) options[key] = btn.getAttribute("aria-checked") === "true";
			});
			const promptInput = this.querySelector("[data-advanced-prompt]");
			if (promptInput) {
				options.prompt = promptInput.value;
			}
			const stored = sessionStorage.getItem(this.storageKey);
			const selections = stored ? JSON.parse(stored) : {};
			selections.advancedOptions = options;
			sessionStorage.setItem(this.storageKey, JSON.stringify(selections));
		} catch (e) {
			// Ignore storage errors
		}
	}

	restoreAdvancedOptions() {
		try {
			const stored = sessionStorage.getItem(this.storageKey);
			if (!stored) return;
			const selections = JSON.parse(stored);
			const options = selections?.advancedOptions;
			if (!options || typeof options !== "object") return;
			// Restore data builder options
			this.querySelectorAll("[data-advanced-option]").forEach((btn) => {
				const key = btn.getAttribute("data-advanced-option");
				if (key && options[key] === true) btn.setAttribute("aria-checked", "true");
			});
			// Restore prompt value; query-param prompt supersedes saved
			const promptInput = this.querySelector("[data-advanced-prompt]");
			if (promptInput) {
				const value = this._promptFromUrl ?? (typeof options.prompt === "string" ? options.prompt : "");
				if (value) {
					promptInput.value = value;
					const refresh = attachAutoGrowTextarea(promptInput);
					if (refresh) refresh();
				}
			}
			this.updateAdvancedCreateButton();
		} catch (e) {
			// Ignore storage errors
		}
	}

	/** Store prompt from ?prompt= (e.g. from landing page). Applied to Basic tab when server+method has a prompt field. */
	applyPromptFromUrl() {
		if (window.location.pathname !== "/create") return;
		const params = new URLSearchParams(window.location.search);
		const prompt = params.get("prompt");
		this._promptFromUrl = typeof prompt === "string" && prompt.trim() ? prompt.trim() : null;
	}

	/** If we have a URL prompt and the current method has a prompt field, fill it. Call after renderFields(). */
	applyUrlPromptToBasicFields() {
		if (!this._promptFromUrl || !this.selectedMethod?.fields) return;
		const fields = this.selectedMethod.fields;
		const promptKey = Object.keys(fields).find((k) => isPromptLikeField(k, fields[k]));
		if (!promptKey) return;
		this.fieldValues[promptKey] = this._promptFromUrl;
		const input = this.querySelector(`#field-${promptKey}`);
		if (!input) return;
		input.value = this._promptFromUrl;
		if (input.tagName === "TEXTAREA") {
			const refresh = attachAutoGrowTextarea(input);
			if (refresh) refresh();
		}
		this.updateButtonState();
		this.saveSelections();
	}

	async handleAdvancedCreate() {
		const advancedSelect = this.querySelector("[data-advanced-server-select]");
		const queryBtn = this.querySelector("[data-advanced-create-button]");
		if (!advancedSelect?.value) return;

		const serverId = Number(advancedSelect.value);
		if (!Number.isFinite(serverId) || serverId <= 0) return;

		const args = {};
		// Collect prompt value
		const promptInput = this.querySelector("[data-advanced-prompt]");
		if (promptInput && promptInput.value.trim()) {
			args.prompt = promptInput.value.trim();
		}
		// Collect data builder options
		this.querySelectorAll("[data-advanced-option]").forEach((btn) => {
			const key = btn.getAttribute("data-advanced-option");
			if (key) args[key] = btn.getAttribute("aria-checked") === "true";
		});

		if (queryBtn) {
			queryBtn.disabled = true;
			queryBtn.textContent = 'Querying…';
		}
		try {
			const res = await fetch('/api/create/query', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ server_id: serverId, args })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				this.showAdvancedConfirm(
					data?.message || data?.error || 'Failed to query server',
					null
				);
				return;
			}
			const supported = data?.supported === true || data?.supported === 'true';
			const cost = typeof data?.cost === 'number' ? data.cost : Number(data?.cost);
			if (supported && Number.isFinite(cost) && cost > 0) {
				this._advancedConfirm = { serverId, args, cost };
				this.showAdvancedConfirm(
					`This will cost ${cost} credit${cost === 1 ? '' : 's'}.`,
					true
				);
			} else {
				this._advancedConfirm = null;
				this.showAdvancedConfirm(
					'This server does not support this request.',
					false
				);
			}
		} finally {
			if (queryBtn) {
				queryBtn.disabled = false;
				queryBtn.textContent = 'Query';
				this.updateAdvancedCreateButton();
			}
		}
	}

	handleConfirmPrimary() {
		const action = this._confirmPrimaryAction;
		if (typeof action === 'function') {
			try { action(); } catch { /* ignore */ }
			return;
		}
		this.submitAdvancedCreate();
	}

	showAdvancedConfirm(message, showCreateButton, { primaryLabel, onPrimary } = {}) {
		const dialog = this.querySelector("[data-advanced-confirm-dialog]");
		const msgEl = this.querySelector("[data-advanced-confirm-message]");
		const createBtn = this.querySelector("[data-advanced-confirm-create]");
		if (msgEl) msgEl.textContent = message;
		if (createBtn) {
			createBtn.hidden = !showCreateButton;
			createBtn.textContent = typeof primaryLabel === 'string' && primaryLabel.trim()
				? primaryLabel.trim()
				: 'Create';
		}
		this._confirmPrimaryAction = typeof onPrimary === 'function' ? onPrimary : null;
		if (dialog) {
			dialog.hidden = false;
			dialog.classList.add('open');
		}
	}

	closeAdvancedConfirm() {
		const dialog = this.querySelector("[data-advanced-confirm-dialog]");
		if (dialog) {
			dialog.hidden = true;
			dialog.classList.remove('open');
		}
		this._advancedConfirm = null;
		this._confirmPrimaryAction = null;
	}

	extractMentions(prompt) {
		const text = typeof prompt === 'string' ? prompt : '';
		if (!text) return [];
		const out = [];
		const seen = new Set();
		const re = /@([a-zA-Z0-9_]+)/g;
		let match;
		while ((match = re.exec(text)) !== null) {
			const full = `@${match[1]}`;
			if (seen.has(full)) continue;
			seen.add(full);
			out.push(full);
		}
		return out;
	}

	async validateMentions({ args } = {}) {
		const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
		const mentions = this.extractMentions(prompt);
		if (mentions.length === 0) return { ok: true, mentions };

		const res = await fetch('/api/create/validate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ args: args || {} })
		});
		const data = await res.json().catch(() => ({}));
		if (res.ok) return { ok: true, mentions, data };
		return { ok: false, mentions, data, status: res.status };
	}

	async handlePreviewPayload() {
		const args = {};
		const promptInput = this.querySelector("[data-advanced-prompt]");
		if (promptInput && promptInput.value.trim()) {
			args.prompt = promptInput.value.trim();
		}
		this.querySelectorAll("[data-advanced-option]").forEach((btn) => {
			const key = btn.getAttribute("data-advanced-option");
			if (key) args[key] = btn.getAttribute("aria-checked") === "true";
		});
		const hasAtLeastOne = Object.keys(args).some((k) => k === 'prompt' || args[k] === true);
		if (!hasAtLeastOne) {
			const pre = this.querySelector("[data-advanced-preview-json]");
			if (pre) pre.textContent = 'Turn on at least one Data Builder option or enter a prompt to preview the payload.';
			this.openPreviewPayload();
			return;
		}
		try {
			const res = await fetch('/api/create/preview', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ args })
			});
			const data = await res.json().catch(() => ({}));
			const pre = this.querySelector("[data-advanced-preview-json]");
			if (pre) {
				if (!res.ok) {
					pre.textContent = data?.message || data?.error || 'Failed to load preview.';
				} else {
					const payload = data?.payload;
					pre.textContent = payload != null
						? JSON.stringify(payload, null, 2)
						: 'No payload returned.';
				}
			}
			this._previewPayloadRaw = data?.payload != null ? JSON.stringify(data.payload) : null;
			this.openPreviewPayload();
		} catch (e) {
			const pre = this.querySelector("[data-advanced-preview-json]");
			if (pre) pre.textContent = 'Failed to load preview.';
			this._previewPayloadRaw = null;
			this.openPreviewPayload();
		}
	}

	openPreviewPayload() {
		const dialog = this.querySelector("[data-advanced-preview-dialog]");
		if (dialog) {
			dialog.hidden = false;
			dialog.classList.add('open');
		}
	}

	closePreviewPayload() {
		const dialog = this.querySelector("[data-advanced-preview-dialog]");
		if (dialog) {
			dialog.hidden = true;
			dialog.classList.remove('open');
		}
		this._previewPayloadRaw = null;
	}

	copyPreviewPayload() {
		const raw = this._previewPayloadRaw;
		if (!raw) return;
		try {
			navigator.clipboard.writeText(raw).then(() => {
				const btn = this.querySelector("[data-advanced-preview-copy]");
				if (btn) {
					const prev = btn.textContent;
					btn.textContent = 'Copied';
					setTimeout(() => { btn.textContent = prev; }, 1500);
				}
			}).catch(() => { });
		} catch (e) { }
	}

	async submitAdvancedCreate() {
		const pending = this._advancedConfirm;
		if (!pending) {
			this.closeAdvancedConfirm();
			return;
		}
		const runSubmit = (hydrateMentions) => {
			this.closeAdvancedConfirm();
			const isStandaloneCreatePage = window.location.pathname === '/create';
			submitCreationWithPending({
				serverId: pending.serverId,
				methodKey: 'advanced_generate',
				args: pending.args,
				creditCost: pending.cost,
				hydrateMentions,
				navigate: isStandaloneCreatePage ? 'full' : 'spa',
				onInsufficientCredits: async () => { await this.loadCredits(); },
				onError: async () => { await this.loadCredits(); }
			});
		};

		const prompt = typeof pending?.args?.prompt === 'string' ? pending.args.prompt : '';
		const mentions = this.extractMentions(prompt);
		if (mentions.length === 0) {
			runSubmit(false);
			return;
		}

		const validateResult = await this.validateMentions({ args: pending.args });
		if (validateResult.ok) {
			runSubmit(true);
			return;
		}

		const message = formatMentionsFailureForDialog(validateResult.data);
		this.showAdvancedConfirm(
			message,
			true,
			{
				primaryLabel: 'Submit anyway',
				onPrimary: () => runSubmit(false)
			}
		);
	}

	handleServerChange(serverId) {
		if (!serverId) {
			this.selectedServer = null;
			this.selectedMethod = null;
			this.fieldValues = {};
			this.hideMethodGroup();
			this.hideFieldsGroup();
			this.updateButtonState();
			this.saveSelections();
			return;
		}

		const server = this.servers.find(s => s.id === Number(serverId));
		if (!server) return;

		this.selectedServer = server;
		this.selectedMethod = null;
		this.fieldValues = {};
		this.renderMethodOptions();
		this.hideFieldsGroup();
		this.updateButtonState();
		this.saveSelections();
	}

	renderMethodOptions(skipAutoSelect = false) {
		const methodGroup = this.querySelector("[data-method-group]");
		const methodSelect = this.querySelector("[data-method-select]");
		if (!methodGroup || !methodSelect) return;

		// Clear existing options except the first one
		while (methodSelect.children.length > 1) {
			methodSelect.removeChild(methodSelect.lastChild);
		}

		if (!this.selectedServer) {
			methodGroup.style.display = 'none';
			return;
		}

		// Ensure server_config is parsed
		let serverConfig = this.selectedServer.server_config;
		if (typeof serverConfig === 'string') {
			try {
				serverConfig = JSON.parse(serverConfig);
				this.selectedServer.server_config = serverConfig;
			} catch (e) {
				// console.warn('Failed to parse server_config:', e);
				methodGroup.style.display = 'none';
				return;
			}
		}

		if (!serverConfig || !serverConfig.methods) {
			methodGroup.style.display = 'none';
			return;
		}

		// Add method options, sorted by display name
		const methods = serverConfig.methods;
		const methodKeys = Object.keys(methods).sort((a, b) => {
			const nameA = (methods[a]?.name || a).toString().toLowerCase();
			const nameB = (methods[b]?.name || b).toString().toLowerCase();
			return nameA.localeCompare(nameB);
		});
		methodKeys.forEach(methodKey => {
			const method = methods[methodKey];
			const option = document.createElement('option');
			option.value = methodKey;
			option.textContent = method.name || methodKey;
			methodSelect.appendChild(option);
		});

		methodGroup.style.display = 'flex';

		// Auto-select method: prefer one with default: true, otherwise first (unless skipping auto-select)
		if (!skipAutoSelect && methodKeys.length > 0) {
			const defaultMethodKey = methodKeys.find(key => {
				const m = methods[key];
				return m && (m.default === true || m.default === 'true');
			});
			const methodKeyToSelect = defaultMethodKey ?? methodKeys[0];
			methodSelect.value = methodKeyToSelect;
			// Use microtask to ensure DOM is ready and method selection happens after render
			Promise.resolve().then(() => {
				this.handleMethodChange(methodKeyToSelect);
			});
		} else if (methodKeys.length === 0) {
			methodSelect.value = '';
		}
	}

	handleMethodChange(methodKey) {
		if (!methodKey) {
			this.selectedMethod = null;
			this.fieldValues = {};
			this.hideFieldsGroup();
			this.updateButtonState();
			this.saveSelections();
			return;
		}

		if (!this.selectedServer) {
			return;
		}

		// Ensure server_config is parsed
		let serverConfig = this.selectedServer.server_config;
		if (typeof serverConfig === 'string') {
			try {
				serverConfig = JSON.parse(serverConfig);
				this.selectedServer.server_config = serverConfig;
			} catch (e) {
				// console.warn('Failed to parse server_config:', e);
				return;
			}
		}

		if (!serverConfig || !serverConfig.methods || !serverConfig.methods[methodKey]) {
			return;
		}

		this.selectedMethod = serverConfig.methods[methodKey];
		this.fieldValues = {};
		this.renderFields();
		this.updateButtonState();
		this.saveSelections();
	}

	renderFields() {
		const fieldsGroup = this.querySelector("[data-fields-group]");
		const fieldsContainer = this.querySelector("[data-fields-container]");
		if (!fieldsGroup || !fieldsContainer) return;

		if (!this.selectedMethod || !this.selectedMethod.fields) {
			fieldsGroup.style.display = 'none';
			return;
		}

		const fields = this.selectedMethod.fields;
		if (Object.keys(fields).length === 0) {
			fieldsGroup.style.display = 'none';
			return;
		}

		renderFields(fieldsContainer, fields, {
			onFieldChange: (fieldKey, value) => {
				this.fieldValues[fieldKey] = value;
				this.updateButtonState();
				this.saveSelections();
			}
		});

		const hasHiddenFields = Object.values(fields).some(f => f && (f.hidden === true || f.hidden === 'true'));
		const toggleWrap = this.querySelector("[data-fields-toggle]");
		const toggleLink = this.querySelector("[data-toggle-hidden-fields]");
		if (toggleWrap && toggleLink) {
			if (hasHiddenFields) {
				toggleWrap.style.display = '';
				this.showHiddenFields = false;
				fieldsContainer.classList.remove("show-hidden-fields");
				toggleLink.textContent = "Show hidden fields";
			} else {
				toggleWrap.style.display = 'none';
			}
		}

		fieldsGroup.style.display = 'flex';
		this.applyUrlPromptToBasicFields();
		fieldsContainer.querySelectorAll('.prompt-editor').forEach((el) => attachPromptInlineSuggest(el));
	}

	hideMethodGroup() {
		const methodGroup = this.querySelector("[data-method-group]");
		const methodSelect = this.querySelector("[data-method-select]");
		if (methodGroup) methodGroup.style.display = 'none';
		if (methodSelect) methodSelect.value = '';
	}

	hideFieldsGroup() {
		const fieldsGroup = this.querySelector("[data-fields-group]");
		if (fieldsGroup) fieldsGroup.style.display = 'none';
	}

	handleCreditsUpdated(event) {
		if (event.detail && typeof event.detail.count === 'number') {
			this.creditsCount = event.detail.count;
			this.updateButtonState();
		} else {
			this.loadCredits();
		}
	}

	/** Cache-then-refresh: show cached credits immediately if available (localStorage), then refresh in background. */
	loadCredits() {
		const CACHE_KEY = 'create-credits-cache';
		const storage = typeof localStorage !== 'undefined' ? localStorage : null;
		try {
			const cached = storage?.getItem(CACHE_KEY);
			if (cached) {
				const { balance } = JSON.parse(cached);
				if (typeof balance === 'number' && Number.isFinite(balance)) {
					this.creditsCount = this.normalizeCredits(balance);
					this.updateButtonState();
				}
			}
		} catch (e) {
			// ignore invalid cache
		}
		fetchJsonWithStatusDeduped('/api/credits', { credentials: 'include' }, { windowMs: 2000 })
			.then((result) => {
				if (result?.ok) {
					const balance = result.data?.balance ?? 0;
					this.creditsCount = this.normalizeCredits(balance);
					try {
						if (storage) {
							storage.setItem(CACHE_KEY, JSON.stringify({ balance, cachedAt: Date.now() }));
						}
					} catch (e) {
						// ignore
					}
				} else {
					this.creditsCount = 0;
				}
				this.updateButtonState();
			})
			.catch(() => {
				const stored = storage?.getItem('credits-balance');
				this.creditsCount = stored !== null ? this.normalizeCredits(stored) : 0;
				this.updateButtonState();
			});
	}

	normalizeCredits(value) {
		const count = Number(value);
		if (!Number.isFinite(count)) return 0;
		return Math.max(0, Math.round(count * 10) / 10);
	}

	updateButtonState() {
		const button = this.querySelector("[data-create-button]");
		const costElement = this.querySelector("[data-create-cost]");

		if (!button || !costElement) return;

		// Check if server and method are selected
		if (!this.selectedServer || !this.selectedMethod) {
			button.disabled = true;
			costElement.textContent = 'Select a server and method to see cost';
			costElement.classList.remove('insufficient');
			return;
		}

		// Check if all required fields are filled
		const fields = this.selectedMethod.fields || {};
		const requiredFields = Object.keys(fields).filter(key => fields[key].required);
		const allRequiredFilled = requiredFields.every(key => {
			const value = this.fieldValues[key];
			if (value === undefined || value === null) return false;
			if (value instanceof File) return true;
			return value !== '';
		});

		if (!allRequiredFilled) {
			button.disabled = true;
			// Get cost from method config
			let cost = 0.5; // default fallback
			if (this.selectedMethod && typeof this.selectedMethod.credits === 'number') {
				cost = this.selectedMethod.credits;
			} else if (this.selectedMethod && this.selectedMethod.credits !== undefined) {
				const parsedCost = parseFloat(this.selectedMethod.credits);
				if (!isNaN(parsedCost)) {
					cost = parsedCost;
				}
			}
			costElement.textContent = `Costs ${cost} credits - Fill all required fields`;
			costElement.classList.remove('insufficient');
			return;
		}

		// Check credits - get cost from method config
		let cost = 0.5; // default fallback
		if (this.selectedMethod) {
			if (typeof this.selectedMethod.credits === 'number') {
				cost = this.selectedMethod.credits;
			} else if (this.selectedMethod.credits !== undefined && this.selectedMethod.credits !== null) {
				// Try to parse if it's a string
				const parsedCost = parseFloat(this.selectedMethod.credits);
				if (!isNaN(parsedCost)) {
					cost = parsedCost;
				} else {
					// console.warn('updateButtonState - Could not parse credits:', this.selectedMethod.credits);
				}
			} else {
				// console.warn('updateButtonState - Credits is undefined or null, using default 0.5');
			}
		} else {
			// console.warn('updateButtonState - No selectedMethod');
		}

		const hasEnoughCredits = this.creditsCount >= cost;

		button.disabled = !hasEnoughCredits;

		if (hasEnoughCredits) {
			costElement.textContent = `Costs ${cost} credits`;
			costElement.classList.remove('insufficient');
		} else {
			costElement.textContent = `Insufficient credits. You have ${this.creditsCount} credits, need ${cost} credits.`;
			costElement.classList.add('insufficient');
		}
	}

	handleCreate(button) {
		if (!button) return;
		// Yield so the loading state can paint before we run validation/submit/navigation
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				this.handleCreateAfterSpinner(button);
			});
		});
	}

	async handleCreateAfterSpinner(button) {
		if (!this.selectedServer || !this.selectedMethod) {
			this.resetCreateButton(button);
			return;
		}

		// Get the method key from the selected method
		const methods = this.selectedServer.server_config?.methods || {};
		const methodKey = Object.keys(methods).find(key => methods[key] === this.selectedMethod);

		if (!methodKey) {
			this.resetCreateButton(button);
			return;
		}

		// Collect all field values from inputs right before submission
		const fields = this.selectedMethod.fields || {};
		const collectedArgs = {};
		Object.keys(fields).forEach(fieldKey => {
			let input = this.querySelector(`#field-${fieldKey}`);
			const field = fields[fieldKey];
			if (input?.classList?.contains('form-switch')) {
				input = input.querySelector('.form-switch-input');
			}
			if (input) {
				if (field?.type === 'boolean' || input.type === 'checkbox') {
					collectedArgs[fieldKey] = input.checked;
				} else if (isImageUrlArrayField(field)) {
					const raw = this.fieldValues[fieldKey] ?? input.value ?? '';
					let arr = [];
					if (Array.isArray(raw)) arr = raw;
					else if (typeof raw === 'string' && raw.trim()) {
						try {
							const a = JSON.parse(raw);
							arr = Array.isArray(a) ? a : [];
						} catch {
							// leave arr []
						}
					}
					collectedArgs[fieldKey] = arr;
				} else if (isImageUrlField(field)) {
					const fv = this.fieldValues[fieldKey];
					if (fv instanceof File) {
						collectedArgs[fieldKey] = fv;
					} else {
						const fromFv = typeof fv === 'string' ? fv.trim() : '';
						const fromInput = typeof input.value === 'string' ? input.value.trim() : '';
						collectedArgs[fieldKey] = fromFv || fromInput || '';
					}
				} else {
					collectedArgs[fieldKey] = input.value || this.fieldValues[fieldKey] || '';
				}
			} else {
				// Fallback to stored value (e.g. image_url can be string URL or File; upload happens on Create)
				collectedArgs[fieldKey] = this.fieldValues[fieldKey] ?? (field?.type === 'boolean' ? false : '');
			}
		});

		// Validate required data
		if (!this.selectedServer.id || !methodKey) {
			this.resetCreateButton(button);
			return;
		}

		// If any field of type image_url has a File (paste or upload), upload it first; then submit with the URL.
		for (const fieldKey of Object.keys(fields)) {
			const field = fields[fieldKey];
			if (!isImageUrlField(field)) continue;
			const value = collectedArgs[fieldKey];
			if (value instanceof File) {
				try {
					collectedArgs[fieldKey] = await uploadImageFile(value);
				} catch (err) {
					this.resetCreateButton(button);
					if (typeof this.showCreateError === 'function') {
						this.showCreateError(err?.message || 'Image upload failed');
					} else {
						alert(err?.message || 'Image upload failed');
					}
					return;
				}
			}
		}

		// If any field of type image_url_array has Files, upload each and replace with URLs.
		for (const fieldKey of Object.keys(fields)) {
			const field = fields[fieldKey];
			if (!isImageUrlArrayField(field)) continue;
			const arr = collectedArgs[fieldKey];
			if (!Array.isArray(arr)) continue;
			const hasFile = arr.some((v) => v instanceof File);
			if (!hasFile) continue;
			try {
				collectedArgs[fieldKey] = await Promise.all(
					arr.map((v) => (v instanceof File ? uploadImageFile(v) : Promise.resolve(v)))
				);
			} catch (err) {
				this.resetCreateButton(button);
				if (typeof this.showCreateError === 'function') {
					this.showCreateError(err?.message || 'Image upload failed');
				} else {
					alert(err?.message || 'Image upload failed');
				}
				return;
			}
		}

		// Standalone create page (/create) needs full navigation to /creations; SPA only works when create is in-app.
		const isStandaloneCreatePage = window.location.pathname === '/create';
		const argsToSend = collectedArgs || {};
		let mutateParentIds = [];

		// Map any queued images used as inputs to their parent creation IDs so they become ancestors.
		// Use normalized URLs so relative/absolute or different origins still match; backend then replaces
		// unpublished image URLs with share URLs so the provider can fetch them (same as mutate flow).
		try {
			const queueItems = loadMutateQueue();
			if (Array.isArray(queueItems) && queueItems.length > 0) {
				const byNormalizedUrl = new Map();
				queueItems.forEach((item) => {
					const url = typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : '';
					const sid = Number(item?.sourceId);
					if (!url || !Number.isFinite(sid) || sid <= 0) return;
					const norm = normalizeImageUrlForMatch(url);
					if (norm && !byNormalizedUrl.has(norm)) byNormalizedUrl.set(norm, sid);
					// Also key by raw URL so exact match still works
					if (url && !byNormalizedUrl.has(url)) byNormalizedUrl.set(url, sid);
				});
				if (byNormalizedUrl.size > 0) {
					const parentSet = new Set();
					Object.keys(fields).forEach((fieldKey) => {
						const field = fields[fieldKey];
						if (isImageUrlField(field)) {
							const v = argsToSend[fieldKey];
							if (typeof v === 'string') {
								const trimmed = v.trim();
								const id = byNormalizedUrl.get(trimmed) ?? byNormalizedUrl.get(normalizeImageUrlForMatch(trimmed));
								if (Number.isFinite(id) && id > 0) parentSet.add(id);
							}
						} else if (isImageUrlArrayField(field)) {
							const arr = argsToSend[fieldKey];
							if (Array.isArray(arr)) {
								arr.forEach((v) => {
									if (typeof v !== 'string') return;
									const trimmed = v.trim();
									const id = byNormalizedUrl.get(trimmed) ?? byNormalizedUrl.get(normalizeImageUrlForMatch(trimmed));
									if (Number.isFinite(id) && id > 0) parentSet.add(id);
								});
							}
						}
					});
					if (parentSet.size > 0) {
						mutateParentIds = Array.from(parentSet);
					}
				}
			}
		} catch {
			// ignore storage errors
		}

		// Hydration only supports the canonical `prompt` arg for now.
		const prompt = typeof argsToSend?.prompt === 'string' ? String(argsToSend.prompt) : '';
		const mentions = this.extractMentions(prompt);

		const mutateOfId = mutateParentIds.length === 1 ? mutateParentIds[0] : undefined;
		const doSubmit = (hydrateMentions) => {
			submitCreationWithPending({
				serverId: this.selectedServer.id,
				methodKey,
				args: argsToSend,
				mutateOfId,
				mutateParentIds,
				hydrateMentions,
				navigate: isStandaloneCreatePage ? 'full' : 'spa',
				onInsufficientCredits: async () => {
					this.resetCreateButton(button);
					await this.loadCredits();
				},
				onError: async () => {
					this.resetCreateButton(button);
					await this.loadCredits();
				}
			});
		};

		async function runMentionsCheckAndSubmit() {
			if (mentions.length === 0) {
				doSubmit(false);
				return;
			}
			const validateResult = await this.validateMentions({ args: { prompt } });
			if (validateResult.ok) {
				doSubmit(true);
				return;
			}
			this.resetCreateButton(button);
			this.showAdvancedConfirm(
				formatMentionsFailureForDialog(validateResult.data),
				true,
				{
					primaryLabel: 'Submit anyway',
					onPrimary: () => {
						this.closeAdvancedConfirm();
						try {
							button.style.minWidth = `${button.offsetWidth}px`;
							button.disabled = true;
							button.innerHTML = '<span class="create-button-spinner" aria-hidden="true"></span>';
							void button.offsetHeight;
						} catch { /* ignore */ }
						doSubmit(false);
					}
				}
			);
		}

		void runMentionsCheckAndSubmit.call(this);
	}

	resetCreateButton(button) {
		if (!button) return;
		button.disabled = false;
		button.style.minWidth = '';
		button.textContent = 'Create';
	}

	saveSelections() {
		try {
			// Files cannot round-trip through JSON.stringify (they become `{}`); restoring that
			// object into <input>.value yields "[object Object]" and breaks provider image_url.
			const fieldValuesForStorage = { ...this.fieldValues };
			for (const k of Object.keys(fieldValuesForStorage)) {
				if (fieldValuesForStorage[k] instanceof File) {
					delete fieldValuesForStorage[k];
				}
			}
			const selections = {
				serverId: this.selectedServer?.id || null,
				methodKey: this.getMethodKey() || null,
				fieldValues: fieldValuesForStorage
			};
			const tabsEl = this.querySelector('app-tabs');
			const activeTab = tabsEl?.getAttribute?.('active');
			if (activeTab === 'basic' || activeTab === 'advanced') {
				selections.tab = activeTab;
			}
			const options = {};
			this.querySelectorAll("[data-advanced-option]").forEach((btn) => {
				const key = btn.getAttribute("data-advanced-option");
				if (key) options[key] = btn.getAttribute("aria-checked") === "true";
			});
			selections.advancedOptions = options;
			sessionStorage.setItem(this.storageKey, JSON.stringify(selections));
		} catch (e) {
			// Ignore storage errors
		}
	}

	getMethodKey() {
		if (!this.selectedServer || !this.selectedMethod) return null;
		const methods = this.selectedServer.server_config?.methods || {};
		return Object.keys(methods).find(key => methods[key] === this.selectedMethod) || null;
	}

	restoreSelections() {
		// Only restore if servers are loaded
		if (!this.servers || this.servers.length === 0) return false;

		try {
			const stored = sessionStorage.getItem(this.storageKey);
			if (!stored) return false;

			const selections = JSON.parse(stored);
			if (!selections || !selections.serverId) return false;

			// Restore server selection
			const server = this.servers.find(s => s.id === Number(selections.serverId));
			if (!server) return false;

			const serverSelect = this.querySelector("[data-server-select]");
			if (!serverSelect) return false;

			serverSelect.value = server.id;
			this.selectedServer = server;
			this.renderMethodOptions(true); // Skip auto-select when restoring

			// Restore same server on Advanced tab
			const advancedSelect = this.querySelector("[data-advanced-server-select]");
			if (advancedSelect) {
				const optionExists = Array.from(advancedSelect.options).some(opt => opt.value === String(server.id));
				if (optionExists) {
					advancedSelect.value = server.id;
					this.updateAdvancedCreateButton();
				}
			}

			// Restore method selection after methods are rendered
			if (selections.methodKey) {
				// Use microtask to ensure DOM is ready
				Promise.resolve().then(() => {
					const methodSelect = this.querySelector("[data-method-select]");
					if (methodSelect) {
						const methodExists = Array.from(methodSelect.options).some(
							opt => opt.value === selections.methodKey
						);
						if (methodExists) {
							methodSelect.value = selections.methodKey;
							this.handleMethodChange(selections.methodKey);

							// Restore field values after fields are rendered
							if (selections.fieldValues && Object.keys(selections.fieldValues).length > 0) {
								Promise.resolve().then(() => {
									this.restoreFieldValues(selections.fieldValues);
								});
							}
						}
					}
				});
			}

			return true;
		} catch (e) {
			// Ignore storage errors
			return false;
		}
	}

	setupBlogTab() {
		const newBtn = this.querySelector("[data-blog-new]");
		const refreshBtn = this.querySelector("[data-blog-refresh]");
		newBtn?.addEventListener("click", () => this.onBlogNewDraft());
		refreshBtn?.addEventListener("click", () => this.loadBlogPosts());
		const tabsEl = this.querySelector("app-tabs");
		tabsEl?.addEventListener("tab-change", (e) => {
			if (e.detail?.id === "blog") this.loadBlogPosts();
		});
		const blogOverlay = this.querySelector("[data-blog-campaign-overlay]");
		const blogCloseX = this.querySelector("[data-blog-campaign-close-x]");
		if (blogOverlay) blogOverlay.addEventListener("click", () => this.closeBlogCampaignModal());
		if (blogCloseX) blogCloseX.addEventListener("click", () => this.closeBlogCampaignModal());
		const campaignBody = this.querySelector("[data-blog-campaign-body]");
		if (campaignBody) {
			campaignBody.addEventListener("change", (e) => {
				const t = e.target;
				if (t?.matches?.("[data-blog-campaign-select]")) {
					const wrap = this.querySelector("[data-blog-campaign-custom-wrap]");
					if (wrap) wrap.hidden = t.value !== "__custom__";
					if (t.value && t.value !== "__custom__") this.fetchTrackedUrlForBlogCampaign();
				}
				if (t?.matches?.("[data-blog-campaign-active]")) {
					this.patchBlogCampaignActive(t.getAttribute("data-blog-campaign-active"), t.checked);
				}
			});
			campaignBody.addEventListener("click", (e) => {
				const t = e.target;
				if (t?.matches?.("[data-blog-copy-tracked]")) this.copyBlogCampaignTrackedField("tracked");
				if (t?.matches?.("[data-blog-copy-canonical]")) this.copyBlogCampaignTrackedField("canonical");
				if (t?.matches?.("[data-blog-campaign-copy-preview]")) this.copyBlogCampaignPreview(t);
				if (t?.matches?.("[data-blog-campaign-copy-tracked-simple]")) {
					const id = t.getAttribute("data-blog-campaign-copy-tracked-simple");
					this.copyBlogCampaignSimpleTracked(id, t);
				}
				if (t?.matches?.("[data-blog-campaign-copy-canonical-simple]")) {
					this.copyBlogCampaignCanonicalSimple(t);
				}
				if (t?.matches?.("[data-blog-campaign-add-btn]")) this.submitBlogCampaignAdd(e);
			});
			campaignBody.addEventListener("input", (e) => {
				const t = e.target;
				if (t?.matches?.("[data-blog-campaign-custom-input]")) {
					clearTimeout(this._blogCampaignCustomDebounce);
					this._blogCampaignCustomDebounce = setTimeout(() => this.fetchTrackedUrlForBlogCampaign(), 320);
				}
			});
		}
		this.loadBlogPosts();
	}

	closeBlogCampaignModal() {
		const dialog = this.querySelector("[data-blog-campaign-dialog]");
		if (dialog) {
			dialog.hidden = true;
			dialog.classList.remove("open");
		}
		this._blogCampaignPost = null;
		const body = this.querySelector("[data-blog-campaign-body]");
		if (body) body.innerHTML = "";
	}

	async openBlogCampaignModal(post) {
		const dialog = this.querySelector("[data-blog-campaign-dialog]");
		const titleEl = this.querySelector("[data-blog-campaign-title]");
		const body = this.querySelector("[data-blog-campaign-body]");
		if (!dialog || !body) return;
		this._blogCampaignPost = {
			id: Number(post.id),
			slug: String(post.slug || "").trim(),
			title: String(post.title || "").trim() || "Post"
		};
		if (titleEl) titleEl.textContent = `Links - ${this._blogCampaignPost.title}`;
		body.innerHTML = html`<p class="create-cost">Loading…</p>`;
		dialog.hidden = false;
		dialog.classList.add("open");
		let campaigns = [];
		try {
			const r = await fetch("/api/blog/campaigns", { credentials: "include" });
			const data = await r.json().catch(() => ({}));
			if (r.ok) campaigns = Array.isArray(data?.campaigns) ? data.campaigns : [];
		} catch (_) {
			// ignore
		}
		this._blogCampaignList = campaigns;
		this.renderBlogCampaignModalContent();
	}

	renderBlogCampaignModalContent() {
		const body = this.querySelector("[data-blog-campaign-body]");
		const post = this._blogCampaignPost;
		if (!body || !post) return;

		const previewLi = blogPreviewFullUrl(post.slug)
			? html`<li class="create-route-blog-campaign-simple-row">
					<span class="create-route-blog-campaign-simple-label">Preview</span>
					<button
						type="button"
						class="btn-secondary create-route-blog-campaign-simple-copy"
						data-blog-campaign-copy-preview
					>
						Copy
					</button>
				</li>`
			: "";

		if (!this._blogUserIsAdmin) {
			const list = (this._blogCampaignList || []).filter((c) => c && typeof c.id === "string");
			const campaignRows = list
				.map((c) => {
					const rawId = String(c.id);
					const idAttr = escapeHtml(rawId);
					const label = escapeHtml(String(c.label || c.id || ""));
					return html`<li class="create-route-blog-campaign-simple-row">
						<span class="create-route-blog-campaign-simple-label">${label}</span>
						<button type="button" class="btn-secondary create-route-blog-campaign-simple-copy" data-blog-campaign-copy-tracked-simple="${idAttr}">Copy</button>
					</li>`;
				})
				.join("");
			const emptyNote =
				list.length === 0
					? html`<p class="create-cost create-route-blog-campaign-simple-note">No named campaigns in the registry yet.</p>`
					: "";
			body.innerHTML = html`<ul class="create-route-blog-campaign-simple-list">
				${previewLi}
				<li class="create-route-blog-campaign-simple-row">
					<span class="create-route-blog-campaign-simple-label">Generic</span>
					<button type="button" class="btn-secondary create-route-blog-campaign-simple-copy" data-blog-campaign-copy-canonical-simple>Copy</button>
				</li>
				${campaignRows}
			</ul>${emptyNote}`;
			return;
		}

		const opts = (this._blogCampaignList || [])
			.filter((c) => c && typeof c.id === "string")
			.map(
				(c) =>
					html`<option value="${escapeHtml(String(c.id))}">${escapeHtml(String(c.label || c.id || ""))}</option>`
			)
			.join("");

		const adminAdd = this._blogUserIsAdmin
			? html`
				<div class="create-route-blog-campaign-section">
					<p class="form-label">Add campaign (registry)</p>
					<div class="create-route-blog-campaign-add-grid">
						<input type="text" class="form-input" data-blog-new-campaign-id placeholder="id (a–z, 0–9, max 12)" maxlength="12" autocomplete="off" />
						<input type="text" class="form-input" data-blog-new-campaign-label placeholder="Label" maxlength="200" />
					</div>
					<textarea class="form-input create-route-blog-campaign-notes" data-blog-new-campaign-notes rows="2" placeholder="Notes (optional)" maxlength="2000"></textarea>
					<button type="button" class="btn-secondary" data-blog-campaign-add-btn>Add campaign</button>
					<p class="create-cost create-route-blog-campaign-hint" data-blog-campaign-add-status aria-live="polite"></p>
				</div>
			`
			: "";

		const registryRows = (this._blogCampaignList || [])
			.map((c) => {
				const rawId = String(c.id || "");
				const idEsc = escapeHtml(rawId);
				const label = escapeHtml(String(c.label || c.id || ""));
				const active = c.active !== false;
				const activeCtrl = this._blogUserIsAdmin
					? html`<label class="create-route-blog-campaign-active-label"><input type="checkbox" data-blog-campaign-active="${rawId}" ${active ? "checked" : ""} /> Active</label>`
					: html`<span class="create-route-blog-campaign-active-ro">${active ? "Active" : "Off"}</span>`;
				return html`<tr>
					<td class="create-route-blog-campaign-reg-id">${idEsc}</td>
					<td>${label}</td>
					<td class="create-route-blog-campaign-reg-active">${activeCtrl}</td>
				</tr>`;
			})
			.join("");

		const registryTable =
			(this._blogCampaignList || []).length > 0
				? html`<table class="create-route-blog-campaign-registry" role="grid">
						<thead>
							<tr>
								<th scope="col">Id</th>
								<th scope="col">Label</th>
								<th scope="col">Active</th>
							</tr>
						</thead>
						<tbody>${registryRows}</tbody>
					</table>`
				: html`<p class="create-cost">No campaigns in the registry yet.${this._blogUserIsAdmin ? " Add one below." : ""}</p>`;

		body.innerHTML = html`
			${previewLi ? html`<ul class="create-route-blog-campaign-simple-list">${previewLi}</ul>` : ""}
			<div class="create-route-blog-campaign-section">
				<p class="form-label">Tracked link</p>
				<p class="create-cost create-route-blog-campaign-lead">Choose a campaign id to build a URL that attributes views in analytics. Custom ids must be 1–12 lowercase letters or numbers.</p>
				<select class="form-select" data-blog-campaign-select>
					<option value="">Select campaign…</option>
					${opts}
					<option value="__custom__">Custom id…</option>
				</select>
				<div class="create-route-blog-campaign-custom-wrap" data-blog-campaign-custom-wrap hidden>
					<label class="form-label" for="blog-campaign-custom-input">Custom campaign id</label>
					<input type="text" id="blog-campaign-custom-input" class="form-input" data-blog-campaign-custom-input placeholder="e.g. feed12" maxlength="12" autocomplete="off" />
				</div>
				<p class="create-cost create-route-blog-campaign-url-status" data-blog-campaign-url-status aria-live="polite"></p>
				<div class="create-route-blog-campaign-url-row">
					<label class="form-label" for="blog-campaign-tracked-out">Tracked URL</label>
					<div class="create-route-blog-campaign-url-fields">
						<input type="text" id="blog-campaign-tracked-out" class="form-input" data-blog-tracked-out readonly />
						<button type="button" class="btn-secondary" data-blog-copy-tracked>Copy</button>
					</div>
				</div>
				<div class="create-route-blog-campaign-url-row">
					<label class="form-label" for="blog-campaign-canonical-out">Canonical URL</label>
					<div class="create-route-blog-campaign-url-fields">
						<input type="text" id="blog-campaign-canonical-out" class="form-input" data-blog-canonical-out readonly />
						<button type="button" class="btn-secondary" data-blog-copy-canonical>Copy</button>
					</div>
				</div>
			</div>
			<div class="create-route-blog-campaign-section">
				<p class="form-label">Campaign registry</p>
				${registryTable}
			</div>
			${adminAdd}
		`;
	}

	async fetchTrackedUrlForBlogCampaign() {
		const post = this._blogCampaignPost;
		const body = this.querySelector("[data-blog-campaign-body]");
		const statusEl = body?.querySelector("[data-blog-campaign-url-status]");
		const trackedEl = body?.querySelector("[data-blog-tracked-out]");
		const canonEl = body?.querySelector("[data-blog-canonical-out]");
		if (!post?.id || !trackedEl || !canonEl) return;
		const select = body.querySelector("[data-blog-campaign-select]");
		const customIn = body.querySelector("[data-blog-campaign-custom-input]");
		let raw = select?.value || "";
		if (raw === "__custom__") {
			raw = (customIn?.value || "").trim().toLowerCase();
		}
		if (!raw) {
			trackedEl.value = "";
			canonEl.value = "";
			if (statusEl) statusEl.textContent = "";
			return;
		}
		if (!BLOG_CAMPAIGN_ID_RE.test(raw)) {
			if (statusEl) statusEl.textContent = "Campaign id must be 1–12 lowercase letters or numbers.";
			trackedEl.value = "";
			canonEl.value = "";
			return;
		}
		if (statusEl) statusEl.textContent = "Loading URL…";
		try {
			const res = await fetch(
				`/api/blog/posts/${post.id}/tracked-url?campaign=${encodeURIComponent(raw)}`,
				{ credentials: "include" }
			);
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				if (statusEl) statusEl.textContent = data?.error || "Could not build URL.";
				trackedEl.value = "";
				canonEl.value = "";
				return;
			}
			const built = buildParasceneBlogPublicUrls(post.slug, raw);
			trackedEl.value = built.tracked;
			canonEl.value = built.canonical;
			if (statusEl) statusEl.textContent = "";
		} catch (e) {
			if (statusEl) statusEl.textContent = "Could not build URL.";
			trackedEl.value = "";
			canonEl.value = "";
		}
	}

	copyBlogCampaignSimpleTracked(campaignId, btn) {
		const post = this._blogCampaignPost;
		if (!post?.slug || campaignId == null) return;
		const raw = String(campaignId).trim().toLowerCase();
		if (!BLOG_CAMPAIGN_ID_RE.test(raw)) return;
		const built = buildParasceneBlogPublicUrls(post.slug, raw);
		navigator.clipboard.writeText(built.tracked).then(() => {
			if (btn) {
				const prev = btn.textContent;
				btn.textContent = "Copied";
				setTimeout(() => {
					btn.textContent = prev;
				}, 1500);
			}
		}).catch(() => {});
	}

	/** Canonical public URL (no campaign segment); same as admin “Canonical URL” field. */
	copyBlogCampaignCanonicalSimple(btn) {
		const post = this._blogCampaignPost;
		if (!post?.slug) return;
		const { canonical } = buildParasceneBlogPublicUrls(post.slug, "x");
		navigator.clipboard.writeText(canonical).then(() => {
			if (btn) {
				const prev = btn.textContent;
				btn.textContent = "Copied";
				setTimeout(() => {
					btn.textContent = prev;
				}, 1500);
			}
		}).catch(() => {});
	}

	copyBlogCampaignPreview(btn) {
		const post = this._blogCampaignPost;
		if (!post?.slug) return;
		const url = blogPreviewFullUrl(post.slug);
		if (!url) return;
		navigator.clipboard.writeText(url).then(() => {
			if (btn) {
				const prev = btn.textContent;
				btn.textContent = "Copied";
				setTimeout(() => {
					btn.textContent = prev;
				}, 1500);
			}
		}).catch(() => {});
	}

	copyBlogCampaignTrackedField(which) {
		const body = this.querySelector("[data-blog-campaign-body]");
		const sel = which === "canonical" ? "[data-blog-canonical-out]" : "[data-blog-tracked-out]";
		const inp = body?.querySelector(sel);
		if (!inp || !inp.value) return;
		navigator.clipboard.writeText(inp.value).then(() => {
			const btn = body.querySelector(which === "canonical" ? "[data-blog-copy-canonical]" : "[data-blog-copy-tracked]");
			if (btn) {
				const prev = btn.textContent;
				btn.textContent = "Copied";
				setTimeout(() => {
					btn.textContent = prev;
				}, 1500);
			}
		}).catch(() => {});
	}

	async patchBlogCampaignActive(campaignId, active) {
		if (!this._blogUserIsAdmin || !campaignId) return;
		try {
			const res = await fetch(`/api/blog/campaigns/${encodeURIComponent(campaignId)}`, {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ active })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				window.alert(data?.error || "Could not update campaign.");
				return;
			}
			const r = await fetch("/api/blog/campaigns", { credentials: "include" });
			const data = await r.json().catch(() => ({}));
			if (r.ok) this._blogCampaignList = Array.isArray(data?.campaigns) ? data.campaigns : [];
			this.renderBlogCampaignModalContent();
		} catch (_) {
			window.alert("Could not update campaign.");
		}
	}

	async submitBlogCampaignAdd(e) {
		e.preventDefault();
		if (!this._blogUserIsAdmin) return;
		const body = this.querySelector("[data-blog-campaign-body]");
		const statusEl = body?.querySelector("[data-blog-campaign-add-status]");
		const idIn = body?.querySelector("[data-blog-new-campaign-id]");
		const labelIn = body?.querySelector("[data-blog-new-campaign-label]");
		const notesIn = body?.querySelector("[data-blog-new-campaign-notes]");
		const rawId = (idIn?.value || "").trim().toLowerCase();
		if (!BLOG_CAMPAIGN_ID_RE.test(rawId)) {
			if (statusEl) statusEl.textContent = "Id must be 1–12 lowercase letters or numbers.";
			return;
		}
		if (isSystemReservedBlogCampaignId(rawId)) {
			if (statusEl) {
				statusEl.textContent =
					"Ids n and i are reserved for feed and blog index links; choose another id.";
			}
			return;
		}
		if (statusEl) statusEl.textContent = "Saving…";
		try {
			const res = await fetch("/api/blog/campaigns", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id: rawId,
					label: (labelIn?.value || "").trim(),
					notes: (notesIn?.value || "").trim(),
					active: true
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				if (statusEl) statusEl.textContent = data?.error || "Could not add campaign.";
				return;
			}
			if (idIn) idIn.value = "";
			if (labelIn) labelIn.value = "";
			if (notesIn) notesIn.value = "";
			if (statusEl) statusEl.textContent = "Campaign added.";
			const r = await fetch("/api/blog/campaigns", { credentials: "include" });
			const listData = await r.json().catch(() => ({}));
			if (r.ok) this._blogCampaignList = Array.isArray(listData?.campaigns) ? listData.campaigns : [];
			this.renderBlogCampaignModalContent();
			const sel = body.querySelector("[data-blog-campaign-select]");
			if (sel) {
				sel.value = rawId;
				const wrap = body.querySelector("[data-blog-campaign-custom-wrap]");
				if (wrap) wrap.hidden = true;
				this.fetchTrackedUrlForBlogCampaign();
			}
		} catch (_) {
			if (statusEl) statusEl.textContent = "Could not add campaign.";
		}
	}

	async onBlogNewDraft() {
		const slugRaw = window.prompt("URL slug (lowercase, hyphens, e.g. my-new-post):", "");
		if (slugRaw == null) return;
		const titleRaw = window.prompt("Title:", "");
		if (titleRaw == null || !String(titleRaw).trim()) return;
		const res = await fetch("/api/blog/posts", {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slug: slugRaw.trim(), title: String(titleRaw).trim() })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			window.alert(data?.error || "Could not create draft.");
			return;
		}
		const id = data?.post?.id;
		if (id) {
			window.location.href = `/create/blog/${id}`;
		}
	}

	async onBlogDeletePost(postId) {
		if (!postId) return;
		if (
			!window.confirm(
				"Delete this post permanently? This removes the post and its view analytics for this post."
			)
		) {
			return;
		}
		try {
			const res = await fetch(`/api/blog/posts/${encodeURIComponent(postId)}`, {
				method: "DELETE",
				credentials: "include"
			});
			if (res.status === 204) {
				await this.loadBlogPosts();
				return;
			}
			const data = await res.json().catch(() => ({}));
			window.alert(data?.error || "Could not delete post.");
		} catch (_) {
			window.alert("Could not delete post.");
		}
	}

	async loadBlogPosts() {
		const container = this.querySelector("[data-blog-table-container]");
		const statusEl = this.querySelector("[data-blog-status]");
		if (!container) return;
		statusEl.textContent = "Loading…";
		const r = await fetchJsonWithStatusDeduped("/api/blog/posts", { credentials: "include" }, { windowMs: 5000 });
		if (!r.ok) {
			statusEl.textContent = r.data?.error || "Failed to load posts.";
			container.innerHTML = "";
			return;
		}
		statusEl.textContent = "";
		const posts = Array.isArray(r.data?.posts) ? r.data.posts : [];
		if (posts.length === 0) {
			container.innerHTML = html`<p class="create-cost">No blog posts yet.</p>`;
			return;
		}
		const rows = posts
			.map((p) => {
				const id = p.id;
				const slug = String(p.slug || "").trim();
				const st = String(p.status || "");
				const updated = p.updated_at ? String(p.updated_at).slice(0, 19).replace("T", " ") : "";
				const authorUser =
					p.author_username != null && String(p.author_username).trim() !== ""
						? String(p.author_username).trim()
						: "";
				const authorCell = authorUser || "\u2014";
				const stKey = ["draft", "published", "archived"].includes(st) ? st : "draft";
				const views = Number.isFinite(Number(p.view_count)) ? Number(p.view_count) : 0;
				const titleEsc = escapeHtml(String(p.title || ""));
				const slugEsc = escapeHtml(slug);
				return html`<tr class="create-route-blog-row">
					<td class="create-route-blog-title-cell">${titleEsc}</td>
					<td><span class="create-route-blog-author">${escapeHtml(authorCell)}</span></td>
					<td><span class="create-route-blog-status create-route-blog-status--${stKey}">${escapeHtml(st)}</span></td>
					<td class="create-route-blog-views">${views}</td>
					<td class="create-route-blog-date">${escapeHtml(updated)}</td>
					<td class="create-route-blog-actions">
						<span class="create-route-blog-actions-inner">
							<button
								type="button"
								class="create-route-blog-icon-btn"
								data-blog-campaign-open
								data-blog-post-id="${String(id)}"
								data-blog-post-slug="${slugEsc}"
								data-blog-post-title="${titleEsc}"
								aria-label="Campaigns and tracked links"
							>
								${blogIcCampaign}
							</button>
							<button type="button" class="create-route-blog-icon-btn" data-blog-edit="${id}" aria-label="Edit post">
								${blogIcEdit}
							</button>
							<button
								type="button"
								class="create-route-blog-icon-btn create-route-blog-icon-btn--danger"
								data-blog-delete="${id}"
								aria-label="Delete post"
							>
								${blogIcTrash}
							</button>
						</span>
					</td>
				</tr>`;
			})
			.join("");
		container.innerHTML = html`<table class="create-route-blog-table" role="grid">
					<thead>
						<tr>
							<th scope="col">Title</th>
							<th scope="col">Author</th>
							<th scope="col">Status</th>
							<th scope="col">Views</th>
							<th scope="col">Updated</th>
							<th scope="col" class="create-route-blog-th-actions"><span class="create-route-blog-sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>`;
		container.querySelectorAll("[data-blog-edit]").forEach((btn) => {
			btn.addEventListener("click", () => {
				const id = btn.getAttribute("data-blog-edit");
				if (id) window.location.href = `/create/blog/${id}`;
			});
		});
		container.querySelectorAll("[data-blog-delete]").forEach((btn) => {
			btn.addEventListener("click", () => {
				const rowId = btn.getAttribute("data-blog-delete");
				if (rowId) this.onBlogDeletePost(rowId);
			});
		});
		container.querySelectorAll("[data-blog-campaign-open]").forEach((btn) => {
			btn.addEventListener("click", () => {
				const id = btn.getAttribute("data-blog-post-id");
				const slug = btn.getAttribute("data-blog-post-slug") || "";
				const title = btn.getAttribute("data-blog-post-title") || "";
				if (id) this.openBlogCampaignModal({ id, slug, title });
			});
		});
	}

	restoreFieldValues(savedFieldValues) {
		const fields = this.selectedMethod?.fields || {};
		Object.keys(savedFieldValues).forEach(fieldKey => {
			// Query-param prompt supersedes saved prompt on Basic tab
			if (this._promptFromUrl && isPromptLikeField(fieldKey, fields[fieldKey])) return;
			let el = this.querySelector(`#field-${fieldKey}`);
			if (el?.classList?.contains('form-switch')) {
				el = el.querySelector('.form-switch-input');
			}
			if (el) {
				const savedValue = savedFieldValues[fieldKey];
				if (savedValue !== undefined && savedValue !== null && savedValue !== '') {
					if (el.type === 'checkbox') {
						el.checked = savedValue === true || savedValue === 'true';
					} else if (typeof savedValue === 'string' || typeof savedValue === 'number') {
						el.value = String(savedValue);
					}
					// Skip objects/arrays (e.g. `{}` from corrupted JSON of a File) — never assign to .value
					// Trigger change event to update fieldValues and button state
					el.dispatchEvent(new Event('input', { bubbles: true }));
					el.dispatchEvent(new Event('change', { bubbles: true }));
				}
			}
		});
		// Re-apply URL prompt so it wins over any saved prompt we skipped
		this.applyUrlPromptToBasicFields();
	}
}

customElements.define("app-route-create", AppRouteCreate);
