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
	const { attachFeedCardCreationDragSource, bindCreateComposerCreationDropTargets } = await import('../client/shared/creationComposerDrag.js');

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
	assert.equal(card.dataset.creationDragSource, '1');
	assert.equal(card.querySelector('img').draggable, false);

	delete card.dataset.creationDragSource;
	attachFeedCardCreationDragSource(card);
	assert.equal(card.dataset.creationDragSource, '1');

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
	assert.equal(pendingCard.dataset.creationDragSource, undefined);

	const composer = dom.window.document.createElement('div');
	composer.className = 'create-composer';
	const shell = dom.window.document.createElement('div');
	composer.append(shell);
	dom.window.document.body.append(composer);
	const attached = [];
	const unbind = bindCreateComposerCreationDropTargets(composer, shell, {
		onAttachImageUrl: (url, detail) => attached.push({ url, detail }),
	});
	dom.window.document.elementsFromPoint = () => [shell];
	const pointer = (type, x) => {
		const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
		Object.defineProperties(event, {
			clientX: { value: x },
			clientY: { value: 0 },
			pointerId: { value: 1 },
			button: { value: 0 },
		});
		return event;
	};
	card.dispatchEvent(pointer('pointerdown', 0));
	dom.window.dispatchEvent(pointer('pointermove', 12));
	assert.equal(dom.window.document.documentElement.classList.contains('prsn-creation-composer-drag-active'), true);
	assert.ok(dom.window.document.querySelector('.creation-drag-highlight'));
	assert.equal(composer.classList.contains('is-drop-target'), true);
	dom.window.dispatchEvent(pointer('pointerup', 12));
	assert.equal(attached.length, 1);
	assert.equal(attached[0].detail.creationId, 9);
	assert.equal(dom.window.document.documentElement.classList.contains('prsn-creation-composer-drag-active'), false);
	assert.equal(dom.window.document.querySelector('.creation-drag-highlight'), null);
	assert.equal(card.hasAttribute('aria-grabbed'), false);
	assert.equal(composer.classList.contains('is-drop-target'), false);
	unbind();
});
