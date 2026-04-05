/**
 * /styles/:slug — load style from API and show title, slug, description, modifiers.
 */

import { getStyleThumbUrl } from "./create-styles.js";

function escapeHtml(text) {
	return String(text ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
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

function renderStyle(root, loading, errRoot, style) {
	if (loading) loading.hidden = true;
	if (errRoot) errRoot.hidden = true;
	if (!root) return;
	root.hidden = false;

	const tag = String(style.tag ?? "");
	const displayTitle = (style.title && String(style.title).trim()) || tag;
	const thumbUrl = getStyleThumbUrl(tag);
	const vis = style.visibility ? String(style.visibility) : "";
	const desc = style.description && String(style.description).trim();
	const mods = style.injection_text && String(style.injection_text).trim();

	document.title = `${displayTitle} — parascene`;

	const thumbBlock =
		thumbUrl ?
			`<img class="style-detail-thumb" src="${escapeHtml(thumbUrl)}" alt="" width="140" height="160" loading="eager" decoding="async" />` :
			"";

	root.innerHTML = `
		<div class="style-detail-hero">
			${thumbBlock}
			<div class="style-detail-identity">
				<h1 class="style-detail-title">${escapeHtml(displayTitle)}</h1>
				<p class="style-detail-slug">Use in prompts: <code>$${escapeHtml(tag)}</code></p>
				${vis ? `<p class="style-detail-meta">Visibility: ${escapeHtml(vis)}</p>` : ""}
			</div>
		</div>
		${desc ? `<p class="style-detail-description">${escapeHtml(desc)}</p>` : `<p class="style-detail-description">A preset style you can apply by typing <code>$${escapeHtml(tag)}</code> in your prompt. The model receives the modifiers below (in addition to your text).</p>`}
		<h2 class="style-detail-section-title">Prompt modifiers</h2>
		<pre class="style-detail-modifiers" role="region" aria-label="Style modifier text">${mods ? escapeHtml(mods) : escapeHtml("(No modifier text stored for this style.)")}</pre>
		<div class="style-detail-footer">
			<a href="/prompt-library#styles" class="btn-outlined">See All Styles</a>
		</div>
	`;

	const thumbEl = root.querySelector(".style-detail-thumb");
	if (thumbEl) {
		thumbEl.addEventListener("error", () => {
			thumbEl.hidden = true;
		});
	}
}

async function load() {
	const loading = document.querySelector("[data-style-detail-loading]");
	const root = document.querySelector("[data-style-detail-root]");
	const errRoot = document.querySelector("[data-style-detail-error]");
	const slug = getSlugFromPath();

	if (!slug || !/^[a-z][a-z0-9_-]{0,63}$/.test(slug)) {
		renderError(root, loading, errRoot, "Invalid style");
		return;
	}

	const v = document.querySelector('meta[name="asset-version"]')?.getAttribute("content")?.trim() || "";
	const qs = v ? `?v=${encodeURIComponent(v)}` : "";

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

		renderStyle(root, loading, errRoot, style);
	} catch {
		renderError(root, loading, errRoot, "Could not load style.");
	}
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", load);
} else {
	void load();
}
