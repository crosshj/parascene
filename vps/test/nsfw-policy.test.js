import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.CustomEvent = dom.window.CustomEvent;

const { setNsfwContentEnabled, setNsfwObscure, initNsfwViewPreference } = await import('../client/shared/nsfwView.js');
const {
	includeInCollection,
	nsfwMediaUrl,
	publishNsfwPreference,
	readNsfwPolicy,
} = await import('../client/shared/nsfwPolicy.js');

const item = { nsfw: true, url: '/api/creations/media/one.png?creation_id=1' };
const safe = { nsfw: false, url: '/api/creations/media/safe.png?creation_id=2' };

function reset() {
	localStorage.clear();
	sessionStorage.clear();
	document.body.className = '';
}

test('NSFW off blurs a direct file and omits the row from collections', () => {
	reset();
	assert.equal(readNsfwPolicy().showInCollections, false);
	assert.equal(includeInCollection(item), false);
	assert.equal(includeInCollection(safe), true);
	assert.match(nsfwMediaUrl(item.url, item), /variant=blur/);
	assert.match(nsfwMediaUrl(item.url, item), /source_variant=thumbnail/);
	assert.match(nsfwMediaUrl(item.url, item, { sourceVariant: 'original' }), /source_variant=original/);
	assert.equal(nsfwMediaUrl(item.url, item, { sourceVariant: 'original' }).includes('source_variant=thumbnail'), false);
	assert.equal(nsfwMediaUrl(safe.url, safe).includes('variant=blur'), false);
});

test('NSFW on and obscured includes the row and still serves the blur', () => {
	reset();
	setNsfwContentEnabled(true);
	setNsfwObscure(true);
	const policy = readNsfwPolicy();
	assert.equal(policy.showInCollections, true);
	assert.equal(policy.presentation, 'blur');
	assert.equal(includeInCollection(item), true);
	assert.match(nsfwMediaUrl(item.url, item), /variant=blur/);
	assert.equal(nsfwMediaUrl(item.url, item, { revealed: true }).includes('variant=blur'), false);
});

test('NSFW on and unobscured serves the clear file', () => {
	reset();
	setNsfwContentEnabled(true);
	setNsfwObscure(false);
	assert.equal(readNsfwPolicy().presentation, 'clear');
	assert.equal(nsfwMediaUrl(item.url, item).includes('variant=blur'), false);
	assert.match(nsfwMediaUrl('/api/creations/media/one.png?variant=blur&source_variant=thumbnail', item), /^\/api\/creations\/media\/one\.png$/);
});

test('unobscured settings clear the body blur class on startup', () => {
	reset();
	setNsfwContentEnabled(true);
	setNsfwObscure(false);
	document.body.classList.remove('view-nsfw');
	initNsfwViewPreference();
	assert.equal(document.body.classList.contains('view-nsfw'), true);
	assert.equal(document.body.dataset.enableNsfw, '1');
	assert.equal(nsfwMediaUrl(item.url, item).includes('variant=blur'), false);
});

test('publish reports membership only when collection visibility flips', () => {
	reset();
	const off = readNsfwPolicy();
	let detail = null;
	document.addEventListener('nsfw-preference-changed', (event) => { detail = event.detail; });
	setNsfwContentEnabled(true);
	publishNsfwPreference(off);
	assert.equal(detail.membershipChanged, true);
	assert.equal(detail.presentation, 'blur');
	const obscured = readNsfwPolicy();
	setNsfwObscure(false);
	publishNsfwPreference(obscured);
	assert.equal(detail.membershipChanged, false);
	assert.equal(detail.presentation, 'clear');
});
