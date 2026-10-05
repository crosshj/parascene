import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildCreationCardShell } from '../client/shared/creationCard.js';
import { creationDetailChromeHtmlFromSeed, feedItemToCreationDetailSeed } from '../client/shared/creationDetailSeed.js';

test('feed like state paints immediately, while unknown state shows a spinner', () => {
	for (const liked of [true, false, undefined]) {
		const seed = feedItemToCreationDetailSeed({ id: 42, created_image_id: 42, viewer_liked: liked, like_count: 3, published: true });
		assert.equal(seed.viewer_liked, liked);
		const markup = creationDetailChromeHtmlFromSeed(seed);
		assert.match(markup, new RegExp(`aria-busy="${liked === undefined}"`));
		assert.match(markup, new RegExp(`aria-pressed="${liked === true}"`));
	}
});

test('early creation detail chrome shows the username rather than the display name', () => {
	for (const creator of [{ author_user_name: 'artist', author_display_name: 'Display Name' }, { creator: { user_name: 'artist', display_name: 'Display Name' } }]) {
		const markup = creationDetailChromeHtmlFromSeed({ id: 42, ...creator });
		assert.match(markup, /creation-detail-action-strip-creator-name">@artist<\/div>/);
		assert.doesNotMatch(markup, /creator-name">Display Name/);
	}
});

test('shared creation card builder emits the media shell used by related creations', () => {
	const markup = buildCreationCardShell({
		mediaAttrs: {
			'data-related-media': true,
			'data-image-id': '31885" unsafe',
			'data-status': 'completed'
		},
		badgesHtml: '<span data-badge></span>',
		nsfw: true
	});

	assert.match(markup, /class="route-card route-card-image"/);
	assert.match(markup, /class="route-media nsfw"/);
	assert.match(markup, /data-related-media/);
	assert.match(markup, /data-image-id="31885&quot; unsafe"/);
	assert.match(markup, /<span data-badge><\/span>/);
});

test('creation detail ships the shared card, comment thread, and related-grid styles', async () => {
	const [styleIndex, cardCss, commentsCss, detailCss] = await Promise.all([
		readFile(new URL('../client/styles/index.js', import.meta.url), 'utf8'),
		readFile(new URL('../client/components/CreationCard/CreationCard.css', import.meta.url), 'utf8'),
		readFile(new URL('../client/components/Comments/Comments.css', import.meta.url), 'utf8'),
		readFile(new URL('../client/views/CreationDetail/CreationDetailView.css', import.meta.url), 'utf8'),
	]);

	assert.match(styleIndex, /CreationCard\/CreationCard\.css/);
	assert.match(styleIndex, /Comments\/Comments\.css/);
	assert.match(cardCss, /\.route-card-image\s*\{/);
	assert.match(cardCss, /\.route-media\s*\{/);
	assert.match(commentsCss, /\.comment-inline-reply\s*\{/);
	assert.match(commentsCss, /\.comment-reaction-picker\s*\{/);
	assert.match(commentsCss, /\.comment-sticker-modal\s*\{/);
	assert.match(commentsCss, /\.msg-reply-indicator-inner\s*\{/);
	assert.match(commentsCss, /\.msg-reply-indicator-target-mark\s*\{/);
	assert.match(commentsCss, /\.founder-name\s*\{/);
	assert.match(commentsCss, /\.mention-link\s*\{/);
	assert.match(detailCss, /\.creation-detail-related\s*\{/);
	assert.match(detailCss, /\.creation-detail-related-grid\s*\{/);
});
