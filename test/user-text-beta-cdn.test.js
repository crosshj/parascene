import assert from 'node:assert/strict';
import test from 'node:test';
import { processUserText } from '../client/shared/userText.js';

const imageUrl = 'https://beta-cdn.parascene.com/s/MjY6bWlzY18.7o32Ogy6MfQlf2ac/image.webp';

test('beta CDN share images render inline', () => {
	const html = processUserText(imageUrl);
	assert.match(html, /class="user-text-inline-image"/);
	assert.match(html, new RegExp(`src="${imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});
