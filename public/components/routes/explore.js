import { formatDateTime, formatRelativeTime } from '../../shared/datetime.js';
import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { searchIcon } from '../../icons/svg-strings.js';
import { buildProfilePath } from '../../shared/profileLinks.js';

const html = String.raw;

function scheduleImageWork(start, { immediate = true, wakeOnVisible = true } = {}) {
	if (typeof start !== 'function') return Promise.resolve();

	const isVisible = document.visibilityState === 'visible';
	if (immediate && isVisible) {
		start();
		return Promise.resolve();
	}

	return new Promise((resolve) => {
		let idleHandle = null;
		let timeoutHandle = null;

		function onVisibilityChange() {
			if (document.visibilityState === 'visible') runNow();
		}

		function runNow() {
			if (idleHandle !== null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle);
			if (timeoutHandle !== null) clearTimeout(timeoutHandle);
			if (wakeOnVisible) document.removeEventListener('visibilitychange', onVisibilityChange);
			start();
			resolve();
		}

		if (wakeOnVisible) {
			document.addEventListener('visibilitychange', onVisibilityChange);
		}

		if (typeof requestIdleCallback === 'function') {
			idleHandle = requestIdleCallback(() => runNow(), { timeout: 2000 });
		} else {
			timeoutHandle = setTimeout(() => runNow(), 500);
		}
	});
}

function setRouteMediaBackgroundImage(mediaEl, url, { lowPriority = false } = {}) {
	if (!mediaEl || !url) return;

	if (mediaEl.dataset.bgLoadedUrl === url) {
		return Promise.resolve(true);
	}

	mediaEl.classList.remove('route-media-error');
	mediaEl.style.backgroundImage = '';

	return new Promise((resolve) => {
		const startProbe = () => {
			const probe = new Image();
			probe.decoding = 'async';
			if ('fetchPriority' in probe) {
				probe.fetchPriority = lowPriority ? 'low' : (document.visibilityState === 'visible' ? 'auto' : 'low');
			}
			probe.onload = () => {
				mediaEl.dataset.bgLoadedUrl = url;
				mediaEl.classList.remove('route-media-error');
				mediaEl.style.backgroundImage = `url("${String(url).replace(/"/g, '\\"')}")`;
				resolve(true);
			};
			probe.onerror = () => {
				mediaEl.classList.add('route-media-error');
				mediaEl.style.backgroundImage = '';
				resolve(false);
			};
			probe.src = url;
		};

		void scheduleImageWork(startProbe, { immediate: !lowPriority, wakeOnVisible: !lowPriority });
	});
}

/** Page size for explore (one window per load). */
const EXPLORE_PAGE_SIZE = 100;

class AppRouteExplore extends HTMLElement {
	isRouteActive() {
		try {
			return window.__CURRENT_ROUTE__ === 'explore' || this.isActiveRoute === true;
		} catch {
			return this.isActiveRoute === true;
		}
	}

	resumeImageLazyLoading() {
		this.setupImageLazyLoading();
		const pendingTiles = this.querySelectorAll('.route-media[data-bg-url]');
		pendingTiles.forEach((mediaEl) => {
			if (!mediaEl) return;
			if (mediaEl.classList.contains('route-media-error')) return;
			if (mediaEl.style && typeof mediaEl.style.backgroundImage === 'string' && mediaEl.style.backgroundImage) return;
			if (!mediaEl.dataset.bgUrl) return;
			mediaEl.dataset.bgQueued = '0';
			if (this.imageObserver) this.imageObserver.observe(mediaEl);
		});
		this.drainImageLoadQueue();
	}

