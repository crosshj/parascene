let submitCreationWithPending;
let formatMentionsFailureForDialog;
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
let renderEmptyState;
let renderEmptyLoading;
let renderEmptyError;
let addToMutateQueue;
let clearMutateQueue;
let loadMutateQueue;
let removeFromMutateQueueByImageUrl;

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
		const emptyStateMod = await import(`/shared/emptyState.js${qs}`);
		renderEmptyState = emptyStateMod.renderEmptyState;
		renderEmptyLoading = emptyStateMod.renderEmptyLoading;
		renderEmptyError = emptyStateMod.renderEmptyError;

		const mutateQueueMod = await import(`/shared/mutateQueue.js${qs}`);
		addToMutateQueue = mutateQueueMod.addToMutateQueue;
		clearMutateQueue = mutateQueueMod.clearMutateQueue;
		loadMutateQueue = mutateQueueMod.loadMutateQueue;
		removeFromMutateQueueByImageUrl = mutateQueueMod.removeFromMutateQueueByImageUrl;

		await import(`/components/elements/tabs.js${qs}`);
	})();
	return _depsPromise;
}

const html = String.raw;
const MUTATE_MODE_STORAGE_KEY = 'mutate_page_mode';

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
		localStorage.setItem('create_page_prompt_image_edit', text);
		localStorage.setItem('create_page_tab', 'image-edit');
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

/** Queue (single item) + same prompt/tab/session snapshot as Image Edit on /create. */
function persistMutateForNextCreatePage({ prompt, mutateOfId, normalizedImageUrl, published }) {
	try {
		clearMutateQueue();
		addToMutateQueue({ sourceId: mutateOfId, imageUrl: normalizedImageUrl, published });
	} catch (_) { }
	persistMutateImageEditDraftToStorage(prompt);
}

function getCreationId() {
	const pathname = window.location.pathname;
	const match = pathname.match(/^\/creations\/(\d+)\/(edit|mutat|mutate)$/);
	return match ? parseInt(match[1], 10) : null;
}

