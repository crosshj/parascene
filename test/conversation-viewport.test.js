import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { bindConversationVisualViewport } from '../client/core/conversationViewport.js';

function mount({ mode = 'conversation', mobile = true, scale = 1 } = {}) {
	const dom = new JSDOM(`<!doctype html><html><body>
		<div id="app-shell" data-mobile-mode="${mode}">
			<div class="beta-outlet__frame">
				<div class="chat-page-messages" data-chat-messages></div>
				<form class="beta-outlet__composer"><textarea></textarea></form>
			</div>
		</div>
	</body></html>`, { url: 'http://localhost/dm/1', pretendToBeVisual: true });
	const view = dom.window;
	const frames = [];
	view.requestAnimationFrame = (callback) => {
		frames.push(callback);
		return frames.length;
	};
	view.matchMedia = () => ({
		matches: mobile,
		addEventListener() {},
		removeEventListener() {},
	});
	const visualViewport = new view.EventTarget();
	visualViewport.offsetTop = 120;
	visualViewport.offsetLeft = 0;
	visualViewport.width = 390;
	visualViewport.height = 420;
	visualViewport.scale = scale;
	view.visualViewport = visualViewport;
	const root = view.document.getElementById('app-shell');
	const frame = root.querySelector('.beta-outlet__frame');
	const messages = frame.querySelector('[data-chat-messages]');
	let scrollTop = 0;
	Object.defineProperty(messages, 'scrollHeight', { configurable: true, value: 1000 });
	Object.defineProperty(messages, 'clientHeight', { configurable: true, value: 400 });
	Object.defineProperty(messages, 'scrollTop', {
		configurable: true,
		get() { return scrollTop; },
		set(value) { scrollTop = value; },
	});
	const binding = bindConversationVisualViewport({ frame, root });
	return {
		dom,
		view,
		root,
		frame,
		messages,
		binding,
		flush() { while (frames.length) frames.shift()(); },
	};
}

test('mobile chat and DM pin the frame to the visual viewport and keep a bottom-stuck thread pinned', () => {
	const page = mount();
	try {
		page.messages.scrollTop = 540;
		page.view.visualViewport.dispatchEvent(new page.view.Event('resize'));
		assert.equal(page.frame.classList.contains('is-visual-viewport'), true);
		assert.equal(page.frame.style.top, '120px');
		assert.equal(page.frame.style.left, '0px');
		assert.equal(page.frame.style.width, '390px');
		assert.equal(page.frame.style.height, '420px');
		page.flush();
		assert.equal(page.messages.scrollTop, 1000);
	} finally {
		page.binding.destroy();
		page.dom.window.close();
	}
});

test('a thread the reader has scrolled up keeps its place when the keyboard resizes the viewport', () => {
	const page = mount();
	try {
		page.messages.scrollTop = 80;
		page.view.visualViewport.dispatchEvent(new page.view.Event('resize'));
		page.flush();
		assert.equal(page.messages.scrollTop, 80);
		assert.equal(page.frame.style.height, '420px');
	} finally {
		page.binding.destroy();
		page.dom.window.close();
	}
});

test('leaving a conversation and pinch-zoom release the visual viewport frame', () => {
	const page = mount();
	try {
		assert.equal(page.frame.style.height, '420px');
		page.root.dataset.mobileMode = 'primary';
		page.binding.sync();
		assert.equal(page.frame.classList.contains('is-visual-viewport'), false);
		assert.equal(page.frame.style.height, '');
		assert.equal(page.frame.style.top, '');
		page.root.dataset.mobileMode = 'conversation';
		page.view.visualViewport.scale = 1.4;
		page.binding.sync();
		assert.equal(page.frame.style.height, '');
		page.view.visualViewport.scale = 1;
		page.binding.sync();
		assert.equal(page.frame.style.height, '420px');
	} finally {
		page.binding.destroy();
		page.dom.window.close();
	}
});

test('desktop conversation layout does not take over the frame', () => {
	const page = mount({ mobile: false });
	try {
		assert.equal(page.frame.classList.contains('is-visual-viewport'), false);
		assert.equal(page.frame.style.top, '');
		assert.equal(page.frame.style.height, '');
	} finally {
		page.binding.destroy();
		page.dom.window.close();
	}
});
