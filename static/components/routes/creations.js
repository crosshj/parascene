import { formatDateTime, formatRelativeTime } from '../../shared/datetime.js';
import { fetchJsonWithStatusDeduped } from '../../shared/api.js';

const html = String.raw;

function parseMeta(raw) {
	if (raw == null) return null;
	if (typeof raw === 'object') return raw;
	if (typeof raw !== 'string') return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function isTimedOut(status, meta) {
	if (status !== 'creating') return false;
	const timeoutAt = meta && typeof meta.timeout_at === 'string' ? new Date(meta.timeout_at).getTime() : NaN;
	if (!Number.isFinite(timeoutAt)) return false;
	return Date.now() > timeoutAt;
}

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

function getHiddenFailedCreationIds() {
	try {
		const raw = sessionStorage.getItem('hiddenFailedCreations');
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((id) => typeof id === 'number' || typeof id === 'string');
	} catch {
		return [];
	}
}

class AppRouteCreations extends HTMLElement {
	isRouteActive() {
		try {
			return window.__CURRENT_ROUTE__ === 'creations' || this.isActiveRoute === true;
		} catch {
			return this.isActiveRoute === true;
		}
	}

	resumeImageLazyLoading() {
		// Recreate observer and re-observe any tiles that still need images.
		this.setupImageLazyLoading();
		const pendingTiles = this.querySelectorAll('.route-media[data-bg-url]');
		pendingTiles.forEach((mediaEl) => {
			if (!mediaEl) return;
			if (mediaEl.classList.contains('route-media-error')) return;
			// If it already has a background image, don't reload.
			if (mediaEl.style && typeof mediaEl.style.backgroundImage === 'string' && mediaEl.style.backgroundImage) return;
			if (!mediaEl.dataset.bgUrl) return;
			mediaEl.dataset.bgQueued = '0';
			if (this.imageObserver) this.imageObserver.observe(mediaEl);
		});
		this.drainImageLoadQueue();
	}

	connectedCallback() {
		this.innerHTML = html`
      <div class="creations-route">
        <div class="route-header">
          <h3>Creations</h3>
          <p>Your generated creations. Share them when you're ready.</p>
        </div>
        <div class="route-cards route-cards-image-grid" data-creations-container>
          <div class="route-empty route-empty-image-grid route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>
        </div>
      </div>
    `;
		this.pollInterval = null;
		this.hasLoadedOnce = false;
		this.isLoading = false;
		this.isActiveRoute = false;
		this.deferredPreloadTimer = null;
		this.deferredPreloadIdle = null;
		this.setupRouteListener();
		this.pendingUpdateHandler = () => {
			if (this.isActiveRoute) {
				this.loadCreations({ force: true, background: false });
			} else {
				// Defer background refresh so the current route keeps priority.
				this.scheduleDeferredPreload();
			}
		};
		document.addEventListener('creations-pending-updated', this.pendingUpdateHandler);
		this.setupImageLazyLoading();

		this.scheduleDeferredPreload = () => {
			if (this.hasLoadedOnce) return;
			if (this.deferredPreloadTimer || this.deferredPreloadIdle) return;
			this.deferredPreloadTimer = setTimeout(() => {
				this.deferredPreloadTimer = null;
				const run = () => {
					this.deferredPreloadIdle = null;
					if (this.isActiveRoute || this.hasLoadedOnce) return;
					this.loadCreations({ force: true, background: true });
				};
				if (typeof requestIdleCallback === 'function') {
					this.deferredPreloadIdle = requestIdleCallback(run, { timeout: 2000 });
				} else {
					run();
				}
			}, 3000);
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

		// Mount-time awareness of current route.
		const initialRoute = window.__CURRENT_ROUTE__ || null;
		const pathname = window.location.pathname || '';
		const inferred = initialRoute || (pathname.startsWith('/creations') ? 'creations' : null);
		this.isActiveRoute = inferred === 'creations';
		if (this.isRouteActive()) {
			this.cancelDeferredPreload();
			this.refreshOnActivate();
			this.startPolling();
		} else {
			this.scheduleDeferredPreload();
		}
	}

	setupRouteListener() {
		// Listen for route change events to reload when creations route becomes active
		this.routeChangeHandler = (e) => {
			const route = e.detail?.route;
			if (typeof route !== 'string') {
				// Ignore unrelated/malformed route-change events.
				return;
			}
			if (route === 'creations') {
				this.isActiveRoute = true;
				this.cancelDeferredPreload();
				// Only refresh if stale or needed to avoid flicker
				this.refreshOnActivate();
				// If we didn't rebuild, make sure lazy loading resumes.
				if (this.hasLoadedOnce) {
					this.resumeImageLazyLoading();
				}
				// Restart polling in case it was stopped
				if (!this.pollInterval) {
					this.startPolling();
				}
			} else {
				this.isActiveRoute = false;
				// If the route is not active, stop background polling and image work.
				this.stopPolling();
				if (this.imageObserver) this.imageObserver.disconnect();
				this.imageLoadQueue = [];
				this.imageLoadsInFlight = 0;
			}
		};
		document.addEventListener('route-change', this.routeChangeHandler);

		// Also use IntersectionObserver to detect when element becomes visible
		// This catches cases where the route change event might not fire
		this.intersectionObserver = new IntersectionObserver((entries) => {
			entries.forEach(entry => {
				if (entry.isIntersecting && entry.target === this) {
					// If the element is actually visible, treat it as active to avoid stalls.
					this.isActiveRoute = true;
					// Element is visible, refresh if needed
					this.refreshOnActivate();
					if (this.hasLoadedOnce) {
						this.resumeImageLazyLoading();
					}
					if (!this.pollInterval) {
						this.startPolling();
					}
				}
			});
		}, {
			threshold: 0.1 // Trigger when at least 10% visible
		});

		this.intersectionObserver.observe(this);
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
			Promise.resolve(setRouteMediaBackgroundImage(next.el, next.url, { lowPriority: !this.isRouteActive() }))
				.finally(() => {
					this.imageLoadsInFlight -= 1;
					this.drainImageLoadQueue();
				});
		}
	}

	disconnectedCallback() {
		this.stopPolling();
		if (typeof this.cancelDeferredPreload === 'function') {
			this.cancelDeferredPreload();
		}
		if (this.routeChangeHandler) {
			document.removeEventListener('route-change', this.routeChangeHandler);
		}
		if (this.pendingUpdateHandler) {
			document.removeEventListener('creations-pending-updated', this.pendingUpdateHandler);
		}
		if (this.intersectionObserver) {
			this.intersectionObserver.disconnect();
		}
		if (this.imageObserver) {
			this.imageObserver.disconnect();
			this.imageObserver = null;
		}
		this.imageLoadQueue = [];
		this.imageLoadsInFlight = 0;
	}

	getPendingCreations() {
		const pending = JSON.parse(sessionStorage.getItem("pendingCreations") || "[]");
		return Array.isArray(pending) ? pending : [];
	}

	startPolling() {
		// Poll every 2 seconds for creations that are still being created
		this.pollInterval = setInterval(() => {
			this.checkForUpdates();
		}, 2000);
	}

	stopPolling() {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}

	async checkForUpdates() {
		const container = this.querySelector("[data-creations-container]");
		if (!container) return;

		// Check if there are any loading creations
		const loadingCreations = container.querySelectorAll('.route-media[data-image-id][data-status="creating"]');
		if (loadingCreations.length === 0) {
			// No loading creations, stop polling
			this.stopPolling();
			return;
		}

		try {
			const result = await fetchJsonWithStatusDeduped("/api/create/images", {
				credentials: 'include'
			}, { windowMs: 300 });
			if (!result.ok) return;

			const creations = Array.isArray(result.data?.images) ? result.data.images : [];

			// Update any creations that have changed out of "creating"
			let hasUpdates = false;
			loadingCreations.forEach(loadingElement => {
				const creationId = loadingElement.getAttribute('data-image-id');
				const updatedCreation = creations.find(c => c.id.toString() === creationId);
				if (updatedCreation && updatedCreation.status && updatedCreation.status !== 'creating') {
					hasUpdates = true;
				}
			});

			if (hasUpdates) {
				// Reload the entire list to get the updated creations (including failed/timed-out)
				this.loadCreations({ force: true, background: !this.isRouteActive() });
			}
		} catch (error) {
			console.error("Error checking for updates:", error);
		}
	}

	refreshOnActivate() {
		const hasPending = this.getPendingCreations().length > 0;
		const hasLoading = this.querySelectorAll('.route-media[data-image-id][data-status="creating"]').length > 0;

		if (!this.hasLoadedOnce || hasPending || hasLoading) {
			this.loadCreations({ force: true, background: !this.isRouteActive() });
			return;
		}

		// Already loaded and nothing pending: ensure lazy loads keep flowing.
		this.resumeImageLazyLoading();
	}

	async loadCreations({ force = false, background = false } = {}) {
		const container = this.querySelector("[data-creations-container]");
		if (!container) return;
		if (this.isLoading) return;
		if (!background && !this.isRouteActive()) return;
		if (!force && this.hasLoadedOnce) return;

		try {
			this.isLoading = true;
			// Fetch created creations only
			const creationsResult = await fetchJsonWithStatusDeduped("/api/create/images", {
				credentials: 'include'
			}, { windowMs: 500 }).catch(() => ({ ok: false, status: 0, data: null }));

			const creationsRaw = creationsResult.ok
				? (Array.isArray(creationsResult.data?.images) ? creationsResult.data.images : [])
				: [];

			const hiddenIds = getHiddenFailedCreationIds();
			const hiddenSet = new Set(hiddenIds.map((id) => String(id)));
			const creations = creationsRaw.filter((item) => !hiddenSet.has(String(item.id)));

			container.innerHTML = "";
			// New content means new media elements; clear previous observers/queue.
			if (this.imageObserver) this.imageObserver.disconnect();
			this.imageLoadQueue = [];
			this.imageLoadsInFlight = 0;
			this.setupImageLazyLoading();

			const pendingCreations = this.getPendingCreations();

			// Dedupe pending vs DB rows by creation_token when available.
			const creationsByToken = new Map();
			creations.forEach((item) => {
				const meta = parseMeta(item.meta);
				const token = meta && typeof meta.creation_token === 'string' ? meta.creation_token : null;
				if (token) {
					creationsByToken.set(token, item);
				}
			});

			const filteredPending = pendingCreations.filter((p) => {
				const token = typeof p.creation_token === 'string' ? p.creation_token : null;
				if (!token) return true;
				return !creationsByToken.has(token);
			});

			const combinedCreations = [...filteredPending, ...creations];

			if (combinedCreations.length === 0) {
				container.innerHTML = html`
          <div class="route-empty route-empty-image-grid">
            <div class="route-empty-title">No creations yet</div>
            <div class="route-empty-message">Start creating to see your work here.</div>
            <a href="/create" class="route-empty-button" data-route="create">Get Started</a>
          </div>
        `;

				// Add click handler for the button to use client-side routing
				const button = container.querySelector('.route-empty-button');
				if (button) {
					button.addEventListener('click', (e) => {
						e.preventDefault();
						const header = document.querySelector('app-navigation');
						if (header && typeof header.handleRouteChange === 'function') {
							window.history.pushState({ route: 'create' }, '', '/create');
							header.handleRouteChange();
						} else {
							window.location.hash = 'create';
						}
					});
				}
				this.hasLoadedOnce = true;
				return;
			}

			// Sort creations by created_at (newest first)
			const sortedCreations = combinedCreations.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

			sortedCreations.forEach((item, index) => {
				const card = document.createElement("div");
				card.className = "route-card route-card-image";

				const meta = parseMeta(item.meta);
				const rawStatus = item.status || 'completed';
				const timedOut = isTimedOut(rawStatus, meta);
				const status = timedOut && rawStatus === 'creating' ? 'failed' : rawStatus;

				const isPending = status === 'pending';
				const isCreating = status === 'creating';
				const isFailed = status === 'failed';

				if (isPending) {
					// Local pending item (no DB row yet)
					card.innerHTML = html`
            <div 
              class="route-media loading"
              data-image-id="${item.id}"
              data-status="pending"
              aria-hidden="true"
            ></div>
            <div class="route-details">
              <div class="route-details-content">
                <div class="route-title">Creating...</div>
                <div class="route-summary">Your creation is being processed...</div>
                <div class="route-meta" title="${formatDateTime(item.created_at)}">${formatRelativeTime(item.created_at)}</div>
              </div>
            </div>
          `;
				} else if (isCreating) {
					// DB row still creating
					card.innerHTML = html`
            <div 
              class="route-media loading"
              data-image-id="${item.id}"
              data-status="creating"
              aria-hidden="true"
            ></div>
            <div class="route-details">
              <div class="route-details-content">
                <div class="route-title">Creating...</div>
                <div class="route-summary">Your creation is being processed...</div>
                <div class="route-meta" title="${formatDateTime(item.created_at)}">${formatRelativeTime(item.created_at)}</div>
              </div>
            </div>
          `;
					// Restart polling if it was stopped
					if (this.isActiveRoute && !this.pollInterval) {
						this.startPolling();
					}
				} else if (isFailed) {
					// Failed or timed-out creation: show error placeholder; click opens detail view.
					const reason =
						(meta && typeof meta.error === 'string' && meta.error) ||
						(meta && meta.error_code === 'timeout'
							? 'This creation timed out.'
							: 'This creation failed.');

					card.style.cursor = 'pointer';
					card.addEventListener('click', () => {
						window.location.href = `/creations/${item.id}`;
					});

					card.innerHTML = html`
            <div 
              class="route-media route-media-error"
              data-image-id="${item.id}"
              data-status="failed"
              aria-hidden="true"
            ></div>
            <div class="route-details">
              <div class="route-details-content">
                <div class="route-title">Creation unavailable</div>
                <div class="route-summary">${reason}</div>
                <div class="route-meta" title="${formatDateTime(item.created_at)}">Created ${formatRelativeTime(
						item.created_at
					)}</div>
              </div>
            </div>
          `;
				} else {
					// Show completed image - make it clickable
					card.style.cursor = 'pointer';
					card.addEventListener('click', () => {
						// Navigate to server route for creation detail
						window.location.href = `/creations/${item.id}`;
					});

					const isPublished = item.published === true || item.published === 1;
					let publishedBadge = '';
					let publishedInfo = '';

					if (isPublished) {
						publishedBadge = html`
              <div class="creation-published-badge" title="Published">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
              </div>
            `;
					}

					if (isPublished && item.published_at) {
						const publishedDate = new Date(item.published_at);
						const publishedTimeAgo = formatRelativeTime(publishedDate);
						publishedInfo = html`<div class="route-meta" title="${formatDateTime(item.published_at)}">Published ${publishedTimeAgo}</div>`;
					}

					card.innerHTML = html`
            <div 
              class="route-media"
              aria-hidden="true"
              data-image-id="${item.id}"
              data-status="completed"
            ></div>
            ${publishedBadge}
            <div class="route-details">
              <div class="route-details-content">
                <div class="route-title">${item.title || 'Untitled'}</div>
                <div class="route-summary">${item.width} × ${item.height}px</div>
                ${publishedInfo}
                <div class="route-meta" title="${formatDateTime(item.created_at)}">Created ${formatRelativeTime(item.created_at)}</div>
                <div class="route-meta route-meta-spacer"></div>
                <div class="route-tags">Color: ${item.color || 'N/A'}</div>
              </div>
            </div>
          `;

					const mediaEl = card.querySelector('.route-media');
					const url = item.thumbnail_url || item.url;
					if (index < this.eagerImageCount) {
						setRouteMediaBackgroundImage(mediaEl, url, { lowPriority: !this.isRouteActive() });
					} else if (this.imageObserver && mediaEl) {
						mediaEl.dataset.bgUrl = url;
						mediaEl.dataset.bgQueued = '0';
						this.imageObserver.observe(mediaEl);
					}
				}

				container.appendChild(card);
			});
			this.hasLoadedOnce = true;
		} catch (error) {
			console.error("Error loading creations:", error);
			container.innerHTML = html`
        <div class="route-empty route-empty-image-grid">Unable to load creations.</div>
      `;
		} finally {
			this.isLoading = false;
		}
	}

	async retryCreation(item) {
		const meta = item.meta || parseMeta(item.meta);
		const serverId = meta && typeof meta.server_id !== 'undefined' ? meta.server_id : null;
		const method = meta && typeof meta.method === 'string' ? meta.method : null;
		const args = meta && typeof meta.args === 'object' && meta.args ? meta.args : {};

		if (!serverId || !method) {
			console.warn('retryCreation: missing server_id or method in meta', meta);
			alert('Cannot retry this creation because its details are missing.');
			return;
		}

		const creationToken = `crt_retry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

		try {
			const res = await fetch('/api/create', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				credentials: 'include',
				body: JSON.stringify({
					server_id: serverId,
					method,
					args: args || {},
					creation_token: creationToken
				})
			});

			if (!res.ok) {
				let message = 'Failed to retry creation.';
				try {
					const data = await res.json();
					if (data && typeof data.error === 'string') {
						message = data.error;
					} else if (typeof data.message === 'string') {
						message = data.message;
					}
				} catch {
					// ignore parse errors
				}
				alert(message);
				return;
			}

			// Reload list to pick up new creating row + updated credits.
			await this.loadCreations({ force: true, background: false });
		} catch (error) {
			console.error('Error retrying creation:', error);
			alert('Failed to retry creation. Please try again.');
		}
	}

	async deleteCreation(item) {
		if (!item || typeof item.id === 'undefined' || item.id === null) {
			alert('Cannot delete this creation.');
			return;
		}

		if (!confirm('Are you sure you want to delete this creation? This action cannot be undone.')) {
			return;
		}

		try {
			const res = await fetch(`/api/create/images/${item.id}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (!res.ok) {
				let message = 'Failed to delete creation.';
				try {
					const data = await res.json();
					if (data && typeof data.error === 'string') {
						message = data.error;
					}
				} catch {
					// ignore
				}
				alert(message);
				return;
			}

			await this.loadCreations({ force: true, background: false });
		} catch (error) {
			console.error('Error deleting creation from list view:', error);
			alert('Failed to delete creation. Please try again.');
		}
	}
}

customElements.define("app-route-creations", AppRouteCreations);
