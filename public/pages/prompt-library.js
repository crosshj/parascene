/**
 * Prompt library — one GET /api/prompt-injections payload; tabs filter by tag_type (client-side).
 * URL hash: #styles | #personas switches tabs (e.g. /prompt-library#styles).
 */

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

function setupPromptLibraryRowActivation(root) {
	if (!root || root.dataset.promptLibraryActivation === "1") return;
	root.dataset.promptLibraryActivation = "1";
	root.addEventListener("click", (e) => {
		const tr = e.target.closest(".prompt-library-row");
		if (!tr || !root.contains(tr)) return;
		// Modal detail: TODO when API + modal exist
	});
	root.addEventListener("keydown", (e) => {
		if (e.key !== "Enter" && e.key !== " ") return;
		const tr = e.target.closest(".prompt-library-row");
		if (!tr || !root.contains(tr)) return;
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
			renderRows(stylesBody, [], { formatRelativeTime });
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
		renderRows(stylesBody, styles, { formatRelativeTime });
		renderRows(personasBody, personas, { formatRelativeTime });
		setupPromptLibraryRowActivation(root);
	} catch {
		if (intro) intro.textContent = "Could not load prompt library.";
		renderRows(stylesBody, [], { formatRelativeTime });
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
