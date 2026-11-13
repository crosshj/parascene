import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('finished creation cards are draggable, and a refresh keeps them draggable', async () => {
	const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.HTMLImageElement = dom.window.HTMLImageElement;
	const { creationCardMarkup } = await import('../client/shared/creationGrid.js');
	const { attachFeedCardCreationDragSource } = await import('../client/shared/creationComposerDrag.js');

	const finished = creationCardMarkup({
		id: 9,
		created_image_id: 9,
		status: 'completed',
		media_type: 'image',
		url: '/api/creations/media/nine.png',
	});
	dom.window.document.body.innerHTML = finished;
	const card = dom.window.document.querySelector('.feed-card');
	attachFeedCardCreationDragSource(card);
	assert.equal(card.getAttribute('draggable'), 'true');
	assert.equal(card.querySelector('img').draggable, false);

	card.removeAttribute('draggable');
	attachFeedCardCreationDragSource(card);
	assert.equal(card.getAttribute('draggable'), 'true');

	const processing = creationCardMarkup({
		id: 10,
		created_image_id: 10,
		status: 'processing',
		media_type: 'image',
		url: '/api/creations/media/ten.png',
	});
	dom.window.document.body.insertAdjacentHTML('beforeend', processing);
	const pendingCard = dom.window.document.querySelector('[data-creation-id="10"]');
	attachFeedCardCreationDragSource(pendingCard);
	assert.equal(pendingCard.getAttribute('draggable'), null);
});
