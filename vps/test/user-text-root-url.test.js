import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('chat keeps the hostname visible for a same-origin site-root URL', async () => {
	const dom = new JSDOM('', { url: 'https://beta.parascene.com/' });
	const previousWindow = globalThis.window;
	globalThis.window = dom.window;
	try {
		const { processUserText } = await import('../client/shared/userText.js?root-url-test');
		const html = processUserText('https://beta.parascene.com');
		assert.match(html, /href="https:\/\/beta\.parascene\.com"/);
		assert.match(html, />https:\/\/beta\.parascene\.com<\/a>/);
		assert.doesNotMatch(html, /href="\/"[^>]*>\/<\/a>/);
	} finally {
		if (previousWindow === undefined) delete globalThis.window;
		else globalThis.window = previousWindow;
		dom.window.close();
	}
});
