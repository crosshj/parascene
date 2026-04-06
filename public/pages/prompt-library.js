/**
 * Prompt library — one GET /api/prompt-injections payload; tabs filter by tag_type (client-side).
 * URL hash: #styles | #personas switches tabs (e.g. /prompt-library#styles).
 * Seeds <app-tabs active> from the hash before the element upgrades (race with entry.js); then
 * applies again after customElements.whenDefined so the correct tab always wins over the HTML default.
 */

import { getStyleThumbUrl } from "./create-styles.js";

const COPY_KEY_ICON = `<svg class="prompt-library-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
	<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
</svg>`;

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

function renderPersonaRows(tbody, rows, getAvatarColor) {
	if (!tbody) return;
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
			const thumbCell = avatarUrl
				? `<img class="prompt-library-persona-avatar-img" src="${escapeHtml(avatarUrl)}" alt="" width="48" height="48" loading="lazy" decoding="async" />`
				: `<span class="prompt-library-persona-avatar-fallback" style="--prompt-library-persona-avatar-bg: ${avatarBg};" aria-hidden="true">${escapeHtml(initial)}</span>`;
			return `<tr class="prompt-library-row prompt-library-row--persona" data-prompt-injection-id="${escapeHtml(id)}" data-tag="${tagAttr}" tabindex="0">
				<td class="prompt-library-cell-thumb">${thumbCell}</td>
				<td><code class="prompt-library-tag">${tagHtml}</code></td>
				<td class="prompt-library-cell-actions">
					<button type="button" class="prompt-library-copy-key" data-copy-persona-handle="${handleAttr}" aria-label="Copy persona handle">
						${COPY_KEY_ICON}
					</button>
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

function renderStyleRows(tbody, rows) {
	if (!tbody) return;
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
			const thumbUrl = getStyleThumbUrl(canonicalTag);
			const thumbCell = thumbUrl
				? `<img class="prompt-library-thumb-img" src="${escapeHtml(thumbUrl)}" alt="" width="48" height="56" loading="lazy" decoding="async" />`
				: `<span class="prompt-library-thumb-fallback" aria-hidden="true"></span>`;
			return `<tr class="prompt-library-row prompt-library-row--style" data-prompt-injection-id="${escapeHtml(id)}" data-tag="${tagAttr}" tabindex="0">
				<td class="prompt-library-cell-thumb">${thumbCell}</td>
				<td><code class="prompt-library-tag">${tagHtml}</code></td>
				<td class="prompt-library-cell-actions">
					<button type="button" class="prompt-library-copy-key" data-copy-style-key="${tagAttr}" aria-label="Copy style key">
						${COPY_KEY_ICON}
					</button>
				</td>
			</tr>`;
		})
		.join("");

	for (const img of tbody.querySelectorAll(".prompt-library-thumb-img")) {
		img.addEventListener("error", () => {
			img.style.display = "none";
			const td = img.closest(".prompt-library-cell-thumb");
			if (td && !td.querySelector(".prompt-library-thumb-fallback")) {
				const fb = document.createElement("span");
				fb.className = "prompt-library-thumb-fallback";
				fb.setAttribute("aria-hidden", "true");
				td.appendChild(fb);
			}
		});
	}
}

function setupPromptLibraryRowActivation(root) {
	if (!root || root.dataset.promptLibraryActivation === "1") return;
	root.dataset.promptLibraryActivation = "1";

	root.addEventListener("click", async (e) => {
		const copyBtn = e.target.closest("[data-copy-style-key]");
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

		const copyPersonaBtn = e.target.closest("[data-copy-persona-handle]");
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
			return;
		}

		const tr = e.target.closest(".prompt-library-row");
		if (!tr || !root.contains(tr)) return;
		const tbody = tr.closest("tbody");
		const isStyles = tbody?.hasAttribute("data-prompt-library-styles-tbody");
		const isPersonas = tbody?.hasAttribute("data-prompt-library-personas-tbody");
		const rawTag = tr.getAttribute("data-tag") || "";
		const tag = String(rawTag).trim().toLowerCase();
		if (isStyles && /^[a-z][a-z0-9_-]{0,63}$/.test(tag)) {
			window.location.href = `/styles/${encodeURIComponent(tag)}`;
			return;
		}
		if (isPersonas && /^[a-z0-9][a-z0-9_-]{2,23}$/.test(tag)) {
			window.location.href = `/p/${encodeURIComponent(tag)}`;
		}
	});
	root.addEventListener("keydown", (e) => {
		if (e.key !== "Enter" && e.key !== " ") return;
		const tr = e.target.closest(".prompt-library-row");
		if (!tr || !root.contains(tr)) return;
		if (e.target.closest("[data-copy-style-key]") || e.target.closest("[data-copy-persona-handle]")) return;
		e.preventDefault();
		tr.click();
	});
}

async function loadPromptLibrary() {
	const intro = document.querySelector("[data-prompt-library-intro]");
	const stylesBody = document.querySelector("[data-prompt-library-styles-tbody]");
	const personasBody = document.querySelector("[data-prompt-library-personas-tbody]");
	const root = document.querySelector("[data-prompt-library-root]");

	const v = document.querySelector('meta[name="asset-version"]')?.getAttribute("content")?.trim() || "";
	const qs = v ? `?v=${encodeURIComponent(v)}` : "";
	const { getAvatarColor } = await import(`../shared/avatar.js${qs}`);

	try {
		const res = await fetch("/api/prompt-injections", { credentials: "include" });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			const msg = typeof data?.error === "string" ? data.error : "Could not load prompt library.";
			if (intro) intro.textContent = msg;
			renderStyleRows(stylesBody, []);
			renderPersonaRows(personasBody, [], getAvatarColor);
			queueApplyPromptLibraryTabFromHash();
			return;
		}
		const items = Array.isArray(data.items) ? data.items : [];
		const styles = items.filter((r) => String(r.tag_type ?? "").toLowerCase() === "style");
		const personas = items.filter((r) => String(r.tag_type ?? "").toLowerCase() === "persona");

		if (intro) {
			intro.textContent =
				"Saved styles and personas you can use in prompts. Open a row to view that style or persona; use the copy icon for the tag or @handle.";
		}
		renderStyleRows(stylesBody, styles);
		renderPersonaRows(personasBody, personas, getAvatarColor);
		setupPromptLibraryRowActivation(root);
	} catch {
		if (intro) intro.textContent = "Could not load prompt library.";
		renderStyleRows(stylesBody, []);
		renderPersonaRows(personasBody, [], getAvatarColor);
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
