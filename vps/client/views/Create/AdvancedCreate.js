import * as blogCampaignPathModule from '../../shared/blogCampaignPath.js';
import * as ProviderFieldsModule from '../../components/ProviderFields/ProviderFields.js';
import * as aspectRatioModule from '../../shared/aspectRatio.js';
import * as createSettingsSyncModule from '../../shared/createSettingsSync.js';
import * as embedPageRuntimeModule from '../../shared/embedPageRuntime.js';
import '../../elements/tabs.js';
import * as createPageRuntimeModule from '../../shared/createPageRuntime.js';
import * as apiModule from '../../shared/api.js';
import * as createSubmitModule from '../../providers/create/transport.js';
import * as gpuOccupancyModule from '../../shared/gpuOccupancy.js';
import * as mutateQueueSyncModule from '../../shared/mutateQueueSync.js';
import * as promptFieldClearModule from '../../shared/promptFieldClear.js';
import * as autogrowModule from '../../shared/autogrow.js';
import * as triggeredSuggestModule from '../../shared/triggeredSuggest.js';
import * as importMediaEntryModule from '../../shared/importMediaEntry.js';
import { reportSubmissionError } from './SubmissionFeedback.js';
import { createAspectRatioWarning } from './AspectRatioWarning.js';
import { readSavedCreateForm } from '../../shared/createSettingsSync.js';
import { createWorkflowLifetime } from './lifetime.js';
import { navigate } from '../../shared/createPageRuntime.js';

const [
	blogCampaignPathMod,
	providerFormFieldsMod,
	aspectRatioMod,
	createSettingsSyncMod,
	embedPageRuntimeMod,
] = [blogCampaignPathModule, ProviderFieldsModule, aspectRatioModule, createSettingsSyncModule, embedPageRuntimeModule];
const { isSystemReservedBlogCampaignId } = blogCampaignPathMod;
const {
	renderFields: renderProviderFormFields,
 disposeProviderFormFields,
	isPromptLikeField,
	isImageUrlField,
	isImageUrlArrayField,
	extraFieldsFromSelectOptions,
	resolveRenderableFields,
	isAlwaysHiddenField,
	applyShowWhenFields,
	fieldMatchesShowWhen,
} = providerFormFieldsMod;
const {
	shouldUseAspectRatioSelector,
	getVirtualAspectRatioField,
	closestAspectRatioPreset,
	buildAspectRatioMismatchMessage,
} = aspectRatioMod;
const {
	mergeSharedSettingsIntoSessionSelections,
	getSharedFieldValueOverrides,
	getSharedModelForContext,
	getSharedAdvancedPrompt,
	getSharedAspectRatio,
	readSharedCreateSettings,
	syncCreatePageSelectionsToSharedStorage,
	persistSharedPrompt,
	persistSharedAspectRatio,
	CREATE_SETTINGS_UPDATED_EVENT,
} = createSettingsSyncMod;
const { notifySpaPageOverlayEmbedReady } = embedPageRuntimeMod;

let fetchJsonWithStatusDeduped;
let readRasterFileDimensions;
let readImageUrlDimensions;
let showOccupancyConfirm;
let getMutateLineageForImageUrls;
let attachPromptFieldClear;
let attachAutoGrowTextarea;
let attachPromptInlineSuggest;


function dataBuilderTabMarkup() {
	return html`
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
                <div class="create-prompt-wrap">
                  <textarea class="form-input prompt-editor" id="advanced-prompt" data-advanced-prompt data-autogrow="true" rows="3" placeholder="Enter a prompt..."></textarea>
                  <a href="#" class="create-prompt-clear" tabindex="-1" aria-label="Clear field" data-prompt-clear>clear</a>
                </div>
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
          </tab>`;
}

async function afterCreateOverlaySubmit(result, workflow) {
	if (!result?.id || !workflow?._lifetime?.active) return;

	const runtimeMod = createPageRuntimeModule;
	if (workflow._lifetime.active) runtimeMod.refreshAfterSubmit({ creationId: result.id });
}

async function openBlogEditorFromCreate(id) {
	if (!id) return;
	const href = `/create/blog/${id}`;

	const { openFullPageRoute } = createPageRuntimeModule;
	openFullPageRoute(href);
}


function initializeDependencies() {
		const [
			apiMod,
			createSubmitMod,
			gpuOccupancyMod,
			mutateQueueSyncMod,
			promptFieldClearMod,
			autogrowMod,
			suggestMod,
		] = [apiModule, createSubmitModule, gpuOccupancyModule, mutateQueueSyncModule, promptFieldClearModule, autogrowModule, triggeredSuggestModule];

		fetchJsonWithStatusDeduped = apiMod.fetchJsonWithStatusDeduped;

		readRasterFileDimensions = createSubmitMod.readRasterFileDimensions;
		readImageUrlDimensions = createSubmitMod.readImageUrlDimensions;
		showOccupancyConfirm = gpuOccupancyMod.showOccupancyConfirm;

		getMutateLineageForImageUrls = mutateQueueSyncMod.getMutateLineageForImageUrls;

		attachPromptFieldClear = promptFieldClearMod.attachPromptFieldClear;

		attachAutoGrowTextarea = autogrowMod.attachAutoGrowTextarea;

		attachPromptInlineSuggest = suggestMod.attachPromptInlineSuggest;

}

