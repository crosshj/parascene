import test from 'node:test';
import assert from 'node:assert/strict';
import {
	canViewUnpublishedCreationViaChallengeHero,
	canViewUnpublishedCreationViaChallengeResults
} from '../server/services/create/challengeSubmitShared.js';

const CHALLENGE_ID = '2026-08-summer';
const CREATION_ID = 20317;

function message(id, body) {
	return {
		id,
		body: JSON.stringify(body),
		created_at: '2026-07-31T14:52:58.000Z',
		sender_id: 1,
		reactions: {}
	};
}

function accessClient(matchRows) {
	let scannedNewestWindow = false;
	const client = {
		scannedNewestWindow() {
			return scannedNewestWindow;
		},
		from(table) {
			const state = { filters: [], orders: [], range: null };
			const builder = {
				select() {
					return builder;
				},
				eq(column, value) {
					state.filters.push([column, value]);
					return builder;
				},
				ilike(_column, pattern) {
					state.ilike = pattern;
					return builder;
				},
				order(column) {
					state.orders.push(column);
					return builder;
				},
				limit(count) {
					state.limit = count;
					return builder;
				},
				lt() {
					return builder;
				},
				range(from, to) {
					state.range = [from, to];
					return builder;
				},
				maybeSingle() {
					if (state.filters.some(([column, value]) => column === 'channel_slug' && value === 'challenges')) {
						return Promise.resolve({ data: { id: 100 }, error: null });
					}
					return Promise.resolve({
						data: { type: 'channel', channel_slug: 'challenges' },
						error: null
					});
				},
				then(onOk, onErr) {
					let data = [];
					if (table === 'prsn_chat_messages' && state.range && state.range[0] === 0) {
						const needle = String(state.ilike || '');
						data = matchRows.filter((row) => needle.includes('%') ? String(row.body).includes(needle.slice(1, -1)) : false);
					} else if (table === 'prsn_chat_messages' && state.orders[0] === 'created_at') {
						scannedNewestWindow = true;
						data = [];
					}
					return Promise.resolve({ data, error: null }).then(onOk, onErr);
				}
			};
			return builder;
		}
	};
	return client;
}

const heroConfig = message(7754, {
	kind: 'challenge_config',
	challenge_id: CHALLENGE_ID,
	title: 'Summer',
	hero_image_url: `/creations/${CREATION_ID}`
});

const resultsConfig = message(7755, {
	kind: 'challenge_config',
	challenge_id: '2026-07-monsters-vs-aliens',
	title: 'Monsters VS Aliens',
	results_creation_url: '/creations/15819'
});

test('an unpublished announce creation is visible after its config leaves the newest messages', async () => {
	const sb = accessClient([heroConfig]);
	const allowed = await canViewUnpublishedCreationViaChallengeHero(sb, {
		ancestorRow: { id: CREATION_ID },
		challengeId: CHALLENGE_ID,
		viewerUserId: 26
	});
	assert.equal(allowed, true);
	assert.equal(sb.scannedNewestWindow(), false);
});

test('an image request that only has the creation id still finds the stored hero link', async () => {
	const sb = accessClient([heroConfig]);
	const allowed = await canViewUnpublishedCreationViaChallengeHero(sb, {
		ancestorRow: { id: CREATION_ID },
		viewerUserId: 26
	});
	assert.equal(allowed, true);
	assert.equal(sb.scannedNewestWindow(), false);
});

test('an old results creation stays visible the same way', async () => {
	const sb = accessClient([resultsConfig]);
	const allowed = await canViewUnpublishedCreationViaChallengeResults(sb, {
		ancestorRow: { id: 15819 },
		challengeId: '2026-07-monsters-vs-aliens',
		viewerUserId: 26
	});
	assert.equal(allowed, true);
	assert.equal(sb.scannedNewestWindow(), false);
});

test('a creation that is not the hero is still refused', async () => {
	const sb = accessClient([heroConfig]);
	const allowed = await canViewUnpublishedCreationViaChallengeHero(sb, {
		ancestorRow: { id: 99999 },
		challengeId: CHALLENGE_ID,
		viewerUserId: 26
	});
	assert.equal(allowed, false);
});
