import { formatDateTime, formatRelativeTime } from '../../shared/datetime.js';
import { fetchJsonWithStatusDeduped } from '../../shared/api.js';

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
		};

		if (wakeOnVisible) {
			document.addEventListener('visibilitychange', onVisibilityChange);
		}

		// Low priority: wait for idle time (and/or small delay).
		if (typeof requestIdleCallback === 'function') {
			idleHandle = requestIdleCallback(() => runNow(), { timeout: 2000 });
		} else {
			timeoutHandle = setTimeout(() => runNow(), 500);
		}
	});
}

function setRouteMediaBackgroundImage(mediaEl, url, { lowPriority = false } = {}) {
	if (!mediaEl || !url) return;

	// Always preload, but let the active/visible route win.
	mediaEl.classList.remove('route-media-has-image');
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
				mediaEl.classList.remove('route-media-error');
				mediaEl.classList.add('route-media-has-image');
				mediaEl.style.backgroundImage = `url("${String(url).replace(/"/g, '\\"')}")`;
				resolve(true);
			};
			probe.onerror = () => {
				mediaEl.classList.remove('route-media-has-image');
				mediaEl.classList.add('route-media-error');
				mediaEl.style.backgroundImage = '';
				resolve(false);
			};
			probe.src = url;
		};

		void scheduleImageWork(startProbe, { immediate: !lowPriority, wakeOnVisible: !lowPriority });
	});
}

class AppRouteExplore extends HTMLElement {
	isRouteActive() {
		try {
			return window.__CURRENT_ROUTE__ === 'explore' || this.isActiveRoute === true;
		} catch {
			return this.isActiveRoute === true;
		}
	}

	connectedCallback() {
		this.innerHTML = html`
      <style>
        .explore-route .route-media:not(.route-media-has-image) {
          background:
            linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(5, 199, 111, 0.2)),
            repeating-linear-gradient(
              45deg,
              rgba(255, 255, 255, 0.06) 0,
              rgba(255, 255, 255, 0.06) 6px,
              rgba(255, 255, 255, 0.02) 6px,
              rgba(255, 255, 255, 0.02) 12px
            );
        }
        .explore-route .route-media.route-media-has-image {
          background-size: cover !important;
          background-position: center !important;
        }
      </style>
      <div class="explore-route">
        <div class="route-header">
        <h3>Explore</h3>
        <p>Discover creations from the broader community, including people you are not friends with yet.</p>
        </div>
        <div class="route-cards route-cards-image-grid" data-explore-container>
        <div class="route-empty route-empty-image-grid route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>
        </div>
      </div>
    `;
		this.setupImageLazyLoading();
		this.hasLoadedOnce = false;
		this.isLoading = false;
		// Use null so the initial setActiveRoute() always runs once
		// (so inactive routes can schedule deferred background preloads).
		this.isActiveRoute = null;
		this.loadedAt = 0;
		this.deferredPreloadTimer = null;
		this.deferredPreloadIdle = null;

		this.setActiveRoute = (shouldBeActive) => {
			const next = Boolean(shouldBeActive);
			if (next === this.isActiveRoute) return;
			this.isActiveRoute = next;

			if (this.isActiveRoute) {
				this.cancelDeferredPreload();
				this.refreshOnActivate();
			} else {
				// Stop scheduling more image work while inactive.
				if (this.imageObserver) this.imageObserver.disconnect();
				this.imageLoadQueue = [];
				this.imageLoadsInFlight = 0;

				// Defer preload work so the current route gets priority.
				this.scheduleDeferredPreload();
			}
		};

		this.refreshOnActivate = () => {
			// If we already have cards, don't blow them away; just resume lazy loading.
			if (this.hasLoadedOnce) {
				const now = Date.now();
				const isStale = !this.loadedAt || (now - this.loadedAt) > 60000;
				if (isStale) {
					this.loadExplore({ background: false, force: true });
					return;
				}
				this.resumeImageLazyLoading();
				return;
			}

			this.loadExplore({ background: false, force: true });
		};

		this.resumeImageLazyLoading = () => {
			// Recreate observer and re-observe any tiles that still need images.
			this.setupImageLazyLoading();
			const pendingTiles = this.querySelectorAll('.route-media[data-bg-url]');
			pendingTiles.forEach((mediaEl) => {
				if (!mediaEl) return;
				if (mediaEl.classList.contains('route-media-has-image')) return;
				if (mediaEl.classList.contains('route-media-error')) return;
				if (!mediaEl.dataset.bgUrl) return;
				mediaEl.dataset.bgQueued = '0';
				if (this.imageObserver) this.imageObserver.observe(mediaEl);
			});
			this.drainImageLoadQueue();
		};

		this.scheduleDeferredPreload = () => {
			if (this.hasLoadedOnce) return;
			if (this.deferredPreloadTimer || this.deferredPreloadIdle) return;
			this.deferredPreloadTimer = setTimeout(() => {
				this.deferredPreloadTimer = null;
				const run = () => {
					this.deferredPreloadIdle = null;
					if (this.isActiveRoute || this.hasLoadedOnce) return;
					this.loadExplore({ background: true, force: true });
				};
				if (typeof requestIdleCallback === 'function') {
					this.deferredPreloadIdle = requestIdleCallback(run, { timeout: 2000 });
				} else {
					run();
				}
			}, 2500);
		};

		this.cancelDeferredPreload = () => {
			if (this.deferredPreloadTimer) {
				clearTimeout(this.deferredPreloadTimer);
				this.deferredPreloadTimer = null;
			}
			if (this.deferredPreloadIdle && typeof cancelIdleCallback === 'function') {
				cancelIdleCallback(this.deferredPreloadIdle);
				this.deferredPreloadIdle = null;
			}
		};

		this.routeChangeHandler = (e) => {
			const route = e?.detail?.route;
			if (typeof route !== 'string') return;
			this.setActiveRoute(route === 'explore');
		};
		document.addEventListener('route-change', this.routeChangeHandler);

		// Mount-time awareness of current route.
		const initialRoute = window.__CURRENT_ROUTE__ || null;
		const pathname = window.location.pathname || '';
		const inferred = initialRoute || (pathname.startsWith('/explore') ? 'explore' : null);
		this.setActiveRoute(inferred === 'explore');
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

		// (Re)create observer
		if (this.imageObserver) this.imageObserver.disconnect();
		this.imageObserver = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (!entry.isIntersecting) return;

				const el = entry.target;
				if (!el || el.dataset.bgQueued === '1') return;

				const url = el.dataset.bgUrl;
				if (!url) {
					this.imageObserver.unobserve(el);
					return;
				}

				el.dataset.bgQueued = '1';
				this.imageObserver.unobserve(el);
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
			Promise.resolve(setRouteMediaBackgroundImage(next.el, next.url, { lowPriority: !this.isActiveRoute }))
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
		if (typeof this.cancelDeferredPreload === 'function') {
			this.cancelDeferredPreload();
		}
		if (this.imageObserver) {
			this.imageObserver.disconnect();
			this.imageObserver = null;
		}
		this.imageLoadQueue = [];
		this.imageLoadsInFlight = 0;
	}

