/**
 * /styles/:slug — load style from API and show title, slug, description, modifiers.
 * /styles/new — form to add a global catalog style (admin / founder).
 *
 * create-styles + avatar load via dynamic import with ?v= so they cache-bust with the page (static
 * sibling imports from a versioned entry URL do not inherit ?v= in browsers).
 */

const STYLE_TAG_RE = /^(?=.*[a-z])[a-z0-9][a-z0-9_-]{0,63}$/;

function getAssetVersionQs() {
	const v = document.querySelector('meta[name="asset-version"]')?.getAttribute("content")?.trim() || "";
	return v ? `?v=${encodeURIComponent(v)}` : "";
}

let styleDetailDepsPromise = null;

async function ensureStyleDetailDeps() {
	if (!styleDetailDepsPromise) {
		const qs = getAssetVersionQs();
		styleDetailDepsPromise = Promise.all([
			import(`./create-styles.js${qs}`),
			import(`../shared/avatar.js${qs}`),
			import(`../icons/svg-strings.js${qs}`)
		]).then(([cs, av, icons]) => ({
			getStyleThumbUrl: cs.getStyleThumbUrl,
			getAvatarColor: av.getAvatarColor,
			pencilIcon: icons.pencilIcon
		}));
	}
	return styleDetailDepsPromise;
}

function escapeHtml(text) {
	return String(text ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Prefer API `message`, then non-generic `error`, else fallback (e.g. plain "Forbidden"). */
function apiErrorMessageFromResponse(data, fallback) {
	const msg = typeof data?.message === "string" ? data.message.trim() : "";
	if (msg) return msg;
	const err = typeof data?.error === "string" ? data.error.trim() : "";
	if (err && err !== "Forbidden") return err;
	return fallback;
}

function isNewStylePath() {
	const p = (window.location.pathname || "").replace(/\/+$/, "");
	return p === "/styles/new";
}

function getSlugFromPath() {
	const pathname = window.location.pathname || "";
	const m = pathname.match(/^\/styles\/([^/]+)\/?$/);
	return m ? String(m[1] || "").trim().toLowerCase() : "";
}

function renderError(root, loading, errRoot, message) {
	if (loading) loading.hidden = true;
	if (root) root.hidden = true;
	if (!errRoot) return;
	errRoot.hidden = false;
	errRoot.innerHTML = `
		<div class="route-empty-state">
			<h2 class="route-empty-title">${escapeHtml(message)}</h2>
			<p class="route-empty-message">This style is not in your library, or the link may be wrong.</p>
			<p class="route-empty-message"><a href="/prompt-library#styles" class="route-empty-button">See All Styles</a></p>
		</div>
	`;
}

function wireStyleThumbModal(root, tag) {
	if (!root) return;
	const hit = root.querySelector("[data-style-thumb-hit]");
	const modalRoot = root.querySelector("[data-style-thumb-modal-root]");
	const input = root.querySelector("[data-style-thumb-modal-input]");
	const errEl = root.querySelector("[data-style-thumb-modal-error]");
	const saveBtn = root.querySelector("[data-style-thumb-modal-save]");
	const cancelBtn = root.querySelector("[data-style-thumb-modal-cancel]");
	const dismissEls = root.querySelectorAll("[data-style-thumb-modal-dismiss]");

	if (
		!(hit instanceof HTMLElement) ||
		!(modalRoot instanceof HTMLElement) ||
		!(input instanceof HTMLInputElement) ||
		!(errEl instanceof HTMLElement) ||
		!(saveBtn instanceof HTMLButtonElement) ||
		!(cancelBtn instanceof HTMLButtonElement)
	) {
		return;
	}

	const removeBtn = root.querySelector("[data-style-thumb-modal-remove]");

	function showErr(msg) {
		errEl.textContent = msg || "";
		errEl.hidden = !msg;
	}

	function openModal() {
		showErr("");
		const hero = root.querySelector(".style-detail-hero");
		const prefill = String(hero?.dataset.styleThumbCreationPrefill ?? "").trim();
		input.value = prefill;
		modalRoot.hidden = false;
		requestAnimationFrame(() => input.focus());
	}

	function closeModal() {
		modalRoot.hidden = true;
		showErr("");
	}

	hit.addEventListener("click", () => openModal());
	cancelBtn.addEventListener("click", () => closeModal());
	for (const el of dismissEls) {
		el.addEventListener("click", () => closeModal());
	}
	modalRoot.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.preventDefault();
			closeModal();
		}
	});

	if (removeBtn instanceof HTMLButtonElement) {
		removeBtn.addEventListener("click", () => {
			if (!window.confirm("Remove the custom image for this style? The default or letter placeholder will show instead.")) {
				return;
			}
			showErr("");
			void (async () => {
				removeBtn.disabled = true;
				saveBtn.disabled = true;
				try {
					const res = await fetch(`/api/styles/${encodeURIComponent(tag)}`, {
						method: "PATCH",
						credentials: "include",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ clear_thumb: true })
					});
					const data = await res.json().catch(() => ({}));
					if (res.status === 401) {
						window.location.href = `/auth.html?returnUrl=${encodeURIComponent(window.location.pathname)}`;
						return;
					}
					if (res.status === 403) {
						showErr(
							apiErrorMessageFromResponse(
								data,
								"You don't have permission to change this style image."
							)
						);
						return;
					}
					if (!res.ok) {
						const msg =
							typeof data?.message === "string"
								? data.message
								: typeof data?.error === "string"
									? data.error
									: "Could not remove image.";
						showErr(msg);
						return;
					}
					closeModal();
					window.location.reload();
				} catch {
					showErr("Could not remove image.");
				} finally {
					removeBtn.disabled = false;
					saveBtn.disabled = false;
				}
			})();
		});
	}

	saveBtn.addEventListener("click", () => {
		const link = String(input.value ?? "").trim();
		if (!link) {
			showErr("Paste a creation link or id.");
			return;
		}
		showErr("");
		void (async () => {
			saveBtn.disabled = true;
			if (removeBtn instanceof HTMLButtonElement) removeBtn.disabled = true;
			try {
				const res = await fetch(`/api/styles/${encodeURIComponent(tag)}`, {
					method: "PATCH",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ creation_link: link })
				});
				const data = await res.json().catch(() => ({}));
				if (res.status === 401) {
					window.location.href = `/auth.html?returnUrl=${encodeURIComponent(window.location.pathname)}`;
					return;
				}
				if (res.status === 403) {
					showErr(
						apiErrorMessageFromResponse(data, "You don't have permission to set this style image.")
					);
					return;
				}
				if (!res.ok) {
					const msg =
						typeof data?.message === "string"
							? data.message
							: typeof data?.error === "string"
								? data.error
								: "Could not save image.";
					showErr(msg);
					return;
				}
				closeModal();
				window.location.reload();
			} catch {
				showErr("Could not save image.");
			} finally {
				saveBtn.disabled = false;
				if (removeBtn instanceof HTMLButtonElement) removeBtn.disabled = false;
			}
		})();
	});
}

