let fetchJsonWithStatusDeduped;
let getNsfwContentEnabled;

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

		const nsfwMod = await import(`../../shared/nsfwView.js${qs}`);
		getNsfwContentEnabled = nsfwMod.getNsfwContentEnabled;
	})();
	return _depsPromise;
}

let _runtimePromise;
async function loadCreationDetailRuntime() {
	if (_runtimePromise) return _runtimePromise;
	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	_runtimePromise = import(`../../shared/creationDetailRuntime.js${qs}`);
	return _runtimePromise;
}

let _suggestPromise;
async function loadPublishInlineSuggest() {
	if (_suggestPromise) return _suggestPromise;
	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	_suggestPromise = import(`../../shared/triggeredSuggest.js${qs}`).then((m) => m.attachPromptInlineSuggest);
	return _suggestPromise;
}

let shouldAutoSetVideoPosterOnPublish;
let captureVideoFirstFrameFile;

let _videoPosterDepsPromise;
async function loadVideoPosterDeps() {
	if (_videoPosterDepsPromise) return _videoPosterDepsPromise;
	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	_videoPosterDepsPromise = (async () => {
		const [aspectMod, frameMod] = await Promise.all([
			import(`../../shared/aspectRatio.js${qs}`),
			import(`../../shared/queueFromFrameModal.js${qs}`),
		]);
		shouldAutoSetVideoPosterOnPublish = aspectMod.shouldAutoSetVideoPosterOnPublish;
		captureVideoFirstFrameFile = frameMod.captureVideoFirstFrameFile;
	})();
	return _videoPosterDepsPromise;
}

const html = String.raw;

/**
 * Default NSFW checkbox state for publish/edit modal.
 * - Already marked NSFW → checked.
 * - Prior choice was "not NSFW" (published without NSFW, or edited and unchecked) → unchecked (don't re-tick).
 * - Mutated from NSFW creation → checked.
 * - User in NSFW mode (first-time or no prior choice) → checked.
 * - Otherwise → unchecked.
 * @param {{ nsfw?: boolean, meta?: { nsfw?: boolean }, published?: boolean, published_at?: string|null, mutate_of_nsfw?: boolean }} creation
 * @returns {boolean}
 */
function defaultNsfwChecked(creation) {
	const creationIsNsfw = creation?.nsfw === true || creation?.meta?.nsfw === true;
	if (creationIsNsfw) return true;

	// Respect prior choice: they published without NSFW, or they edited and left it unchecked (meta.nsfw explicitly false).
	const wasPreviouslyPublished = creation?.published === true || (creation?.published_at != null && creation.published_at !== '');
	const explicitNotNsfw = creation?.meta?.nsfw === false;
	if ((wasPreviouslyPublished && !creationIsNsfw) || explicitNotNsfw) return false;

	if (creation?.mutate_of_nsfw === true) return true;
	if (getNsfwContentEnabled()) return true;
	return false;
}

