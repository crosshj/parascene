/* Same rule as touch.css, pushed into shadow roots. Document CSS cannot reach those. */
const TOUCH_FOCUS_CSS = `@media (max-width: 768px), ((hover: none) and (pointer: coarse)) {
	*, *::before, *::after { -webkit-tap-highlight-color: transparent !important; }
	:focus, :focus-visible, :focus-within,
	:focus::before, :focus::after,
	:focus-visible::before, :focus-visible::after,
	:focus-within::before, :focus-within::after {
		outline: none !important;
		outline-offset: 0 !important;
		outline-color: transparent !important;
		-webkit-focus-ring-color: transparent !important;
	}
	:focus, :focus-visible,
	:focus::before, :focus::after,
	:focus-visible::before, :focus-visible::after {
		box-shadow: none !important;
	}
}`;

const TOUCH_MEDIA = '(max-width: 768px), ((hover: none) and (pointer: coarse))';

function touchPrimary() {
	try {
		return window.matchMedia(TOUCH_MEDIA).matches;
	} catch {
		return false;
	}
}

function isTypingTarget(el) {
	if (!(el instanceof HTMLElement)) return false;
	if (el.isContentEditable) return true;
	const tag = el.tagName;
	if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (tag !== 'INPUT') return false;
	const type = (el.getAttribute('type') || 'text').toLowerCase();
	return type !== 'button' && type !== 'submit' && type !== 'reset' && type !== 'checkbox' && type !== 'radio' && type !== 'file' && type !== 'range' && type !== 'color' && type !== 'image';
}

function installTouchFocusStyle(root) {
	if (!root || root.querySelector?.('style[data-touch-focus]')) return;
	const style = document.createElement('style');
	style.dataset.touchFocus = '';
	style.textContent = TOUCH_FOCUS_CSS;
	root.appendChild(style);
}

const nativeAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function attachShadowWithoutTouchFocusRing(init) {
	const root = nativeAttachShadow.call(this, init);
	const install = () => installTouchFocusStyle(root);
	new MutationObserver(install).observe(root, { childList: true });
	install();
	return root;
};

document.addEventListener('focusin', (event) => {
	if (!touchPrimary()) return;
	const el = event.target;
	if (!(el instanceof HTMLElement) || el === document.body || el === document.documentElement) return;
	if (isTypingTarget(el)) return;
	el.blur();
}, true);