function wireStyleEditModal(root, style) {
	if (!root || !style || typeof style !== "object") return;
	const tag = String(style.tag ?? "").trim().toLowerCase();
	if (!tag) return;
	const openBtn = root.querySelector("[data-style-edit-open]");
	const modalRoot = root.querySelector("[data-style-edit-modal-root]");
	const form = root.querySelector("[data-style-edit-form]");
	const errEl = root.querySelector("[data-style-edit-error]");
	const cancelBtn = root.querySelector("[data-style-edit-cancel]");
	const submitBtn = root.querySelector("[data-style-edit-submit]");
	const dismissEls = root.querySelectorAll("[data-style-edit-dismiss]");
	if (
		!(openBtn instanceof HTMLButtonElement) ||
		!(modalRoot instanceof HTMLElement) ||
		!(form instanceof HTMLFormElement) ||
		!(errEl instanceof HTMLElement)
	) {
		return;
	}

	function showErr(msg) {
		errEl.textContent = msg || "";
		errEl.hidden = !msg;
	}

	function openModal() {
		showErr("");
		modalRoot.hidden = false;
		const firstInput = form.querySelector("input, textarea, select");
		if (firstInput instanceof HTMLElement) {
			requestAnimationFrame(() => firstInput.focus());
		}
	}

	function closeModal() {
		modalRoot.hidden = true;
		showErr("");
	}

	openBtn.addEventListener("click", () => openModal());
	if (cancelBtn instanceof HTMLElement) {
		cancelBtn.addEventListener("click", () => closeModal());
	}
	for (const el of dismissEls) {
		el.addEventListener("click", () => closeModal());
	}
	modalRoot.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.preventDefault();
			closeModal();
		}
	});

	form.addEventListener("submit", (e) => {
		e.preventDefault();
		showErr("");
		const fd = new FormData(form);
		const injectionText = String(fd.get("injection_text") ?? "").trim();
		if (!injectionText) {
			showErr("Prompt modifiers are required.");
			return;
		}
		const payload = {
			title: String(fd.get("title") ?? "").trim() || null,
			description: String(fd.get("description") ?? "").trim() || null,
			visibility: String(fd.get("visibility") ?? "public").trim().toLowerCase(),
			injection_text: injectionText
		};
		if (payload.visibility !== "public" && payload.visibility !== "unlisted") {
			showErr("Visibility must be public or unlisted.");
			return;
		}
		const creationLink = String(fd.get("creation_link") ?? "").trim();
		const prefillSaved = String(form.getAttribute("data-style-creation-link-prefill") || "").trim();
		if (creationLink && creationLink !== prefillSaved) {
			payload.creation_link = creationLink;
		}

		void (async () => {
			if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;
			try {
				const res = await fetch(`/api/styles/${encodeURIComponent(tag)}`, {
					method: "PATCH",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload)
				});
				const data = await res.json().catch(() => ({}));
				if (res.status === 401) {
					window.location.href = `/auth.html?returnUrl=${encodeURIComponent(window.location.pathname)}`;
					return;
				}
				if (res.status === 403) {
					showErr(apiErrorMessageFromResponse(data, "You don't have permission to edit this style."));
					return;
				}
				if (!res.ok) {
					const msg =
						typeof data?.message === "string"
							? data.message
							: typeof data?.error === "string"
								? data.error
								: "Could not save style.";
					showErr(msg);
					return;
				}
				closeModal();
				window.location.reload();
			} catch {
				showErr("Could not save style.");
			} finally {
				if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
			}
		})();
	});
}

