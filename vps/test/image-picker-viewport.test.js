import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createImagePickerModalDom, wireImagePickerModal } from '../client/shared/imagePickerModal.js';

function mount() {
	const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/doom', pretendToBeVisual: true });
	const view = dom.window;
	const timers = [];
	view.setTimeout = (fn) => {
		timers.push(fn);
		return timers.length;
	};
	view.clearTimeout = () => {};
	view.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
	const visualViewport = new view.EventTarget();
	visualViewport.offsetTop = 0;
	visualViewport.offsetLeft = 0;
	visualViewport.width = 390;
	visualViewport.height = 420;
	view.visualViewport = visualViewport;
	const previousDocument = globalThis.document;
	globalThis.document = view.document;
	const refs = createImagePickerModalDom('form-input');
	view.document.body.appendChild(refs.modalOverlay);
	const wired = wireImagePickerModal(refs, { detachOnClose: false, onPick() {} });
	return {
		dom,
		view,
		refs,
		wired,
		flush() { while (timers.length) timers.shift()(); },
		restore() {
			globalThis.document = previousDocument;
			dom.window.close();
		},
	};
}

test('Add Image modal centers in the visible viewport above the keyboard', () => {
	const page = mount();
	try {
		page.wired.openModal();
		page.view.visualViewport.offsetTop = 80;
		page.view.visualViewport.height = 360;
		page.view.visualViewport.dispatchEvent(new page.view.Event('resize'));
		assert.equal(page.refs.modalOverlay.style.getPropertyValue('--image-picker-vv-top'), '80px');
		assert.equal(page.refs.modalOverlay.style.getPropertyValue('--image-picker-vv-height'), '360px');
		assert.equal(page.refs.modalOverlay.style.getPropertyValue('--image-picker-vv-width'), '390px');
		page.wired.closeModal();
		assert.equal(page.refs.modalOverlay.style.getPropertyValue('--image-picker-vv-top'), '');
		assert.equal(page.refs.modalOverlay.style.getPropertyValue('--image-picker-vv-height'), '');
	} finally {
		page.restore();
	}
});

test('doom comments reserve the keyboard band when the visual viewport stays full height', () => {
	const page = mount();
	try {
		page.view.innerHeight = 800;
		page.view.document.documentElement.dataset.chatDoomCommentsOpen = '1';
		page.view.visualViewport.offsetTop = 0;
		page.view.visualViewport.height = 800;
		page.wired.openModal();
		page.flush();
		assert.equal(page.refs.modalOverlay.style.getPropertyValue('--image-picker-vv-top'), '0px');
		assert.equal(page.refs.modalOverlay.style.getPropertyValue('--image-picker-vv-height'), '440px');
		page.view.visualViewport.height = 420;
		page.view.visualViewport.dispatchEvent(new page.view.Event('resize'));
		assert.equal(page.refs.modalOverlay.style.getPropertyValue('--image-picker-vv-height'), '420px');
	} finally {
		page.restore();
	}
});
