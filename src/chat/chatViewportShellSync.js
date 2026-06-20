/**
 * `#chatShell` visualViewport sizing, feed-like scroll pinning, composer focus retries.
 * Lived as end-of-body inline script in `pages/chat.html`; bundled so one JS request carries it.
 * Early head bootstrap (scroll, mobile header class, storage CSS vars) stays in `chat.html`.
 */
import { isVisualViewportPinchZoomed } from './chatVisualViewportPinchZoom.js';

export function initChatViewportShellSync() {
	const shell = document.getElementById('chatShell');
	const root = document.querySelector('[data-chat-page]');
	if (!shell || !root) return;

	const messagesEl = root.querySelector('[data-chat-messages]');
	const inputEl = root.querySelector('[data-chat-body-input]');

	let chatViewportCleanup = null;
	const chatViewportRetryTimeouts = [];

	function isNearBottom(el, threshold) {
		const t = threshold != null ? threshold : 24;
		return el.scrollHeight - el.scrollTop - el.clientHeight <= t;
	}

	function normalizePathname(pathname) {
		const p = String(pathname || '').replace(/\/+$/, '');
		return p || '/';
	}

	function isFeedLikePathname() {
		const path = normalizePathname(window.location?.pathname ? window.location.pathname : '');
		const chatChannelMatch = path.match(/^\/chat\/c\/([^\/?#]+)/i);
		const chatChannel = chatChannelMatch && chatChannelMatch[1]
			? String(chatChannelMatch[1]).toLowerCase()
			: '';
		const chatChannelFeedLike =
			chatChannel === 'feed' ||
			chatChannel === 'explore' ||
			chatChannel === 'creations' ||
			chatChannel === 'challenges' ||
			chatChannel === 'comments';
		return (
			path === '/creations' ||
			path === '/challenges' ||
			path === '/explore' ||
			path === '/comments' ||
			path === '/feed' ||
			path === '/' ||
			path === '/index.html' ||
			chatChannelFeedLike
		);
	}

	function clearShellVisualViewportInlineStyles() {
		try {
			shell.style.removeProperty('top');
			shell.style.removeProperty('left');
			shell.style.removeProperty('width');
			shell.style.removeProperty('height');
		} catch {
			// ignore
		}
	}

	function syncToVisualViewport() {
		const vv = window.visualViewport;
		if (!vv) {
			shell.style.top = '0px';
			shell.style.left = '0px';
			shell.style.width = '100%';
			shell.style.height = window.innerHeight + 'px';
			return;
		}
		shell.style.top = vv.offsetTop + 'px';
		shell.style.left = vv.offsetLeft + 'px';
		shell.style.width = vv.width + 'px';
		shell.style.height = vv.height + 'px';
	}

	function onViewportChange() {
		if (isVisualViewportPinchZoomed()) {
			clearShellVisualViewportInlineStyles();
			return;
		}
		if (isFeedLikePathname()) {
			syncToVisualViewport();
			try {
				window.scrollTo(0, 0);
			} catch {
				// ignore
			}
			if (messagesEl) {
				messagesEl.scrollTop = 0;
			}
			return;
		}
		const shouldStick = messagesEl && isNearBottom(messagesEl, 64);
		syncToVisualViewport();
		if (shouldStick && messagesEl) {
			requestAnimationFrame(() => {
				messagesEl.scrollTop = messagesEl.scrollHeight;
			});
		}
	}

	function clearChatViewportRetryTimeouts() {
		for (let i = 0; i < chatViewportRetryTimeouts.length; i++) {
			clearTimeout(chatViewportRetryTimeouts[i]);
		}
		chatViewportRetryTimeouts.length = 0;
	}

	function scheduleChatViewportHeightRetries() {
		clearChatViewportRetryTimeouts();
		const delays = [0, 50, 120, 220, 400];
		for (let d = 0; d < delays.length; d++) {
			(function schedule(ms) {
				const id = setTimeout(() => {
					onViewportChange();
				}, ms);
				chatViewportRetryTimeouts.push(id);
			})(delays[d]);
		}
	}

	function setupChatViewportSync() {
		if (typeof chatViewportCleanup === 'function') {
			chatViewportCleanup();
			chatViewportCleanup = null;
		}
		const onComposerFocusViewport = (ev) => {
			if (!(inputEl instanceof HTMLElement) || ev.target !== inputEl) return;
			scheduleChatViewportHeightRetries();
		};
		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', onViewportChange);
			window.visualViewport.addEventListener('scroll', onViewportChange);
		}
		window.addEventListener('resize', onViewportChange);
		window.addEventListener('orientationchange', onViewportChange);
		root.addEventListener('focusin', onComposerFocusViewport);
		root.addEventListener('focusout', onComposerFocusViewport);
		if (inputEl instanceof HTMLElement) {
			inputEl.addEventListener('focus', onViewportChange);
			inputEl.addEventListener('blur', onViewportChange);
		}
		onViewportChange();
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				onViewportChange();
			});
		});
		if (isFeedLikePathname()) {
			try {
				if (window.history && 'scrollRestoration' in window.history) {
					window.history.scrollRestoration = 'manual';
				}
			} catch {
				// ignore
			}
			try {
				window.scrollTo(0, 0);
			} catch {
				// ignore
			}
			try {
				document.documentElement.scrollTop = 0;
				document.body.scrollTop = 0;
			} catch {
				// ignore
			}
		}
		if (messagesEl) {
			messagesEl.scrollTop = isFeedLikePathname() ? 0 : messagesEl.scrollHeight;
		}
		const forceFeedLikeTop = () => {
			if (!isFeedLikePathname()) return;
			try {
				window.scrollTo(0, 0);
			} catch {
				// ignore
			}
			try {
				document.documentElement.scrollTop = 0;
				document.body.scrollTop = 0;
			} catch {
				// ignore
			}
			if (messagesEl) {
				messagesEl.scrollTop = 0;
			}
		};
		forceFeedLikeTop();
		requestAnimationFrame(() => {
			forceFeedLikeTop();
			requestAnimationFrame(forceFeedLikeTop);
		});
		window.addEventListener('pageshow', forceFeedLikeTop);
		window.addEventListener('load', forceFeedLikeTop);
		const settleDelays = [60, 180, 360];
		for (let i = 0; i < settleDelays.length; i++) {
			setTimeout(forceFeedLikeTop, settleDelays[i]);
		}
		chatViewportCleanup = () => {
			clearChatViewportRetryTimeouts();
			window.removeEventListener('pageshow', forceFeedLikeTop);
			window.removeEventListener('load', forceFeedLikeTop);
			try {
				shell.style.removeProperty('top');
				shell.style.removeProperty('left');
				shell.style.removeProperty('width');
				shell.style.removeProperty('height');
			} catch {
				// ignore
			}
			if (window.visualViewport) {
				window.visualViewport.removeEventListener('resize', onViewportChange);
				window.visualViewport.removeEventListener('scroll', onViewportChange);
			}
			window.removeEventListener('resize', onViewportChange);
			window.removeEventListener('orientationchange', onViewportChange);
			root.removeEventListener('focusin', onComposerFocusViewport);
			root.removeEventListener('focusout', onComposerFocusViewport);
			if (inputEl instanceof HTMLElement) {
				inputEl.removeEventListener('focus', onViewportChange);
				inputEl.removeEventListener('blur', onViewportChange);
			}
		};
	}

	setupChatViewportSync();
}
