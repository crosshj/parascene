/**
 * Prompt library — one GET /api/prompt-injections payload; tabs filter by tag_type (client-side).
 * URL hash: #styles | #personas switches tabs (e.g. /prompt-library#styles).
 * Seeds <app-tabs active> from the hash before the element upgrades (race with entry.js); then
 * applies again after customElements.whenDefined so the correct tab always wins over the HTML default.
 *
 * Icons come from svg-strings.js via dynamic import with ?v= (same as avatar / create-styles) so the
 * dependency is cache-busted with the page and stays in sync with named exports.
 */

/** Aligned with GET /api/styles/:slug — digit-leading OK if slug contains a letter (not $100). */
const STYLE_TAG_RE = /^(?=.*[a-z])[a-z0-9][a-z0-9_-]{0,63}$/;
const PERSONA_TAG_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/;

function hashTabIdFromLocation() {
	return (window.location.hash || "").replace(/^#/, "").trim().toLowerCase();
}

function applyPromptLibraryTabFromHash() {
	const raw = hashTabIdFromLocation();
	if (raw !== "styles" && raw !== "personas") return;
	const tabsEl = document.querySelector("app-tabs");
	if (!tabsEl || typeof tabsEl.setActiveTab !== "function") return;
	tabsEl.setActiveTab(raw, { focus: false });
}

/** Before app-tabs is defined, hydrate() reads `active`; set it from the hash so #personas wins over markup. */
function seedPromptLibraryTabsActiveFromHash() {
	const raw = hashTabIdFromLocation();
	if (raw !== "styles" && raw !== "personas") return;
	if (customElements.get("app-tabs")) return;
	const el = document.querySelector("app-tabs");
	if (el) el.setAttribute("active", raw);
}

function queueApplyPromptLibraryTabFromHash() {
	void customElements.whenDefined("app-tabs").then(() => {
		queueMicrotask(() => {
			requestAnimationFrame(() => applyPromptLibraryTabFromHash());
		});
	});
}

function setupPromptLibraryTabsHashSync() {
	const tabsEl = document.querySelector("app-tabs");
	if (!tabsEl || tabsEl.dataset.promptLibraryHashSync === "1") return;
	tabsEl.dataset.promptLibraryHashSync = "1";
	tabsEl.addEventListener("tab-change", (e) => {
		const id = String(e.detail?.id ?? "").trim().toLowerCase();
		if (id !== "styles" && id !== "personas") return;
		if (hashTabIdFromLocation() === id) return;
		window.location.hash = id;
	});
}

function escapeHtml(text) {
	return String(text ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function parseInjectionMeta(raw) {
	if (raw == null) return {};
	if (typeof raw === "object" && !Array.isArray(raw)) return raw;
	if (typeof raw !== "string" || !raw.trim()) return {};
	try {
		const o = JSON.parse(raw);
		return o && typeof o === "object" && !Array.isArray(o) ? o : {};
	} catch {
		return {};
	}
}

function renderPersonaRows(tbody, rows, getAvatarColor, copyKeySvg, viewDetailSvg) {
	if (!tbody) return;
	const copySvg = typeof copyKeySvg === "string" ? copyKeySvg : "";
	const eyeSvg = typeof viewDetailSvg === "string" ? viewDetailSvg : "";
	if (!rows.length) {
		tbody.innerHTML = `<tr><td colspan="3" class="prompt-library-table-empty">No items yet.</td></tr>`;
		return;
	}
	const colorFn = typeof getAvatarColor === "function" ? getAvatarColor : () => "#6b7280";
	tbody.innerHTML = rows
		.map((row) => {
			const id = row.id != null ? String(row.id) : "";
			const rawTag = String(row.tag ?? "").trim();
			const canonicalTag = rawTag.toLowerCase();
			const tagAttr = escapeHtml(canonicalTag);
			const tagHtml = escapeHtml(rawTag || canonicalTag);
			const title = String(row.title ?? "").trim();
			const displayLabel = title || rawTag || canonicalTag;
			const initial = (displayLabel.charAt(0) || "?").toUpperCase();
			const meta = parseInjectionMeta(row.meta);
			const avatarUrl = typeof meta.persona_avatar_url === "string" ? meta.persona_avatar_url.trim() : "";
			const seed = canonicalTag || displayLabel;
			const avatarBg = colorFn(seed);
			const handleToCopy = `@${canonicalTag}`;
			const handleAttr = escapeHtml(handleToCopy);
			const personaHref =
				PERSONA_TAG_RE.test(canonicalTag) ? `/p/${encodeURIComponent(canonicalTag)}` : "";
			const openPersona =
				personaHref !== ""
					? `<a href="${escapeHtml(personaHref)}" class="prompt-library-view" aria-label="View persona">${eyeSvg}</a>`
					: "";
			const thumbCell = avatarUrl
				? `<img class="prompt-library-persona-avatar-img" src="${escapeHtml(avatarUrl)}" alt="" width="48" height="48" loading="lazy" decoding="async" />`
				: `<span class="prompt-library-persona-avatar-fallback" style="--prompt-library-persona-avatar-bg: ${avatarBg};" aria-hidden="true">${escapeHtml(initial)}</span>`;
			return `<tr class="prompt-library-row prompt-library-row--persona" data-prompt-injection-id="${escapeHtml(id)}" data-tag="${tagAttr}">
				<td class="prompt-library-cell-thumb">${thumbCell}</td>
				<td><code class="prompt-library-tag">${tagHtml}</code></td>
				<td class="prompt-library-cell-actions">
					<button type="button" class="prompt-library-copy-key" data-copy-persona-handle="${handleAttr}" aria-label="Copy persona handle">
						${copySvg}
					</button>
					${openPersona}
				</td>
			</tr>`;
		})
		.join("");

	for (const img of tbody.querySelectorAll(".prompt-library-persona-avatar-img")) {
		img.addEventListener("error", () => {
			img.style.display = "none";
			const tr = img.closest("tr");
			const td = img.closest(".prompt-library-cell-thumb");
			if (!td || !tr || td.querySelector(".prompt-library-persona-avatar-fallback")) return;
			const rawTag = String(tr.getAttribute("data-tag") || "").trim();
			const initial = (rawTag.charAt(0) || "?").toUpperCase();
			const fb = document.createElement("span");
			fb.className = "prompt-library-persona-avatar-fallback";
			fb.style.setProperty("--prompt-library-persona-avatar-bg", colorFn(rawTag.toLowerCase() || rawTag));
			fb.setAttribute("aria-hidden", "true");
			fb.textContent = initial;
			td.appendChild(fb);
		});
	}
}

function renderStyleRows(tbody, rows, getAvatarColor, getStyleThumbUrl, copyKeySvg, viewDetailSvg) {
	if (!tbody) return;
	const colorFn = typeof getAvatarColor === "function" ? getAvatarColor : () => "#6b7280";
	const thumbFn = typeof getStyleThumbUrl === "function" ? getStyleThumbUrl : () => "";
	const copySvg = typeof copyKeySvg === "string" ? copyKeySvg : "";
	const eyeSvg = typeof viewDetailSvg === "string" ? viewDetailSvg : "";
	if (!rows.length) {
		tbody.innerHTML = `<tr><td colspan="3" class="prompt-library-table-empty">No items yet.</td></tr>`;
		return;
	}
	tbody.innerHTML = rows
		.map((row) => {
			const id = row.id != null ? String(row.id) : "";
			const rawTag = String(row.tag ?? "").trim();
			const canonicalTag = rawTag.toLowerCase();
			const tagAttr = escapeHtml(canonicalTag);
			const tagHtml = escapeHtml(rawTag || canonicalTag);
			const title = String(row.title ?? "").trim();
			const displayLabel = title || rawTag || canonicalTag;
			const initial = (displayLabel.charAt(0) || "?").toUpperCase();
			const initialAttr = escapeHtml(initial);
			const thumbBg = colorFn(canonicalTag || displayLabel);
			const meta = parseInjectionMeta(row.meta);
			const catalogThumb =
				typeof meta.style_thumb_url === "string" ? meta.style_thumb_url.trim() : "";
			const thumbUrl = catalogThumb || thumbFn(canonicalTag);
			const fallbackSpan = `<span class="prompt-library-thumb-fallback" style="--prompt-library-style-thumb-bg: ${thumbBg};" aria-hidden="true">${initialAttr}</span>`;
			const thumbCell = thumbUrl
				? `<img class="prompt-library-thumb-img" src="${escapeHtml(thumbUrl)}" alt="" width="48" height="56" loading="lazy" decoding="async" />`
				: fallbackSpan;
			const styleHref = STYLE_TAG_RE.test(canonicalTag) ? `/styles/${encodeURIComponent(canonicalTag)}` : "";
			const openStyle =
				styleHref !== ""
					? `<a href="${escapeHtml(styleHref)}" class="prompt-library-view" aria-label="View style">${eyeSvg}</a>`
					: "";
			return `<tr class="prompt-library-row prompt-library-row--style" data-prompt-injection-id="${escapeHtml(id)}" data-tag="${tagAttr}" data-style-thumb-initial="${initialAttr}">
				<td class="prompt-library-cell-thumb">${thumbCell}</td>
				<td><code class="prompt-library-tag">${tagHtml}</code></td>
				<td class="prompt-library-cell-actions">
					<button type="button" class="prompt-library-copy-key" data-copy-style-key="${tagAttr}" aria-label="Copy style key">
						${copySvg}
					</button>
					${openStyle}
				</td>
			</tr>`;
		})
		.join("");

	for (const img of tbody.querySelectorAll(".prompt-library-thumb-img")) {
		img.addEventListener("error", () => {
			const td = img.closest(".prompt-library-cell-thumb");
			const tr = img.closest("tr");
			img.remove();
			if (!td || !tr) return;
			let fb = td.querySelector(".prompt-library-thumb-fallback");
			if (!fb) {
				fb = document.createElement("span");
				fb.className = "prompt-library-thumb-fallback";
				fb.setAttribute("aria-hidden", "true");
				td.appendChild(fb);
			}
			const rawTag = String(tr.getAttribute("data-tag") || "").trim();
			const seed = rawTag.toLowerCase() || rawTag;
			fb.style.setProperty("--prompt-library-style-thumb-bg", colorFn(seed));
			const fromAttr = String(tr.getAttribute("data-style-thumb-initial") || "").trim();
			fb.textContent = fromAttr || (rawTag.charAt(0) || "?").toUpperCase();
		});
	}
}

/** Clicks on text inside a button can use a Text node as `event.target`, which has no `closest`. */
function clickTargetElement(e) {
	const n = e?.target;
	if (n instanceof Element) return n;
	if (n && n.nodeType === Node.TEXT_NODE && n.parentElement) return n.parentElement;
	return null;
}

function setupPromptLibraryCopyButtons(root) {
	if (!root || root.dataset.promptLibraryCopyDelegation === "1") return;
	root.dataset.promptLibraryCopyDelegation = "1";

	root.addEventListener("click", async (e) => {
		const fromEl = clickTargetElement(e);
		if (!fromEl) return;

		const copyBtn = fromEl.closest("[data-copy-style-key]");
		if (copyBtn && root.contains(copyBtn)) {
			e.preventDefault();
			e.stopPropagation();
			const key = String(copyBtn.getAttribute("data-copy-style-key") || "").trim();
			if (!key) return;
			try {
				if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(key);
				}
			} catch {
				// ignore
			}
			return;
		}

		const copyPersonaBtn = fromEl.closest("[data-copy-persona-handle]");
		if (copyPersonaBtn && root.contains(copyPersonaBtn)) {
			e.preventDefault();
			e.stopPropagation();
			const handle = String(copyPersonaBtn.getAttribute("data-copy-persona-handle") || "").trim();
			if (!handle) return;
			try {
				if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(handle);
				}
			} catch {
				// ignore
			}
		}
	});
}

function syncPromptLibraryAddStyleButton(canAdd) {
	const btn = document.querySelector(".prompt-library-add-style");
	if (!(btn instanceof HTMLAnchorElement)) return;
	btn.classList.toggle("is-allowed", Boolean(canAdd));
}

async function loadPromptLibrary() {
	const intro = document.querySelector("[data-prompt-library-intro]");
	const stylesBody = document.querySelector("[data-prompt-library-styles-tbody]");
	const personasBody = document.querySelector("[data-prompt-library-personas-tbody]");
	const root = document.querySelector("[data-prompt-library-root]");

	const v = document.querySelector('meta[name="asset-version"]')?.getAttribute("content")?.trim() || "";
	const qs = v ? `?v=${encodeURIComponent(v)}` : "";
	const [{ getAvatarColor }, { getStyleThumbUrl }, { copyIcon, eyeIcon }] = await Promise.all([
		import(`../shared/avatar.js${qs}`),
		import(`./create-styles.js${qs}`),
		import(`../icons/svg-strings.js${qs}`)
	]);
	const copyKeySvg = typeof copyIcon === "function" ? copyIcon("prompt-library-copy-icon") : "";
	const viewDetailSvg = typeof eyeIcon === "function" ? eyeIcon("prompt-library-copy-icon") : "";

	try {
		const res = await fetch("/api/prompt-injections", { credentials: "include" });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			const msg = typeof data?.error === "string" ? data.error : "Could not load prompt library.";
			if (intro) intro.textContent = msg;
			renderStyleRows(stylesBody, [], getAvatarColor, getStyleThumbUrl, copyKeySvg, viewDetailSvg);
			renderPersonaRows(personasBody, [], getAvatarColor, copyKeySvg, viewDetailSvg);
			syncPromptLibraryAddStyleButton(false);
			queueApplyPromptLibraryTabFromHash();
			return;
		}
		const items = Array.isArray(data.items) ? data.items : [];
		const styles = items.filter((r) => String(r.tag_type ?? "").toLowerCase() === "style");
		const personas = items.filter((r) => String(r.tag_type ?? "").toLowerCase() === "persona");

		if (intro) {
			intro.textContent =
				"Saved styles and personas you can use in prompts. Use the eye icon to view a style or persona; use the copy icon for the tag or @handle.";
		}
		renderStyleRows(stylesBody, styles, getAvatarColor, getStyleThumbUrl, copyKeySvg, viewDetailSvg);
		renderPersonaRows(personasBody, personas, getAvatarColor, copyKeySvg, viewDetailSvg);
		setupPromptLibraryCopyButtons(root);
		syncPromptLibraryAddStyleButton(Boolean(data?.canAddStyle));
	} catch {
		if (intro) intro.textContent = "Could not load prompt library.";
		renderStyleRows(stylesBody, [], getAvatarColor, getStyleThumbUrl, copyKeySvg, viewDetailSvg);
		renderPersonaRows(personasBody, [], getAvatarColor, copyKeySvg, viewDetailSvg);
		syncPromptLibraryAddStyleButton(false);
	}
	queueApplyPromptLibraryTabFromHash();
}

window.addEventListener("hashchange", () => queueApplyPromptLibraryTabFromHash());

function bootPromptLibraryPage() {
	seedPromptLibraryTabsActiveFromHash();
	setupPromptLibraryTabsHashSync();
	queueApplyPromptLibraryTabFromHash();
	void loadPromptLibrary();
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", bootPromptLibraryPage);
} else {
	bootPromptLibraryPage();
}