function renderStyle(root, loading, errRoot, style, adminCanDelete, canSetStyleThumb, canEditStyle, deps) {
	if (loading) loading.hidden = true;
	if (errRoot) errRoot.hidden = true;
	if (!root) return;
	root.hidden = false;

	const getStyleThumbUrl = deps?.getStyleThumbUrl;
	const getAvatarColor = deps?.getAvatarColor;
	const pencilIcon = typeof deps?.pencilIcon === "function" ? deps.pencilIcon : null;
	const thumbFromPreset =
		typeof getStyleThumbUrl === "function" ? getStyleThumbUrl : () => "";
	const colorFromSeed = typeof getAvatarColor === "function" ? getAvatarColor : () => "#6b7280";

	const tag = String(style.tag ?? "");
	const displayTitle = (style.title && String(style.title).trim()) || tag;
	const catalogThumb =
		typeof style.style_thumb_url === "string" ? style.style_thumb_url.trim() : "";
	const thumbUrl = catalogThumb || thumbFromPreset(tag);
	const vis = style.visibility ? String(style.visibility) : "";
	const desc = style.description && String(style.description).trim();
	const mods = style.injection_text && String(style.injection_text).trim();
	const thumbInitial = (String(displayTitle || tag).trim().charAt(0) || "?").toUpperCase();
	const thumbPlaceholderBg = colorFromSeed(tag);
	const thumbCreationIdRaw = style.style_thumb_creation_id;
	const thumbCreationId =
		thumbCreationIdRaw != null &&
		Number.isFinite(Number(thumbCreationIdRaw)) &&
		Number(thumbCreationIdRaw) > 0
			? Number(thumbCreationIdRaw)
			: null;
	const savedCreationLinkPath = thumbCreationId ? `/creations/${thumbCreationId}` : "";
	const heroThumbPrefillAttr =
		savedCreationLinkPath !== ""
			? ` data-style-thumb-creation-prefill="${escapeHtml(savedCreationLinkPath)}"`
			: "";

	document.title = `${displayTitle} — parascene`;

	const thumbBlock = thumbUrl
		? `<img class="style-detail-thumb" src="${escapeHtml(thumbUrl)}" alt="" width="140" height="160" loading="eager" decoding="async" />`
		: `<span class="style-detail-thumb style-detail-thumb--placeholder" style="--style-detail-thumb-placeholder-bg: ${thumbPlaceholderBg};" aria-hidden="true">${escapeHtml(thumbInitial)}</span>`;

	const thumbWrap = canSetStyleThumb
		? `<button type="button" class="style-detail-thumb-hit" data-style-thumb-hit aria-label="Set style image from a creation">${thumbBlock}</button>`
		: thumbBlock;

	const hasCustomCatalogThumb = Boolean(catalogThumb);
	const removeBtnHtml = hasCustomCatalogThumb
		? `<button type="button" class="style-detail-thumb-modal-remove" data-style-thumb-modal-remove>Remove image</button>`
		: "";

	const thumbModal = canSetStyleThumb
		? `
		<div class="style-detail-thumb-modal" hidden data-style-thumb-modal-root>
			<div class="style-detail-thumb-modal-overlay" data-style-thumb-modal-dismiss tabindex="-1" aria-hidden="true"></div>
			<div class="style-detail-thumb-modal-panel" role="dialog" aria-modal="true" aria-labelledby="style-thumb-modal-title">
				<h2 id="style-thumb-modal-title" class="style-detail-thumb-modal-title">Style image</h2>
				<p class="style-detail-thumb-modal-hint">Paste a link to a published creation (for example <code>/creations/123</code>). That image will represent this style in the Prompt Library.</p>
				<label class="style-detail-thumb-modal-label" for="style-thumb-modal-input">Creation link</label>
				<input id="style-thumb-modal-input" type="text" class="style-detail-thumb-modal-input" data-style-thumb-modal-input placeholder="/creations/123" autocomplete="off" />
				<p class="style-detail-thumb-modal-error" data-style-thumb-modal-error hidden role="alert"></p>
				<div class="style-detail-thumb-modal-actions">
					${removeBtnHtml}
					<span class="style-detail-thumb-modal-actions-spacer"></span>
					<button type="button" class="style-detail-form-cancel" data-style-thumb-modal-cancel>Cancel</button>
					<button type="button" class="btn-primary" data-style-thumb-modal-save>Save</button>
				</div>
			</div>
		</div>`
		: "";

	const editIconSvg = pencilIcon ? pencilIcon("style-detail-edit-icon") : "";
	const editBtnHtml = canEditStyle
		? `<button type="button" class="style-detail-edit-open" data-style-edit-open aria-label="Edit style">${editIconSvg}<span>Edit</span></button>`
		: "";
	const editModal = canEditStyle
		? `
		<div class="style-detail-thumb-modal style-detail-editor-modal" hidden data-style-edit-modal-root>
			<div class="style-detail-thumb-modal-overlay" data-style-edit-dismiss tabindex="-1" aria-hidden="true"></div>
			<div class="style-detail-thumb-modal-panel style-detail-editor-modal-panel" role="dialog" aria-modal="true" aria-labelledby="style-editor-modal-title">
				<h2 id="style-editor-modal-title" class="style-detail-thumb-modal-title">Edit style</h2>
				<form class="style-detail-form style-detail-form--modal" data-style-edit-form data-style-creation-link-prefill="${escapeHtml(savedCreationLinkPath)}">
					<p class="style-detail-form-error" data-style-edit-error hidden role="alert"></p>
					<div class="field">
						<label for="style-edit-title">Title <span class="style-detail-optional">(optional)</span></label>
						<input id="style-edit-title" name="title" type="text" class="style-detail-form-input" autocomplete="off" maxlength="200" value="${escapeHtml(style.title ?? "")}" />
					</div>
					<div class="field">
						<label for="style-edit-description">Description <span class="style-detail-optional">(optional)</span></label>
						<textarea id="style-edit-description" name="description" class="style-detail-form-input" rows="3" maxlength="2000">${escapeHtml(style.description ?? "")}</textarea>
					</div>
					<div class="field">
						<label for="style-edit-visibility">Visibility</label>
						<select id="style-edit-visibility" name="visibility" class="style-detail-form-select">
							<option value="public"${vis === "public" ? " selected" : ""}>Public (listed for everyone)</option>
							<option value="unlisted"${vis === "unlisted" ? " selected" : ""}>Unlisted (usable with $tag, not promoted in lists)</option>
						</select>
					</div>
					<div class="field">
						<label for="style-edit-modifiers">Prompt modifiers</label>
						<textarea id="style-edit-modifiers" name="injection_text" class="style-detail-form-input style-detail-form-modifiers" required rows="10" maxlength="32000">${escapeHtml(mods || "")}</textarea>
					</div>
					<div class="field">
						<label for="style-edit-creation-link">Style image from creation <span class="style-detail-optional">(optional)</span></label>
						<input id="style-edit-creation-link" name="creation_link" type="text" class="style-detail-form-input" autocomplete="off" placeholder="/creations/123" value="${escapeHtml(savedCreationLinkPath)}" />
						<span class="style-detail-hint">Pre-filled when we know the source creation. Leave as-is to skip re-processing the image.</span>
					</div>
					<div class="style-detail-thumb-modal-actions">
						<span class="style-detail-thumb-modal-actions-spacer"></span>
						<button type="button" class="style-detail-form-cancel" data-style-edit-cancel data-style-edit-dismiss>Cancel</button>
						<button type="submit" class="btn-primary" data-style-edit-submit>Save changes</button>
					</div>
				</form>
			</div>
		</div>`
		: "";

	root.innerHTML = `
		<div class="style-detail-hero"${heroThumbPrefillAttr}>
			${thumbWrap}
			<div class="style-detail-identity">
				<div class="style-detail-title-row">
					<h1 class="style-detail-title">${escapeHtml(displayTitle)}</h1>
					${editBtnHtml}
				</div>
				<p class="style-detail-slug">Use in prompts: <code>$${escapeHtml(tag)}</code></p>
				${vis ? `<p class="style-detail-meta">Visibility: ${escapeHtml(vis)}</p>` : ""}
			</div>
		</div>
		${desc ? `<p class="style-detail-description">${escapeHtml(desc)}</p>` : `<p class="style-detail-description">A preset style you can apply by typing <code>$${escapeHtml(tag)}</code> in your prompt. The model receives the modifiers below (in addition to your text).</p>`}
		<h2 class="style-detail-section-title">Prompt modifiers</h2>
		<pre class="style-detail-modifiers" role="region" aria-label="Style modifier text">${mods ? escapeHtml(mods) : escapeHtml("(No modifier text stored for this style.)")}</pre>
		<div class="style-detail-footer">
			<div class="style-detail-footer-inner">
				${
					adminCanDelete
						? `<button type="button" class="btn-danger style-detail-delete" data-style-delete aria-label="Delete style from catalog">Delete style</button>`
						: ""
				}
				<a href="/prompt-library#styles" class="btn-outlined">See All Styles</a>
			</div>
		</div>
		${thumbModal}
		${editModal}
	`;

	if (canSetStyleThumb) {
		wireStyleThumbModal(root, tag);
	}
	if (canEditStyle) {
		wireStyleEditModal(root, style);
	}

	const thumbEl = root.querySelector(".style-detail-thumb");
	if (thumbEl instanceof HTMLImageElement) {
		thumbEl.addEventListener("error", () => {
			const ph = document.createElement("span");
			ph.className = "style-detail-thumb style-detail-thumb--placeholder";
			ph.style.setProperty("--style-detail-thumb-placeholder-bg", colorFromSeed(tag));
			ph.setAttribute("aria-hidden", "true");
			ph.textContent = thumbInitial;
			thumbEl.replaceWith(ph);
		});
	}

	const deleteBtn = root.querySelector("[data-style-delete]");
	if (deleteBtn instanceof HTMLButtonElement) {
		deleteBtn.addEventListener("click", () => {
			if (
				!window.confirm(
					`Remove this style ($${tag}) from the catalog for everyone? This cannot be undone.`
				)
			) {
				return;
			}
			void (async () => {
				deleteBtn.disabled = true;
				try {
					const res = await fetch(`/api/styles/${encodeURIComponent(tag)}`, {
						method: "DELETE",
						credentials: "include"
					});
					const data = await res.json().catch(() => ({}));
					if (res.status === 403) {
						window.alert("You don't have permission to delete this style.");
						deleteBtn.disabled = false;
						return;
					}
					if (!res.ok) {
						const msg = typeof data?.error === "string" ? data.error : "Could not delete style.";
						window.alert(msg);
						deleteBtn.disabled = false;
						return;
					}
					window.location.href = "/prompt-library#styles";
				} catch {
					deleteBtn.disabled = false;
					window.alert("Could not delete style.");
				}
			})();
		});
	}
}

