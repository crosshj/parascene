let submitCreationWithPending;
let formatMentionsFailureForDialog;
let mutatePromptSaveTimerId = null;
let fetchJsonWithStatusDeduped;
let attachAutoGrowTextarea;
let refreshAutoGrowTextareas;
let attachMentionSuggest;
let addPageUsers;
let clearPageUsers;
let DEFAULT_APP_ORIGIN;
let loadMutateServerOptions;
let MUTATE_DEFAULT_SERVER_ID;
let MUTATE_DEFAULT_METHOD_KEY;
let MUTATE_DEFAULT_MODEL;
let MUTATE_VIDEO_DEFAULT_METHOD_KEY;
let MUTATE_VIDEO_DEFAULT_MODEL;
let MUTATE_VIDEO_LTX_SERVER_ID;
let MUTATE_VIDEO_LTX_METHOD_KEY;
let MUTATE_VIDEO_LTX_MODEL;
let renderEmptyState;
let renderEmptyError;
let addToMutateQueue;
let replaceMutateQueueSingleItem;
let loadMutateQueue;
let removeFromMutateQueueByImageUrl;
let syncMutatePageToAdvancedCreate;
let applyHeroAspectLayoutToElement;
let aspectRatioFromCreation;
let closestAspectRatioPreset;
let parseAspectRatioString;
let attachPromptFieldClear;

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
		const createSubmitMod = await import(`/shared/createSubmit.js${qs}`);
		submitCreationWithPending = createSubmitMod.submitCreationWithPending;
		formatMentionsFailureForDialog = createSubmitMod.formatMentionsFailureForDialog;

		const apiMod = await import(`/shared/api.js${qs}`);
		fetchJsonWithStatusDeduped = apiMod.fetchJsonWithStatusDeduped;

		const autogrowMod = await import(`/shared/autogrow.js${qs}`);
		attachAutoGrowTextarea = autogrowMod.attachAutoGrowTextarea;
		refreshAutoGrowTextareas = autogrowMod.refreshAutoGrowTextareas;

		const suggestMod = await import(`/shared/triggeredSuggest.js${qs}`);
		attachMentionSuggest = suggestMod.attachMentionSuggest;
		addPageUsers = suggestMod.addPageUsers;
		clearPageUsers = suggestMod.clearPageUsers;

		const userTextMod = await import(`/shared/userText.js${qs}`);
		DEFAULT_APP_ORIGIN = userTextMod.DEFAULT_APP_ORIGIN;

		const mutateOptionsMod = await import(`/shared/mutateOptions.js${qs}`);
		loadMutateServerOptions = mutateOptionsMod.loadMutateServerOptions;

		const generationDefaultsMod = await import(`/shared/generationDefaults.js${qs}`);
		MUTATE_DEFAULT_SERVER_ID = generationDefaultsMod.MUTATE_DEFAULT_SERVER_ID;
		MUTATE_DEFAULT_METHOD_KEY = generationDefaultsMod.MUTATE_DEFAULT_METHOD_KEY;
		MUTATE_DEFAULT_MODEL = generationDefaultsMod.MUTATE_DEFAULT_MODEL;
		MUTATE_VIDEO_DEFAULT_METHOD_KEY = generationDefaultsMod.MUTATE_VIDEO_DEFAULT_METHOD_KEY;
		MUTATE_VIDEO_DEFAULT_MODEL = generationDefaultsMod.MUTATE_VIDEO_DEFAULT_MODEL;
		MUTATE_VIDEO_LTX_SERVER_ID = generationDefaultsMod.MUTATE_VIDEO_LTX_SERVER_ID;
		MUTATE_VIDEO_LTX_METHOD_KEY = generationDefaultsMod.MUTATE_VIDEO_LTX_METHOD_KEY;
		MUTATE_VIDEO_LTX_MODEL = generationDefaultsMod.MUTATE_VIDEO_LTX_MODEL;
		const emptyStateMod = await import(`/shared/emptyState.js${qs}`);
		renderEmptyState = emptyStateMod.renderEmptyState;
		renderEmptyError = emptyStateMod.renderEmptyError;

		const mutateQueueMod = await import(`/shared/mutateQueue.js${qs}`);
		addToMutateQueue = mutateQueueMod.addToMutateQueue;
		replaceMutateQueueSingleItem = mutateQueueMod.replaceMutateQueueSingleItem;
		loadMutateQueue = mutateQueueMod.loadMutateQueue;
		removeFromMutateQueueByImageUrl = mutateQueueMod.removeFromMutateQueueByImageUrl;

		const mutateQueueSyncMod = await import(`/shared/mutateQueueSync.js${qs}`);
		syncMutatePageToAdvancedCreate = mutateQueueSyncMod.syncMutatePageToAdvancedCreate;

		const aspectRatioMod = await import(`/shared/aspectRatio.js${qs}`);
		applyHeroAspectLayoutToElement = aspectRatioMod.applyHeroAspectLayoutToElement;
		aspectRatioFromCreation = aspectRatioMod.aspectRatioFromCreation;
		closestAspectRatioPreset = aspectRatioMod.closestAspectRatioPreset;
		parseAspectRatioString = aspectRatioMod.parseAspectRatioString;

		const promptFieldClearMod = await import(`/shared/promptFieldClear.js${qs}`);
		attachPromptFieldClear = promptFieldClearMod.attachPromptFieldClear;

		await import(`/components/elements/tabs.js${qs}`);
	})();
	return _depsPromise;
}

const html = String.raw;
const MUTATE_MODE_STORAGE_KEY = 'mutate_page_mode';
const MUTATE_I2V_ENGINE_STORAGE_KEY = 'mutate_i2v_engine';

function toParasceneImageUrl(raw) {
	const base = (typeof window !== 'undefined' && window.location?.origin) || DEFAULT_APP_ORIGIN;
	if (typeof raw !== 'string') return '';
	const value = raw.trim();
	if (!value) return '';
	try {
		const parsed = new URL(value, base);
		// Only normalize http(s) URLs.
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
		return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return '';
	}
}

