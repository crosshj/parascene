import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createCreationsRoutes } from '../routes/creations.js';
import { commentAllowsUnpublishedCreation } from '../services/create/postedCreationAccess.js';
import { creationAudioPlayerHref, creationDetailLinkVisible, fetchCreationEmbedPayload } from '../client/shared/userText.js';

const audio = {
	id: 9,
	user_id: 7,
	filename: 'song.png',
	file_path: '7/song.png',
	status: 'completed',
	published: false,
	meta: { media_type: 'audio', audio: { cdn_id: 'o_0123456789abcdef01234567' } }
};

test('a comment unlocks an unpublished creation only when the viewer can see that comment', () => {
	const image = { id: 9, unavailable_at: null };
	const pasted = { id: 4, created_image_id: 20, text: 'hear this https://www.parascene.com/creations/9' };
	assert.equal(commentAllowsUnpublishedCreation({
		image, comment: pasted, parent: { id: 20, user_id: 3, published: true }, viewerId: 42
	}), true);
	assert.equal(commentAllowsUnpublishedCreation({
		image, comment: pasted, parent: { id: 20, user_id: 42, published: false }, viewerId: 42
	}), true);
	assert.equal(commentAllowsUnpublishedCreation({
		image, comment: pasted, parent: { id: 20, user_id: 3, published: false }, viewerId: 42
	}), false);
	assert.equal(commentAllowsUnpublishedCreation({
		image, comment: { id: 4, created_image_id: 20, text: 'no link' }, parent: { id: 20, user_id: 3, published: true }, viewerId: 42
	}), false);
	assert.equal(commentAllowsUnpublishedCreation({
		image: { ...image, unavailable_at: '2026-01-01' }, comment: pasted, parent: { id: 20, user_id: 3, published: true }, viewerId: 42
	}), false);
});

test('comment proof returns playable unpublished audio and its cover', async () => {
	const creations = {
		byIdForViewer: async () => null,
		byIdForCommentProof: async (viewerId, creationId, commentId) => (
			Number(viewerId) === 42 && Number(creationId) === 9 && Number(commentId) === 4 ? audio : null
		),
		canAccessMedia: async () => false,
		safeKey: (key) => String(key || ''),
		fetchMedia: async () => new Response('cover'),
		mintAudioPlaybackUrl: async () => 'https://cdn.example/song.mp3'
	};
	const users = {
		byId: async (id) => ({ id: Number(id), role: 'consumer', meta: {} }),
		profileByUserId: async (id) => ({ user_id: Number(id), user_name: 'maker', display_name: 'Maker', avatar_url: null })
	};
	const app = express();
	app.use((req, _res, next) => { if (req.headers.authorization === 'Bearer test') req.auth = { userId: 42 }; next(); });
	app.use(createCreationsRoutes({ creations, users }));
	const server = app.listen(0);
	try {
		const origin = `http://127.0.0.1:${server.address().port}`;
		const headers = { Authorization: 'Bearer test' };
		const missing = await fetch(`${origin}/api/create/images/9`, { headers });
		assert.equal(missing.status, 404);
		const payload = await fetch(`${origin}/api/create/images/9?comment_id=4`, { headers }).then((res) => res.json());
		assert.match(payload.audio_url, /\/api\/share\/v1\/.+\/cdn-audio$/);
		assert.match(payload.url, /comment_id=4/);
		const audioResponse = await fetch(`${origin}/api/creations/9/audio?comment_id=4`, { headers, redirect: 'manual' });
		assert.equal(audioResponse.status, 302);
		assert.equal(audioResponse.headers.get('location'), 'https://cdn.example/song.mp3');
		const cover = await fetch(`${origin}/api/creations/media/7/song.png?creation_id=9&comment_id=4`, { headers });
		assert.equal(cover.status, 200);
		assert.equal(await cover.text(), 'cover');
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});

test('an unpublished image or video hides go to creation from anyone but the owner', () => {
	assert.equal(creationDetailLinkVisible({ published: false, ownerId: 7, viewerId: 42 }), false);
	assert.equal(creationDetailLinkVisible({ published: false, ownerId: 7, viewerId: 7 }), true);
	assert.equal(creationDetailLinkVisible({ published: true, ownerId: 7, viewerId: 42 }), true);
});

test('an unpublished audio player has no link to the creation', () => {
	assert.equal(creationAudioPlayerHref({ published: false, user_id: 7 }, 9, '4', 42), '');
	assert.equal(creationAudioPlayerHref({ published: false, user_id: 7 }, 9, '4', 7), '/creations/9?comment_id=4');
	assert.equal(creationAudioPlayerHref({ published: true, user_id: 7 }, 9, '4', 42), '/creations/9?comment_id=4');
	assert.equal(creationAudioPlayerHref({ published: true }, 9, ''), '/creations/9');
});

test('a creation link inside a comment asks for that comment proof', async () => {
	const seen = [];
	const previous = globalThis.fetch;
	globalThis.fetch = async (url) => {
		seen.push(String(url));
		return new Response(JSON.stringify({ id: 9, media_type: 'audio', audio_url: '/api/share/v1/token/cdn-audio', status: 'completed', url: '/cover.png' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	};
	try {
		await fetchCreationEmbedPayload(9, null, null, '4');
		assert.match(seen[0], /\/api\/create\/images\/9\?comment_id=4$/);
	} finally {
		globalThis.fetch = previous;
	}
});
