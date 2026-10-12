/**
 * Mobile chat and DM keyboard behavior from WWW `chatViewportShellSync`.
 * The conversation frame tracks the visual viewport, so the header stays at the
 * top, the composer stays at the bottom, and the message list is the region
 * that shrinks when the keyboard opens.
 */

const MOBILE_QUERY = '(max-width: 768px)';
const NEAR_BOTTOM_PX = 64;
const KEYBOARD_RETRY_MS = [0, 50, 120, 220, 400];

function isPinchZoomed(view) {
	const viewport = view.visualViewport;
	if (!viewport || typeof viewport.scale !== 'number' || !Number.isFinite(viewport.scale)) return false;
	return Math.abs(viewport.scale - 1) > 0.01;
}

export function bindConversationVisualViewport({ frame, root }) {
	const view = frame.ownerDocument.defaultView;
	const mobileQuery = view.matchMedia(MOBILE_QUERY);
	const retryTimers = [];

	function messagesElement() {
		return frame.querySelector('[data-chat-messages]');
	}

	function clearGeometry() {
		frame.classList.remove('is-visual-viewport');
		frame.style.removeProperty('top');
		frame.style.removeProperty('left');
		frame.style.removeProperty('width');
		frame.style.removeProperty('height');
	}

	function conversationActive() {
		return mobileQuery.matches && root.dataset.mobileMode === 'conversation';
	}

	function applyGeometry() {
		const viewport = view.visualViewport;
		if (!viewport) {
			frame.style.top = '0px';
			frame.style.left = '0px';
			frame.style.width = '100%';
			frame.style.height = `${view.innerHeight}px`;
			return;
		}
		frame.style.top = `${viewport.offsetTop}px`;
		frame.style.left = `${viewport.offsetLeft}px`;
		frame.style.width = `${viewport.width}px`;
		frame.style.height = `${viewport.height}px`;
	}

	function sync() {
		if (!conversationActive() || isPinchZoomed(view)) {
			clearGeometry();
			return;
		}
		const messages = messagesElement();
		const nearBottom = messages
			? messages.scrollHeight - messages.scrollTop - messages.clientHeight <= NEAR_BOTTOM_PX
			: false;
		frame.classList.add('is-visual-viewport');
		applyGeometry();
		if (nearBottom && messages) {
			view.requestAnimationFrame(() => {
				messages.scrollTop = messages.scrollHeight;
			});
		}
	}

	function clearRetries() {
		for (const timer of retryTimers) view.clearTimeout(timer);
		retryTimers.length = 0;
	}

	function scheduleRetries() {
		clearRetries();
		for (const delay of KEYBOARD_RETRY_MS) {
			retryTimers.push(view.setTimeout(sync, delay));
		}
	}

	function onComposerFocus(event) {
		const input = frame.querySelector('.beta-outlet__composer textarea');
		if (!(input instanceof view.HTMLElement) || event.target !== input) return;
		scheduleRetries();
	}

	function onViewportChange() {
		sync();
	}

	if (view.visualViewport) {
		view.visualViewport.addEventListener('resize', onViewportChange);
		view.visualViewport.addEventListener('scroll', onViewportChange);
	}
	view.addEventListener('resize', onViewportChange);
	view.addEventListener('orientationchange', onViewportChange);
	mobileQuery.addEventListener?.('change', onViewportChange);
	frame.addEventListener('focusin', onComposerFocus);
	frame.addEventListener('focusout', onComposerFocus);
	sync();

	return {
		sync,
		destroy() {
			clearRetries();
			clearGeometry();
			if (view.visualViewport) {
				view.visualViewport.removeEventListener('resize', onViewportChange);
				view.visualViewport.removeEventListener('scroll', onViewportChange);
			}
			view.removeEventListener('resize', onViewportChange);
			view.removeEventListener('orientationchange', onViewportChange);
			mobileQuery.removeEventListener?.('change', onViewportChange);
			frame.removeEventListener('focusin', onComposerFocus);
			frame.removeEventListener('focusout', onComposerFocus);
		},
	};
}