/** Same keys as `entry-create.js` / Image Edit tab — keeps draft in sync with /create. */
function persistMutateImageEditDraftToStorage(prompt) {
	const text = typeof prompt === 'string' ? prompt : '';
	try {
		localStorage.setItem('create_page_prompt', text);
		localStorage.setItem('create_page_prompt_image_edit', text);
		localStorage.setItem('create_page_prompt_text', text);
	} catch (_) { }
	try {
		const sk = 'create-page-selections';
		const stored = sessionStorage.getItem(sk);
		const selections = stored ? JSON.parse(stored) : {};
		const fv = selections.fieldValues && typeof selections.fieldValues === 'object' ? selections.fieldValues : {};
		const adv = selections.advancedOptions && typeof selections.advancedOptions === 'object' ? selections.advancedOptions : {};
		selections.fieldValues = { ...fv, prompt: text };
		selections.advancedOptions = { ...adv, prompt: text };
		sessionStorage.setItem(sk, JSON.stringify(selections));
	} catch (_) { }
}

function cancelMutatePromptDraftPersist() {
	if (mutatePromptSaveTimerId != null) {
		clearTimeout(mutatePromptSaveTimerId);
		mutatePromptSaveTimerId = null;
	}
}

/** After mutate submit: queue source for lineage; prompt cleared on success in createSubmit. */
function prepareCreationsPageAfterMutateSubmit({ mutateOfId, normalizedImageUrl, published }) {
	cancelMutatePromptDraftPersist();
	try {
		replaceMutateQueueSingleItem({
			sourceId: mutateOfId,
			imageUrl: normalizedImageUrl,
			published,
		});
	} catch (_) { }
}

function getCreationId() {
	const pathname = window.location.pathname;
	const match = pathname.match(/^\/creations\/(\d+)\/(edit|mutate)$/);
	return match ? parseInt(match[1], 10) : null;
}

function loadSavedMutateMode() {
	try {
		const saved = localStorage.getItem(MUTATE_MODE_STORAGE_KEY);
		if (saved === 'image-to-video' || saved === 'image-to-video-ltx') return 'image-to-video';
		return 'image-to-image';
	} catch {
		return 'image-to-image';
	}
}

function persistMutateMode(mode) {
	try {
		localStorage.setItem(MUTATE_MODE_STORAGE_KEY, mode === 'image-to-video' ? 'image-to-video' : 'image-to-image');
	} catch {
		// ignore storage errors
	}
}

function mutateModeFromTabOrDataset(idOrMode) {
	const v = typeof idOrMode === 'string' ? idOrMode.trim() : '';
	return v === 'image-to-video' ? 'image-to-video' : 'image-to-image';
}

/** Full-resolution preview URL (detail hero uses creation.url, not thumbnail variant). */
function getMutatePreviewImageUrl(raw) {
	if (typeof raw !== 'string' || !raw.trim()) return '';
	try {
		const parsed = new URL(raw.trim(), window.location.origin);
		parsed.searchParams.delete('variant');
		return parsed.toString();
	} catch {
		const value = raw.trim();
		return value.replace(/([?&])variant=[^&]+(&?)/g, (_, lead, tail) => (tail ? lead : '')).replace(/\?&/, '?').replace(/[?&]$/, '');
	}
}

function normalizeCreationMetaForAspect(raw) {
	if (raw == null) return null;
	if (typeof raw === 'object') return raw;
	if (typeof raw === 'string') {
		try {
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === 'object' ? parsed : null;
		} catch {
			return null;
		}
	}
	return null;
}

/** Match creation-detail hero layout; prefer real pixel dimensions when metadata is missing or square. */
function applyMutateSourceAspectLayout(wrap, creation, img) {
	if (!(wrap instanceof HTMLElement)) return;
	const meta = normalizeCreationMetaForAspect(creation?.meta);
	const payload = {
		width: creation?.width,
		height: creation?.height,
		meta,
		media_type: creation?.media_type,
		video_url: creation?.video_url,
	};

	if (typeof applyHeroAspectLayoutToElement === 'function') {
		applyHeroAspectLayoutToElement(wrap, payload);
	}

	let w = Number(creation?.width);
	let h = Number(creation?.height);
	if (img instanceof HTMLImageElement && img.naturalWidth > 0 && img.naturalHeight > 0) {
		w = img.naturalWidth;
		h = img.naturalHeight;
	}
	if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) && typeof aspectRatioFromCreation === 'function') {
		const ratio = aspectRatioFromCreation(payload);
		w = ratio.w;
		h = ratio.h;
	}
	if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) || w === h) return;

	const mode = w > h ? 'landscape' : 'portrait';
	wrap.classList.remove('hero-layout-legacy', 'hero-layout-landscape', 'hero-layout-portrait', 'hero-portrait-by-width');
	wrap.style.setProperty('--hero-aspect-w', String(w));
	wrap.style.setProperty('--hero-aspect-h', String(h));
	wrap.style.setProperty('--hero-aspect-ratio', `${w} / ${h}`);
	wrap.classList.add(`hero-layout-${mode}`);
	if (mode === 'portrait') wrap.classList.add('hero-portrait-by-width');
}

function normalizeCreationMetaLocal(meta) {
	if (meta && typeof meta === 'object') return meta;
	if (typeof meta === 'string') {
		try {
			return JSON.parse(meta);
		} catch {
			return null;
		}
	}
	return null;
}

/** Closest MVP preset for mutate i2v (prefer job args, then pixels from row or loaded preview). */
function resolveMutateSourceAspectRatio(creation, img) {
	const meta = normalizeCreationMetaLocal(creation?.meta);
	const fromArgRaw = meta?.args?.aspect_ratio;
	if (typeof parseAspectRatioString === 'function' && parseAspectRatioString(fromArgRaw)) {
		return String(fromArgRaw).trim();
	}

	let w = Number(creation?.width);
	let h = Number(creation?.height);
	if (img instanceof HTMLImageElement && img.naturalWidth > 0 && img.naturalHeight > 0) {
		w = img.naturalWidth;
		h = img.naturalHeight;
	}
	if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) && typeof aspectRatioFromCreation === 'function') {
		const ratio = aspectRatioFromCreation(creation);
		w = ratio.w;
		h = ratio.h;
	}
	if (typeof closestAspectRatioPreset === 'function') {
		return closestAspectRatioPreset(w, h);
	}
	return '1:1';
}