	connectedCallback() {
		this.innerHTML = html`
	<div class="explore-route">
		<div class="route-header">
			<h3>Explore</h3>
			<p>Discover creations from the broader community, including people you are not friends with yet.</p>
			<div class="explore-search-bar">
				<input type="search" class="explore-search-input" placeholder="Search creations..."
					aria-label="Search creations" id="explore-search-input" />
				${searchIcon('explore-search-icon')}
			</div>
		</div>
		<div class="explore-search-results route-cards content-cards-image-grid" data-explore-search-results hidden>
			<div class="route-empty route-empty-image-grid">
				<div class="route-empty-title">No creations found</div>
			</div>
		</div>
		<div class="explore-main" data-explore-main>
			<div class="route-cards content-cards-image-grid" data-explore-container>
				<div class="route-empty route-empty-image-grid route-loading">
					<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
				</div>
			</div>
			<div class="explore-load-more-sentinel" data-explore-sentinel aria-hidden="true"></div>
			<div class="explore-load-more-fallback" data-explore-load-more-fallback>
				<button type="button" class="btn-secondary explore-load-more-btn" data-explore-load-more-btn>Load
					more</button>
			</div>
		</div>
	</div>
    `;
		this.hasLoadedOnce = false;
		this.isLoading = false;
		this.isLoadingMore = false;
		this.isActiveRoute = false;
		this.exploreOffset = 0;
		this.hasMore = true;
		this.setupRouteListener();
		this.setupLoadMoreFallback();
		this.setupImageLazyLoading();
		this.updateLoadMoreFallback();
		this.setupSearchUi();

		const initialRoute = window.__CURRENT_ROUTE__ || null;
		const pathname = window.location.pathname || '';
		const inferred = initialRoute || (pathname.startsWith('/explore') ? 'explore' : null);
		this.isActiveRoute = inferred === 'explore';
		if (this.isRouteActive()) {
			this.refreshOnActivate();
			requestAnimationFrame(() => {
				if (this.hasMore) this.observeLoadMoreSentinel();
			});
		}
	}

	setupRouteListener() {
		this.routeChangeHandler = (e) => {
			const route = e?.detail?.route;
			if (typeof route !== 'string') return;
			if (route === 'explore') {
				this.isActiveRoute = true;
				this.refreshOnActivate();
				if (this.hasLoadedOnce) {
					this.resumeImageLazyLoading();
				}
				requestAnimationFrame(() => {
					if (this.hasMore) this.observeLoadMoreSentinel();
				});
			} else {
				this.isActiveRoute = false;
				if (this.imageObserver) this.imageObserver.disconnect();
				this.imageLoadQueue = [];
				this.imageLoadsInFlight = 0;
				this.sentinelObserver?.disconnect();
				this.sentinelObserver = null;
			}
		};
		document.addEventListener('route-change', this.routeChangeHandler);
	}

