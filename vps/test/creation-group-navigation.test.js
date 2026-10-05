import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { isGroupHeroBlurred, watchGroupNavigation } from '../client/views/CreationDetail/groupNavigation.js';

test('group navigation stays disabled until NSFW is revealed and respects loading state', async () => {
	const dom = new JSDOM('<div class="nsfw"><button data-group-hero-prev hidden></button><button data-group-hero-next hidden></button></div>');
	const hero = dom.window.document.querySelector('div');
	const buttons = [...hero.querySelectorAll('button')];
	const stop = watchGroupNavigation(hero);
	const flush = () => new Promise(resolve => setImmediate(resolve));
	try {
		assert.ok(isGroupHeroBlurred(hero));
		for (const button of buttons) { button.hidden = false; button.disabled = false; }
		await flush();
		assert.ok(buttons.every(button => button.disabled));
		hero.classList.add('nsfw-revealed');
		await flush();
		assert.equal(isGroupHeroBlurred(hero), false);
		assert.ok(buttons.every(button => !button.disabled));
		hero.classList.remove('nsfw-revealed');
		await flush();
		assert.ok(buttons.every(button => button.disabled));
		dom.window.document.body.classList.add('view-nsfw');
		await flush();
		assert.ok(buttons.every(button => !button.disabled));
		buttons[0].hidden = true;
		await flush();
		assert.ok(buttons[0].disabled);
		stop();
		dom.window.document.body.classList.remove('view-nsfw');
		await flush();
		assert.equal(buttons[1].disabled, false);
	} finally { stop(); dom.window.close(); }
});
