/**
 * Group carousel / video playlist and cover thumbs for `.route-media` grids.
 *
 * Dependencies are ordinary static imports owned by the VPS client bundle.
 */
import { setRouteMediaBackgroundImage } from './routeMedia.js';
import {
	creationMediaType,
	creationNeedsAudioWaveformCover,
	isPlaceholderAudioCover,
	mountAudioCoverWaveform,
	removeAudioCoverWaveform,
} from './audioCoverWaveform.js';
import {
	normalizeRouteCardFeedItem,
	parseCreationItemMeta,
	resolveGroupCoverDisplayUrl,
	isGroupCreationItem,
	routeCardGroupBadgeHtml,
} from './creationGroupMedia.js';
import {
	getFeedItemGroupCarouselSources,
	getFeedItemGroupVideoSlides,
	setupFeedCardGroupCarousel,
	setupFeedCardGroupVideoPlaylist,
	feedItemCardImageUrl,
	isFeedCreationImageProcessing,
} from './feedCardBuild.js';

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

	const preferThumbnail = mediaType === "audio" ? false : options.preferThumbnail !== false;
	const url = resolveRouteCardThumbUrl(feedItem, preferThumbnail, isVideo);
	if (mediaType === "audio") {
		const hasRealStill =
			Boolean(url) &&
			!isPlaceholderAudioCover(url) &&
			meta?.cover_placeholder !== true;
		if (hasRealStill) {
			removeAudioCoverWaveform(mediaEl);
			mediaEl.classList.add("route-media-audio-real-cover");
		} else if (creationNeedsAudioWaveformCover(feedItem)) {
			mountAudioCoverWaveform(mediaEl);
			if (!url || isPlaceholderAudioCover(url)) {
				return { kind: "audio-wave" };
			}
		}
	}
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
