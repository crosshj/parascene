/**
 * Client helpers for grouped creation media (cover source, badges, thumb URLs).
 */

const html = String.raw;

export function parseCreationItemMeta(item) {
	const m = item?.meta;
	if (m && typeof m === "object") return m;
	if (typeof m === "string") {
		try {
			const o = JSON.parse(m);
			return o && typeof o === "object" ? o : null;
		} catch {
			return null;
		}
	}
	return null;
}

export function isGroupCreationItem(item) {
	const meta = parseCreationItemMeta(item);
	return meta?.group?.kind === "group_creations";
}

export function getGroupCoverSourceFromMeta(meta) {
	const groupPayload = meta?.group && typeof meta.group === "object" ? meta.group : null;
	if (groupPayload?.kind !== "group_creations") return null;
	const sourcesRaw = Array.isArray(groupPayload.source_creations) ? groupPayload.source_creations : [];
	const coverId = Number(groupPayload.cover_source_id);
	let coverSource = null;
	if (Number.isFinite(coverId) && coverId > 0) {
		coverSource = sourcesRaw.find((s) => s && typeof s === "object" && Number(s.id) === coverId) || null;
	}
	if (!coverSource) {
		coverSource = sourcesRaw.find((s) => s && typeof s === "object") || null;
	}
	return coverSource || null;
}

export function appendThumbnailVariant(url) {
	if (!url) return "";
	const s = String(url);
	if (s.includes("variant=thumbnail")) return s;
	const sep = s.includes("?") ? "&" : "?";
	return `${s}${sep}variant=thumbnail`;
}

export function appendCreationIdToMediaUrl(url, creationId) {
	if (!url) return "";
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) return String(url);
	const s = String(url);
	if (!s.includes("/api/images/created/") && !s.includes("/api/videos/created/")) return s;
	try {
		const parsed = new URL(s, "http://localhost");
		parsed.searchParams.set("creation_id", String(id));
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		const sep = s.includes("?") ? "&" : "?";
		return `${s}${sep}creation_id=${encodeURIComponent(String(id))}`;
	}
}

export function resolveGroupCoverDisplayUrl(item, preferThumbnail = false) {
	const creationId = Number(item?.created_image_id ?? item?.id);
	const meta = parseCreationItemMeta(item);
	const cover = getGroupCoverSourceFromMeta(meta);
	if (!cover) return "";
	const filePath = typeof cover.file_path === "string" ? cover.file_path.trim() : "";
	if (!filePath) return "";
	let url = appendCreationIdToMediaUrl(filePath, creationId);
	if (preferThumbnail) url = appendThumbnailVariant(url);
	return url;
}

export function groupCreationBadgeHtml() {
	return html`<span class="creation-group-badge" aria-label="Group creation" title="Group creation">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"
			stroke-linejoin="round" aria-hidden="true">
			<rect x="3.5" y="6.5" width="9.5" height="9.5" rx="2"></rect>
			<rect x="10.5" y="10.5" width="10" height="10" rx="2"></rect>
		</svg>
	</span>`;
}

export function routeCardGroupBadgeHtml(item) {
	return isGroupCreationItem(item) ? groupCreationBadgeHtml() : "";
}

/**
 * @param {object} item
 * @returns {object}
 */
export function normalizeRouteCardFeedItem(item) {
	const id = item?.created_image_id ?? item?.id ?? null;
	return {
		...item,
		id,
		created_image_id: id,
		meta: parseCreationItemMeta(item) ?? item?.meta ?? null,
		image_url: item?.image_url ?? item?.url ?? null,
		thumbnail_url: item?.thumbnail_url ?? null,
		video_url: item?.video_url ?? null,
		media_type:
			typeof item?.media_type === "string"
				? item.media_type
				: (parseCreationItemMeta(item)?.media_type ?? "image")
	};
}
