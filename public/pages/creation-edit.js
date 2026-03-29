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
		const emptyStateMod = await import(`/shared/emptyState.js${qs}`);
		renderEmptyState = emptyStateMod.renderEmptyState;
		renderEmptyLoading = emptyStateMod.renderEmptyLoading;
		renderEmptyError = emptyStateMod.renderEmptyError;

		const mutateQueueMod = await import(`/shared/mutateQueue.js${qs}`);
		addToMutateQueue = mutateQueueMod.addToMutateQueue;
		clearMutateQueue = mutateQueueMod.clearMutateQueue;
		loadMutateQueue = mutateQueueMod.loadMutateQueue;
		removeFromMutateQueueByImageUrl = mutateQueueMod.removeFromMutateQueueByImageUrl;
	})();
	return _depsPromise;
}

const html = String.raw;

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

let isMutateDirty = false;
let hasInstalledNavigationGuard = false;

function confirmDiscardChanges() {
	if (!isMutateDirty) return true;
	return window.confirm('You have unsaved changes. If you leave this page, you will lose them. Continue?');
}

function installNavigationGuardOnce() {
	if (hasInstalledNavigationGuard) return;
	hasInstalledNavigationGuard = true;

	// Browser-level fallback: refresh, back/forward, closing tab, etc.
	window.addEventListener('beforeunload', (e) => {
		if (!isMutateDirty) return;
		e.preventDefault();
		e.returnValue = '';
	});

	// Intercept user-initiated navigation clicks (header links, mobile nav, anchors).
	document.addEventListener('click', (e) => {
		if (!isMutateDirty) return;

		// Header/mobile nav route clicks (often <a data-route> or <button data-route>).
		const routeEl = e.target?.closest?.('[data-route]');
		if (routeEl) {
			if (!confirmDiscardChanges()) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}
			return;
		}

		// Normal links.
		const a = e.target?.closest?.('a[href]');
		if (!a) return;
		const href = a.getAttribute('href') || '';
		if (!href) return;
		if (href.startsWith('#')) return;
		if (href.toLowerCase().startsWith('javascript:')) return;
		if (a.target && a.target !== '_self') return;

		if (!confirmDiscardChanges()) {
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	}, true);
}