function renderNewStyleForbidden(root, loading, errRoot) {
	if (loading) loading.hidden = true;
	if (root) root.hidden = true;
	if (!errRoot) return;
	errRoot.hidden = false;
	document.title = "New style — parascene";
	errRoot.innerHTML = `
		<div class="route-empty-state">
			<h2 class="route-empty-title">Not allowed</h2>
			<p class="route-empty-message">Only admins and Founder-tier users can add catalog styles.</p>
			<p class="route-empty-message"><a href="/prompt-library#styles" class="route-empty-button">See All Styles</a></p>
		</div>
	`;
}

function renderNewStyleForm(root, loading, errRoot) {
	if (loading) loading.hidden = true;
	if (errRoot) errRoot.hidden = true;
	if (!root) return;
	root.hidden = false;
	document.title = "New style — parascene";

	root.innerHTML = `
		<h1 class="style-detail-title style-detail-title--form">New style</h1>
		<p class="style-detail-description">Add a global preset. It appears in the Prompt Library for everyone. Prompts use <code>$tag</code> in the text.</p>
		<form class="style-detail-form" data-style-new-form>
			<p class="style-detail-form-error" data-style-new-error hidden role="alert"></p>
			<div class="field">
				<label for="style-new-tag">Style tag (slug)</label>
				<input id="style-new-tag" name="tag" type="text" class="style-detail-form-input" required autocomplete="off" placeholder="e.g. watercolor-sketch" maxlength="64" />
				<span class="style-detail-hint">Lowercase letters, numbers, hyphens, underscores. Must include at least one letter.</span>
			</div>
			<div class="field">
				<label for="style-new-title">Title <span class="style-detail-optional">(optional)</span></label>
				<input id="style-new-title" name="title" type="text" class="style-detail-form-input" autocomplete="off" maxlength="200" />
			</div>
			<div class="field">
				<label for="style-new-description">Description <span class="style-detail-optional">(optional)</span></label>
				<textarea id="style-new-description" name="description" class="style-detail-form-input" rows="3" maxlength="2000"></textarea>
			</div>
			<div class="field">
				<label for="style-new-visibility">Visibility</label>
				<select id="style-new-visibility" name="visibility" class="style-detail-form-select">
					<option value="public" selected>Public (listed for everyone)</option>
					<option value="unlisted">Unlisted (usable with $tag, not promoted in lists)</option>
				</select>
			</div>
			<div class="field">
				<label for="style-new-modifiers">Prompt modifiers</label>
				<textarea id="style-new-modifiers" name="injection_text" class="style-detail-form-input style-detail-form-modifiers" required rows="10" maxlength="32000" placeholder="Text appended for the model when this style is active."></textarea>
			</div>
			<div class="field">
				<label for="style-new-creation-link">Style image from creation <span class="style-detail-optional">(optional)</span></label>
				<input id="style-new-creation-link" name="creation_link" type="text" class="style-detail-form-input" autocomplete="off" placeholder="/creations/123" />
				<span class="style-detail-hint">Paste a published creation link or id to set the style image while saving.</span>
			</div>
			<div class="style-detail-footer style-detail-footer--form">
				<div class="style-detail-footer-inner">
					<a href="/prompt-library#styles" class="style-detail-form-cancel">Cancel</a>
					<button type="submit" class="btn-primary" data-style-new-submit>Save style</button>
				</div>
			</div>
		</form>
	`;

	const form = root.querySelector("[data-style-new-form]");
	const errEl = root.querySelector("[data-style-new-error]");
	const submitBtn = root.querySelector("[data-style-new-submit]");

	if (!(form instanceof HTMLFormElement) || !(errEl instanceof HTMLElement)) return;

	function showError(msg) {
		errEl.textContent = msg || "";
		errEl.hidden = !msg;
	}

	form.addEventListener("submit", (e) => {
		e.preventDefault();
		showError("");
		const fd = new FormData(form);
		const tag = String(fd.get("tag") ?? "")
			.trim()
			.toLowerCase();
		if (tag === "new") {
			showError('The tag "new" is reserved. Pick another slug.');
			return;
		}
		if (!STYLE_TAG_RE.test(tag)) {
			showError("Invalid tag. Use lowercase letters, numbers, hyphens, and underscores; include at least one letter.");
			return;
		}
		const injectionText = String(fd.get("injection_text") ?? "").trim();
		if (!injectionText) {
			showError("Prompt modifiers are required.");
			return;
		}
		const title = String(fd.get("title") ?? "").trim();
		const description = String(fd.get("description") ?? "").trim();
		const visibility = String(fd.get("visibility") ?? "public").trim().toLowerCase();
		const creationLink = String(fd.get("creation_link") ?? "").trim();

		void (async () => {
			if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;
			try {
				const res = await fetch("/api/styles", {
					method: "POST",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						tag,
						title: title || null,
						description: description || null,
						injection_text: injectionText,
						visibility
					})
				});
				const data = await res.json().catch(() => ({}));
				if (res.status === 401) {
					window.location.href = `/auth.html?returnUrl=${encodeURIComponent(window.location.pathname)}`;
					return;
				}
				if (res.status === 403) {
					showError("You don't have permission to add styles.");
					return;
				}
				if (res.status === 409) {
					showError(typeof data?.error === "string" ? data.error : "A style with this tag already exists.");
					return;
				}
				if (!res.ok) {
					showError(typeof data?.error === "string" ? data.error : "Could not save style.");
					return;
				}
				const savedTag = typeof data?.tag === "string" ? data.tag : tag;
				if (creationLink) {
					const thumbRes = await fetch(`/api/styles/${encodeURIComponent(savedTag)}`, {
						method: "PATCH",
						credentials: "include",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ creation_link: creationLink })
					});
					const thumbData = await thumbRes.json().catch(() => ({}));
					if (!thumbRes.ok) {
						const msg =
							typeof thumbData?.message === "string"
								? thumbData.message
								: typeof thumbData?.error === "string"
									? thumbData.error
									: "Style was saved but image could not be set.";
						showError(msg);
						return;
					}
				}
				window.location.href = `/styles/${encodeURIComponent(savedTag)}`;
			} catch {
				showError("Could not save style.");
			} finally {
				if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
			}
		})();
	});
}