function loadSavedMutateMode() {
	try {
		const saved = localStorage.getItem(MUTATE_MODE_STORAGE_KEY);
		return saved === 'image-to-video' ? 'image-to-video' : 'image-to-image';
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

function withVariant(url, variant) {
	if (typeof url !== 'string' || !url) return '';
	try {
		const parsed = new URL(url, window.location.origin);
		parsed.searchParams.set('variant', variant);
		return parsed.toString();
	} catch {
		const parts = url.split('#');
		const base = parts[0] || '';
		const hash = parts.length > 1 ? `#${parts.slice(1).join('#')}` : '';
		const joiner = base.includes('?') ? '&' : '?';
		return `${base}${joiner}variant=${encodeURIComponent(variant)}${hash}`;
	}
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

	editContent.innerHTML = renderEmptyLoading({});

	try {
		const response = await fetch(`/api/create/images/${creationId}`, { credentials: 'include' });
		if (!response.ok) {
			editContent.innerHTML = renderEmptyState({
				title: 'Unable to load creation',
				message: "The creation you're trying to edit doesn't exist or you don't have access.",
			});
			return;
		}

		const creation = await response.json();
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
		const creationDetailHref = `/creations/${creationId}`;
		const sourceImageUrl = canEdit ? String(creation.url) : '';
		const thumbUrl = canEdit ? withVariant(sourceImageUrl, 'thumbnail') : '';

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
			if (!thumbUrl) return resolve({ ok: false });
			const img = new Image();
			img.onload = () => resolve({ ok: true });
			img.onerror = () => resolve({ ok: false });
			img.decoding = 'async';
			img.src = thumbUrl;
		});

		const servers = await loadMutateServerOptions();
		const server = servers.find((s) => Number(s.id) === Number(MUTATE_DEFAULT_SERVER_ID));
		if (!server) {
			editContent.innerHTML = renderEmptyState({
				title: 'Mutate unavailable',
				message: 'You do not have access to the default mutate server.',
			});
			return;
		}
		const methods = server.server_config && typeof server.server_config === 'object' ? server.server_config.methods : null;
		if (!methods || typeof methods !== 'object') {
			editContent.innerHTML = renderEmptyState({
				title: 'Mutate unavailable',
				message: 'No mutate methods are available on this server.',
			});
			return;
		}
		const imageMethodDef = methods[MUTATE_DEFAULT_METHOD_KEY];
		const videoMethodDef = methods[MUTATE_VIDEO_DEFAULT_METHOD_KEY];

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
		const hasImageMode = Boolean(imageMethodDef) && Number.isFinite(imageCost) && imageCost >= 0;
		const hasVideoMode = Boolean(videoMethodDef) && Number.isFinite(videoCost) && videoCost >= 0;
		if (!hasImageMode && !hasVideoMode) {
			editContent.innerHTML = renderEmptyState({
				title: 'Mutate unavailable',
				message: 'No valid mutate modes are configured for this server.',
			});
			return;
		}

		const savedMode = loadSavedMutateMode();
		let activeMode = savedMode;
		if (activeMode === 'image-to-video' && !hasVideoMode) activeMode = 'image-to-image';
		if (activeMode === 'image-to-image' && !hasImageMode) activeMode = 'image-to-video';

		editContent.innerHTML = html`
			<div class="create-content creation-edit-create-content">
				<app-tabs active="${activeMode === 'image-to-video' ? 'image-to-video' : 'image-to-image'}">
					${hasImageMode ? html`
					<tab label="Image Edit" data-id="image-to-image" ${activeMode==='image-to-image' ? 'default' : '' }>
						<h1 class="create-title">What do you want to change?</h1>
						<div class="create-image-edit-wrap creation-edit-source-wrap">
							<div class="create-image-edit-box creation-edit-source-box" data-source-thumb-wrap title="View creation"
								aria-label="Source image">
								<img class="image-thumb" data-source-thumb alt="Source image" />
							</div>
						</div>
						<div class="create-prompt-wrap is-empty" data-prompt-wrap>
							<textarea class="create-prompt-input prompt-editor" data-edit-prompt data-mode="image-to-image" rows="3"
								placeholder="Describe your changes..."></textarea>
							<a href="#" class="create-prompt-clear" aria-label="Clear field">clear</a>
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
					${hasVideoMode ? html`
					<tab label="Image To Video" data-id="image-to-video" ${activeMode==='image-to-video' ? 'default' : '' }>
						<h1 class="create-title">What happens next?</h1>
						<div class="create-image-edit-wrap creation-edit-source-wrap">
							<div class="create-image-edit-box creation-edit-source-box" data-source-thumb-wrap title="View creation"
								aria-label="Source image">
								<img class="image-thumb" data-source-thumb alt="Source image" />
							</div>
						</div>
						<div class="create-prompt-wrap is-empty" data-prompt-wrap>
							<textarea class="create-prompt-input prompt-editor" data-edit-prompt data-mode="image-to-video" rows="3"
								placeholder="Describe the motion or camera movement..."></textarea>
							<a href="#" class="create-prompt-clear" aria-label="Clear field">clear</a>
						</div>
						<div class="create-controls">
							<div class="create-controls-buttons">
								<button class="create-btn-generate btn-primary" data-generate-btn
									data-generate-mode="image-to-video" disabled>Animate</button>
							</div>
							<p class="create-cost" data-mutate-cost data-mode-cost="image-to-video">Loading credits…</p>
						</div>
					</tab>
					` : ''}
				</app-tabs>
				<footer class="create-page-footer creation-edit-footer">
					<nav class="create-page-footer-nav" aria-label="Mutate actions">
						<button type="button" class="creation-edit-queue-link create-page-footer-link" data-queue-mutate-btn>Queue for later</button>
					</nav>
				</footer>
			</div>
		`;

		// Wire up image thumbnail (with shimmer) and click-to-view behavior.
		editContent.querySelectorAll('[data-source-thumb]').forEach((thumbEl) => {
			const thumb = thumbEl;
			const thumbWrap = thumb.closest('[data-source-thumb-wrap]');
			if (!(thumb instanceof HTMLImageElement) || !(thumbWrap instanceof HTMLElement)) return;
			thumbWrap.classList.add('loading');
			thumbWrap.classList.remove('loaded');
			thumbWrap.classList.remove('error');
			thumb.style.opacity = '0';
			thumb.addEventListener('load', () => {
				thumbWrap.classList.remove('loading');
				thumbWrap.classList.add('loaded');
				thumbWrap.classList.remove('error');
				thumb.style.opacity = '';
			}, { once: true });
			thumb.addEventListener('error', () => {
				thumbWrap.classList.remove('loading');
				thumbWrap.classList.remove('loaded');
				thumbWrap.classList.add('error');
			}, { once: true });
			thumb.src = thumbUrl;
			thumb.loading = 'lazy';
			thumb.decoding = 'async';
			thumbWrap.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
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

		editContent.dataset.mutateSourceId = String(creationId);
		editContent.dataset.mutateImageUrl = sourceImageUrl;
		editContent.dataset.mutatePublished =
			creation.published === true || creation.published === 1 ? '1' : '0';

		const normalizedImageUrlForQueue = toParasceneImageUrl(sourceImageUrl);
		let isImageQueued = false;
		if (normalizedImageUrlForQueue) {
			try {
				const queueItems = loadMutateQueue();
				const creationIdNum = Number(creationId);
				isImageQueued = queueItems.some((item) => {
					const itemUrl = typeof item?.imageUrl === 'string' ? item.imageUrl : '';
					const itemSourceIdNum = Number(item?.sourceId);
					const matchesSourceId = Number.isFinite(itemSourceIdNum) && itemSourceIdNum > 0 && itemSourceIdNum === creationIdNum;
					const matchesUrl = itemUrl === normalizedImageUrlForQueue;
					return matchesSourceId || matchesUrl;
				});
			} catch {
				// Ignore storage errors
			}
		}

		function getModeCost(mode) {
			return mode === 'image-to-video' ? videoCost : imageCost;
		}

		function updateCostAndButtonState() {
			const promptsByMode = {
				'image-to-image': '',
				'image-to-video': '',
			};
			promptEls.forEach((el) => {
				if (!(el instanceof HTMLTextAreaElement)) return;
				const mode = el.dataset.mode === 'image-to-video' ? 'image-to-video' : 'image-to-image';
				promptsByMode[mode] = el.value || '';
			});

			costEls.forEach((costEl) => {
				if (!(costEl instanceof HTMLElement)) return;
				const mode = costEl.dataset.modeCost === 'image-to-video' ? 'image-to-video' : 'image-to-image';
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
				const mode = buttonEl.dataset.generateMode === 'image-to-video' ? 'image-to-video' : 'image-to-image';
				const hasPrompt = (promptsByMode[mode] || '').trim().length > 0;
				const cost = getModeCost(mode);
				const hasEnoughCredits = creditsCount != null && Number.isFinite(cost) && creditsCount >= cost;
				buttonEl.disabled = !(hasPrompt && hasEnoughCredits);
			});
		}
		tabsEl?.addEventListener('tab-change', (e) => {
			const mode = e?.detail?.id === 'image-to-video' ? 'image-to-video' : 'image-to-image';
			activeMode = mode;
			persistMutateMode(mode);
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

		let promptSaveTimer;
		function scheduleMutatePromptPersist() {
			clearTimeout(promptSaveTimer);
			promptSaveTimer = setTimeout(() => {
				const activePromptEl = editContent.querySelector('app-tabs tab:not([hidden]) [data-edit-prompt]');
				const text = activePromptEl instanceof HTMLTextAreaElement ? activePromptEl.value || '' : '';
				persistMutateImageEditDraftToStorage(text);
			}, 300);
		}
		promptEls.forEach((promptEl) => {
			if (!(promptEl instanceof HTMLTextAreaElement)) return;
			promptEl.addEventListener('input', () => {
				const value = promptEl.value || '';
				promptEls.forEach((other) => {
					if (other !== promptEl && other instanceof HTMLTextAreaElement) {
						other.value = value;
					}
				});
				updateCostAndButtonState();
				scheduleMutatePromptPersist();
				const wrap = promptEl.closest('[data-prompt-wrap]');
				wrap?.classList.toggle('is-empty', value.trim().length === 0);
				const clear = wrap?.querySelector('.create-prompt-clear');
				clear?.classList.toggle('is-visible', value.trim().length > 0);
			});
			promptEl.addEventListener('change', scheduleMutatePromptPersist);
			const wrap = promptEl.closest('[data-prompt-wrap]');
			wrap?.classList.toggle('is-empty', (promptEl.value || '').trim().length === 0);
			const clear = wrap?.querySelector('.create-prompt-clear');
			clear?.classList.toggle('is-visible', (promptEl.value || '').trim().length > 0);
		});

		editContent.querySelectorAll('.create-prompt-clear').forEach((clearEl) => {
			clearEl.addEventListener('click', (e) => {
				e.preventDefault();
				promptEls.forEach((p) => {
					if (p instanceof HTMLTextAreaElement) {
						p.value = '';
						const wrap = p.closest('[data-prompt-wrap]');
						wrap?.classList.add('is-empty');
						const clear = wrap?.querySelector('.create-prompt-clear');
						clear?.classList.remove('is-visible');
					}
				});
				updateCostAndButtonState();
				scheduleMutatePromptPersist();
			});
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
	const activeMode = btn.getAttribute('data-generate-mode') === 'image-to-video'
		? 'image-to-video'
		: 'image-to-image';

	const serverId = MUTATE_DEFAULT_SERVER_ID;
	const mutateOfId = Number(sourceIdRaw);

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
		persistMutateForNextCreatePage({
			prompt,
			mutateOfId,
			normalizedImageUrl,
			published: container?.dataset?.mutatePublished === '1',
		});
		submitCreationWithPending({
			serverId,
			methodKey: activeMode === 'image-to-video' ? MUTATE_VIDEO_DEFAULT_METHOD_KEY : MUTATE_DEFAULT_METHOD_KEY,
			mutateOfId,
			args: {
				prompt,
				...(activeMode === 'image-to-video'
					? { image: normalizedImageUrl, model: MUTATE_VIDEO_DEFAULT_MODEL }
					: { image_url: normalizedImageUrl, model: MUTATE_DEFAULT_MODEL }),
			},
			hydrateMentions,
			navigate: 'full'
		});
	};

	const mentions = extractMentions(prompt);
	if (mentions.length === 0) {
		doSubmit(false);
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
				doSubmit(true);
				return;
			}
			const message = formatMentionsFailureForDialog(data);
			const proceed = window.confirm(message);
			if (proceed) doSubmit(false);
		})
		.catch(() => {
			const message = formatMentionsFailureForDialog({});
			const proceed = window.confirm(message);
			if (proceed) doSubmit(false);
		});
});

