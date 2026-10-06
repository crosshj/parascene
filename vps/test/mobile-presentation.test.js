import test from 'node:test';
import assert from 'node:assert/strict';
import { mobilePresentation } from '../client/core/mobilePresentation.js';
import { createScrollContext } from '../client/core/scrollContext.js';

test('WWW mobile primary lanes and chat roster show the app header and five action footer', () => {
	for (const url of ['/feed', '/', '/challenges', '/creations', '/chat#channels']) {
		const result = mobilePresentation({ url });
		assert.equal(result.appHeader, true, url);
		assert.equal(result.footer, true, url);
	}
	assert.equal(mobilePresentation({ url: '/chat#channels' }).mode, 'roster');
	for (const url of ['/feed', '/explore', '/creations', '/comments', '/challenges', '/chat#channels']) {
		assert.equal(mobilePresentation({ url }).scrollOwner, 'document', url);
	}
});

test('conversations select Chat and replace app chrome with contextual controls', () => {
	for (const url of ['/ch/general', '/dm/alice', '/chat/t/12/general', '/notes']) {
		const result = mobilePresentation({ url });
		assert.equal(result.mode, 'conversation', url);
		assert.equal(result.active, 'connect', url);
		assert.equal(result.appHeader, false, url);
		assert.equal(result.footer, false, url);
		assert.equal(result.scrollOwner, 'outlet', url);
		assert.equal(result.backButton, true, url);
	}
});

test('secondary chat tools expose a mobile return control without changing their page mode', () => {
	for (const url of ['/files', '/comments', '/explore', '/library']) {
		const result = mobilePresentation({ url });
		assert.equal(result.mode, 'secondary', url);
		assert.equal(result.backButton, true, url);
		assert.equal(result.footer, false, url);
	}
});

test('secondary pages and overlays do not inherit primary mobile chrome', () => {
	for (const url of ['/explore', '/files', '/library', '/create']) {
		const result = mobilePresentation({ url });
		assert.equal(result.mode, 'secondary', url);
		assert.equal(result.appHeader, false, url);
		assert.equal(result.footer, false, url);
	}
	const overlay = mobilePresentation({ url: '/creations/12', backgroundUrl: '/creations', overlay: { path: '/creations/:creationId' } });
	assert.equal(overlay.appHeader, false);
	assert.equal(overlay.footer, false);
	assert.equal(overlay.scrollOwner, 'overlay');
	assert.equal(overlay.backgroundScrollOwner, 'document');
});

test('Challenges subroutes use contextual back-button chrome without the app footer', () => {
	for (const url of ['/challenges/organize', '/challenges/details/abc']) {
		const result = mobilePresentation({ url });
		assert.equal(result.mode, 'challenge-subpage', url);
		assert.equal(result.appHeader, false, url);
		assert.equal(result.footer, false, url);
		assert.equal(result.backButton, true, url);
	}
});

test('scroll context maps WWW document ownership to viewport observers and inner pages to the outlet', () => {
	const region = { dataset: { scrollOwner: 'document' } };
	const documentOwned = createScrollContext({ closest: () => region });
	assert.equal(documentOwned.intersectionRoot, null);
	region.dataset.scrollOwner = 'outlet';
	const outletOwned = createScrollContext({ closest: () => region });
	assert.equal(outletOwned.intersectionRoot, region);
});