async function loadNewStylePage() {
	const loading = document.querySelector("[data-style-detail-loading]");
	const root = document.querySelector("[data-style-detail-root]");
	const errRoot = document.querySelector("[data-style-detail-error]");

	try {
		const res = await fetch("/api/styles/new", { credentials: "include" });
		const data = await res.json().catch(() => ({}));

		if (res.status === 401) {
			window.location.href = `/auth.html?returnUrl=${encodeURIComponent(window.location.pathname)}`;
			return;
		}
		if (!res.ok) {
			renderError(root, loading, errRoot, typeof data?.error === "string" ? data.error : "Could not load.");
			return;
		}
		if (!data?.canCreate) {
			renderNewStyleForbidden(root, loading, errRoot);
			return;
		}
		renderNewStyleForm(root, loading, errRoot);
	} catch {
		renderError(root, loading, errRoot, "Could not load.");
	}
}

async function loadExistingStyle(deps) {
	const loading = document.querySelector("[data-style-detail-loading]");
	const root = document.querySelector("[data-style-detail-root]");
	const errRoot = document.querySelector("[data-style-detail-error]");
	const slug = getSlugFromPath();

	if (!slug || !STYLE_TAG_RE.test(slug)) {
		renderError(root, loading, errRoot, "Invalid style");
		return;
	}

	try {
		const res = await fetch(`/api/styles/${encodeURIComponent(slug)}`, { credentials: "include" });
		const data = await res.json().catch(() => ({}));

		if (res.status === 401) {
			window.location.href = `/auth.html?returnUrl=${encodeURIComponent(window.location.pathname)}`;
			return;
		}
		if (res.status === 404) {
			renderError(root, loading, errRoot, "Style not found");
			return;
		}
		if (!res.ok) {
			const msg = typeof data?.error === "string" ? data.error : "Could not load style.";
			renderError(root, loading, errRoot, msg);
			return;
		}

		const style = data?.style;
		if (!style || typeof style !== "object") {
			renderError(root, loading, errRoot, "Style not found");
			return;
		}

		const adminCanDelete = Boolean(data?.adminCanDelete);
		const canSetStyleThumb = Boolean(data?.canSetStyleThumb);
		const canEditStyle = Boolean(data?.canEditStyle);
		renderStyle(root, loading, errRoot, style, adminCanDelete, canSetStyleThumb, canEditStyle, deps);
	} catch {
		renderError(root, loading, errRoot, "Could not load style.");
	}
}

async function load() {
	if (isNewStylePath()) {
		await loadNewStylePage();
		return;
	}
	const deps = await ensureStyleDetailDeps();
	await loadExistingStyle(deps);
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => void load());
} else {
	void load();
}