const html = String.raw;
const BASIC_IMAGE_EDIT_CARRYOVER_KEY = 'create_page_image_edit_carryover';

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
		this.handleServersConfigUpdated = this.handleServersConfigUpdated.bind(this);
		this.storageKey = 'create-page-selections';
		this._advancedConfirm = null; // { serverId, args, cost } when cost dialog is open
		this._promptFromUrl = null; // prompt from ?prompt= (landing page); applied when Basic tab has a prompt field
		this._confirmPrimaryAction = null;
		this.showHiddenFields = false;
		this._imageFieldPersistTokens = Object.create(null);
		this._pendingSavedFieldValues = null;
		this._crossMethodImageCarryover = null;
		this._optionExtraFieldKeys = [];
		this._optionExtraModel = null;
	}

	_fetch(url, options = {}) {
 const request = url.startsWith('/api/create') ? this.createProvider.api.request : window.fetch.bind(window);
 return request(url, { ...options, signal: this._lifetime.signal });
 }

	async connectedCallback() {
		this._lifetime = createWorkflowLifetime();
		initializeDependencies();
  this.createProvider.workflow.enterMode({ mode: 'advanced' });

		((runtimeMod) => {
 if (!this._lifetime.active) return;
			runtimeMod.bindCreatePageEmbedNavigation();
			runtimeMod.bindCreatePageEmbedEscape(() => {
				const confirm = this.querySelector('.create-route-advanced-confirm.open:not([hidden])');
				if (confirm instanceof HTMLElement) return true;
				const preview = this.querySelector('[data-advanced-preview-dialog].open:not([hidden])');
				if (preview instanceof HTMLElement) return true;
				const blog = this.querySelector('[data-blog-campaign-dialog].open:not([hidden])');
				return blog instanceof HTMLElement;
			});
		})(createPageRuntimeModule);
  this._lifetime.own(this.createProvider.workflow.subscribe(status => {
   if (!this._lifetime.active) return;
   const button = this.querySelector('[data-create-button]');
   if (['idle', 'error'].includes(status.phase)) { this.resetCreateButton(button); this.updateButtonState(); }
   else if (button) button.disabled = true;
  }));
  let previousDraft;
  this._lifetime.own(this.createProvider.draft.subscribe(saved => {
   const previous = previousDraft; previousDraft = saved;
   if (!previous || this._writingDraft || this._restoringSelections || !this.selectedMethod || !this._lifetime.active) return;
   if (JSON.stringify(previous.fieldValues) === JSON.stringify(saved.fieldValues) && previous.serverId === saved.serverId && previous.methodKey === saved.methodKey) return;
   queueMicrotask(() => {
    if (!this._lifetime.active || this._writingDraft || this._restoringSelections) return;
    this._restoringSelections = true;
    try {
     const current = this.createProvider.draft.read();
     if (current.serverId !== this.selectedServer?.id || current.methodKey !== this.getMethodKey()) this.restoreSelections();
     else { this.fieldValues = {}; this.renderFields(); this.updateButtonState(); }
    } finally { this._restoringSelections = false; }
   });
  }));
		this._showBlogTab = false;
		if (this._blogUserIsAdmin == null) this._blogUserIsAdmin = false;
		this._serversLoading = true;
		this._embedOnly = true;
		// Locked to Advanced for now — hide Data Builder / Blog tab picker.
		// const dataBuilderTab = embedOnly ? '' : dataBuilderTabMarkup();
		const dataBuilderTab = '';
		const viewTemplate = document.createElement('template');
		viewTemplate.innerHTML = html`
      <div class="create-route">
        <div class="create-route-loading" data-create-loading aria-busy="true"></div>
        <div class="create-route-content" data-create-content hidden aria-hidden="true">
        <div class="create-route-empty-wrap route-empty route-empty-state" data-create-empty hidden aria-hidden="true">
          <div class="route-empty-title">No servers available</div>
          <div class="route-empty-message">You don't have access to any servers yet. Add a server to get started.</div>
        </div>
        <div class="create-route-form-wrap" data-create-form-wrap hidden aria-hidden="true">
        <app-tabs active="basic" class="create-route-tabs-embed">
          <tab data-id="basic" label="Advanced" default>
            <!--
            <div class="route-header">
              <p>Select a server and generation method to create a new image.</p>
            </div>
            -->
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
                <div data-fields-container></div>
                <div class="create-fields-toggle" data-fields-toggle style="display: none;">
                  <a href="#" class="create-fields-toggle-link" data-toggle-hidden-fields>Show hidden fields</a>
                </div>
                <div class="create-fields-hidden-slot" data-fields-hidden-slot></div>
              </div>
            </form>
            <div class="create-controls">
              <button type="button" class="btn-primary create-button" data-create-button disabled>
                Create
              </button>
              <p class="create-cost" data-create-cost>Select a server and method to see cost</p>
            </div>
          </tab>
          ${dataBuilderTab}
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
            <a href="/create" class="create-page-footer-link create-switch-to-basic" data-create-switch-to-basic>Basic Mode</a>
            <span class="create-page-footer-sep" aria-hidden="true">·</span>
            <a href="/party" class="create-page-footer-link create-page-footer-link--secondary">Party Mode</a>
            <span class="create-page-footer-sep" aria-hidden="true">·</span>
            <button type="button" class="create-page-footer-link create-page-footer-link--secondary" data-import-media>Import Media</button>
          </nav>
        </footer>
        </div>
      </div>
    `;
		this.replaceChildren(viewTemplate.content.cloneNode(true));
		this._aspectRatioWarning = createAspectRatioWarning({
			root: this,
			lifetime: this._lifetime,
			getFields: () => this.getRenderableMethodFields(),
			getValues: () => this.fieldValues,
		});
		this.setupEventListeners();
		this._notifyCreateEmbedReady();
		const serversPaintSource = this.applyServersFromCacheOrDefault();
		this.ready = Promise.resolve().then(() => {
			if (!this.isConnected) return;
			// Locked to Advanced for now — hide Data Builder / Blog tab picker.
			// if (!embedOnly) void this._maybeAddBlogTabFromProfile();
			const refreshData = () => {
				this.loadServers();
				this.loadCredits();
			};
			if (serversPaintSource) {
				this._lifetime.defer(refreshData, 0);
			} else {
				refreshData();
			}
			this._attachPromptFieldEnhancements();
		});
	}

	_attachPromptFieldEnhancements() {
		const promptTextarea = this.querySelector('[data-advanced-prompt]');
		if (promptTextarea instanceof HTMLTextAreaElement) {
			if (typeof attachAutoGrowTextarea === 'function') {
				this._advancedPromptAutogrow = attachAutoGrowTextarea(promptTextarea);
			}
			if (typeof attachPromptInlineSuggest === 'function') {
				attachPromptInlineSuggest(promptTextarea);
			}
			if (typeof attachPromptFieldClear === 'function') {
				attachPromptFieldClear(promptTextarea, {
					afterClear: () => {
						this._refreshAdvancedPromptGrow();
					},
				});
			}
			const tabsEl = this.querySelector('app-tabs');
			if (tabsEl?.getAttribute('active') === 'advanced') {
				this._lifetime.frame(() => this._refreshAdvancedPromptGrow());
				this._lifetime.defer(() => this._refreshAdvancedPromptGrow(), 60);
			}
		}
		this.querySelectorAll('.prompt-editor').forEach((el) => {
			if (typeof attachPromptInlineSuggest === 'function') attachPromptInlineSuggest(el);
			if (el instanceof HTMLTextAreaElement && typeof attachAutoGrowTextarea === 'function') {
				attachAutoGrowTextarea(el);
			}
		});
	}

	/** Markup for the admin/founder-only Blog tab, injected after the profile gate resolves. */
	_blogTabMarkup() {
		return html`
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
        `;
	}

	/** Resolve the admin/founder Blog-tab gate without blocking the create form's first paint. */
	async _maybeAddBlogTabFromProfile() {
		if (this._embedOnly) return;
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
			if (pr.ok) this._blogUserIsAdmin = p?.role === "admin";
			const eligible = pr.ok && (p?.role === "admin" || plan === "founder");
			if (eligible) this._addBlogTab();
		} catch (_) {
			// offline / profile unavailable — Blog tab stays hidden
		}
	}

	/** Append the Blog tab to the already-rendered tab strip and wire it up. */
	_addBlogTab() {
		if (this._embedOnly || this._showBlogTab) return;
		const tabs = this.querySelector('app-tabs');
		if (!tabs || !this.isConnected) return;
		const tpl = document.createElement('template');
		tpl.innerHTML = this._blogTabMarkup();
		const tabEl = tpl.content.querySelector('tab');
		if (!tabEl) return;
		this._showBlogTab = true;
		tabs.appendChild(tabEl);
		// Re-hydrate so the new tab gets a button; active tab is preserved via the `active` attribute.
		if (typeof tabs.hydrate === 'function') tabs.hydrate();
		try {
			this.setupBlogTab();
		} catch (_) {
			// ignore blog tab wiring errors
		}
	}

	disconnectedCallback() {
  this.closeAdvancedConfirm();
 disposeProviderFormFields(this);
		this._lifetime?.destroy();
		clearTimeout(this._blogCampaignCustomDebounce);
		this.flushSharedCreateSettingsToStorage();
		if (typeof this._flushSharedSettingsOnLeave === 'function') {
			window.removeEventListener('pagehide', this._flushSharedSettingsOnLeave);
		}
		document.removeEventListener('credits-updated', this.handleCreditsUpdated);
		// server.js dispatches this on window, so the listener must be on window too.
		window.removeEventListener('parascene:servers-config-updated', this.handleServersConfigUpdated);
		if (CREATE_SETTINGS_UPDATED_EVENT && this.handleCreateSettingsUpdated) {
			document.removeEventListener(CREATE_SETTINGS_UPDATED_EVENT, this.handleCreateSettingsUpdated);
		}
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
			this._lifetime.listen(createButton, "click", () => {
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
			this._lifetime.listen(serverSelect, "change", (e) => this.handleServerChange(e.target.value));
		}

		const methodSelect = this.querySelector("[data-method-select]");
		if (methodSelect) {
			this._lifetime.listen(methodSelect, "change", (e) => this.handleMethodChange(e.target.value));
		}

		const toggleHiddenLink = this.querySelector("[data-toggle-hidden-fields]");
		const hiddenFieldsSlot = this.querySelector("[data-fields-hidden-slot]");
		if (toggleHiddenLink && hiddenFieldsSlot) {
			this._lifetime.listen(toggleHiddenLink, "click", (e) => {
				e.preventDefault();
				this.showHiddenFields = !this.showHiddenFields;
				hiddenFieldsSlot.classList.toggle("show-hidden-fields", this.showHiddenFields);
				toggleHiddenLink.textContent = this.showHiddenFields ? "Hide hidden fields" : "Show hidden fields";
			});
		}

		// Advanced tab: server select and Create button
		const advancedServerSelect = this.querySelector("[data-advanced-server-select]");
		if (advancedServerSelect) {
			this._lifetime.listen(advancedServerSelect, "change", () => {
				const serverId = advancedServerSelect.value;
				const serverSelect = this.querySelector("[data-server-select]");
				if (serverId && serverSelect && String(serverSelect.value) !== String(serverId)) {
					serverSelect.value = serverId;
					this.handleServerChange(serverId);
				}
				this.updateAdvancedCreateButton();
			});
		}
		const advancedCreateButton = this.querySelector("[data-advanced-create-button]");
		if (advancedCreateButton) {
			this._lifetime.listen(advancedCreateButton, "click", () => this.handleAdvancedCreate());
		}
		const previewPayloadBtn = this.querySelector("[data-advanced-preview-payload]");
		if (previewPayloadBtn) {
			this._lifetime.listen(previewPayloadBtn, "click", () => this.handlePreviewPayload());
		}
		const previewDialog = this.querySelector("[data-advanced-preview-dialog]");
		const previewOverlay = this.querySelector("[data-advanced-preview-overlay]");
		const previewCloseBtn = this.querySelector("[data-advanced-preview-close]");
		const previewCloseX = this.querySelector("[data-advanced-preview-close-x]");
		const previewCopyBtn = this.querySelector("[data-advanced-preview-copy]");
		if (previewOverlay) this._lifetime.listen(previewOverlay, "click", () => this.closePreviewPayload());
		if (previewCloseBtn) this._lifetime.listen(previewCloseBtn, "click", () => this.closePreviewPayload());
		if (previewCloseX) this._lifetime.listen(previewCloseX, "click", () => this.closePreviewPayload());
		if (previewCopyBtn) this._lifetime.listen(previewCopyBtn, "click", () => this.copyPreviewPayload());
		this._boundPreviewEscape = (e) => {
			if (e.key === "Escape") {
				const confirmD = this.querySelector("[data-advanced-confirm-dialog]");
				if (confirmD && !confirmD.hidden && confirmD.classList.contains("open")) {
					this.closeAdvancedConfirm();
					e.preventDefault();
					return;
				}
				const blogD = this.querySelector("[data-blog-campaign-dialog]");
				if (blogD && !blogD.hidden && blogD.classList.contains("open")) {
					this.closeBlogCampaignModal();
					e.preventDefault();
					return;
				}
				const d = this.querySelector("[data-advanced-preview-dialog]");
				if (d && !d.hidden && d.classList.contains("open")) {
					this.closePreviewPayload();
					e.preventDefault();
				}
			}
		};
		this._lifetime.listen(document, "keydown", this._boundPreviewEscape);
		// Advanced confirm dialog
		const confirmDialog = this.querySelector("[data-advanced-confirm-dialog]");
		const confirmOverlay = this.querySelector("[data-advanced-confirm-overlay]");
		const confirmCreateBtn = this.querySelector("[data-advanced-confirm-create]");
		const confirmCancelBtn = this.querySelector("[data-advanced-confirm-cancel]");
		if (confirmOverlay) this._lifetime.listen(confirmOverlay, "click", () => this.closeAdvancedConfirm());
		if (confirmCancelBtn) this._lifetime.listen(confirmCancelBtn, "click", () => this.closeAdvancedConfirm());
		if (confirmCreateBtn) this._lifetime.listen(confirmCreateBtn, "click", () => this.handleConfirmPrimary());
		// Advanced tab: switch toggles
		this.querySelectorAll("[data-advanced-option]").forEach((btn) => {
			this._lifetime.listen(btn, "click", (e) => {
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
			this._lifetime.listen(promptInput, "input", () => this.saveAdvancedOptions());
			this._lifetime.listen(promptInput, "change", () => this.saveAdvancedOptions());
		}
		this.applyPromptFromUrl(); // run first so URL prompt can supersede saved state
		this.restoreAdvancedOptions();

		const switchToBasic = this.querySelector('[data-create-switch-to-basic]');
		if (switchToBasic) {
			this._lifetime.listen(switchToBasic, 'click', async (e) => {
					e.preventDefault();
					e.stopPropagation();
					try {
						await this.persistImageForBasicMode();
					} catch (error) { reportSubmissionError(error, this._lifetime.active); return; }
     if (!this._lifetime.active) return;

					const { switchCreateEditorMode } = createPageRuntimeModule;
					switchCreateEditorMode('basic', e);
				}, true);
		}

		((mod) =>
			mod.bindImportSunoEntry(this, this.createProvider).then(cleanup => this._lifetime.own(cleanup)))(importMediaEntryModule);

		// Restore and persist active tab (Basic / Advanced / Blog); sync with URL hash (#basic, #advanced, #blog)
		const tabsEl = this.querySelector('app-tabs');
		if (tabsEl) {
			// 'blog' is always listed: the Blog tab is injected asynchronously (admin/founder only) after
			// the profile gate resolves, so render-time `_showBlogTab` may still be false here.
			// setActiveTab() safely falls back to the first tab when the target id isn't present.
			const CREATE_TAB_IDS = ['basic'];
			const setCreateActiveTab = (id, opts) => {
				if (typeof tabsEl.setActiveTab !== 'function') return;
				tabsEl.setActiveTab(id, opts);
			};
			const syncTabFromHash = () => {
				if (window.location.pathname !== '/create') return;
				const hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
				if (!CREATE_TAB_IDS.includes(hash)) return;
				setCreateActiveTab(hash, { focus: false });
				try {
					const stored = JSON.stringify(this.createProvider.draft.read());
					const selections = stored ? JSON.parse(stored) : {};
					selections.tab = hash;
					this.createProvider.workflow.edit({ tab: selections.tab }, { notify: false });
				} catch (e) {
					// Ignore storage errors
				}
			};

			const applyInitialCreateTab = () => {
				if (typeof tabsEl.setActiveTab !== 'function') return;
				// Prefer URL hash over sessionStorage when present; default to basic when neither is set
				if (window.location.pathname !== '/create') return;
				const hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
				if (CREATE_TAB_IDS.includes(hash)) {
					setCreateActiveTab(hash);
					try {
						const stored = JSON.stringify(this.createProvider.draft.read());
						const selections = stored ? JSON.parse(stored) : {};
						selections.tab = hash;
						this.createProvider.workflow.edit({ tab: selections.tab }, { notify: false });
					} catch (e) {
						// Ignore storage errors
					}
					return;
				}
				try {
					const stored = JSON.stringify(this.createProvider.draft.read());
					const selections = stored ? JSON.parse(stored) : {};
					const tab = selections?.tab;
					if (CREATE_TAB_IDS.includes(tab)) {
						setCreateActiveTab(tab);
					} else {
						setCreateActiveTab('basic');
					}
				} catch (e) {
					// Ignore storage errors
					setCreateActiveTab('basic');
				}
			};
			if (typeof tabsEl.setActiveTab === 'function') {
				applyInitialCreateTab();
			} else {
				void customElements.whenDefined('app-tabs').then(() => {
					if (!this.isConnected) return;
					customElements.upgrade(tabsEl);
					applyInitialCreateTab();
				});
			}

			this._lifetime.listen(window, 'hashchange', syncTabFromHash);

			this._lifetime.listen(tabsEl, 'tab-change', (e) => {
				const id = e.detail?.id;
				if (!CREATE_TAB_IDS.includes(id)) return;
				try {
					const stored = JSON.stringify(this.createProvider.draft.read());
					const selections = stored ? JSON.parse(stored) : {};
					selections.tab = id;
					this.createProvider.workflow.edit({ tab: selections.tab }, { notify: false });
				} catch (e) {
					// Ignore storage errors
				}
				if (window.location.pathname === '/create' && window.location.hash !== `#${id}`) {
					navigate(`/create#${id}`, { replace: true });
				}
				if (id === 'advanced') {
					this._lifetime.frame(() => this._refreshAdvancedPromptGrow());
				}
			});
			this._createTabHashCleanup = () => window.removeEventListener('hashchange', syncTabFromHash);
		}

		this._lifetime.listen(document, 'credits-updated', this.handleCreditsUpdated);
		// server.js dispatches this on window, so the listener must be on window too.
		this._lifetime.listen(window, 'parascene:servers-config-updated', this.handleServersConfigUpdated);
		this.handleCreateSettingsUpdated = () => this.syncSharedPromptToFields();
		if (CREATE_SETTINGS_UPDATED_EVENT) {
			this._lifetime.listen(document, CREATE_SETTINGS_UPDATED_EVENT, this.handleCreateSettingsUpdated);
		}
		this._flushSharedSettingsOnLeave = () => {
			try {
				this.flushSharedCreateSettingsToStorage();
			} catch (_) {
				// Ignore storage errors
			}
		};
		this._lifetime.listen(window, 'pagehide', this._flushSharedSettingsOnLeave);
	}

	/** True if both arrays match id, name, and server_config (so we can skip re-rendering). */
	serversListSame(a, b) {
		return this.createProvider.serversListSame(a, b);
	}

	clearServersCache() {
		this.createProvider.clearCreateServersCache();
	}

	handleServersConfigUpdated() {
		this.clearServersCache();
		this.loadServers({ forceApply: true });
	}

	/** Process raw API servers (filter + parse server_config) into form we use. */
	processServers(rawServers) {
		return this.createProvider.processCreateServers(rawServers);
	}

	/** Apply a processed server list to state and UI; then restore or auto-select. */
	applyServers(servers) {
		if (!Array.isArray(servers) || servers.length === 0) return;
		this.servers = servers;
		this.renderServerOptions();
		this.renderAdvancedServerOptions();
		let restored = this.restoreSelections();
		if (!restored && this.servers.length > 0) {
			this.applyDefaultServerSelection();
		}
	}

	/** First server in list when nothing was restored; do not overwrite saved shared settings. */
	applyDefaultServerSelection() {
		const firstServer = this.servers[0];
		const serverSelect = this.querySelector('[data-server-select]');
		if (serverSelect) {
			serverSelect.value = firstServer.id;
			this.handleServerChange(firstServer.id, { persist: false });
		}
		const advancedSelect = this.querySelector('[data-advanced-server-select]');
		if (advancedSelect) {
			advancedSelect.value = firstServer.id;
			this.updateAdvancedCreateButton();
		}
	}

	_notifyCreateEmbedReady() {
		if (this._createEmbedReadySent) return;
		this._createEmbedReadySent = true;
		notifySpaPageOverlayEmbedReady();
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
			if (
				document.body.classList.contains('create-page-advanced') ||
				Boolean(this.closest('.create-workflow-root.create-page-advanced'))
			) {
				document.body.classList.add('loaded');
				this._notifyCreateEmbedReady();
				this._lifetime.frame(() => {
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
			if (
				document.body.classList.contains('create-page-advanced') ||
				Boolean(this.closest('.create-workflow-root.create-page-advanced'))
			) {
				document.body.classList.add('loaded');
				this._notifyCreateEmbedReady();
			}
		}
	}

	/** Read the processed servers list from localStorage cache. */
	readServersCacheList() {
		const paint = this.createProvider.getCreateServersPaint();
		return paint.source === 'cache' ? paint.servers : null;
	}

	/** Synchronously reveal the form from cached servers if available. Returns true when applied. */
	applyServersFromCache() {
		const cached = this.readServersCacheList();
		if (!cached) return false;
		this.applyServers(cached);
		this._serversLoading = false;
		this.updateCreateFormVisibility();
		return true;
	}

	/** Instant cold start when localStorage cache is empty (public servers baked into the bundle). */
	applyServersFromDefault() {
		const paint = this.createProvider.getCreateServersPaint();
		if (paint.source !== 'bundle' || !paint.servers.length) return false;
		this.applyServers(paint.servers);
		this._serversLoading = false;
		this.updateCreateFormVisibility();
		return true;
	}

	/**
	 * Paint order: localStorage cache, then baked default, else stay on loading until network.
	 * @returns {'cache'|'default'|false}
	 */
	applyServersFromCacheOrDefault() {
		const paint = this.createProvider.getCreateServersPaint();
		if (!paint.servers.length) return false;
		this.applyServers(paint.servers);
		this._serversLoading = false;
		this.updateCreateFormVisibility();
		return paint.source === 'cache' ? 'cache' : 'default';
	}

	/** Cache then bundle for first paint; network only when bundle was used or cache TTL expired. */
	loadServers(options = {}) {
		const source = this.applyServersFromCacheOrDefault();
		const paint = this.createProvider.getCreateServersPaint();
		if (options.forceApply || source !== 'cache' || paint.shouldRefresh) {
			this.refreshServersFromNetwork(options);
		}
	}

	/** Fetch /api/servers, update the cache, and re-apply only when the list/config changed. */
	refreshServersFromNetwork(options = {}) {
		const { forceApply = false } = options;
		this.createProvider.refreshCreateServersFromNetwork()
			.then((result) => {
				if (!this.isConnected) return;
				this._serversLoading = false;
				if (!result?.ok || !Array.isArray(result.servers)) {
					this._lifetime.defer(() => this.updateCreateFormVisibility(), 0);
					return;
				}
				const processed = result.servers;
				if (!forceApply && this.serversListSame(processed, this.servers)) return;
				const promptEl = this.querySelector('[data-advanced-prompt]');
				const hadFocusOnPrompt = promptEl && document.activeElement === promptEl;
				this.applyServers(processed);
				this._lifetime.defer(() => {
					this.updateCreateFormVisibility();
					if (hadFocusOnPrompt && document.activeElement !== promptEl) {
						this._lifetime.frame(() => promptEl.focus());
					}
				}, 0);
			})
			.catch(() => {
				this._serversLoading = false;
				this._lifetime.defer(() => this.updateCreateFormVisibility(), 0);
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
		const canQuery = hasAtLeastOneSwitch;
		advancedCreateButton.disabled = !hasServer || !canQuery;
		advancedCreateButton.textContent = 'Query';
		if (costEl) costEl.hidden = canQuery;
		if (costQueryEl) costQueryEl.hidden = !canQuery;
	}

	flushSharedCreateSettingsToStorage() {
		const fields = this.selectedMethod?.fields || {};
		const fieldValues = { ...this.fieldValues };
		for (const [fieldKey, field] of Object.entries(fields)) {
			if (!isPromptLikeField(fieldKey, field)) continue;
			let el = this.querySelector(`#field-${fieldKey}`);
			if (el?.classList?.contains('form-switch')) {
				el = el.querySelector('.form-switch-input');
			}
			if (el && typeof el.value === 'string') {
				fieldValues[fieldKey] = el.value;
			}
		}
  if (!this._lifetime?.active || !this.selectedMethod) return;
  Object.assign(this.fieldValues, fieldValues);
  this.saveSelections();
	}

	_persistOutgoingPromptBeforeSwitch() {
		if (this._promptFromUrl) return;
		const fields = this.selectedMethod?.fields;
		if (fields && typeof fields === 'object') {
			for (const [fieldKey, field] of Object.entries(fields)) {
				if (!isPromptLikeField(fieldKey, field)) continue;
				const fromValues = this.fieldValues[fieldKey];
				if (typeof fromValues === 'string' && fromValues.trim()) {
					persistSharedPrompt(fromValues, { notify: false });
					return;
				}
				const el = this.querySelector(`#field-${fieldKey}`);
				if (el && typeof el.value === 'string' && el.value.trim()) {
					persistSharedPrompt(el.value, { notify: false });
					return;
				}
			}
		}
		const advancedPrompt = this.querySelector('[data-advanced-prompt]');
		if (advancedPrompt && typeof advancedPrompt.value === 'string' && advancedPrompt.value.trim()) {
			persistSharedPrompt(advancedPrompt.value, { notify: false });
		}
	}

	_persistOutgoingAspectRatioBeforeSwitch() {
		let aspect = '';
		if (typeof this.fieldValues.aspect_ratio === 'string' && this.fieldValues.aspect_ratio.trim()) {
			aspect = this.fieldValues.aspect_ratio.trim();
		} else {
			const hidden = this.querySelector('#field-aspect_ratio');
			if (hidden instanceof HTMLInputElement && hidden.value.trim()) {
				aspect = hidden.value.trim();
			} else {
				const selected = this.querySelector(
					'[data-field-key="aspect_ratio"] .aspect-ratio-option[aria-checked="true"]'
				);
				const fromOption = selected?.getAttribute?.('data-value');
				if (typeof fromOption === 'string' && fromOption.trim()) {
					aspect = fromOption.trim();
				}
			}
		}
		if (!aspect) {
			try {
				aspect = getSharedAspectRatio() || '';
			} catch {
				aspect = '';
			}
		}
		if (aspect && typeof persistSharedAspectRatio === 'function') {
			persistSharedAspectRatio(aspect, { notify: false });
		}
	}

	applySharedAspectRatioToFieldValues() {
		const current = this.fieldValues.aspect_ratio;
		if (current !== undefined && current !== null && String(current).trim() !== '') return;

		const pendingSaved =
			this._pendingSavedFieldValues && typeof this._pendingSavedFieldValues === 'object'
				? this._pendingSavedFieldValues
				: null;
		if (pendingSaved && typeof pendingSaved.aspect_ratio === 'string' && pendingSaved.aspect_ratio.trim()) {
			this.fieldValues.aspect_ratio = pendingSaved.aspect_ratio.trim();
			return;
		}

		let aspect = '';
		try {
			aspect = getSharedAspectRatio() || '';
		} catch {
			aspect = '';
		}
		if (aspect) {
			this.fieldValues.aspect_ratio = aspect;
		}
	}

	applySharedPromptToFieldValues() {
		if (this._promptFromUrl) return;
		const fields = this.selectedMethod?.fields;
		if (!fields || typeof fields !== 'object') return;
		let prompt = '';
		try {
			prompt = getSharedAdvancedPrompt() || '';
		} catch {
			prompt = '';
		}
		if (!prompt.trim()) return;
		for (const [fieldKey, field] of Object.entries(fields)) {
			if (!isPromptLikeField(fieldKey, field)) continue;
			const current = this.fieldValues[fieldKey];
			if (current !== undefined && current !== null && String(current).trim() !== '') continue;
			this.fieldValues[fieldKey] = prompt;
		}
	}

	applySharedModelToFieldValues() {
		const fields = this.selectedMethod?.fields;
		if (!fields?.model) return;

		const current = this.fieldValues.model;
		if (current !== undefined && current !== null && String(current).trim() !== '') return;

		const pendingSaved =
			this._pendingSavedFieldValues && typeof this._pendingSavedFieldValues === 'object'
				? this._pendingSavedFieldValues
				: null;
		if (pendingSaved && typeof pendingSaved.model === 'string' && pendingSaved.model.trim()) {
			this.fieldValues.model = pendingSaved.model.trim();
			return;
		}

		let model = '';
		try {
			model =
				getSharedModelForContext(this.selectedServer?.id, this.getMethodKey()) || '';
		} catch {
			model = '';
		}
		if (model.trim()) {
			this.fieldValues.model = model.trim();
		}
	}

	_refreshAdvancedPromptGrow() {
		const promptInput = this.querySelector('[data-advanced-prompt]');
		if (!(promptInput instanceof HTMLTextAreaElement)) return;
		if (typeof this._advancedPromptAutogrow !== 'function') {
			if (typeof attachAutoGrowTextarea !== 'function') return;
			this._advancedPromptAutogrow = attachAutoGrowTextarea(promptInput);
		}
		if (typeof this._advancedPromptAutogrow === 'function') this._advancedPromptAutogrow();
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
   this.createProvider.workflow.edit({ advancedOptions: options,
    fieldValues: typeof options.prompt === 'string' ? { prompt: options.prompt } : {} }, { notify: !this._syncingSharedPrompt });
		} catch (e) {
			// Ignore storage errors
		}
	}

	syncSharedPromptToFields() {
		if (this._promptFromUrl || this._syncingSharedPrompt) return;
		let prompt = '';
		try {
			prompt = getSharedAdvancedPrompt() || '';
		} catch {
			prompt = '';
		}

		const fields = this.selectedMethod?.fields;
		const promptInput = this.querySelector('[data-advanced-prompt]');
		if (promptInput instanceof HTMLTextAreaElement && promptInput.value === prompt) {
			let inSync = true;
			if (fields && typeof fields === 'object') {
				for (const [fieldKey, field] of Object.entries(fields)) {
					if (!isPromptLikeField(fieldKey, field)) continue;
					let el = this.querySelector(`#field-${fieldKey}`);
					if (el?.classList?.contains('form-switch')) {
						el = el.querySelector('.form-switch-input');
					}
					if (el && el.type !== 'checkbox' && el.value !== prompt) {
						inSync = false;
						break;
					}
				}
			}
			if (inSync) return;
		}

		this._syncingSharedPrompt = true;
		try {
			if (promptInput instanceof HTMLTextAreaElement) {
				promptInput.value = prompt;
				this._refreshAdvancedPromptGrow();
				this.updateAdvancedCreateButton();
			}
			if (!fields || typeof fields !== 'object') return;
			for (const [fieldKey, field] of Object.entries(fields)) {
				if (!isPromptLikeField(fieldKey, field)) continue;
				this.fieldValues[fieldKey] = prompt;
				let el = this.querySelector(`#field-${fieldKey}`);
				if (el?.classList?.contains('form-switch')) {
					el = el.querySelector('.form-switch-input');
				}
				if (el && el.type !== 'checkbox' && el.value !== prompt) {
					el.value = prompt;
				}
			}
		} finally {
			this._syncingSharedPrompt = false;
		}
	}

	restoreAdvancedOptions() {
		try {
			const stored = JSON.stringify(this.createProvider.draft.read());
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
				const sharedPrompt = this._promptFromUrl ? '' : getSharedAdvancedPrompt();
				const value =
					this._promptFromUrl ??
					(sharedPrompt || (typeof options.prompt === 'string' ? options.prompt : ''));
				promptInput.value = typeof value === 'string' ? value : '';
				this._refreshAdvancedPromptGrow();
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
		if (input.tagName === "TEXTAREA" && typeof attachAutoGrowTextarea === 'function') {
			const refresh = attachAutoGrowTextarea(input);
			if (refresh) refresh();
		}
		this.updateButtonState();
		this.saveSelections();
	}

	async handleAdvancedCreate() {
  const selected = this.querySelector('[data-advanced-server-select]');
  const button = this.querySelector('[data-advanced-create-button]');
  const serverId = Number(selected?.value);
  if (!Number.isFinite(serverId) || serverId <= 0 || !this._lifetime.active) return;
  this.saveAdvancedOptions();
  const values = { ...this.createProvider.draft.read().advancedOptions };
  const fields = Object.fromEntries(Object.keys(values).map(key => [key, {}]));
  if (button) { button.disabled = true; button.textContent = 'Querying…'; }
  try {
   const result = await this.createProvider.workflow.submit({ mode: 'advanced', serverId, methodKey: 'advanced_generate', fields, values, quote: true, navigate: 'none' },
    { signal: this._lifetime.signal, confirm: question => this.requestWorkflowConfirmation(question) });
   if (this._lifetime.active) await afterCreateOverlaySubmit(result, this);
  } catch (error) { reportSubmissionError(error, this._lifetime.active); }
  finally { if (button && this._lifetime.active) { button.textContent = 'Query'; this.updateAdvancedCreateButton(); } }
 }

	handleConfirmPrimary() {
		const action = this._confirmPrimaryAction;
		if (typeof action === 'function') {
			try { action(); } catch { /* ignore */ }
			return;
		}
		this.closeAdvancedConfirm();
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
  this._workflowConfirmResolve?.(false);
  this._workflowConfirmResolve = null;
		const dialog = this.querySelector("[data-advanced-confirm-dialog]");
		if (dialog) {
			dialog.hidden = true;
			dialog.classList.remove('open');
		}
		this._advancedConfirm = null;
		this._confirmPrimaryAction = null;
	}

	requestWorkflowConfirmation(question) {
  if (question.kind === 'occupancy') return showOccupancyConfirm(question.occupancy, question.options);
  return new Promise(resolve => {
   this.closeAdvancedConfirm();
   this._workflowConfirmResolve = resolve;
   this.showAdvancedConfirm(question.message, true, { primaryLabel: question.primaryLabel || 'Continue',
    onPrimary: () => { this._workflowConfirmResolve = null; this.closeAdvancedConfirm(); resolve(true); } });
  });
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
			const res = await this._fetch('/api/create/preview', {
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
					this._lifetime.defer(() => { btn.textContent = prev; }, 1500);
				}
			}).catch(() => { });
		} catch (e) { }
	}


	handleServerChange(serverId, { persist = true } = {}) {
		if (!serverId) {
			this.selectedServer = null;
			this.selectedMethod = null;
			this.fieldValues = {};
			this._crossMethodImageCarryover = null;
			this.hideMethodGroup();
			this.hideFieldsGroup();
			this.updateButtonState();
			if (persist) this.saveSelections();
			return;
		}

		const server = this.servers.find(s => s.id === Number(serverId));
		if (!server) return;

		this._persistOutgoingPromptBeforeSwitch();
		this._persistOutgoingAspectRatioBeforeSwitch();
		this.selectedServer = server;
		this.selectedMethod = null;
		this.fieldValues = {};
		this._crossMethodImageCarryover = null;
		this.renderMethodOptions(false, { persist });
		this.hideFieldsGroup();
		this.updateButtonState();
		if (persist) {
			let serverConfig = server.server_config;
			if (typeof serverConfig === 'string') {
				try {
					serverConfig = JSON.parse(serverConfig);
				} catch {
					serverConfig = null;
				}
			}
			const methodKeys =
				serverConfig?.methods && typeof serverConfig.methods === 'object'
					? Object.keys(serverConfig.methods)
					: [];
			// Auto-selected method saves after fields render; avoid wiping model in session first.
			if (methodKeys.length === 0) {
				this.saveSelections();
			}
		}
	}

	renderMethodOptions(skipAutoSelect = false, { persist = true } = {}) {
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
				if (this._lifetime.active && this.selectedServer?.server_config?.methods === methods) this.handleMethodChange(methodKeyToSelect, { persist });
			});
		} else if (methodKeys.length === 0) {
			methodSelect.value = '';
		}
	}

	handleMethodChange(methodKey, { persist = true } = {}) {
		if (!methodKey) {
			this.selectedMethod = null;
			this.fieldValues = {};
			this._optionExtraFieldKeys = [];
			this._optionExtraModel = null;
			this._crossMethodImageCarryover = null;
			this.hideFieldsGroup();
			this.updateButtonState();
			if (persist) this.saveSelections();
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

		this._persistOutgoingPromptBeforeSwitch();
		this._persistOutgoingAspectRatioBeforeSwitch();

		this.selectedMethod = serverConfig.methods[methodKey];
		this.fieldValues = {};
		this._optionExtraFieldKeys = [];
		this._optionExtraModel = null;
		this.renderFields();
		this.updateButtonState();
		if (persist) this.saveSelections();
	}

	renderFields() {
		const fieldsGroup = this.querySelector("[data-fields-group]");
		const fieldsContainer = this.querySelector("[data-fields-container]");
		if (!fieldsGroup || !fieldsContainer) return;
 disposeProviderFormFields(fieldsGroup);

		if (!this.selectedMethod || !this.selectedMethod.fields) {
			fieldsGroup.style.display = 'none';
			this._crossMethodImageCarryover = null;
			return;
		}

  const fields = this.selectedMethod.fields;
  const savedValues = this.createProvider.workflow.project({ mode: 'advanced', fields });
  const liveFiles = Object.fromEntries(Object.entries(this.fieldValues).filter(([, value]) => value instanceof File || Array.isArray(value) && value.some(item => item instanceof File)));
  this.fieldValues = { ...savedValues, ...liveFiles };
  const extraFields = extraFieldsFromSelectOptions(fields, this.fieldValues);
  const schema = { ...fields, ...extraFields };
  const projected = this.createProvider.workflow.project({ mode: 'advanced', fields: schema });
  this.fieldValues = { ...projected, ...liveFiles };
  const fieldsForRender = Object.fromEntries(Object.entries(schema).map(([key, field]) => [key,
   Object.hasOwn(this.fieldValues, key) ? { ...field, default: this.fieldValues[key] } : field]));
  this.applyAspectRatioFieldVisibility(fieldsForRender, fields);

		this._crossMethodImageCarryover = null;

		if (Object.keys(fields).length === 0) {
			fieldsGroup.style.display = 'none';
			return;
		}

		this._renderingFields = true;
		try {
			renderProviderFormFields(fieldsContainer, fieldsForRender, {
				formContext: this.getFormFieldContext(),
				onFieldChange: (fieldKey, value) => {
					this.fieldValues[fieldKey] = value;
					if (!this._renderingFields && !this._syncingSharedPrompt && typeof persistSharedPrompt === 'function') {
						const field = this.selectedMethod?.fields?.[fieldKey];
						if (isPromptLikeField(fieldKey, field) && typeof value === 'string') {
							persistSharedPrompt(value, { notify: false });
						}
					}
					this.updateButtonState();
					if (!this._renderingFields) {
						const field = this.getRenderableMethodFields()[fieldKey];
      const imageChange = !this._restoringSelections && isImageUrlArrayField(field) && Array.isArray(value) && value.every(item => typeof item === 'string')
       ? { type: 'replace', images: value }
       : !this._restoringSelections && isImageUrlField(field) && typeof value === 'string'
        ? value.trim() ? { type: 'replaceFirst', image: value } : { type: 'removeFirst' }
        : undefined;
      this.saveSelections({ imageChange });
						if (value instanceof File || Array.isArray(value) && value.some(item => item instanceof File)) this.persistImageFieldSelection(fieldKey, value);
					}
					if (this._renderingFields) return;
					if (fieldKey === 'model') {
						this.renderFields();
						return;
					}
					applyShowWhenFields(fieldsContainer, this.fieldValues);
				}
			});

			const hiddenFieldsSlot = this.querySelector("[data-fields-hidden-slot]");
			if (hiddenFieldsSlot) {
				hiddenFieldsSlot.innerHTML = '';
				fieldsContainer.querySelectorAll(".field-hidden").forEach((node) => hiddenFieldsSlot.appendChild(node));
			}

			const hasHiddenFields = Object.entries(fieldsForRender).some(([key, f]) => {
				if (key === 'aspect_ratio') return false;
				return isAlwaysHiddenField(f);
			});
			const toggleWrap = this.querySelector("[data-fields-toggle]");
			const toggleLink = this.querySelector("[data-toggle-hidden-fields]");
			if (toggleWrap && toggleLink && hiddenFieldsSlot) {
				if (hasHiddenFields) {
					toggleWrap.style.display = '';
					this.showHiddenFields = false;
					hiddenFieldsSlot.classList.remove("show-hidden-fields");
					toggleLink.textContent = "Show hidden fields";
				} else {
					toggleWrap.style.display = 'none';
					hiddenFieldsSlot.innerHTML = '';
					hiddenFieldsSlot.classList.remove("show-hidden-fields");
				}
			}
		} finally {
			this._renderingFields = false;
		}

		fieldsGroup.style.display = 'flex';
		this.applyUrlPromptToBasicFields();
		if (typeof attachPromptInlineSuggest === 'function') {
			fieldsGroup.querySelectorAll(".prompt-editor").forEach((el) => attachPromptInlineSuggest(el));
		}
		this.syncAspectRatioFieldVisibility();
		this._aspectRatioWarning?.refresh();
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
  const query = this.creditsProvider.query;
  if (!query) return Promise.resolve();
  const paint = () => {
   if (!this.isConnected) return;
   this.creditsCount = this.normalizeCredits(query.getSnapshot().data?.balance || 0);
   this.updateButtonState();
  };
  if (!this._creditsSubscription) {
   this._creditsSubscription = query.subscribe(paint);
   this._lifetime.own(() => { this._creditsSubscription?.(); this._creditsSubscription = null; });
  }
  paint();
  return query.loadIfNeeded().then(paint).catch(() => {});
 }

	normalizeCredits(value) {
		const count = Number(value);
		if (!Number.isFinite(count)) return 0;
		return Math.max(0, Math.round(count * 10) / 10);
	}

	updateButtonState() {
		this._aspectRatioWarning?.refresh();
		const button = this.querySelector("[data-create-button]");
		const costElement = this.querySelector("[data-create-cost]");

		if (!button || !costElement) return;
  if (!['idle', 'error'].includes(this.createProvider.workflow.getSnapshot().phase)) { button.disabled = true; return; }

		// Check if server and method are selected
		if (!this.selectedServer || !this.selectedMethod) {
			button.disabled = true;
			costElement.textContent = 'Select a server and method to see cost';
			costElement.classList.remove('insufficient');
			return;
		}

		// Check if all required fields are filled
		const fields = this.getRenderableMethodFields();
		const formContext = this.getFormFieldContext();
		const requiredFields = Object.keys(fields).filter((key) => {
			if (key === 'aspect_ratio' && typeof shouldUseAspectRatioSelector === 'function' && !shouldUseAspectRatioSelector(formContext)) {
				return false;
			}
			if (!fieldMatchesShowWhen(fields[key], this.fieldValues)) return false;
			return fields[key].required;
		});
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
		this._lifetime.frame(() => {
			this._lifetime.frame(() => {
				this.handleCreateAfterSpinner(button);
			});
		});
	}

	async resolveAdvancedCreateUploadAspect(file, collectedArgs, formContext) {
		const selected =
			typeof collectedArgs.aspect_ratio === 'string' ? collectedArgs.aspect_ratio.trim() : '';
		const selectorOn =
			typeof shouldUseAspectRatioSelector === 'function' &&
			shouldUseAspectRatioSelector(formContext);
		if (selectorOn && selected) {
			return selected;
		}
		const dims =
			typeof readRasterFileDimensions === 'function'
				? await readRasterFileDimensions(file)
				: null;
		if (!dims) return selected || '1:1';
		const detected =
			typeof closestAspectRatioPreset === 'function'
				? closestAspectRatioPreset(dims.width, dims.height)
				: selected || '1:1';
		if (selectorOn) {
			collectedArgs.aspect_ratio = detected;
			this.fieldValues.aspect_ratio = detected;
		}
		return detected;
	}

	async readFirstAdvancedCreateImageDimensions(collectedArgs, fields) {
		for (const fieldKey of Object.keys(fields)) {
			const field = fields[fieldKey];
			const value = collectedArgs[fieldKey];
			if (typeof isImageUrlField === 'function' && isImageUrlField(field)) {
				if (value instanceof File && typeof readRasterFileDimensions === 'function') {
					const dims = await readRasterFileDimensions(value);
					if (dims) return dims;
				}
				if (typeof value === 'string' && value.trim() && typeof readImageUrlDimensions === 'function') {
					const dims = await readImageUrlDimensions(value.trim());
					if (dims) return dims;
				}
			}
			if (typeof isImageUrlArrayField === 'function' && isImageUrlArrayField(field) && Array.isArray(value)) {
				for (const item of value) {
					if (item instanceof File && typeof readRasterFileDimensions === 'function') {
						const dims = await readRasterFileDimensions(item);
						if (dims) return dims;
					}
					if (typeof item === 'string' && item.trim() && typeof readImageUrlDimensions === 'function') {
						const dims = await readImageUrlDimensions(item.trim());
						if (dims) return dims;
					}
				}
			}
		}
		return null;
	}

	async confirmAdvancedCreateAspectMismatch(collectedArgs, fields, formContext) {
		// Aspect ratio is applied when the job is submitted (server letterbox), not at paste/upload time.
		return true;
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
		const fields = this.getRenderableMethodFields();
		const collectedArgs = {};
		Object.keys(fields).forEach(fieldKey => {
			const field = fields[fieldKey];
			if (!fieldMatchesShowWhen(field, this.fieldValues)) return;
			let input = this.querySelector(`#field-${fieldKey}`);
			if (input?.classList?.contains('form-switch')) {
				input = input.querySelector('.form-switch-input');
			}
			const group = input?.closest?.('.form-group');
			if (group && group.style.display === 'none') return;
			if (input?.disabled) return;
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

		const clipIdInput = this.querySelector('#field-audio_clip_id');
		const clipIdRaw = clipIdInput?.value ?? this.fieldValues?.audio_clip_id ?? '';
		const clipId = Number(clipIdRaw);
		if (Number.isFinite(clipId) && clipId > 0) {
			collectedArgs.audio_clip_id = clipId;
		}

		const formContext = this.getFormFieldContext();
		if (typeof shouldUseAspectRatioSelector === 'function' && shouldUseAspectRatioSelector(formContext)) {
			const fromValues = this.fieldValues.aspect_ratio;
			const fromInput = this.querySelector('#field-aspect_ratio')?.value;
			const aspect =
				(typeof fromValues === 'string' ? fromValues : typeof fromInput === 'string' ? fromInput : '').trim();
			if (aspect) collectedArgs.aspect_ratio = aspect;
		} else {
			delete collectedArgs.aspect_ratio;
		}

		// Validate required data
		if (!this.selectedServer.id || !methodKey) {
			this.resetCreateButton(button);
			return;
		}

		if (!this._lifetime.active) return;
		if (!(await this.confirmAdvancedCreateAspectMismatch(collectedArgs, fields, formContext))) {
			this.resetCreateButton(button);
			return;
		}

		if (!this._lifetime.active) return;

  this.saveSelections();
  const submissionFields = Object.fromEntries(Object.entries(fields).filter(([key]) => Object.hasOwn(collectedArgs, key)));
  for (const key of Object.keys(collectedArgs)) if (!submissionFields[key]) submissionFields[key] = {};
  try {
   const result = await this.createProvider.workflow.submit({ mode: 'advanced', fields: submissionFields,
    values: collectedArgs, serverId: this.selectedServer.id, methodKey, navigate: 'none' },
    { signal: this._lifetime.signal, confirm: question => this.requestWorkflowConfirmation(question) });
   if (this._lifetime.active) await afterCreateOverlaySubmit(result, this);
  } catch (error) {
   if (this._lifetime.active) { this.resetCreateButton(button); reportSubmissionError(error); await this.loadCredits(); }
  }
 }

	resetCreateButton(button) {
		if (!button) return;
		button.disabled = false;
		button.style.minWidth = '';
		button.textContent = 'Create';
	}

	saveSelections({ imageChange } = {}) {
		if (this._restoringSelections || this._writingDraft) return;
  this._writingDraft = true;
		try {
			// Files cannot round-trip through JSON.stringify (they become `{}`); restoring that
			// object into <input>.value yields "[object Object]" and breaks provider image_url.
			const fieldValuesForStorage = { ...this.fieldValues };
			for (const k of Object.keys(fieldValuesForStorage)) {
				if (fieldValuesForStorage[k] instanceof File) {
					delete fieldValuesForStorage[k];
					continue;
				}
				if (Array.isArray(fieldValuesForStorage[k])) {
					const onlyStrings = fieldValuesForStorage[k]
						.filter((v) => typeof v === 'string' && v.trim())
						.map((v) => v.trim());
					fieldValuesForStorage[k] = onlyStrings;
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
			this.createProvider.workflow.edit({
				...selections, mode: 'advanced', imageChange,
				imageFieldKeys: Object.entries(this.getRenderableMethodFields()).filter(([, field]) => isImageUrlField(field) || isImageUrlArrayField(field)).map(([key]) => key),
				outputMode: /video/i.test(this.getMethodKey() || '') ? 'video' : /audio|speech|music/i.test(this.getMethodKey() || '') ? 'audio' : 'image',
			}, { notify: !this._syncingSharedPrompt });
		} catch (e) {
			// Ignore storage errors
		} finally { this._writingDraft = false; }
	}

	getMethodKey() {
		if (!this.selectedServer || !this.selectedMethod) return null;
		const methods = this.selectedServer.server_config?.methods || {};
		return Object.keys(methods).find(key => methods[key] === this.selectedMethod) || null;
	}

	/** Model value for capability checks — fieldValues, live select, config default, or first option. */
	resolveEffectiveModelValue() {
		const modelField = this.selectedMethod?.fields?.model;
		if (!modelField || typeof modelField !== 'object') return '';

		const fromFieldValues = this.fieldValues.model;
		if (fromFieldValues !== undefined && fromFieldValues !== null && String(fromFieldValues).trim()) {
			return String(fromFieldValues).trim();
		}

		const pendingSaved =
			this._pendingSavedFieldValues && typeof this._pendingSavedFieldValues === 'object'
				? this._pendingSavedFieldValues
				: null;
		const fromPending = pendingSaved?.model;
		if (fromPending !== undefined && fromPending !== null && String(fromPending).trim()) {
			return String(fromPending).trim();
		}

		const domEl = this.querySelector('#field-model');
		if (domEl && typeof domEl.value === 'string' && domEl.value.trim()) {
			return domEl.value.trim();
		}

		const explicitDefault = modelField.default;
		if (explicitDefault !== undefined && explicitDefault !== null && String(explicitDefault).trim()) {
			return String(explicitDefault).trim();
		}

		const options = modelField.options;
		if (Array.isArray(options) && options.length > 0) {
			const first = options[0];
			if (typeof first === 'string' && first.trim()) return first.trim();
			if (first && typeof first === 'object') {
				const value = first.value ?? first.id ?? first.label ?? '';
				if (String(value).trim()) return String(value).trim();
			}
		}

		return '';
	}

	getRenderableMethodFields() {
		const fields = this.selectedMethod?.fields;
		if (!fields || typeof fields !== 'object') return {};
		return resolveRenderableFields(fields, {
			...this.fieldValues,
			model: this.resolveEffectiveModelValue(),
		});
	}

	pruneStaleOptionFieldValues() {
		const fields = this.selectedMethod?.fields;
		if (!fields || typeof fields !== 'object') return;
		const model = this.resolveEffectiveModelValue();
		const extra = extraFieldsFromSelectOptions(fields, {
			...this.fieldValues,
			model,
		});
		const nextKeys = new Set(Object.keys(extra));
		const prevKeys = Array.isArray(this._optionExtraFieldKeys) ? this._optionExtraFieldKeys : [];
		const modelChanged = this._optionExtraModel != null && this._optionExtraModel !== model;
		for (const key of prevKeys) {
			if (modelChanged || !nextKeys.has(key)) delete this.fieldValues[key];
		}
		this._optionExtraFieldKeys = [...nextKeys];
		this._optionExtraModel = model;
	}

	getFormFieldContext() {
		return {
			serverId: this.selectedServer?.id,
			methodKey: this.getMethodKey(),
			intent: this.selectedMethod?.intent,
			modelValue: this.resolveEffectiveModelValue(),
			fields: this.getRenderableMethodFields(),
		};
	}

	/** Re-render when server/method/model implies aspect_ratio but the field is missing (or vice versa). */
	syncAspectRatioFieldVisibility() {
		if (this._syncingAspectRatioField) return;
		if (typeof shouldUseAspectRatioSelector !== 'function') return;
		const shouldShow = shouldUseAspectRatioSelector(this.getFormFieldContext());
		const hasAspectRatioField = !!this.querySelector('[data-field-key="aspect_ratio"]');
		if (shouldShow === hasAspectRatioField) return;
		this._syncingAspectRatioField = true;
		try {
			this.renderFields();
		} finally {
			this._syncingAspectRatioField = false;
		}
	}

	applyAspectRatioFieldVisibility(fieldsForRender, allFields) {
		const formContext = this.getFormFieldContext();
		const showAspectRatio =
			typeof shouldUseAspectRatioSelector === 'function' && shouldUseAspectRatioSelector(formContext);

		let aspectField = fieldsForRender.aspect_ratio ?? allFields?.aspect_ratio;
		if ((!aspectField || typeof aspectField !== 'object') && showAspectRatio && typeof getVirtualAspectRatioField === 'function') {
			aspectField = getVirtualAspectRatioField();
		}
		if (!aspectField || typeof aspectField !== 'object') return;

		if (showAspectRatio) {
			const pendingSaved =
				this._pendingSavedFieldValues && typeof this._pendingSavedFieldValues === 'object'
					? this._pendingSavedFieldValues
					: null;
			let sharedAspect = '';
			try {
				sharedAspect = getSharedAspectRatio() || '';
			} catch {
				sharedAspect = '';
			}
			const saved =
				(typeof this.fieldValues.aspect_ratio === 'string' && this.fieldValues.aspect_ratio.trim()) ||
				(typeof pendingSaved?.aspect_ratio === 'string' && pendingSaved.aspect_ratio.trim()) ||
				sharedAspect ||
				'';
			const fieldWithDefault = saved
				? { ...aspectField, hidden: false, default: saved }
				: { ...aspectField, hidden: false };
			fieldsForRender.aspect_ratio = fieldWithDefault;
			if (saved) this.fieldValues.aspect_ratio = saved;
			return;
		}

		delete fieldsForRender.aspect_ratio;
		// Selector hidden for this server/method/model — keep stored preference for when it returns.
		if (typeof this.fieldValues.aspect_ratio === 'string' && this.fieldValues.aspect_ratio.trim()) {
			return;
		}
		try {
			const sharedAspect = getSharedAspectRatio();
			if (sharedAspect) {
				this.fieldValues.aspect_ratio = sharedAspect;
			}
		} catch {
			// ignore storage errors
		}
	}

	restoreSelections() {
		// Only restore if servers are loaded
		if (!this.servers || this.servers.length === 0) return false;

		try {
			const selections = this.createProvider.draft.read();
			if (!selections || !selections.serverId) return false;
			this._pendingSavedFieldValues =
				selections.fieldValues && typeof selections.fieldValues === 'object'
					? selections.fieldValues
					: null;

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

			// Restore synchronously: field callbacks must not persist partial values or
			// clear the image queue while the handoff is being applied.
			const methodSelect = this.querySelector("[data-method-select]");
			const methodExists = methodSelect && Array.from(methodSelect.options).some(
				option => option.value === selections.methodKey
			);
			if (!methodExists) return false;
			this._restoringSelections = true;
			try {
				methodSelect.value = selections.methodKey;
				this.handleMethodChange(selections.methodKey, { persist: false });
				this.restoreFieldValues(selections.fieldValues || {});
				// Image values are stored separately from their thumbnail DOM.
				this.renderFields();
				this.updateButtonState();
			} finally {
				this._restoringSelections = false;
				this._pendingSavedFieldValues = null;
			}
			this.saveSelections();

			return true;
		} catch (e) {
			// Ignore storage errors
			return false;
		}
	}

	setupBlogTab() {
		const newBtn = this.querySelector("[data-blog-new]");
		const refreshBtn = this.querySelector("[data-blog-refresh]");
		this._lifetime.listen(newBtn, "click", () => this.onBlogNewDraft());
		this._lifetime.listen(refreshBtn, "click", () => this.loadBlogPosts());
		const tabsEl = this.querySelector("app-tabs");
		this._lifetime.listen(tabsEl, "tab-change", (e) => {
			if (e.detail?.id === "blog") this.loadBlogPosts();
		});
		const blogOverlay = this.querySelector("[data-blog-campaign-overlay]");
		const blogCloseX = this.querySelector("[data-blog-campaign-close-x]");
		if (blogOverlay) this._lifetime.listen(blogOverlay, "click", () => this.closeBlogCampaignModal());
		if (blogCloseX) this._lifetime.listen(blogCloseX, "click", () => this.closeBlogCampaignModal());
		const campaignBody = this.querySelector("[data-blog-campaign-body]");
		if (campaignBody) {
			this._lifetime.listen(campaignBody, "change", (e) => {
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
			this._lifetime.listen(campaignBody, "click", (e) => {
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
			this._lifetime.listen(campaignBody, "input", (e) => {
				const t = e.target;
				if (t?.matches?.("[data-blog-campaign-custom-input]")) {
					clearTimeout(this._blogCampaignCustomDebounce);
					this._blogCampaignCustomDebounce = this._lifetime.defer(() => this.fetchTrackedUrlForBlogCampaign(), 320);
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
			const r = await this._fetch("/api/blog/campaigns", { credentials: "include" });
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
			const res = await this._fetch(
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
				this._lifetime.defer(() => {
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
				this._lifetime.defer(() => {
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
				this._lifetime.defer(() => {
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
				this._lifetime.defer(() => {
					btn.textContent = prev;
				}, 1500);
			}
		}).catch(() => {});
	}

	async patchBlogCampaignActive(campaignId, active) {
		if (!this._blogUserIsAdmin || !campaignId) return;
		try {
			const res = await this._fetch(`/api/blog/campaigns/${encodeURIComponent(campaignId)}`, {
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
			const r = await this._fetch("/api/blog/campaigns", { credentials: "include" });
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
			const res = await this._fetch("/api/blog/campaigns", {
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
			const r = await this._fetch("/api/blog/campaigns", { credentials: "include" });
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
		const res = await this._fetch("/api/blog/posts", {
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
			void openBlogEditorFromCreate(id);
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
			const res = await this._fetch(`/api/blog/posts/${encodeURIComponent(postId)}`, {
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
			this._lifetime.listen(btn, "click", () => {
				const id = btn.getAttribute("data-blog-edit");
				if (id) void openBlogEditorFromCreate(id);
			});
		});
		container.querySelectorAll("[data-blog-delete]").forEach((btn) => {
			this._lifetime.listen(btn, "click", () => {
				const rowId = btn.getAttribute("data-blog-delete");
				if (rowId) this.onBlogDeletePost(rowId);
			});
		});
		container.querySelectorAll("[data-blog-campaign-open]").forEach((btn) => {
			this._lifetime.listen(btn, "click", () => {
				const id = btn.getAttribute("data-blog-post-id");
				const slug = btn.getAttribute("data-blog-post-slug") || "";
				const title = btn.getAttribute("data-blog-post-title") || "";
				if (id) this.openBlogCampaignModal({ id, slug, title });
			});
		});
	}

	restoreFieldValues() {
  this.fieldValues = this.createProvider.workflow.project({ mode: 'advanced', fields: this.getRenderableMethodFields() });
  this.renderFields();
  this.syncAspectRatioFieldVisibility();
  this.applyUrlPromptToBasicFields();
 }

	async persistImageFieldSelection(fieldKey, value, { required = false } = {}) {
  const field = this.getRenderableMethodFields()[fieldKey];
  if (!isImageUrlField(field) && !isImageUrlArrayField(field)) return;
  const token = {};
  this._imageFieldPersistTokens[fieldKey] = token;
  try {
   const saved = await this.createProvider.workflow.selectImages(value, { first: isImageUrlField(field), signal: this._lifetime.signal });
   if (!saved || !this._lifetime.active || this._imageFieldPersistTokens[fieldKey] !== token) return;
   this.fieldValues[fieldKey] = isImageUrlArrayField(field) ? [...saved.inputImages] : saved.inputImages[0] || '';
  } catch (error) { if (required) throw error; reportSubmissionError(error, this._lifetime.active); }
 }

	async persistImageForBasicMode() {
  await this.createProvider.workflow.flushImages();
  if (!this._lifetime.active) return;
  const fields = this.getRenderableMethodFields();
  for (const [key, field] of Object.entries(fields)) {
   const value = this.fieldValues[key];
   if (value instanceof File || Array.isArray(value) && value.some(item => item instanceof File)) {
    await this.persistImageFieldSelection(key, value, { required: true });
   }
  }
  if (!this._lifetime.active) return;
  this.saveSelections();
  const imageUrl = this.createProvider.draft.read().inputImages[0];
  if (!imageUrl) return;
  try { localStorage.setItem(BASIC_IMAGE_EDIT_CARRYOVER_KEY, imageUrl); localStorage.setItem('create_page_tab', 'image-edit'); } catch {}
 }

}

customElements.define("app-route-create", AppRouteCreate);
