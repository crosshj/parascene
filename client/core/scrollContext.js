/** Resolve the active route's scroller for paging, media visibility and restore. */
export function createScrollContext(element) {
	const region = element?.closest?.('.beta-outlet__scroll');
	return {
		region,
		get documentOwned() { return region?.dataset.scrollOwner === 'document'; },
		get intersectionRoot() { return this.documentOwned ? null : region; },
		get eventTarget() { return this.documentOwned ? window : region; },
		get element() { return this.documentOwned ? document.scrollingElement : region; },
		get top() { return this.documentOwned ? (window.scrollY || document.documentElement.scrollTop || 0) : region?.scrollTop || 0; },
		to(top = 0, behavior = 'auto') {
			if (this.documentOwned) window.scrollTo({ top, behavior });
			else region?.scrollTo?.({ top, behavior });
		},
		set(top) {
			if (this.documentOwned) window.scrollTo(0, top);
			else if (region) region.scrollTop = top;
		},
	};
}
