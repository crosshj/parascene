/**
 * /audio-clips/:id — clip hub: player, owners, source, used-in grid.
 */

function escapeHtml(text) {
	return String(text ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function formatDurationSec(sec) {
	const n = Number(sec);
	if (!Number.isFinite(n) || n <= 0) return "—";
	const total = Math.round(n);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSourceType(sourceType) {
	const t = String(sourceType ?? "").trim().toLowerCase();
	if (t === "video_extract") return "Extracted from video";
	if (t === "recorded") return "Recorded";
	if (t === "upload") return "Uploaded";
	return t || "—";
}

function getClipIdFromPath() {
	const m = (window.location.pathname || "").match(/^\/audio-clips\/(\d+)\/?$/);
	return m ? Number(m[1]) : 0;
}

function renderOwnerLine(profile, role) {
	if (!profile) return "";
	const name =
		String(profile.display_name || "").trim() ||
		(String(profile.user_name || "").trim() ? `@${profile.user_name}` : "") ||
		`User #${profile.user_id}`;
	const href = profile.user_name
		? `/user/${encodeURIComponent(profile.user_name)}`
		: (profile.user_id ? `/user/${profile.user_id}` : "");
	const roleLabel = role === "source" ? "Source" : "Creator";
	const inner = href
		? `<a href="${escapeHtml(href)}" class="audio-clip-detail-owner-link">${escapeHtml(name)}</a>`
		: escapeHtml(name);
	return `<li><span class="audio-clip-detail-owner-role">${escapeHtml(roleLabel)}</span> ${inner}</li>`;
}

function renderUsedInGrid(items) {
	if (!items.length) {
		return `<p class="audio-clip-detail-empty">No creations have used this clip yet.</p>`;
	}
	return `<div class="audio-clip-detail-used-grid">${items
		.map((item) => {
			const id = item.created_image_id;
			const href = id ? `/creations/${encodeURIComponent(id)}` : "#";
			const thumb = typeof item.thumbnail_url === "string" ? item.thumbnail_url : "";
			const title = escapeHtml(String(item.title || "").trim() || `Creation #${id}`);
			const thumbHtml = thumb
				? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async" />`
				: `<span class="audio-clip-detail-used-fallback" aria-hidden="true">#</span>`;
			return `<a href="${escapeHtml(href)}" class="audio-clip-detail-used-card">
				<div class="audio-clip-detail-used-thumb">${thumbHtml}</div>
				<span class="audio-clip-detail-used-title">${title}</span>
			</a>`;
		})
		.join("")}</div>`;
}

async function loadClipHub() {
	const loading = document.querySelector("[data-audio-clip-detail-loading]");
	const root = document.querySelector("[data-audio-clip-detail-root]");
	const errRoot = document.querySelector("[data-audio-clip-detail-error]");
	const clipId = getClipIdFromPath();
	if (!clipId) {
		if (loading) loading.hidden = true;
		if (errRoot) {
			errRoot.hidden = false;
			errRoot.textContent = "Invalid clip link.";
		}
		return;
	}
	try {
		const [detailRes, usagesRes] = await Promise.all([
			fetch(`/api/audio-clips/${clipId}`, { credentials: "include" }),
			fetch(`/api/audio-clips/${clipId}/creations?limit=24&offset=0`, { credentials: "include" })
		]);
		const detail = await detailRes.json().catch(() => ({}));
		const usages = await usagesRes.json().catch(() => ({}));
		if (!detailRes.ok) {
			throw new Error(detail?.error || "Clip not found");
		}
		const clip = detail.clip;
		if (!clip) throw new Error("Clip not found");
		const profiles = Array.isArray(clip.owner_profiles) ? clip.owner_profiles : [];
		const owners = clip.owners || {};
		const ownerLines = [];
		for (const p of profiles) {
			const uid = Number(p.user_id);
			if (uid === Number(owners.creator)) ownerLines.push(renderOwnerLine(p, "creator"));
			else if (uid === Number(owners.source)) ownerLines.push(renderOwnerLine(p, "source"));
			else ownerLines.push(renderOwnerLine(p, "creator"));
		}
		const sourceSection =
			clip.source_type === "video_extract" && clip.source_created_image_id
				? `<div class="audio-clip-detail-section">
					<h2 class="audio-clip-detail-section-title">Source</h2>
					<p><a href="/creations/${encodeURIComponent(clip.source_created_image_id)}">Creation #${escapeHtml(clip.source_created_image_id)}</a></p>
				</div>`
				: "";
		const usedItems = Array.isArray(usages.items) ? usages.items : [];
		if (root) {
			root.hidden = false;
			root.innerHTML = `
				<div class="audio-clip-detail-hero">
					<div class="audio-clip-detail-player-wrap">
						<audio controls class="audio-clip-detail-player" src="${escapeHtml(clip.audio_url || "")}" preload="metadata"></audio>
					</div>
					<div class="audio-clip-detail-identity">
						<h1 class="audio-clip-detail-title">${escapeHtml(clip.title || `Clip #${clip.id}`)}</h1>
						<p class="audio-clip-detail-meta">${escapeHtml(formatDurationSec(clip.duration_sec))} · ${escapeHtml(formatSourceType(clip.source_type))} · Used ${escapeHtml(String(clip.usage_count || 0))}×</p>
						${clip.description ? `<p class="audio-clip-detail-description">${escapeHtml(clip.description)}</p>` : ""}
						${ownerLines.length ? `<ul class="audio-clip-detail-owners">${ownerLines.join("")}</ul>` : ""}
					</div>
				</div>
				${sourceSection}
				<div class="audio-clip-detail-section">
					<h2 class="audio-clip-detail-section-title">Used in</h2>
					${renderUsedInGrid(usedItems)}
				</div>
			`;
		}
		if (loading) loading.hidden = true;
		if (errRoot) errRoot.hidden = true;
	} catch (err) {
		if (loading) loading.hidden = true;
		if (root) root.hidden = true;
		if (errRoot) {
			errRoot.hidden = false;
			errRoot.innerHTML = `
				<div class="route-empty-state">
					<h2 class="route-empty-title">${escapeHtml(err?.message || "Could not load clip")}</h2>
					<p class="route-empty-message"><a href="/prompt-library#audio-clips" class="route-empty-button">Back to library</a></p>
				</div>
			`;
		}
	}
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => void loadClipHub());
} else {
	void loadClipHub();
}