	async loadExplore({ background = false, force = false } = {}) {
		if (this.isLoading) return;
		if (!background && !this.isRouteActive()) return;
		if (!force && this.hasLoadedOnce) {
			// If already loaded and not forcing, just resume lazy loading.
			this.resumeImageLazyLoading();
			return;
		}

		const container = this.querySelector("[data-explore-container]");
		if (!container) return;

		try {
			this.isLoading = true;
			// Get current user ID
			let currentUserId = null;
			const profile = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 2000 })
				.catch(() => ({ ok: false, status: 0, data: null }));
			if (profile.ok) {
				currentUserId = profile.data?.id ?? null;
			}

			const feed = await fetchJsonWithStatusDeduped("/api/explore", {
				credentials: 'include'
			}, { windowMs: 2000 });
			if (!feed.ok) throw new Error("Failed to load explore.");
			const items = Array.isArray(feed.data?.items) ? feed.data.items : [];

			container.innerHTML = "";
			// New content means new media elements; clear previous observers/queue.
			if (this.imageObserver) this.imageObserver.disconnect();
			this.imageLoadQueue = [];
			this.imageLoadsInFlight = 0;
			this.setupImageLazyLoading();

			if (items.length === 0) {
				// Check if user has any follows to determine if they've followed everyone
				let hasFollows = false;
				if (currentUserId) {
					try {
						const following = await fetchJsonWithStatusDeduped(`/api/users/${currentUserId}/following`, {
							credentials: 'include'
						}, { windowMs: 2000 }).catch(() => ({ ok: false, status: 0, data: null }));
						if (following.ok && Array.isArray(following.data?.following)) {
							hasFollows = following.data.following.length > 0;
						}
					} catch (e) {
						// If check fails, default to regular empty message
					}
				}

				if (hasFollows) {
					// User has followed everyone (or at least everyone with published content)
					container.innerHTML = html`
            <div class="route-empty route-empty-image-grid feed-empty-state">
              <div class="feed-empty-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </div>
              <div class="route-empty-title">Wow, it looks like everyone is your friend!</div>
              <div class="route-empty-message">Go check out your feed to see what they're up to!</div>
              <a class="route-empty-button" href="/feed" data-route="feed">View Your Feed</a>
            </div>
          `;

					// Use client-side routing for the CTA
					const button = container.querySelector('.route-empty-button[data-route="feed"]');
					if (button) {
						button.addEventListener('click', (e) => {
							e.preventDefault();
							const header = document.querySelector('app-navigation');
							if (header && typeof header.navigateToRoute === 'function') {
								header.navigateToRoute('feed');
								return;
							}
							window.location.href = '/feed';
						});
					}
				} else {
					// Regular empty state - no content available
					container.innerHTML = html`
            <div class="route-empty route-empty-image-grid feed-empty-state">
              <div class="feed-empty-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
              </div>
              <div class="route-empty-title">Your explore feed is empty</div>
              <div class="route-empty-message">Published creations from the community will appear here. Start creating and sharing to see content in your explore feed.</div>
            </div>
          `;
				}
				return;
			}