class AppModalPublish extends HTMLElement {
	constructor() {
		super();
		this._isOpen = false;
		this._mode = 'publish'; // 'publish' or 'edit'
		this._creationId = null;
		this._creation = null;
		this._creationPublished = false; // set when opening edit
		this._creationIsVideo = false;
		this._loading = false;
		this._openRequestId = 0;
		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpenPublish = this.handleOpenPublish.bind(this);
		this.handleOpenEdit = this.handleOpenEdit.bind(this);
		this.handleClose = this.handleClose.bind(this);
		this.handleCloseAllModals = this.handleCloseAllModals.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);
	}

	async connectedCallback() {
		await loadDeps();
		this.setAttribute('data-modal', '');
		this.render();
		this.setupEventListeners();
	}

	disconnectedCallback() {
		document.removeEventListener('keydown', this.handleEscape);
		document.removeEventListener('open-publish-modal', this.handleOpenPublish);
		document.removeEventListener('open-edit-modal', this.handleOpenEdit);
		document.removeEventListener('close-publish-modal', this.handleClose);
		document.removeEventListener('close-all-modals', this.handleCloseAllModals);
	}

	render() {
		this.innerHTML = html`
			<div class="publish-modal-overlay">
				<div class="publish-modal">
					<div class="publish-modal-loading">
						<div class="publish-spinner"></div>
					</div>
					<div class="publish-modal-header">
						<h2 data-modal-title>Publish Creation</h2>
						<button class="publish-modal-close" aria-label="Close">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
								stroke-linecap="round" stroke-linejoin="round">
								<line x1="18" y1="6" x2="6" y2="18"></line>
								<line x1="6" y1="6" x2="18" y2="18"></line>
							</svg>
						</button>
					</div>
					<div class="publish-modal-body">
						<div class="publish-alert" data-publish-alert style="display: none;">
							<span class="publish-alert-message" data-publish-alert-message></span>
							<button class="publish-alert-close" data-publish-alert-close aria-label="Close alert">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
									stroke-linecap="round" stroke-linejoin="round">
									<line x1="18" y1="6" x2="6" y2="18"></line>
									<line x1="6" y1="6" x2="18" y2="18"></line>
								</svg>
							</button>
						</div>
						<div class="publish-field">
							<label for="publish-title">Title</label>
							<input type="text" id="publish-title" name="title" placeholder="Enter a title for your creation (optional)"
								autocapitalize="off" autocorrect="off" spellcheck="false" />
						</div>
						<div class="publish-field">
							<label for="publish-description">Description</label>
							<textarea id="publish-description" name="description" rows="8"
								placeholder="Describe your creation..."></textarea>
						</div>
						<div class="publish-field publish-field-checkbox">
							<label class="publish-checkbox-label">
								<input type="checkbox" id="publish-nsfw" name="nsfw" />
								<span>Not Suitable for Work (NSFW)</span>
							</label>
						</div>
						<div class="publish-field publish-field-checkbox" data-doom-full-height-row style="display: none;">
							<label class="publish-checkbox-label">
								<input type="checkbox" id="publish-doom-full-height" name="doom_full_height" />
								<span>Full-height in doom scroll</span>
							</label>
						</div>
					</div>
					<div class="publish-modal-footer">
						<a href="#" class="publish-cancel-link">Cancel</a>
						<button class="btn-primary publish-submit-btn" data-publish-submit disabled>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"
								style="margin-right: 6px; vertical-align: middle;">
								<path d="M1.5 8L14.5 1.5L10.5 14.5L8 9L1.5 8Z" stroke="currentColor" stroke-width="1.5"
									stroke-linecap="round" stroke-linejoin="round" fill="none" />
							</svg>
							<span data-submit-text>Publish</span>
						</button>
					</div>
				</div>
			</div>
		`;
	}

	setupEventListeners() {
		document.addEventListener('keydown', this.handleEscape);
		document.addEventListener('open-publish-modal', this.handleOpenPublish);
		document.addEventListener('open-edit-modal', this.handleOpenEdit);
		document.addEventListener('close-publish-modal', this.handleClose);
		document.addEventListener('close-all-modals', this.handleCloseAllModals);

		const overlay = this.querySelector('.publish-modal-overlay');
		const closeButton = this.querySelector('.publish-modal-close');
		const cancelLink = this.querySelector('.publish-cancel-link');
		const submitBtn = this.querySelector('[data-publish-submit]');
		const alertClose = this.querySelector('[data-publish-alert-close]');

		if (overlay) {
			overlay.addEventListener('click', (e) => {
				if (e.target === overlay && !this._loading) {
					this.close();
				}
			});
		}

		if (closeButton) {
			closeButton.addEventListener('click', () => {
				if (!this._loading) {
					this.close();
				}
			});
		}

		if (cancelLink) {
			cancelLink.addEventListener('click', (e) => {
				e.preventDefault();
				if (!this._loading) {
					this.close();
				}
			});
		}

		if (submitBtn) {
			submitBtn.addEventListener('click', this.handleSubmit);
		}

		if (alertClose) {
			alertClose.addEventListener('click', () => {
				this.hideAlert();
			});
		}

		// @ user and $ style autocomplete on title and description (same triggers as advanced create prompt)
		const titleInput = this.querySelector('#publish-title');
		const descriptionTextarea = this.querySelector('#publish-description');
		loadPublishInlineSuggest().then((attachPromptInlineSuggest) => {
			if (titleInput && typeof attachPromptInlineSuggest === 'function') {
				attachPromptInlineSuggest(titleInput);
			}
			if (descriptionTextarea && typeof attachPromptInlineSuggest === 'function') {
				attachPromptInlineSuggest(descriptionTextarea);
			}
		});
	}

	handleEscape(e) {
		if (e.key === 'Escape' && this.isOpen() && !this._loading) {
			this.close();
		}
	}

	handleOpenPublish(e) {
		const creationId = e.detail?.creationId || null;
		this.openPublish(creationId);
	}

	handleOpenEdit(e) {
		const creationId = e.detail?.creationId || null;
		this.openEdit(creationId);
	}

	handleClose() {
		this.close();
	}

	handleCloseAllModals() {
		this.close();
	}

	isOpen() {
		return this._isOpen;
	}

	setDoomFullHeightFieldState(isVideo, checked = false) {
		this._creationIsVideo = Boolean(isVideo);
		const row = this.querySelector('[data-doom-full-height-row]');
		const checkbox = this.querySelector('#publish-doom-full-height');
		if (row instanceof HTMLElement) {
			row.style.display = this._creationIsVideo ? '' : 'none';
		}
		if (checkbox instanceof HTMLInputElement) {
			checkbox.checked = this._creationIsVideo ? Boolean(checked) : false;
			checkbox.disabled = this._loading || !this._creationIsVideo;
		}
	}

	readDoomFullHeightFromCreation(creation) {
		if (!creation || typeof creation !== 'object') return false;
		const meta = creation.meta && typeof creation.meta === 'object' ? creation.meta : null;
		return meta?.doom_scroll_full_height === true;
	}

	readIsVideoCreation(creation) {
		if (!creation || typeof creation !== 'object') return false;
		if (creation.media_type === 'video') return true;
		const meta = creation.meta && typeof creation.meta === 'object' ? creation.meta : null;
		return meta?.media_type === 'video';
	}

	async openPublish(creationId) {
		this._mode = 'publish';
		this._creationId = creationId;
		this._creation = null;
		this.setDoomFullHeightFieldState(false, false);
		this.updateModalContent();
		this.open();

		if (!creationId) {
			this.showAlert('Invalid creation ID', true);
			return;
		}

		const requestId = ++this._openRequestId;

		try {
			const response = await fetch(`/api/create/images/${creationId}`, {
				credentials: 'include'
			});

			if (!response.ok) {
				throw new Error('Failed to load creation');
			}

			// Ignore stale async results if another open happened.
			if (requestId !== this._openRequestId) return;

			const creation = await response.json();
			this._creation = creation;
			const titleInput = this.querySelector('#publish-title');
			const descriptionTextarea = this.querySelector('#publish-description');

			// Only prefill if still empty (never clobber user typing).
			if (titleInput && !titleInput.value.trim()) {
				titleInput.value = creation.title || '';
			}

			if (descriptionTextarea && !descriptionTextarea.value.trim()) {
				const savedDescription = typeof creation.description === 'string' ? creation.description.trim() : '';
				descriptionTextarea.value = savedDescription || '';
			}

			const nsfwCheckbox = this.querySelector('#publish-nsfw');
			if (nsfwCheckbox) nsfwCheckbox.checked = defaultNsfwChecked(creation);
			this.setDoomFullHeightFieldState(
				this.readIsVideoCreation(creation),
				this.readDoomFullHeightFromCreation(creation)
			);

			// Focus title input
			if (titleInput) {
				setTimeout(() => titleInput.focus(), 100);
			}
		} catch (error) {
			// console.error('Error loading creation:', error);
			this.showAlert('Failed to load creation data', true);
		}
	}

	async openEdit(creationId) {
		this._mode = 'edit';
		this._creationId = creationId;

		if (!creationId) {
			this.showAlert('Invalid creation ID', true);
			return;
		}

		// Fetch current creation data to populate the form
		try {
			const response = await fetch(`/api/create/images/${creationId}`, {
				credentials: 'include'
			});

			if (!response.ok) {
				throw new Error('Failed to load creation');
			}

			const creation = await response.json();
			this._creationPublished = creation.published === true || creation.published === 1;
			const titleInput = this.querySelector('#publish-title');
			const descriptionTextarea = this.querySelector('#publish-description');

			if (titleInput) titleInput.value = creation.title || '';
			if (descriptionTextarea) descriptionTextarea.value = creation.description || '';
			const nsfwCheckbox = this.querySelector('#publish-nsfw');
			if (nsfwCheckbox) nsfwCheckbox.checked = defaultNsfwChecked(creation);
			this.setDoomFullHeightFieldState(
				this.readIsVideoCreation(creation),
				this.readDoomFullHeightFromCreation(creation)
			);

			this.updateModalContent();
			this.open();

			// Focus on title input
			if (titleInput) {
				setTimeout(() => titleInput.focus(), 100);
			}
		} catch (error) {
			// console.error('Error loading creation:', error);
			this.showAlert('Failed to load creation data', true);
		}
	}

	updateModalContent() {
		const titleEl = this.querySelector('[data-modal-title]');
		const submitTextEl = this.querySelector('[data-submit-text]');
		const submitBtn = this.querySelector('[data-publish-submit]');
		const titleInput = this.querySelector('#publish-title');

		if (this._mode === 'edit') {
			if (titleEl) titleEl.textContent = 'Edit Creation';
			if (submitTextEl) submitTextEl.textContent = 'Save Changes';
			if (submitBtn) {
				submitBtn.disabled = false;
				const icon = submitBtn.querySelector('svg path');
				if (icon) icon.setAttribute('d', 'M11.5 2.5L13.5 4.5L5.5 12.5H3.5V10.5L11.5 2.5Z');
			}
			if (titleInput) titleInput.removeAttribute('required');
		} else {
			if (titleEl) titleEl.textContent = 'Publish Creation';
			if (submitTextEl) submitTextEl.textContent = 'Publish';
			if (submitBtn) {
				submitBtn.disabled = false;
				const icon = submitBtn.querySelector('svg path');
				if (icon) icon.setAttribute('d', 'M1.5 8L14.5 1.5L10.5 14.5L8 9L1.5 8Z');
			}
			if (titleInput) titleInput.removeAttribute('required');
		}
	}

	open() {
		if (this._isOpen) return;
		this._isOpen = true;
		const overlay = this.querySelector('.publish-modal-overlay');
		if (overlay) {
			overlay.classList.add('open');
		}
		// Body scroll prevention is handled globally in global.js
		this.hideAlert();
	}

	close() {
		if (!this._isOpen) return;
		this._isOpen = false;
		const overlay = this.querySelector('.publish-modal-overlay');
		if (overlay) {
			overlay.classList.remove('open');
		}
		// Body scroll restoration is handled globally in global.js
		// Clear form
		const titleInput = this.querySelector('#publish-title');
		const descriptionTextarea = this.querySelector('#publish-description');
		const nsfwCheckbox = this.querySelector('#publish-nsfw');
		const doomFullHeightCheckbox = this.querySelector('#publish-doom-full-height');
		const submitBtn = this.querySelector('[data-publish-submit]');
		if (titleInput) titleInput.value = '';
		if (descriptionTextarea) descriptionTextarea.value = '';
		if (nsfwCheckbox) nsfwCheckbox.checked = false;
		if (doomFullHeightCheckbox) doomFullHeightCheckbox.checked = false;
		this.setDoomFullHeightFieldState(false, false);
		if (submitBtn) submitBtn.disabled = true;
		this._creation = null;
		this.hideAlert();
	}

	showAlert(message, isError = true) {
		const alert = this.querySelector('[data-publish-alert]');
		const alertMessage = this.querySelector('[data-publish-alert-message]');
		if (alert && alertMessage) {
			alertMessage.textContent = message;
			alert.className = `publish-alert ${isError ? 'publish-alert-error' : 'publish-alert-success'}`;
			alert.style.display = 'flex';
		}
	}

	hideAlert() {
		const alert = this.querySelector('[data-publish-alert]');
		if (alert) {
			alert.style.display = 'none';
		}
	}

	resetSubmitLoadingUi() {
		const titleInput = this.querySelector('#publish-title');
		const descriptionTextarea = this.querySelector('#publish-description');
		const nsfwCheckbox = this.querySelector('#publish-nsfw');
		const doomFullHeightCheckbox = this.querySelector('#publish-doom-full-height');
		const loadingOverlay = this.querySelector('.publish-modal-loading');
		const submitBtn = this.querySelector('[data-publish-submit]');
		const cancelLink = this.querySelector('.publish-cancel-link');
		if (loadingOverlay) loadingOverlay.classList.remove('active');
		if (titleInput) titleInput.disabled = false;
		if (descriptionTextarea) descriptionTextarea.disabled = false;
		if (nsfwCheckbox) nsfwCheckbox.disabled = false;
		if (doomFullHeightCheckbox) {
			doomFullHeightCheckbox.disabled = !this._creationIsVideo;
		}
		if (submitBtn) submitBtn.disabled = false;
		if (cancelLink) {
			cancelLink.style.pointerEvents = '';
			cancelLink.style.opacity = '';
		}
		this._loading = false;
	}

	async handleSubmit() {
		if (this._loading) return;

		if (!this._creationId) {
			this.showAlert('Invalid creation ID', true);
			return;
		}

		const titleInput = this.querySelector('#publish-title');
		const descriptionTextarea = this.querySelector('#publish-description');
		const nsfwCheckbox = this.querySelector('#publish-nsfw');
		const doomFullHeightCheckbox = this.querySelector('#publish-doom-full-height');
		const loadingOverlay = this.querySelector('.publish-modal-loading');
		const submitBtn = this.querySelector('[data-publish-submit]');
		const cancelLink = this.querySelector('.publish-cancel-link');

		if (!titleInput || !loadingOverlay) return;

		const title = titleInput.value.trim();
		const description = descriptionTextarea ? descriptionTextarea.value.trim() : '';
		const nsfw = nsfwCheckbox ? nsfwCheckbox.checked : false;
		const doomScrollFullHeight = this._creationIsVideo && doomFullHeightCheckbox
			? doomFullHeightCheckbox.checked
			: undefined;

		// Hide any existing alert
		this.hideAlert();

		// Show loading state
		this._loading = true;
		loadingOverlay.classList.add('active');
		titleInput.disabled = true;
		if (descriptionTextarea) descriptionTextarea.disabled = true;
		if (nsfwCheckbox) nsfwCheckbox.disabled = true;
		if (doomFullHeightCheckbox) doomFullHeightCheckbox.disabled = true;
		if (submitBtn) submitBtn.disabled = true;
		if (cancelLink) {
			cancelLink.style.pointerEvents = 'none';
			cancelLink.style.opacity = '0.5';
		}

		try {
			if (this._mode === 'edit') {
				await this.handleEditSubmit(title, description, nsfw, doomScrollFullHeight);
			} else {
				await this.handlePublishSubmit(title, description, nsfw, doomScrollFullHeight);
			}
			const { isCreationDetailEmbed } = await loadCreationDetailRuntime();
			if (isCreationDetailEmbed()) {
				this.resetSubmitLoadingUi();
			}
		} catch (error) {
			// console.error(`Error ${this._mode === 'edit' ? 'updating' : 'publishing'} creation:`, error);
			this.showAlert(error.message || `Failed to ${this._mode === 'edit' ? 'update' : 'publish'} creation. Please try again.`, true);

			// Hide loading state
			loadingOverlay.classList.remove('active');
			titleInput.disabled = false;
			if (descriptionTextarea) descriptionTextarea.disabled = false;
			if (nsfwCheckbox) nsfwCheckbox.disabled = false;
			if (doomFullHeightCheckbox) doomFullHeightCheckbox.disabled = !this._creationIsVideo;
			if (submitBtn) submitBtn.disabled = false;
			if (cancelLink) {
				cancelLink.style.pointerEvents = '';
				cancelLink.style.opacity = '';
			}
			this._loading = false;
		}
	}

	async maybeSetVideoPosterFromFirstFrame() {
		const creation = this._creation;
		const creationId = this._creationId;
		if (!creation || !creationId) return;

		await loadVideoPosterDeps();
		if (typeof shouldAutoSetVideoPosterOnPublish !== 'function' || !shouldAutoSetVideoPosterOnPublish(creation)) {
			return;
		}
		if (typeof captureVideoFirstFrameFile !== 'function') return;

		const videoUrl = typeof creation.video_url === 'string' ? creation.video_url.trim() : '';
		if (!videoUrl) return;

		const heroVideo = document.querySelector('video[data-video]');
		const useHeroVideo =
			heroVideo instanceof HTMLVideoElement &&
			heroVideo.videoWidth > 0 &&
			heroVideo.videoHeight > 0;
		const { file, width, height } = await captureVideoFirstFrameFile(
			videoUrl,
			Number(creationId),
			{ existingVideo: useHeroVideo ? heroVideo : null }
		);

		const formData = new FormData();
		formData.append('image', file);
		formData.append('video_width', String(width));
		formData.append('video_height', String(height));
		const res = await fetch(`/api/create/images/${creationId}/video-placeholder`, {
			method: 'POST',
			credentials: 'include',
			body: formData,
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new Error(data?.message || data?.error || 'Could not set video poster');
		}

		document.dispatchEvent(new CustomEvent('creation-video-placeholder-updated', {
			detail: {
				creationId: Number(creationId),
				url: data?.url,
				width: data?.width,
				height: data?.height,
			},
		}));
	}

	async handlePublishSubmit(title, description, nsfw, doomScrollFullHeight) {
		try {
			await this.maybeSetVideoPosterFromFirstFrame();
		} catch {
			// Best-effort: publish even if poster capture fails (user can set poster manually).
		}

		const response = await fetch(`/api/create/images/${this._creationId}/publish`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				title,
				description,
				nsfw,
				doom_scroll_full_height: doomScrollFullHeight
			}),
			credentials: 'include'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to publish creation');
		}

		this.close();
		const { refreshAfterMutation, isCreationDetailEmbed, navigate } = await loadCreationDetailRuntime();
		if (isCreationDetailEmbed()) {
			await refreshAfterMutation('published', { creationId: this._creationId });
			return;
		}

		navigate(`/creations/${this._creationId}`);
	}

	async handleEditSubmit(title, description, nsfw, doomScrollFullHeight) {
		const response = await fetch(`/api/create/images/${this._creationId}`, {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				title,
				description,
				nsfw,
				doom_scroll_full_height: doomScrollFullHeight
			}),
			credentials: 'include'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to update creation');
		}

		this.close();
		const { refreshAfterMutation, isCreationDetailEmbed } = await loadCreationDetailRuntime();
		await refreshAfterMutation('edited', {
			creationId: this._creationId,
			standaloneReload: !isCreationDetailEmbed(),
		});
	}
}

customElements.define('app-modal-publish', AppModalPublish);
