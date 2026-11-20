import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installUnbrokenImages } from '../client/shared/unbrokenImages.js';

function page() {
	const dom = new JSDOM('<!doctype html><img id="shot" alt="Cover" src="https://example.test/missing.png">');
	installUnbrokenImages(dom.window.document);
	return { window: dom.window, img: dom.window.document.getElementById('shot') };
}

test('a failed image is concealed instead of showing the broken placeholder', () => {
	const { window, img } = page();
	img.dispatchEvent(new window.Event('error'));
	assert.equal(img.classList.contains('is-media-unavailable'), true);
	assert.equal(img.alt, '');
	assert.equal(img.getAttribute('aria-hidden'), 'true');
	assert.equal(img.getAttribute('src'), 'https://example.test/missing.png');
});

test('a later successful load shows the image again', () => {
	const { window, img } = page();
	img.dispatchEvent(new window.Event('error'));
	Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => 20 });
	img.dispatchEvent(new window.Event('load'));
	assert.equal(img.classList.contains('is-media-unavailable'), false);
	assert.equal(img.alt, 'Cover');
	assert.equal(img.hasAttribute('aria-hidden'), false);
});

test('a replacement src stays concealed until that load succeeds', () => {
	const { window, img } = page();
	img.addEventListener('error', () => {
		img.src = 'https://example.test/fallback.png';
	});
	img.dispatchEvent(new window.Event('error'));
	assert.equal(img.classList.contains('is-media-unavailable'), true);
	assert.equal(img.src, 'https://example.test/fallback.png');
	Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => 12 });
	img.dispatchEvent(new window.Event('load'));
	assert.equal(img.classList.contains('is-media-unavailable'), false);
});