			items.forEach((item, index) => {
				const card = document.createElement("div");
				card.className = "route-card route-card-image";
				const authorUserId = item.user_id != null ? Number(item.user_id) : null;
				const profileHref = Number.isFinite(authorUserId) && authorUserId > 0 ? `/user/${authorUserId}` : null;
				const authorUserName = typeof item.author_user_name === "string" ? item.author_user_name.trim() : "";
				const authorDisplayName = typeof item.author_display_name === "string" ? item.author_display_name.trim() : "";
				const emailPrefix = typeof item.author === "string" && item.author.includes("@")
					? item.author.split("@")[0]
					: "";
				const authorLabel = authorDisplayName || authorUserName || emailPrefix || item.author || "User";
				const handleText = authorUserName || emailPrefix || "";
				const handle = handleText ? `@${handleText}` : "";

				// If item has an image, make it clickable and use the image
				if (item.image_url && item.created_image_id) {
					card.style.cursor = 'pointer';
					card.addEventListener('click', (e) => {
						const profileLink = e.target?.closest?.('[data-profile-link]');
						if (profileLink) return;
						window.location.href = `/creations/${item.created_image_id}`;
					});
				}

				// Check if current user owns this item
				const isOwned = currentUserId && item.user_id && currentUserId === item.user_id;
				const ownedBadge = isOwned ? html`
          <div class="creation-published-badge" title="Your creation">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </div>
        ` : '';

				// Add class to indicate if there's an image (to override gradient)
				const mediaClass = item.image_url ? '' : '';

				card.innerHTML = html`
          <div class="route-media ${mediaClass}" aria-hidden="true"></div>
          ${ownedBadge}
          <div class="route-details">
            <div class="route-details-content">
              <div class="route-title">${item.title}</div>
              <div class="route-summary">${item.summary}</div>
              <div class="route-meta" title="${formatDateTime(item.created_at)}">${formatRelativeTime(item.created_at)}</div>
              <div class="route-meta">
                By ${profileHref ? html`<a class="user-link" href="${profileHref}" data-profile-link>${authorLabel}</a>` : authorLabel}${handle ? html` <span>(${handle})</span>` : ''}
              </div>
              <div class="route-meta route-meta-spacer"></div>
              <div class="route-tags">${item.tags || ""}</div>
            </div>
          </div>
        `;

				// Apply image background with proper load/error handling
				if (item.image_url) {
					const mediaEl = card.querySelector('.route-media');
					const url = item.thumbnail_url || item.image_url;
					// Always store url for resume-on-activate behavior.
					if (mediaEl) {
						mediaEl.dataset.bgUrl = url;
						mediaEl.dataset.bgQueued = '0';
					}
					if (index < this.eagerImageCount) {
						setRouteMediaBackgroundImage(mediaEl, url, { lowPriority: !this.isActiveRoute });
					} else if (this.imageObserver && mediaEl) {
						this.imageObserver.observe(mediaEl);
					}
				}
				container.appendChild(card);
			});
			this.hasLoadedOnce = true;
			this.loadedAt = Date.now();
		} catch (error) {
			container.innerHTML = html`<div class="route-empty route-empty-image-grid">Unable to load explore.</div>`;
		} finally {
			this.isLoading = false;
		}
	}
}

customElements.define("app-route-explore", AppRouteExplore);
