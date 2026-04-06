/**
 * Prompt library — one GET /api/prompt-injections payload; tabs filter by tag_type (client-side).
 * URL hash: #styles | #personas switches tabs (e.g. /prompt-library#styles).
 */

import { getStyleThumbUrl } from "./create-styles.js";

const COPY_KEY_ICON = `<svg class="prompt-library-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
	<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
</svg>`;

function applyPromptLibraryTabFromHash() {
	const raw = (window.location.hash || "").replace(/^#/, "").trim().toLowerCase();
	if (raw !== "styles" && raw !== "personas") return;
	const tabsEl = document.querySelector("app-tabs");
	if (!tabsEl || typeof tabsEl.setActiveTab !== "function") return;
	tabsEl.setActiveTab(raw, { focus: false });
}

function scheduleApplyPromptLibraryHash() {
	queueMicrotask(() => {
		requestAnimationFrame(() => applyPromptLibraryTabFromHash());
	});
}

function escapeHtml(text) {
	return String(text ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function formatUpdated(value, formatRelativeTime) {
	if (!value) return "—";
	const rel = typeof formatRelativeTime === "function" ? formatRelativeTime(value) : "";
	return rel || "—";
}

function renderRows(tbody, rows, { formatRelativeTime }) {
	if (!tbody) return;
	if (!rows.length) {
		tbody.innerHTML = `<tr><td colspan="4" class="prompt-library-table-empty">No items yet.</td></tr>`;
		return;
	}
	tbody.innerHTML = rows
		.map((row) => {
			const id = row.id != null ? String(row.id) : "";
			const tag = escapeHtml(row.tag ?? "");
			const title = escapeHtml(row.title ?? row.tag ?? "");
			const vis = escapeHtml(row.visibility ?? "—");
			const updated = escapeHtml(formatUpdated(row.updated_at, formatRelativeTime));
			return `<tr class="prompt-library-row" data-prompt-injection-id="${escapeHtml(id)}" data-tag="${tag}" tabindex="0">
				<td><code class="prompt-library-tag">${tag}</code></td>
				<td>${title}</td>
				<td>${vis}</td>
				<td>${updated}</td>
			</tr>`;
		})
		.join("");
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

		const tr = e.target.closest(".prompt-library-row");
		if (!tr || !root.contains(tr)) return;
		const tbody = tr.closest("tbody");
		const isStyles = tbody?.hasAttribute("data-prompt-library-styles-tbody");
		const rawTag = tr.getAttribute("data-tag") || "";
		const tag = String(rawTag).trim().toLowerCase();
		if (isStyles && /^[a-z][a-z0-9_-]{0,63}$/.test(tag)) {
			window.location.href = `/styles/${encodeURIComponent(tag)}`;
		}
	});
	root.addEventListener("keydown", (e) => {
		if (e.key !== "Enter" && e.key !== " ") return;
		const tr = e.target.closest(".prompt-library-row");
		if (!tr || !root.contains(tr)) return;
		if (e.target.closest("[data-copy-style-key]")) return;
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
	const { formatRelativeTime } = await import(`../shared/datetime.js${qs}`);

	try {
		const res = await fetch("/api/prompt-injections", { credentials: "include" });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			const msg = typeof data?.error === "string" ? data.error : "Could not load prompt library.";
			if (intro) intro.textContent = msg;
			renderStyleRows(stylesBody, []);
			renderRows(personasBody, [], { formatRelativeTime });
			return;
		}
		const items = Array.isArray(data.items) ? data.items : [];
		const styles = items.filter((r) => String(r.tag_type ?? "").toLowerCase() === "style");
		const personas = items.filter((r) => String(r.tag_type ?? "").toLowerCase() === "persona");

		if (intro) {
			intro.textContent =
				"Saved styles and personas you can use in prompts. Open a style row for its detail page; personas stay in this list for now.";
		}
		renderStyleRows(stylesBody, styles);
		renderRows(personasBody, personas, { formatRelativeTime });
		setupPromptLibraryRowActivation(root);
	} catch {
		if (intro) intro.textContent = "Could not load prompt library.";
		renderStyleRows(stylesBody, []);
		renderRows(personasBody, [], { formatRelativeTime });
	}
	applyPromptLibraryTabFromHash();
}

window.addEventListener("hashchange", applyPromptLibraryTabFromHash);

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => {
		scheduleApplyPromptLibraryHash();
		void loadPromptLibrary();
	});
} else {
	scheduleApplyPromptLibraryHash();
	void loadPromptLibrary();
}
