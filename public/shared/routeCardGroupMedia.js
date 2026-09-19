/**
 * Group carousel / video playlist and cover thumbs for `.route-media` grids.
 *
 * Loaded via `import(\`.../routeCardGroupMedia.js${qs}\`)`. Direct siblings must
 * use the same query; static `import './foo.js'` can resolve a stale cached copy.
 */
const _qs = (() => {
	try {
		const fromModule = new URL(import.meta.url).search;
		if (fromModule) return fromModule;
	} catch {
		/* ignore */
	}
	const v =
		typeof document !== 'undefined'
			? document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || ''
			: '';
	return v ? `?v=${encodeURIComponent(v)}` : '';
})();

const [
	routeMediaMod,
	audioCoverWaveformMod,
	creationGroupMediaMod,
	feedCardBuildMod,
] = await Promise.all([
	import(`./routeMedia.js${_qs}`),
	import(`./audioCoverWaveform.js${_qs}`),
	import(`./creationGroupMedia.js${_qs}`),
	import(`./feedCardBuild.js${_qs}`),
]);
const { setRouteMediaBackgroundImage } = routeMediaMod;
const {
	creationMediaType,
	creationNeedsAudioWaveformCover,
	mountAudioCoverWaveform,
	removeAudioCoverWaveform,
} = audioCoverWaveformMod;
const {
	normalizeRouteCardFeedItem,
	parseCreationItemMeta,
	resolveGroupCoverDisplayUrl,
	isGroupCreationItem,
	routeCardGroupBadgeHtml,
} = creationGroupMediaMod;
const {
	getFeedItemGroupCarouselSources,
	getFeedItemGroupVideoSlides,
	setupFeedCardGroupCarousel,
	setupFeedCardGroupVideoPlaylist,
	feedItemCardImageUrl,
	isFeedCreationImageProcessing,
} = feedCardBuildMod;

function resolveRouteCardThumbUrl(item, preferThumbnail, isVideo) {
	const feedItem = normalizeRouteCardFeedItem(item);
	const groupCover = resolveGroupCoverDisplayUrl(feedItem, preferThumbnail && !isVideo);
	if (groupCover) return groupCover;
	if (isVideo) {
		const poster = feedItem.thumbnail_url || feedItem.image_url || feedItem.url || "";
		return typeof poster === "string" ? poster.trim() : "";
	}
	const fromFeed = feedItemCardImageUrl(feedItem, preferThumbnail);
	if (fromFeed) return fromFeed;
	const raw = preferThumbnail
		? (feedItem.thumbnail_url || feedItem.image_url || feedItem.url || "")
		: (feedItem.image_url || feedItem.url || feedItem.thumbnail_url || "");
	return typeof raw === "string" ? raw.trim() : "";
}

function markRouteMediaGroupHost(mediaEl) {
	if (!(mediaEl instanceof HTMLElement)) return;
	mediaEl.classList.add("route-media--group-host");
}

/**
 * Hydrate one `.route-media` tile (cover thumb, group carousel, or group video playlist).
 * @param {HTMLElement} mediaEl
 * @param {object} item
 * @param {{ preferThumbnail?: boolean, lowPriority?: boolean, eager?: boolean, observer?: IntersectionObserver, posterUrl?: string }} [options]
 * @returns {{ kind: 'group-video'|'group-carousel'|'single'|'audio-wave'|'none' }}
 */
export function hydrateRouteCardMedia(mediaEl, item, options = {}) {
	if (!(mediaEl instanceof HTMLElement)) return { kind: "none" };

	const feedItem = normalizeRouteCardFeedItem(item);
	const meta = parseCreationItemMeta(feedItem);
	const mediaType = creationMediaType(feedItem);
	const hasImportProvider =
		meta?.import &&
		typeof meta.import === "object" &&
		typeof meta.import.provider === "string" &&
		meta.import.provider.trim();
	const hasNativeVideoFile =
		(typeof feedItem.video_url === "string" && feedItem.video_url.trim()) ||
		(meta?.video && typeof meta.video === "object");
	// Imported YouTube covers are stills — treat like images so grid fill matches 9:16 photos.
	const isVideo = mediaType === "video" && hasNativeVideoFile && !hasImportProvider;

	if (mediaType === "audio") {
		mediaEl.setAttribute("data-media-type", "audio");
		if (isFeedCreationImageProcessing(feedItem)) {
			return { kind: "none" };
		}
		if (creationNeedsAudioWaveformCover(feedItem)) {
			mountAudioCoverWaveform(mediaEl);
			return { kind: "audio-wave" };
		}
		removeAudioCoverWaveform(mediaEl);
		mediaEl.classList.add("route-media-audio-real-cover");
	}

	const groupVideoSlides = getFeedItemGroupVideoSlides(feedItem);
	if (isVideo && groupVideoSlides.length > 1) {
		markRouteMediaGroupHost(mediaEl);
		const posterUrl =
			typeof options.posterUrl === "string" && options.posterUrl.trim()
				? options.posterUrl.trim()
				: resolveRouteCardThumbUrl(feedItem, true, true) || groupVideoSlides[0]?.url || "";
		setupFeedCardGroupVideoPlaylist(mediaEl, feedItem, { posterUrl });
		return { kind: "group-video" };
	}

	if (!isVideo) {
		const carouselSources = getFeedItemGroupCarouselSources(feedItem);
		if (carouselSources.length > 1) {
			markRouteMediaGroupHost(mediaEl);
			setupFeedCardGroupCarousel(mediaEl, feedItem, {
				preferThumbnail: options.preferThumbnail !== false
			});
			return { kind: "group-carousel" };
		}
	}

	const url = resolveRouteCardThumbUrl(feedItem, options.preferThumbnail !== false, isVideo);
	if (!url) return { kind: "none" };

	const { eager = false, observer = null, lowPriority = false } = options;
	if (eager) {
		void setRouteMediaBackgroundImage(mediaEl, url, { lowPriority });
	} else if (observer) {
		mediaEl.dataset.bgUrl = url;
		observer.observe(mediaEl);
	} else {
		void setRouteMediaBackgroundImage(mediaEl, url, { lowPriority });
	}
	return { kind: "single" };
}

export { isGroupCreationItem, routeCardGroupBadgeHtml };