function persistMutateAspectRatioDataset(editContent, creation, img) {
	if (!(editContent instanceof HTMLElement)) return;
	const aspectRatio = resolveMutateSourceAspectRatio(creation, img);
	if (aspectRatio) editContent.dataset.mutateAspectRatio = aspectRatio;
}

async function loadEditPage() {
	await loadDeps();
	const editContent = document.querySelector('[data-edit-content]');
	if (!editContent) return;

	const creationId = getCreationId();
	clearPageUsers();
	if (!creationId) {
		editContent.innerHTML = renderEmptyState({ title: 'Invalid creation ID' });
		return;
	}

	try {
		const searchParams = new URLSearchParams(window.location.search);
		const sourceIdRaw = searchParams.get('source_id');
		const groupOfRaw = searchParams.get('group_of');
		const sourceIdParam =
			sourceIdRaw != null && String(sourceIdRaw).trim() !== '' ? String(sourceIdRaw).trim() : '';
		const groupOfLegacy =
			groupOfRaw != null && String(groupOfRaw).trim() !== '' ? String(groupOfRaw).trim() : '';

		// Group-first: /creations/{groupId}/mutate?source_id={sourceId}
		// Legacy: /creations/{sourceId}/mutate?group_of={groupId}
		let mutateSourceId = creationId;
		let mutateGroupId = null;
		let creationDetailHref = `/creations/${creationId}`;
		let imageApiUrl = `/api/create/images/${creationId}`;

		if (sourceIdParam) {
			mutateSourceId = parseInt(sourceIdParam, 10);
			mutateGroupId = creationId;
			creationDetailHref = `/creations/${creationId}`;
			imageApiUrl = `/api/create/images/${creationId}/mutate-source?source_id=${encodeURIComponent(sourceIdParam)}`;
		} else if (groupOfLegacy) {
			const legacyGroupId = parseInt(groupOfLegacy, 10);
			if (Number.isFinite(legacyGroupId) && legacyGroupId > 0) {
				mutateSourceId = creationId;
				mutateGroupId = legacyGroupId;
				creationDetailHref = `/creations/${legacyGroupId}`;
				imageApiUrl = `/api/create/images/${legacyGroupId}/mutate-source?source_id=${encodeURIComponent(String(creationId))}`;
			}
		}

		const response = await fetch(imageApiUrl, { credentials: 'include' });
		if (!response.ok) {
			editContent.innerHTML = renderEmptyState({
				title: 'Unable to load creation',
				message: "The creation you're trying to edit doesn't exist or you don't have access.",
			});
			return;
		}

		const creation = await response.json();
		if (mutateGroupId == null && creation?.group_id != null) {
			const gid = Number(creation.group_id);
			if (Number.isFinite(gid) && gid > 0) mutateGroupId = gid;
		}
		if (creation?.creator?.id != null || creation?.user_id != null) {
			addPageUsers([{
				user_id: creation.creator?.id ?? creation.user_id,
				user_name: creation.creator?.user_name,
				display_name: creation.creator?.display_name,
				avatar_url: creation.creator?.avatar_url
			}]);
		}
		const status = creation.status || 'completed';
		const canEdit = status === 'completed' && Boolean(creation.url);
		const title = typeof creation.title === 'string' && creation.title.trim() ? creation.title.trim() : 'Untitled';
		const sourceImageUrl = canEdit ? String(creation.url) : '';
		const previewImageUrl = canEdit ? getMutatePreviewImageUrl(sourceImageUrl) : '';

		function escapeHtml(value) {
			return String(value ?? '')
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		}

		if (!canEdit) {
			editContent.innerHTML = renderEmptyState({
				title: 'This creation is not ready to mutate',
				message: 'Wait for it to finish rendering, then try again.',
			});
			return;
		}

		// While we build the form, keep the existing route loader visible.
		// Preload the thumbnail in the background so it can pop in quickly once rendered.
		const thumbPreload = new Promise((resolve) => {
			if (!previewImageUrl) return resolve({ ok: false });
			const img = new Image();
			img.onload = () => resolve({ ok: true });
			img.onerror = () => resolve({ ok: false });
			img.decoding = 'async';
			img.src = previewImageUrl;
		});

		const servers = await loadMutateServerOptions();
		const server = servers.find((s) => Number(s.id) === Number(MUTATE_DEFAULT_SERVER_ID));
		const ltxServer = servers.find((s) => Number(s.id) === Number(MUTATE_VIDEO_LTX_SERVER_ID));
		if (!server && !ltxServer) {
			editContent.innerHTML = renderEmptyState({
				title: 'Mutate unavailable',
				message: 'You do not have access to the default mutate server.',
			});
			return;
		}
		const methods = server?.server_config && typeof server.server_config === 'object' ? server.server_config.methods : null;
		const ltxMethods = ltxServer?.server_config && typeof ltxServer.server_config === 'object' ? ltxServer.server_config.methods : null;
		if ((!methods || typeof methods !== 'object') && (!ltxMethods || typeof ltxMethods !== 'object')) {
			editContent.innerHTML = renderEmptyState({
				title: 'Mutate unavailable',
				message: 'No mutate methods are available on this server.',
			});
			return;
		}
		const imageMethodDef = methods?.[MUTATE_DEFAULT_METHOD_KEY];
		const videoMethodDef = methods?.[MUTATE_VIDEO_DEFAULT_METHOD_KEY];
		const ltxVideoMethodDef = ltxMethods?.[MUTATE_VIDEO_LTX_METHOD_KEY];

		function getMethodCost(methodDef) {
			if (!methodDef || typeof methodDef !== 'object') return null;
			if (typeof methodDef.credits === 'number' && Number.isFinite(methodDef.credits)) {
				return methodDef.credits;
			}
			if (methodDef.credits != null && methodDef.credits !== '') {
				const p = parseFloat(methodDef.credits);
				if (Number.isFinite(p)) return p;
			}
			return null;
		}

		const imageCost = getMethodCost(imageMethodDef);
		const videoCost = getMethodCost(videoMethodDef);
		const ltxCost = getMethodCost(ltxVideoMethodDef);
		const hasImageMode = Boolean(imageMethodDef) && Number.isFinite(imageCost) && imageCost >= 0;
		const hasVideoMode = Boolean(videoMethodDef) && Number.isFinite(videoCost) && videoCost >= 0;
		const hasLtxVideoMode = Boolean(ltxVideoMethodDef) && Number.isFinite(ltxCost) && ltxCost >= 0;
		const hasI2vTab = hasVideoMode || hasLtxVideoMode;
		if (!hasImageMode && !hasI2vTab) {
			editContent.innerHTML = renderEmptyState({
				title: 'Mutate unavailable',
				message: 'No valid mutate modes are configured for this server.',
			});
			return;
		}

		let activeMode = loadSavedMutateMode();
		if (!hasImageMode && hasI2vTab) activeMode = 'image-to-video';
		if (activeMode === 'image-to-video' && !hasI2vTab) activeMode = 'image-to-image';
		if (activeMode === 'image-to-image' && !hasImageMode && hasI2vTab) activeMode = 'image-to-video';

		editContent.innerHTML = html`
			<div class="create-content creation-edit-create-content">
				<app-tabs active="${activeMode}">
					${hasImageMode ? html`
					<tab label="Image Edit" data-id="image-to-image" ${activeMode==='image-to-image' ? 'default' : '' }>
						<h1 class="create-title">What do you want to change?</h1>
						<div class="creation-edit-source-wrap">
							<div class="creation-detail-image-wrapper creation-edit-source-box image-loading" data-source-thumb-wrap
								title="View creation" aria-label="Source image">
								<img class="creation-detail-image image-thumb" data-source-thumb data-image alt="Source image" />
							</div>
							<a href="${creationDetailHref}" class="creation-edit-source-link" data-source-link>change image</a>
						</div>
						<div class="create-prompt-wrap is-empty" data-prompt-wrap>
							<textarea class="create-prompt-input prompt-editor" data-edit-prompt data-mode="image-to-image" rows="3"
								placeholder="Describe your changes..."></textarea>
							<a href="#" class="create-prompt-clear" tabindex="-1" aria-label="Clear field">clear</a>
						</div>
						<div class="create-controls">
							<div class="create-controls-buttons">
								<button class="create-btn-generate btn-primary" data-generate-btn
									data-generate-mode="image-to-image" disabled>Mutate</button>
							</div>
							<p class="create-cost" data-mutate-cost data-mode-cost="image-to-image">Loading credits…</p>
						</div>
					</tab>
					` : ''}
					${hasI2vTab ? html`
					<tab label="Image To Video" data-id="image-to-video" ${activeMode==='image-to-video' ? 'default' : '' }>
						<h1 class="create-title">What happens next?</h1>
						<div class="creation-edit-source-wrap">
							<div class="creation-detail-image-wrapper creation-edit-source-box image-loading" data-source-thumb-wrap
								title="View creation" aria-label="Source image">
								<img class="creation-detail-image image-thumb" data-source-thumb data-image alt="Source image" />
							</div>
							<a href="${creationDetailHref}" class="creation-edit-source-link" data-source-link>change image</a>
						</div>
						<div class="create-prompt-wrap is-empty" data-prompt-wrap>
							<textarea class="create-prompt-input prompt-editor" data-edit-prompt data-mode="image-to-video" rows="3"
								placeholder="Describe the motion or camera movement..."></textarea>
							<a href="#" class="create-prompt-clear" tabindex="-1" aria-label="Clear field">clear</a>
						</div>
						<div class="create-controls">
							<div class="create-controls-buttons creation-edit-i2v-controls-row ${hasVideoMode && hasLtxVideoMode ? 'creation-edit-i2v-controls-row--gear' : ''}">
								${hasVideoMode && hasLtxVideoMode ? html`
								<span class="creation-edit-i2v-controls-spacer" aria-hidden="true"></span>
								` : ''}
								<button class="create-btn-generate btn-primary" data-generate-btn
									data-generate-mode="image-to-video" disabled>Animate</button>
								${hasVideoMode && hasLtxVideoMode ? html`
								<button type="button" class="creation-edit-i2v-gear-btn" data-creation-edit-i2v-gear aria-label="Video settings">
									<svg class="creation-edit-i2v-gear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<circle cx="12" cy="12" r="3"></circle>
										<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
									</svg>
								</button>
								` : ''}
							</div>
							<p class="create-cost" data-mutate-cost data-mode-cost="image-to-video">Loading credits…</p>
						</div>
					</tab>
					` : ''}
				</app-tabs>
				<footer class="create-page-footer creation-edit-footer">
					<nav class="create-page-footer-nav" aria-label="Mutate actions">
						<button type="button" class="creation-edit-queue-link create-page-footer-link" data-queue-mutate-btn>Queue for later</button>
						<span class="create-page-footer-sep" aria-hidden="true">·</span>
						<a href="/create" class="create-page-footer-link create-switch-to-advanced" data-mutate-advanced-mode>Advanced Mode</a>
					</nav>
				</footer>
			</div>
			${hasVideoMode && hasLtxVideoMode ? html`
			<div class="modal-overlay creation-edit-i2v-modal" data-creation-edit-i2v-modal aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="creation-edit-i2v-modal-title">
				<div class="modal modal-small">
					<div class="modal-header">
						<h3 id="creation-edit-i2v-modal-title">Video settings</h3>
						<button type="button" class="modal-close" data-creation-edit-i2v-modal-dismiss aria-label="Close">
							<span class="modal-close-icon" aria-hidden="true">×</span>
						</button>
					</div>
					<div class="modal-body">
						<div class="creation-edit-i2v-modal-section-head">
							<h4 class="creation-edit-i2v-modal-engine-heading" id="creation-edit-i2v-engine-heading">Engine</h4>
						</div>
						<div class="creation-edit-i2v-modal-radios" role="radiogroup" aria-labelledby="creation-edit-i2v-engine-heading">
							<label class="creation-edit-i2v-modal-radio">
								<input type="radio" name="creation-edit-i2v-engine" value="ltx" data-i2v-modal-engine />
								<span class="creation-edit-i2v-modal-radio-label">LTX Self-hosted</span>
							</label>
							<label class="creation-edit-i2v-modal-radio">
								<input type="radio" name="creation-edit-i2v-engine" value="wan" data-i2v-modal-engine />
								<span class="creation-edit-i2v-modal-radio-label">WAN Cloud</span>
							</label>
						</div>
					</div>
					<div class="modal-footer">
						<button type="button" class="btn-secondary" data-creation-edit-i2v-modal-cancel>Cancel</button>
						<button type="button" class="btn-primary" data-creation-edit-i2v-modal-save>Save</button>
					</div>
				</div>
			</div>
			` : ''}
		`;

		// Wire up image thumbnail (with shimmer) and click-to-view behavior.
		editContent.querySelectorAll('[data-source-thumb]').forEach((thumbEl) => {
			const thumb = thumbEl;
			const thumbWrap = thumb.closest('[data-source-thumb-wrap]');
			if (!(thumb instanceof HTMLImageElement) || !(thumbWrap instanceof HTMLElement)) return;
			applyMutateSourceAspectLayout(thumbWrap, creation, thumb);
			thumbWrap.classList.add('image-loading');
			thumbWrap.classList.remove('image-error');
			thumb.style.opacity = '0';
			const onPreviewLoad = () => {
				applyMutateSourceAspectLayout(thumbWrap, creation, thumb);
				persistMutateAspectRatioDataset(editContent, creation, thumb);
				thumbWrap.classList.remove('image-loading');
				thumbWrap.classList.remove('image-error');
				thumb.style.opacity = '';
			};
			const onPreviewError = () => {
				thumbWrap.classList.remove('image-loading');
				thumbWrap.classList.add('image-error');
			};
			thumb.addEventListener('load', onPreviewLoad, { once: true });
			thumb.addEventListener('error', onPreviewError, { once: true });
			thumb.src = previewImageUrl;
			if (thumb.complete && thumb.naturalWidth > 0) {
				onPreviewLoad();
			}
			thumb.loading = 'lazy';
			thumb.decoding = 'async';
			thumbWrap.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				window.location.href = creationDetailHref;
			});
		});

		editContent.querySelectorAll('[data-source-link]').forEach((linkEl) => {
			linkEl.addEventListener('click', (e) => {
				e.preventDefault();
				window.location.href = creationDetailHref;
			});
		});

		// Ensure preloaded image has a chance to resolve (no-op if it already did).
		await thumbPreload;

		const promptEls = Array.from(editContent.querySelectorAll('[data-edit-prompt]'));
		const generateBtns = Array.from(editContent.querySelectorAll('[data-generate-btn]'));
		const queueBtns = Array.from(editContent.querySelectorAll('[data-queue-mutate-btn]'));
		const costEls = Array.from(editContent.querySelectorAll('[data-mutate-cost]'));
		const tabsEl = editContent.querySelector('app-tabs');

		let creditsCount = null;

		editContent.dataset.mutateSourceId = String(
			Number.isFinite(Number(mutateSourceId)) && Number(mutateSourceId) > 0 ? mutateSourceId : creationId
		);
		if (mutateGroupId != null && Number.isFinite(Number(mutateGroupId)) && Number(mutateGroupId) > 0) {
			editContent.dataset.mutateGroupId = String(mutateGroupId);
		} else {
			delete editContent.dataset.mutateGroupId;
		}
		editContent.dataset.mutateImageUrl = sourceImageUrl;
		editContent.dataset.mutatePublished =
			creation.published === true || creation.published === 1 ? '1' : '0';

		const sourceThumb = editContent.querySelector('[data-source-thumb]');
		if (sourceThumb instanceof HTMLImageElement && sourceThumb.complete && sourceThumb.naturalWidth > 0) {
			persistMutateAspectRatioDataset(editContent, creation, sourceThumb);
		} else {
			persistMutateAspectRatioDataset(editContent, creation);
		}

		const normalizedImageUrlForQueue = toParasceneImageUrl(sourceImageUrl);
		let isImageQueued = false;
		if (normalizedImageUrlForQueue) {
			try {
				const queueItems = loadMutateQueue();
				const mutateSourceIdNum = Number(editContent.dataset.mutateSourceId || creationId);
				isImageQueued = queueItems.some((item) => {
					const itemUrl = typeof item?.imageUrl === 'string' ? item.imageUrl : '';
					const itemSourceIdNum = Number(item?.sourceId);
					const matchesSourceId = Number.isFinite(itemSourceIdNum) && itemSourceIdNum > 0 && itemSourceIdNum === mutateSourceIdNum;
					const matchesUrl = itemUrl === normalizedImageUrlForQueue;
					return matchesSourceId || matchesUrl;
				});
			} catch {
				// Ignore storage errors
			}
		}

		function loadSavedI2vEngine() {
			try {
				const v = localStorage.getItem(MUTATE_I2V_ENGINE_STORAGE_KEY);
				if (v === 'wan' || v === 'replicate') return 'wan';
				if (v === 'ltx') return 'ltx';
				return 'ltx';
			} catch {
				return 'ltx';
			}
		}

		function persistI2vEngine(engine) {
			try {
				localStorage.setItem(MUTATE_I2V_ENGINE_STORAGE_KEY, engine === 'wan' ? 'wan' : 'ltx');
			} catch {
				// ignore
			}
		}

		let i2vEngine = loadSavedI2vEngine();
		if (i2vEngine === 'ltx' && !hasLtxVideoMode) i2vEngine = 'wan';
		if (i2vEngine === 'wan' && !hasVideoMode && hasLtxVideoMode) i2vEngine = 'ltx';
		editContent.dataset.mutateI2vEngine = i2vEngine;

		const i2vModal = editContent.querySelector('[data-creation-edit-i2v-modal]');
		const i2vGearBtn = editContent.querySelector('[data-creation-edit-i2v-gear]');
		const i2vModalRadios = Array.from(editContent.querySelectorAll('[data-i2v-modal-engine]'));

		function syncI2vModalRadiosFromEngine() {
			i2vModalRadios.forEach((r) => {
				if (r instanceof HTMLInputElement) r.checked = r.value === i2vEngine;
			});
		}

		function openI2vModal() {
			if (!(i2vModal instanceof HTMLElement)) return;
			syncI2vModalRadiosFromEngine();
			i2vModal.classList.add('open');
			i2vModal.setAttribute('aria-hidden', 'false');
			const checked = i2vModalRadios.find((r) => r instanceof HTMLInputElement && r.checked);
			const toFocus = checked instanceof HTMLElement ? checked : i2vModalRadios[0];
			if (toFocus instanceof HTMLElement) toFocus.focus();
		}

		function closeI2vModal() {
			if (!(i2vModal instanceof HTMLElement)) return;
			i2vModal.classList.remove('open');
			i2vModal.setAttribute('aria-hidden', 'true');
			if (i2vGearBtn instanceof HTMLElement) i2vGearBtn.focus();
		}

		function onI2vModalSave() {
			const picked = i2vModalRadios.find((r) => r instanceof HTMLInputElement && r.checked);
			const next = picked?.value === 'wan' ? 'wan' : 'ltx';
			i2vEngine = next;
			editContent.dataset.mutateI2vEngine = i2vEngine;
			persistI2vEngine(i2vEngine);
			updateCostAndButtonState();
			closeI2vModal();
		}

		i2vGearBtn?.addEventListener('click', (e) => {
			e.preventDefault();
			openI2vModal();
		});

		i2vModal?.querySelector('[data-creation-edit-i2v-modal-dismiss]')?.addEventListener('click', (e) => {
			e.preventDefault();
			closeI2vModal();
		});
		i2vModal?.querySelector('[data-creation-edit-i2v-modal-cancel]')?.addEventListener('click', (e) => {
			e.preventDefault();
			closeI2vModal();
		});
		i2vModal?.querySelector('[data-creation-edit-i2v-modal-save]')?.addEventListener('click', (e) => {
			e.preventDefault();
			onI2vModalSave();
		});

		i2vModal?.addEventListener('click', (e) => {
			if (e.target === i2vModal) closeI2vModal();
		});

		const onI2vModalEscape = (e) => {
			if (e.key !== 'Escape') return;
			if (!(i2vModal instanceof HTMLElement) || !i2vModal.classList.contains('open')) return;
			e.preventDefault();
			closeI2vModal();
		};
		document.addEventListener('keydown', onI2vModalEscape);

		function getModeCost(mode) {
			if (mode === 'image-to-video') {
				if (i2vEngine === 'ltx' && hasLtxVideoMode) return ltxCost;
				if (i2vEngine === 'wan' && hasVideoMode) return videoCost;
				if (hasLtxVideoMode) return ltxCost;
				if (hasVideoMode) return videoCost;
				return null;
			}
			return imageCost;
		}

		function updateCostAndButtonState() {
			const promptsByMode = {
				'image-to-image': '',
				'image-to-video': '',
			};
			promptEls.forEach((el) => {
				if (!(el instanceof HTMLTextAreaElement)) return;
				const mode = mutateModeFromTabOrDataset(el.dataset.mode);
				promptsByMode[mode] = el.value || '';
			});

			costEls.forEach((costEl) => {
				if (!(costEl instanceof HTMLElement)) return;
				const mode = mutateModeFromTabOrDataset(costEl.dataset.modeCost);
				const cost = getModeCost(mode);
				costEl.classList.remove('insufficient');
				if (creditsCount == null) {
					costEl.textContent = 'Loading credits…';
				} else if (!Number.isFinite(cost)) {
					costEl.textContent = 'Unavailable';
					costEl.classList.add('insufficient');
				} else {
					costEl.textContent = `Costs ${cost} credits`;
					if (creditsCount < cost) {
						costEl.classList.add('insufficient');
					}
				}
			});

			generateBtns.forEach((buttonEl) => {
				if (!(buttonEl instanceof HTMLButtonElement)) return;
				const mode = mutateModeFromTabOrDataset(buttonEl.dataset.generateMode);
				const hasPrompt = (promptsByMode[mode] || '').trim().length > 0;
				const cost = getModeCost(mode);
				const hasEnoughCredits = creditsCount != null && Number.isFinite(cost) && creditsCount >= cost;
				buttonEl.disabled = !(hasPrompt && hasEnoughCredits);
			});
		}
		tabsEl?.addEventListener('tab-change', (e) => {
			const mode = mutateModeFromTabOrDataset(e?.detail?.id);
			activeMode = mode;
			persistMutateMode(mode);
			if (i2vModal instanceof HTMLElement && i2vModal.classList.contains('open')) closeI2vModal();
		});

		// Image Edit prompt: same localStorage/sessionStorage as /create (see entry-create.js savePrompts).
		promptEls.forEach((promptEl) => {
			if (!(promptEl instanceof HTMLTextAreaElement)) return;
			try {
				const saved = localStorage.getItem('create_page_prompt_image_edit');
				if (typeof saved === 'string') promptEl.value = saved;
			} catch (_) { }
			attachAutoGrowTextarea(promptEl);
			attachMentionSuggest(promptEl);
			try {
				if (typeof refreshAutoGrowTextareas === 'function') {
					refreshAutoGrowTextareas(editContent);
				}
			} catch (_) { }
		});

		// Load credits (match create)
		async function loadCredits() {
			try {
				const result = await fetchJsonWithStatusDeduped('/api/credits', { credentials: 'include' }, { windowMs: 2000 });
				if (result.ok) {
					const n = Number(result.data?.balance ?? 0);
					creditsCount = Number.isFinite(n) ? Math.max(0, Math.round(n * 10) / 10) : 0;
				} else {
					creditsCount = 0;
				}
			} catch {
				const stored = window.localStorage?.getItem('credits-balance');
				const n = Number(stored);
				creditsCount = Number.isFinite(n) ? Math.max(0, Math.round(n * 10) / 10) : 0;
			}
			updateCostAndButtonState();
		}

		function handleCreditsUpdated(event) {
			const n = Number(event?.detail?.count);
			if (Number.isFinite(n)) {
				creditsCount = Math.max(0, Math.round(n * 10) / 10);
				updateCostAndButtonState();
			} else {
				void loadCredits();
			}
		}

		document.addEventListener('credits-updated', handleCreditsUpdated);
		void loadCredits();

		updateCostAndButtonState();

		function scheduleMutatePromptPersist() {
			cancelMutatePromptDraftPersist();
			mutatePromptSaveTimerId = setTimeout(() => {
				mutatePromptSaveTimerId = null;
				const activePromptEl = editContent.querySelector('app-tabs tab:not([hidden]) [data-edit-prompt]');
				const text = activePromptEl instanceof HTMLTextAreaElement ? activePromptEl.value || '' : '';
				persistMutateImageEditDraftToStorage(text);
			}, 300);
		}
		promptEls.forEach((promptEl) => {
			if (!(promptEl instanceof HTMLTextAreaElement)) return;
			const wrap = promptEl.closest('[data-prompt-wrap]');
			if (typeof attachPromptFieldClear === 'function') {
				attachPromptFieldClear(promptEl, {
					wrap,
					onClear: () => {
						promptEls.forEach((p) => {
							if (p !== promptEl && p instanceof HTMLTextAreaElement) {
								p.value = '';
								p.dispatchEvent(new Event('input', { bubbles: true }));
							}
						});
						updateCostAndButtonState();
						scheduleMutatePromptPersist();
					},
					afterClear: () => {
						try {
							refreshAutoGrowTextareas(editContent);
						} catch (_) {}
					},
				});
			}
			promptEl.addEventListener('input', () => {
				const value = promptEl.value || '';
				promptEls.forEach((other) => {
					if (other !== promptEl && other instanceof HTMLTextAreaElement) {
						other.value = value;
						other.dispatchEvent(new Event('input', { bubbles: true }));
					}
				});
				updateCostAndButtonState();
				scheduleMutatePromptPersist();
			});
			promptEl.addEventListener('change', scheduleMutatePromptPersist);
		});

		if (queueBtns.length > 0) {
			const MIN_SPINNER_MS = 350;
			let queueState = isImageQueued ? 'queued' : 'idle';

			function renderQueueButton() {
				queueBtns.forEach((queueBtn) => {
					if (!(queueBtn instanceof HTMLButtonElement)) return;
					if (queueState === 'queueing') {
						queueBtn.disabled = true;
						queueBtn.innerHTML = '<span class="queue-button-spinner" aria-hidden="true"></span><span class="queue-button-label">Queuing…</span>';
						return;
					}
					if (queueState === 'removing') {
						queueBtn.disabled = true;
						queueBtn.innerHTML = '<span class="queue-button-spinner" aria-hidden="true"></span><span class="queue-button-label">Removing…</span>';
						return;
					}
					queueBtn.disabled = false;
					queueBtn.textContent = queueState === 'queued' ? 'Remove from queue' : 'Queue for later';
				});
			}

			renderQueueButton();

			const onQueueClick = () => {
				if (queueState === 'queueing' || queueState === 'removing') return;

				const sourceIdRaw = editContent.dataset.mutateSourceId || '';
				const imageUrlRaw = editContent.dataset.mutateImageUrl || '';
				const sourceId = Number(sourceIdRaw);
				const normalizedImageUrl = toParasceneImageUrl(imageUrlRaw);
				if (!normalizedImageUrl) return;

				const start = performance.now();

				if (queueState === 'queued') {
					queueState = 'removing';
					renderQueueButton();
					try {
						removeFromMutateQueueByImageUrl(normalizedImageUrl);
					} catch {
						// ignore storage errors
					}
					const elapsed = performance.now() - start;
					const remaining = Math.max(0, MIN_SPINNER_MS - elapsed);
					setTimeout(() => {
						queueState = 'idle';
						renderQueueButton();
					}, remaining);
					return;
				}

				if (!Number.isFinite(sourceId) || sourceId <= 0) return;
				queueState = 'queueing';
				renderQueueButton();
				const published = creation.published === true || creation.published === 1;
				try {
					addToMutateQueue({ sourceId, imageUrl: normalizedImageUrl, published });
				} catch {
					// ignore storage errors
				}
				try {
					const activePromptEl = editContent.querySelector('app-tabs tab:not([hidden]) [data-edit-prompt]');
					const promptText = activePromptEl instanceof HTMLTextAreaElement ? (activePromptEl.value || '') : '';
					persistMutateImageEditDraftToStorage(promptText);
				} catch (_) { }
				const elapsed = performance.now() - start;
				const remaining = Math.max(0, MIN_SPINNER_MS - elapsed);
				setTimeout(() => {
					queueState = 'queued';
					renderQueueButton();
				}, remaining);
			};
			queueBtns.forEach((queueBtn) => queueBtn.addEventListener('click', onQueueClick));
		}

		const advancedModeLink = editContent.querySelector('[data-mutate-advanced-mode]');
		if (advancedModeLink instanceof HTMLAnchorElement) {
			advancedModeLink.addEventListener('click', (e) => {
				e.preventDefault();
				cancelMutatePromptDraftPersist();
				const tabsEl = editContent.querySelector('app-tabs');
				const mode = mutateModeFromTabOrDataset(
					tabsEl?.getAttribute?.('active') || activeMode
				);
				const rawEngine = editContent.dataset.mutateI2vEngine;
				const i2vEngine = rawEngine === 'wan' || rawEngine === 'replicate' ? 'wan' : 'ltx';
				const activePromptEl = editContent.querySelector(
					'app-tabs tab:not([hidden]) [data-edit-prompt]'
				);
				const prompt =
					activePromptEl instanceof HTMLTextAreaElement ? activePromptEl.value || '' : '';
				const aspectRatio =
					String(editContent.dataset.mutateAspectRatio || '').trim() || '1:1';
				const sourceId = Number(editContent.dataset.mutateSourceId || '');
				const imageUrl = toParasceneImageUrl(editContent.dataset.mutateImageUrl || '');
				const published = editContent.dataset.mutatePublished === '1';
				try {
					if (typeof syncMutatePageToAdvancedCreate === 'function') {
						syncMutatePageToAdvancedCreate({
							mode,
							i2vEngine,
							prompt,
							aspectRatio,
							imageUrl,
							sourceId,
							published,
						});
					}
				} catch {
					// ignore storage errors
				}
				document.cookie = 'create_editor=; path=/; max-age=0';
				window.location.href = '/create';
			});
		}
	} catch {
		editContent.innerHTML = renderEmptyState({
			title: 'Unable to load creation',
			message: 'An error occurred while loading the creation.',
		});
	}
}