function getCreationId() {
	const pathname = window.location.pathname;
	const match = pathname.match(/^\/creations\/(\d+)\/(edit|mutat|mutate)$/);
	return match ? parseInt(match[1], 10) : null;
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

	installNavigationGuardOnce();

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
		const methodDef = methods && typeof methods === 'object' ? methods[MUTATE_DEFAULT_METHOD_KEY] : null;

		if (!methodDef) {
			editContent.innerHTML = renderEmptyState({
				title: 'Mutate unavailable',
				message: 'The configured mutate method is not available on this server.',
			});
			return;
		}
		let mutateCreditCost = null;
		if (typeof methodDef.credits === 'number' && Number.isFinite(methodDef.credits)) {
			mutateCreditCost = methodDef.credits;
		} else if (methodDef.credits != null && methodDef.credits !== '') {
			const p = parseFloat(methodDef.credits);
			if (Number.isFinite(p)) mutateCreditCost = p;
		}
		if (mutateCreditCost == null || !Number.isFinite(mutateCreditCost) || mutateCreditCost < 0) {
			editContent.innerHTML = renderEmptyState({
				title: 'Mutate unavailable',
				message: 'This method has no valid credit cost in server configuration. An admin must set credits for this method.',
			});
			return;
		}

		editContent.innerHTML = html`
			<form class="create-form" data-edit-form>
				<div class="form-group">
					<label class="form-label">Image</label>
					<div class="form-static image-field" aria-label="Source image">
						<div class="image-thumb-wrap" data-source-thumb-wrap title="View creation">
							<img class="image-thumb" data-source-thumb alt="Source image" />
						</div>
						<div class="image-meta">
							<div class="image-meta-title">${escapeHtml(title ? String(title) : 'Source image')}</div>
							<div class="image-meta-subtitle">Creation #${creationId}</div>
						</div>
					</div>
				</div>
			
				<div class="form-group">
					<label class="form-label" for="edit-prompt">Prompt <span class="field-required"
							aria-hidden="true">*</span></label>
					<textarea class="form-input form-textarea prompt-editor" id="edit-prompt" data-edit-prompt rows="3"
						placeholder="Describe what you want to change..."></textarea>
				</div>
			</form>
			
			<div class="create-controls">
				<div class="create-controls-buttons">
					<button class="create-button" data-generate-btn disabled>
						Mutate
					</button>
					<button type="button" class="btn-secondary" data-queue-mutate-btn>
						Queue for later
					</button>
				</div>
				<p class="create-cost" data-mutate-cost>Loading credits…</p>
			</div>
		`;

		// Wire up image thumbnail (with shimmer) and click-to-view behavior.
		const thumb = editContent.querySelector('[data-source-thumb]');
		const thumbWrap = editContent.querySelector('[data-source-thumb-wrap]');
		if (thumb instanceof HTMLImageElement && thumbWrap instanceof HTMLElement) {
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
				if (!confirmDiscardChanges()) return;
				window.location.href = creationDetailHref;
			});
		}

		// Ensure preloaded image has a chance to resolve (no-op if it already did).
		await thumbPreload;

		const promptEl = editContent.querySelector('[data-edit-prompt]');
		const generateBtn = editContent.querySelector('[data-generate-btn]');
		const queueBtn = editContent.querySelector('[data-queue-mutate-btn]');
		const costEl = editContent.querySelector('[data-mutate-cost]');

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

		function updateCostAndButtonState() {
			const hasPrompt = promptEl instanceof HTMLTextAreaElement && promptEl.value.trim().length > 0;
			isMutateDirty = Boolean(hasPrompt);
			const cost = mutateCreditCost;

			if (costEl instanceof HTMLElement) {
				costEl.classList.remove('insufficient');
				if (creditsCount == null) {
					costEl.textContent = 'Loading credits…';
				} else if (creditsCount >= cost) {
					costEl.textContent = `Costs ${cost} credits`;
				} else {
					costEl.textContent = `Insufficient credits. You have ${creditsCount} credits, need ${cost} credits.`;
					costEl.classList.add('insufficient');
				}
			}

			const hasEnoughCredits = creditsCount != null && creditsCount >= cost;
			if (generateBtn instanceof HTMLButtonElement) {
				generateBtn.disabled = !(hasPrompt && hasEnoughCredits);
			}
		}

		// Image Edit prompt: same localStorage/sessionStorage as /create (see entry-create.js savePrompts).
		if (promptEl instanceof HTMLTextAreaElement) {
			try {
				const saved = localStorage.getItem('create_page_prompt_image_edit');
				if (typeof saved === 'string') promptEl.value = saved;
			} catch (_) {}
			attachAutoGrowTextarea(promptEl);
			attachMentionSuggest(promptEl);
			try {
				if (typeof refreshAutoGrowTextareas === 'function') {
					refreshAutoGrowTextareas(editContent);
				}
			} catch (_) {}
		}

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
				if (promptEl instanceof HTMLTextAreaElement) {
					persistMutateImageEditDraftToStorage(promptEl.value || '');
				}
			}, 300);
		}
		if (promptEl instanceof HTMLTextAreaElement) {
			promptEl.addEventListener('input', () => {
				updateCostAndButtonState();
				scheduleMutatePromptPersist();
			});
			promptEl.addEventListener('change', scheduleMutatePromptPersist);
		}

		if (queueBtn instanceof HTMLButtonElement) {
			const MIN_SPINNER_MS = 350;
			let queueState = isImageQueued ? 'queued' : 'idle';

			function renderQueueButton() {
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
			}

			renderQueueButton();

			queueBtn.addEventListener('click', () => {
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
					const promptText = promptEl instanceof HTMLTextAreaElement ? (promptEl.value || '') : '';
					persistMutateImageEditDraftToStorage(promptText);
				} catch (_) {}
				const elapsed = performance.now() - start;
				const remaining = Math.max(0, MIN_SPINNER_MS - elapsed);
				setTimeout(() => {
					queueState = 'queued';
					renderQueueButton();
				}, remaining);
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
	const promptEl = document.querySelector('[data-edit-prompt]');
	const prompt = promptEl instanceof HTMLTextAreaElement ? promptEl.value.trim() : '';

	const imageUrl = container?.dataset?.mutateImageUrl || '';
	const sourceIdRaw = container?.dataset?.mutateSourceId || '';

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
		// Clear dirty state so navigation isn't blocked by our leave-confirm.
		isMutateDirty = false;
		btn.disabled = true;
		persistMutateForNextCreatePage({
			prompt,
			mutateOfId,
			normalizedImageUrl,
			published: container?.dataset?.mutatePublished === '1',
		});
		submitCreationWithPending({
			serverId,
			methodKey: MUTATE_DEFAULT_METHOD_KEY,
			mutateOfId,
			args: {
				prompt,
				image_url: normalizedImageUrl,
				model: MUTATE_DEFAULT_MODEL,
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

