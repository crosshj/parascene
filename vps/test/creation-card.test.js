import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildCreationCardShell } from '../client/shared/creationCard.js';

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