	/** Single observer: when sentinel is visible, call loadMore() (same as the button). Re-attach after each load. */
	observeLoadMoreSentinel() {
		this.sentinelObserver?.disconnect();
		this.sentinelObserver = null;
		if (!this.hasMore) return;
		const sentinel = this.querySelector('[data-explore-sentinel]');
		if (!sentinel) return;
		this.sentinelObserver = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				if (!entry?.isIntersecting) return;
				if (!this.hasMore || this.isLoadingMore || this.isLoading || !this.isRouteActive()) return;
				this.loadMore();
			},
			{ root: null, rootMargin: '800px 0px', threshold: 0 }
		);
		this.sentinelObserver.observe(sentinel);
	}

	updateLoadMoreFallback() {
		const wrap = this.querySelector('[data-explore-load-more-fallback]');
		const btn = this.querySelector('[data-explore-load-more-btn]');
		if (!wrap || !btn) return;
		if (!this.hasMore) {
			wrap.setAttribute('hidden', '');
			wrap.style.display = 'none';
			return;
		}
		wrap.removeAttribute('hidden');
		wrap.style.display = '';
		btn.disabled = false;
		btn.textContent = 'Load more';
	}

	setupLoadMoreFallback() {
		const btn = this.querySelector('[data-explore-load-more-btn]');
		if (!btn) return;
		btn.addEventListener('click', () => {
			if (!this.hasMore || this.isLoadingMore || this.isLoading) return;
			this.loadMore();
		});
	}

	setupImageLazyLoading() {
		const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
		const prefersSaveData = Boolean(connection && connection.saveData);
		const isVerySlowConnection = Boolean(connection && typeof connection.effectiveType === 'string' && connection.effectiveType.includes('2g'));

		this.eagerImageCount = prefersSaveData || isVerySlowConnection ? 2 : 6;
		this.maxConcurrentImageLoads = prefersSaveData || isVerySlowConnection ? 2 : 4;
		this.imageRootMargin = prefersSaveData || isVerySlowConnection ? '200px 0px' : '600px 0px';

		this.imageLoadQueue = [];
		this.imageLoadsInFlight = 0;

		if (this.imageObserver) this.imageObserver.disconnect();
		this.imageObserver = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (!entry.isIntersecting) return;
				const el = entry.target;
				if (!el || el.dataset.bgQueued === '1') return;
				const url = el.dataset.bgUrl;
				if (!url) {
					this.imageObserver?.unobserve(el);
					return;
				}
				if (el.dataset.bgLoadedUrl === url) {
					this.imageObserver?.unobserve(el);
					return;
				}
				el.dataset.bgQueued = '1';
				this.imageObserver?.unobserve(el);
				this.imageLoadQueue.push({ el, url });
				this.drainImageLoadQueue();
			});
		}, {
			root: null,
			rootMargin: this.imageRootMargin,
			threshold: 0.01,
		});
	}

	drainImageLoadQueue() {
		if (!Array.isArray(this.imageLoadQueue)) return;
		if (typeof this.maxConcurrentImageLoads !== 'number' || this.maxConcurrentImageLoads <= 0) return;

		while (this.imageLoadsInFlight < this.maxConcurrentImageLoads && this.imageLoadQueue.length > 0) {
			const next = this.imageLoadQueue.shift();
			if (!next || !next.el || !next.url) continue;
			this.imageLoadsInFlight += 1;
			Promise.resolve(setRouteMediaBackgroundImage(next.el, next.url, { lowPriority: !this.isRouteActive() }))
				.finally(() => {
					this.imageLoadsInFlight -= 1;
					this.drainImageLoadQueue();
				});
		}
	}

	disconnectedCallback() {
		if (this.routeChangeHandler) {
			document.removeEventListener('route-change', this.routeChangeHandler);
		}
		this.sentinelObserver?.disconnect();
		this.sentinelObserver = null;
		if (this.imageObserver) {
			this.imageObserver.disconnect();
			this.imageObserver = null;
		}
		this.imageLoadQueue = [];
		this.imageLoadsInFlight = 0;

		const searchInput = this.querySelector('.explore-search-input');
		if (searchInput && this.searchInputListener) {
			searchInput.removeEventListener('input', this.searchInputListener);
		}
		this.searchInputListener = null;

		if (this.searchDebounceId) {
			clearTimeout(this.searchDebounceId);
			this.searchDebounceId = null;
		}
	}

	setupSearchUi() {
		const input = this.querySelector('.explore-search-input');
		const main = this.querySelector('[data-explore-main]');
		const results = this.querySelector('[data-explore-search-results]');
		if (!input || !main || !results) return;

		const updateUrlSearchParam = (value) => {
			try {
				const url = new URL(window.location.href);
				if (value) {
					url.searchParams.set('s', value);
				} else {
					url.searchParams.delete('s');
				}
				const next = url.toString();
				if (next !== window.location.href) {
					window.history.replaceState(null, '', next);
				}
			} catch {
				// Ignore URL update errors (e.g., unsupported environment)
			}
		};

		const updateVisibility = () => {
			const hasText = input.value.trim().length > 0;
			if (hasText) {
				main.setAttribute('hidden', '');
				main.style.display = 'none';
				results.removeAttribute('hidden');
				results.style.display = '';
			} else {
				main.removeAttribute('hidden');
				main.style.display = '';
				results.setAttribute('hidden', '');
				results.style.display = 'none';
				// When clearing the search box, reset results content but keep the
				// empty-state placeholder so the transition back to main feels natural.
				results.innerHTML = html`
					<div class="route-empty route-empty-image-grid">
						<div class="route-empty-title">No creations found</div>
					</div>
				`;
			}
		};

		const handleInput = () => {
			const raw = input.value || '';
			const trimmed = raw.trim();
			updateVisibility();

			// Clear any pending search
			if (this.searchDebounceId) {
				clearTimeout(this.searchDebounceId);
				this.searchDebounceId = null;
			}

			// If there is no text, do not perform a search.
			if (!trimmed) {
				this.currentSearchQuery = '';
				updateUrlSearchParam('');
				return;
			}

			this.currentSearchQuery = trimmed;
			updateUrlSearchParam(trimmed);

			// Show a lightweight loading state immediately so the UI feels responsive.
			results.innerHTML = html`
				<div class="route-empty route-empty-image-grid route-loading">
					<div class="route-loading-spinner" aria-label="Searching" role="status"></div>
				</div>
			`;

			// Debounce the actual network request.
			this.searchDebounceId = window.setTimeout(() => {
				this.searchDebounceId = null;
				void this.performExploreSearch(trimmed);
			}, 300);
		};

		this.searchInputListener = () => handleInput();
		input.addEventListener('input', this.searchInputListener);
		// Initial state: hydrate from URL if an "s" query param is present.
		try {
			const params = new URLSearchParams(window.location.search);
			const initial = params.get('s') || '';
			if (initial) {
				input.value = initial;
				updateVisibility();
				this.currentSearchQuery = initial.trim();
				results.innerHTML = html`
					<div class="route-empty route-empty-image-grid route-loading">
						<div class="route-loading-spinner" aria-label="Searching" role="status"></div>
					</div>
				`;
				void this.performExploreSearch(this.currentSearchQuery);
				return;
			}
		} catch {
			// If URL parsing fails, just fall back to default state.
		}

		updateVisibility();
	}

	async performExploreSearch(query) {
		const resultsEl = this.querySelector('[data-explore-search-results]');
		if (!resultsEl) return;

		const trimmed = String(query || '').trim();
		if (!trimmed) {
			resultsEl.innerHTML = html`
				<div class="route-empty route-empty-image-grid">
					<div class="route-empty-title">No creations found</div>
				</div>
			`;
			return;
		}

		// Capture a token so we can ignore out-of-order responses.
		const token = (this.searchRequestToken = (this.searchRequestToken || 0) + 1);

		try {
			const res = await fetchJsonWithStatusDeduped(
				`/api/explore/search?q=${encodeURIComponent(trimmed)}&limit=${EXPLORE_PAGE_SIZE}`,
				{ credentials: 'include' },
				{ windowMs: 500 }
			).catch(() => ({ ok: false, data: null }));

			// If another search started while this one was in flight, ignore this response.
			if (token !== this.searchRequestToken) {
				return;
			}

			if (!res.ok) {
				resultsEl.innerHTML = html`
					<div class="route-empty route-empty-image-grid">
						<div class="route-empty-title">Unable to search creations</div>
						<div class="route-empty-message">Please try again in a moment.</div>
					</div>
				`;
				return;
			}

			const items = Array.isArray(res.data?.items) ? res.data.items : [];
			if (items.length === 0) {
				resultsEl.innerHTML = html`
					<div class="route-empty route-empty-image-grid">
						<div class="route-empty-title">No creations found</div>
					</div>
				`;
				return;
			}

			// Reuse the same card renderer as the main explore feed so layout stays consistent.
			resultsEl.innerHTML = '';
			this.appendExploreCards(resultsEl, items);
		} catch (err) {
			// Network / unexpected error
			resultsEl.innerHTML = html`
				<div class="route-empty route-empty-image-grid">
					<div class="route-empty-title">Unable to search creations</div>
					<div class="route-empty-message">Please try again in a moment.</div>
				</div>
			`;
		}
	}

	refreshOnActivate() {
		if (!this.hasLoadedOnce) {
			this.loadExplore({ reset: true });
			return;
		}
		this.resumeImageLazyLoading();
	}

	async loadExplore({ reset = false } = {}) {
		const container = this.querySelector("[data-explore-container]");
		if (!container) return;
		if (this.isLoading) return;
		if (!this.isRouteActive()) return;

		if (reset) {
			this.exploreOffset = 0;
			this.hasMore = true;
		}

		this.isLoading = true;
		if (reset) {
			container.innerHTML = html`<div class="route-empty route-empty-image-grid route-loading">
	<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
</div>`;
		}

		try {
			const offset = reset ? 0 : this.exploreOffset;
			const res = await fetchJsonWithStatusDeduped(
				`/api/explore?limit=${EXPLORE_PAGE_SIZE}&offset=${offset}`,
				{ credentials: 'include' },
				{ windowMs: 500 }
			).catch(() => ({ ok: false, data: null }));

			let cont = this.querySelector("[data-explore-container]");
			if (!cont) return;

			if (!res.ok) {
				cont.innerHTML = html`<div class="route-empty route-empty-image-grid">Unable to load explore.</div>`;
				return;
			}

			const items = Array.isArray(res.data?.items) ? res.data.items : [];
			const apiHasMore = res.data && res.data.hasMore === true;
			this.hasMore = apiHasMore && items.length >= EXPLORE_PAGE_SIZE;
			this.updateLoadMoreFallback();

			if (reset && items.length === 0) {
				cont.innerHTML = html`
		<div class="route-empty route-empty-image-grid">
			<div class="route-empty-title">Nothing to explore yet</div>
			<div class="route-empty-message">Published creations from the community will appear here.</div>
		</div>
        `;
				this.hasLoadedOnce = true;
				return;
			}

			if (reset) {
				cont.innerHTML = '';
				if (this.imageObserver) this.imageObserver.disconnect();
				this.imageLoadQueue = [];
				this.imageLoadsInFlight = 0;
				this.setupImageLazyLoading();
			}

			this.appendExploreCards(cont, items);
			this.exploreOffset = offset + items.length;
			this.hasLoadedOnce = true;
			if (this.hasMore) this.observeLoadMoreSentinel();
		} catch (err) {
			const errCont = this.querySelector("[data-explore-container]");
			if (errCont) errCont.innerHTML = html`<div class="route-empty route-empty-image-grid">Unable to load explore.</div>`;
		} finally {
			this.isLoading = false;
			this.updateLoadMoreFallback();
			if (this.hasMore) this.observeLoadMoreSentinel();
		}
	}

	async loadMore() {
		if (!this.hasMore || this.isLoadingMore || this.isLoading || !this.isRouteActive()) return;
		if (!this.hasLoadedOnce) return;

		this.isLoadingMore = true;
		this.updateLoadMoreFallback();
		try {
			const res = await fetchJsonWithStatusDeduped(
				`/api/explore?limit=${EXPLORE_PAGE_SIZE}&offset=${this.exploreOffset}`,
				{ credentials: 'include' },
				{ windowMs: 500 }
			).catch(() => ({ ok: false, data: null }));

			const container = this.querySelector("[data-explore-container]");
			if (!container || !res.ok) {
				this.isLoadingMore = false;
				this.updateLoadMoreFallback();
				return;
			}

			const items = Array.isArray(res.data?.items) ? res.data.items : [];
			const apiHasMore = res.data && res.data.hasMore === true;
			this.hasMore = apiHasMore && items.length >= EXPLORE_PAGE_SIZE;
			this.updateLoadMoreFallback();

			this.appendExploreCards(container, items);
			this.exploreOffset += items.length;
			if (this.hasMore) this.observeLoadMoreSentinel();
		} finally {
			this.isLoadingMore = false;
			this.updateLoadMoreFallback();
		}
	}

	appendExploreCards(cont, items) {
		const startIndex = cont.querySelectorAll('.route-card').length;
		items.forEach((item, i) => {
			if (!item || typeof item !== 'object') return;
			const card = document.createElement('div');
			card.className = 'route-card route-card-image';

			const authorUserName = typeof item.author_user_name === 'string' ? item.author_user_name.trim() : '';
			const authorUserId = item.user_id != null ? Number(item.user_id) : null;
			const profileHref = buildProfilePath({ userName: authorUserName, userId: authorUserId });
			const authorDisplayName = typeof item.author_display_name === 'string' ? item.author_display_name.trim() : '';
			const emailPrefix = typeof item.author === 'string' && item.author.includes('@') ? item.author.split('@')[0] : '';
			const authorLabel = authorDisplayName || authorUserName || emailPrefix || item.author || 'User';
			const handleText = authorUserName || emailPrefix || '';
			const handle = handleText ? `@${handleText}` : '';

			card.style.cursor = 'pointer';
			card.addEventListener('click', () => {
				if (item.created_image_id) {
					window.location.href = `/creations/${item.created_image_id}`;
				}
			});

			card.innerHTML = html`
		<div class="route-media" aria-hidden="true" data-image-id="${item.created_image_id ?? ''}" data-status="completed">
		</div>
		<div class="route-details">
			<div class="route-details-content">
				<div class="route-title">${item.title != null ? item.title : 'Untitled'}</div>
				<div class="route-summary">${item.summary != null ? item.summary : ''}</div>
				<div class="route-meta" title="${formatDateTime(item.created_at)}">${formatRelativeTime(item.created_at)}</div>
				<div class="route-meta">
					By ${profileHref ? html`<a class="user-link" href="${profileHref}" data-profile-link>${authorLabel}</a>` :
					authorLabel}${handle ? html` <span>(${handle})</span>` : ''}
				</div>
				<div class="route-meta route-meta-spacer"></div>
				<div class="route-tags">${item.tags || ''}</div>
			</div>
		</div>
      `;

			const mediaEl = card.querySelector('.route-media');
			const url = item.thumbnail_url || item.image_url;
			if (mediaEl && url) {
				mediaEl.dataset.bgUrl = url;
				mediaEl.dataset.bgQueued = '0';
				const index = startIndex + i;
				if (index < this.eagerImageCount) {
					setRouteMediaBackgroundImage(mediaEl, url, { lowPriority: !this.isRouteActive() });
				} else if (this.imageObserver) {
					this.imageObserver.observe(mediaEl);
				}
			}

			const profileLink = card.querySelector('[data-profile-link]');
			if (profileLink) {
				profileLink.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					window.location.href = profileLink.getAttribute('href') || '#';
				});
			}

			cont.appendChild(card);
		});
	}
}

customElements.define('app-route-explore', AppRouteExplore);
