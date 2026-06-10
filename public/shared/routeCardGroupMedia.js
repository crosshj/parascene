/**
 * Group carousel / video playlist and cover thumbs for `.route-media` grids.
 */

import { setRouteMediaBackgroundImage } from "./routeMedia.js";
import {
	normalizeRouteCardFeedItem,
	parseCreationItemMeta,
	resolveGroupCoverDisplayUrl,
	isGroupCreationItem
} from "./creationGroupMedia.js";
import {
	getFeedItemGroupCarouselSources,
	getFeedItemGroupVideoSlides,
	setupFeedCardGroupCarousel,
	setupFeedCardGroupVideoPlaylist,
	feedItemCardImageUrl
} from "./feedCardBuild.js";

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
 * @returns {{ kind: 'group-video'|'group-carousel'|'single'|'none' }}
 */
export function hydrateRouteCardMedia(mediaEl, item, options = {}) {
	if (!(mediaEl instanceof HTMLElement)) return { kind: "none" };

	const feedItem = normalizeRouteCardFeedItem(item);
	const meta = parseCreationItemMeta(feedItem);
	const mediaType =
		typeof feedItem.media_type === "string"
			? feedItem.media_type.trim().toLowerCase()
			: (typeof meta?.media_type === "string" ? meta.media_type.trim().toLowerCase() : "image");
	const isVideo = mediaType === "video";

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
			setupFeedCardGroupCarousel(mediaEl, feedItem);
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

export { isGroupCreationItem, routeCardGroupBadgeHtml } from "./creationGroupMedia.js";
