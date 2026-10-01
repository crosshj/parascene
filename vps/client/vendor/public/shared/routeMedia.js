/**
 * Shared utilities for .route-media tiles: lazy-loading background images
 * and scheduling image work (idle/visibility). Used by feed, explore, creations, user-profile.
 */

export function scheduleImageWork(start, { immediate = true, wakeOnVisible = true } = {}) {
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

/**
 * Load image into a .route-media element as a background. Sets route-media-has-image on success
 * (for feed placeholder styling); other routes ignore that class. Sets route-media-error on failure.
 * @param {HTMLElement} mediaEl - element with class .route-media
 * @param {string} url - image URL
 * @param {{ lowPriority?: boolean }} options - lowPriority: use low fetch priority and defer work
 * @returns {Promise<boolean>} - resolves true on load, false on error; undefined if skipped
 */
export function setRouteMediaBackgroundImage(mediaEl, url, { lowPriority = false } = {}) {
	if (!mediaEl || !url) return;

	if (mediaEl.dataset.bgLoadedUrl === url) {
		return Promise.resolve(true);
	}

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
				mediaEl.dataset.bgLoadedUrl = url;
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