document.addEventListener('DOMContentLoaded', () => {
	void loadEditPage();
});

document.addEventListener('click', (e) => {
	const btn = e.target.closest('[data-generate-btn]');
	if (!(btn instanceof HTMLButtonElement)) return;
	if (btn.disabled) return;

	e.preventDefault();
	const container = document.querySelector('[data-edit-content]');
	const panel = btn.closest('tab');
	const promptEl = panel?.querySelector?.('[data-edit-prompt]') || document.querySelector('[data-edit-prompt]');
	const prompt = promptEl instanceof HTMLTextAreaElement ? promptEl.value.trim() : '';

	const imageUrl = container?.dataset?.mutateImageUrl || '';
	const sourceIdRaw = container?.dataset?.mutateSourceId || '';
	const activeMode = mutateModeFromTabOrDataset(btn.getAttribute('data-generate-mode'));
	const rawEngine = container?.dataset?.mutateI2vEngine;
	const i2vEngineFromDom = rawEngine === 'wan' || rawEngine === 'replicate' ? 'wan' : 'ltx';

	const serverId = activeMode === 'image-to-video' && i2vEngineFromDom === 'ltx'
		? MUTATE_VIDEO_LTX_SERVER_ID
		: MUTATE_DEFAULT_SERVER_ID;
	const mutateOfId = Number(sourceIdRaw);
	const mutateGroupIdRaw = container?.dataset?.mutateGroupId || '';
	const mutateGroupId = Number(mutateGroupIdRaw);

	// Safety checks (button should already be disabled if these are missing).
	if (!prompt) return;
	if (!Number.isFinite(serverId) || serverId <= 0) return;
	const normalizedImageUrl = toParasceneImageUrl(imageUrl);
	if (!normalizedImageUrl) return;
	if (!Number.isFinite(mutateOfId) || mutateOfId <= 0) return;

	const extractMentions = (text) => {
		const out = [];
		const seen = new Set();
		const re = /@([a-zA-Z0-9_]+)/g;
		let match;
		while ((match = re.exec(text || '')) !== null) {
			const full = `@${match[1]}`;
			if (seen.has(full)) continue;
			seen.add(full);
			out.push(full);
		}
		return out;
	};

	const doSubmit = (hydrateMentions) => {
		btn.disabled = true;
		cancelMutatePromptDraftPersist();
		prepareCreationsPageAfterMutateSubmit({
			mutateOfId,
			normalizedImageUrl,
			published: container?.dataset?.mutatePublished === '1',
		});
		let methodKey;
		let args;
		const aspectRatio = String(container?.dataset?.mutateAspectRatio || '').trim() || '1:1';
		if (activeMode === 'image-to-video' && i2vEngineFromDom === 'ltx') {
			methodKey = MUTATE_VIDEO_LTX_METHOD_KEY;
			args = {
				seed: '',
				model: MUTATE_VIDEO_LTX_MODEL,
				prompt,
				input_images: [normalizedImageUrl],
				aspect_ratio: aspectRatio,
			};
		} else if (activeMode === 'image-to-video') {
			methodKey = MUTATE_VIDEO_DEFAULT_METHOD_KEY;
			args = {
				prompt,
				image: normalizedImageUrl,
				model: MUTATE_VIDEO_DEFAULT_MODEL,
			};
		} else {
			methodKey = MUTATE_DEFAULT_METHOD_KEY;
			args = {
				prompt,
				image_url: normalizedImageUrl,
				model: MUTATE_DEFAULT_MODEL,
			};
		}
		submitCreationWithPending({
			serverId,
			methodKey,
			mutateOfId,
			...(Number.isFinite(mutateGroupId) && mutateGroupId > 0 ? { mutateGroupId } : {}),
			args,
			hydrateMentions,
			navigate: 'full'
		});
	};

	const VIDEO_SUBMIT_CONFIRM =
		'You are submitting from Image to Video. Video jobs typically require more processing time than image-only mutations, and credits will be charged as shown on this page.\n\nDo you want to continue?';

	function requestSubmit(hydrateMentions) {
		if (activeMode === 'image-to-video' && !window.confirm(VIDEO_SUBMIT_CONFIRM)) return;
		doSubmit(hydrateMentions);
	}

	const mentions = extractMentions(prompt);
	if (mentions.length === 0) {
		requestSubmit(false);
		return;
	}

	fetch('/api/create/validate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ args: { prompt } })
	})
		.then(async (res) => {
			const data = await res.json().catch(() => ({}));
			if (res.ok) return { ok: true, data };
			return { ok: false, data };
		})
		.then(({ ok, data }) => {
			if (ok) {
				requestSubmit(true);
				return;
			}
			const message = formatMentionsFailureForDialog(data);
			const proceed = window.confirm(message);
			if (proceed) requestSubmit(false);
		})
		.catch(() => {
			const message = formatMentionsFailureForDialog({});
			const proceed = window.confirm(message);
			if (proceed) requestSubmit(false);
		});
});

