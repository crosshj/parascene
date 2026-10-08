import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeCreationForViewer, appendChallengeMediaProof, listChallengeEntryCreations } from '../services/challenges/creationAccess.js';
import { buildChallengesChannelModel } from '../client/shared/challenges/model/buildChannelModel.js';
import { renderChallengesPaneHtml } from '../client/views/Challenges/mountPane.js';
import { createChallengeQueries } from '../db/challenges.js';
import { viewerCanManageChallengePayouts } from '../client/shared/challenges/challengeAdmin.js';
import { challengeDetailNeighbors, renderPastChallengesSection } from '../client/views/Challenges/views/emptyParticipantView.js';
import { creationCardMarkup } from '../client/shared/creationGrid.js';
import { challengeEntryLightboxMedia, challengeEntryPreviewPlan, omitWithdrawnChallengeSubmissions, rememberChallengeDetailUi } from '../client/views/Challenges/views/entryBoardView.js';
import { detailOrganizerHeaderActions } from '../client/views/Challenges/views/organizeBoardView.js';

function challengeDatabase({ member = true, creationId = 42 } = {}) {
 return { from(table) {
  const data = table === 'prsn_chat_messages' ? { id: 7, thread_id: 9, body: JSON.stringify({ kind: 'challenge_submission', created_image_id: creationId }) }
   : table === 'prsn_chat_threads' ? { id: 9, type: 'channel', channel_slug: 'challenges' } : member ? { user_id: 10 } : null;
  return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data }; } };
 } };
}
test('unpublished voting media requires matching submission proof and channel membership', async () => {
 const options = { creations: { byIdForShare: async () => ({ id: 42, user_id: 20, meta: {} }) }, viewer: { id: 10 }, creationId: 42, query: { challenge_message_id: 7 } };
 assert.equal((await challengeCreationForViewer({ ...options, sb: challengeDatabase() })).id, 42);
 assert.equal(await challengeCreationForViewer({ ...options, sb: challengeDatabase({ member: false }) }), null);
 assert.equal(await challengeCreationForViewer({ ...options, sb: challengeDatabase({ creationId: 99 }) }), null);
 assert.equal(await challengeCreationForViewer({ ...options, sb: null }), null);
});
function entryCreationDatabase() {
	const tables = {
		prsn_chat_threads: [{ id: 9, type: 'channel', channel_slug: 'challenges' }],
		prsn_chat_members: [{ thread_id: 9, user_id: 10 }],
		prsn_chat_messages: [{ id: 7, thread_id: 9, body: JSON.stringify({ kind: 'challenge_submission', created_image_id: 42 }) }],
		prsn_created_images: [
			{ id: 42, user_id: 20, status: 'completed', published: false, meta: {}, unavailable_at: null },
			{ id: 43, user_id: 20, status: 'completed', published: false, meta: {}, unavailable_at: null },
			{ id: 44, user_id: 20, status: 'completed', published: true, meta: { nsfw: true }, unavailable_at: null }
		],
		prsn_user_profiles: [{ user_id: 20, user_name: 'oceanman', display_name: 'Ocean', avatar_url: null }]
	};
	return {
		calls: 0,
		from(table) {
			this.calls += 1;
			const all = tables[table] || [];
			const filters = [];
			const api = {
				select() { return api; },
				eq(column, value) { filters.push([column, value]); return api; },
				in(column, values) { filters.push([column, values]); return api; },
				maybeSingle() {
					const data = all.find((row) => filters.every(([column, value]) => row[column] === value)) || null;
					return Promise.resolve({ data });
				},
				then(resolve, reject) {
					const data = all.filter((row) => filters.every(([column, value]) => (
						Array.isArray(value) ? value.map(Number).includes(Number(row[column])) : row[column] === value
					)));
					return Promise.resolve({ data }).then(resolve, reject);
				}
			};
			return api;
		}
	};
}

test('one challenge request loads every entry creation', async () => {
	const sb = entryCreationDatabase();
	const items = await listChallengeEntryCreations({
		sb,
		viewer: { id: 10, meta: {} },
		threadId: 9,
		items: [{ id: 42, messageId: 7 }, { id: 43, messageId: 8 }, { id: 44 }],
		serialize: (row) => ({ id: row.id, url: `/api/create/images/${row.id}` })
	});
	assert.equal(sb.calls, 5);
	assert.deepEqual(items.map((item) => item.id), [42]);
	assert.equal(items[0].creator.user_name, 'oceanman');
	assert.match(items[0].url, /challenge_message_id=7/);
});

test('challenge proof travels with native media and audio URLs', () => {
 const payload = { url: '/api/images/created/20/image.jpg?creation_id=42', audio_url: '/api/create/images/42/audio', thumbnail_url: 'https://cdn.example/42.jpg' };
 appendChallengeMediaProof(payload, 7);
 assert.match(payload.url, /creation_id=42&challenge_message_id=7/);
 assert.match(payload.audio_url, /challenge_message_id=7/);
 assert.equal(payload.thumbnail_url, 'https://cdn.example/42.jpg');
});
test('participant board retains concurrent tracks, detail links, and organizer entry', () => {
 const messages = ['monthly', 'weekly'].map((track, index) => ({ id: index + 1, created_at: '2026-10-01T00:00:00Z', body: JSON.stringify({ kind: 'challenge_config', challenge_id: track, track, title: `${track} challenge`, hero_image_url: '/creations/12', submission_start_at: '2026-10-01T00:00:00Z', submission_end_at: '2026-10-20T00:00:00Z', voting_end_at: '2026-10-22T00:00:00Z' }) }));
 const model = buildChallengesChannelModel(messages, { viewerId: 10, nowMs: Date.parse('2026-10-05') });
 const html = renderChallengesPaneHtml(model, { viewerId: 10 });
	assert.match(html, /monthly challenge/); assert.match(html, /weekly challenge/);
	assert.match(html, /data-challenge-about-open[^>]*data-challenge-id="monthly"/);
	assert.match(html, /challenge-board-time-link[^>]*href="\/challenges\/details\/monthly"/);
	assert.doesNotMatch(html, /challenge-pane-organize-entry/);
 const detail = renderChallengesPaneHtml(model, { viewerId: 10, detailChallengeId: 'weekly' });
 assert.match(detail, /data-challenge-detail/); assert.match(detail, /data-challenge-id="weekly"/);
 assert.match(detail, /challenge-pane-hero-image/);
 assert.match(detail, /challenge-board-meta/);
 assert.doesNotMatch(detail, /challenge-pane-entries-meta/);
});
test('paperman can pay out and finalize a challenge', () => {
	assert.equal(viewerCanManageChallengePayouts('paperman'), true);
	assert.equal(viewerCanManageChallengePayouts('PaperMan'), true);
	assert.equal(viewerCanManageChallengePayouts('oceanman'), true);
	assert.equal(viewerCanManageChallengePayouts('admin'), true);
	assert.equal(viewerCanManageChallengePayouts('someone'), false);
});

test('prior challenges open detail, and a finalized challenge separates winners', () => {
	const configBody = {
		kind: 'challenge_config',
		challenge_id: 'round-1',
		title: 'Round one',
		submission_start_at: '2020-01-01T00:00:00Z',
		voting_end_at: '2020-01-08T00:00:00Z',
		results_published_at: '2020-01-09T00:00:00Z',
		hero_image_url: '/creations/12',
		results_creation_url: '/creations/99',
		results: { winners: [{ place: 1, message_id: 3, created_image_id: 55, user_id: 10 }] }
	};
	const configMsg = { id: 1, created_at: '2020-01-01T00:00:00Z', body: JSON.stringify(configBody) };
	const list = renderPastChallengesSection([{ msg: configMsg, payload: configBody }]);
	assert.match(list, /creation-browse challenge-past-lane/);
	assert.match(list, /challenge-entry-grid challenge-past-grid/);
	assert.match(list, /href="\/challenges\/details\/round-1"/);
	assert.match(list, /Round one/);
	assert.doesNotMatch(list, /More Info/);
	assert.doesNotMatch(list, /challenge-pane-history-card-state/);
	assert.doesNotMatch(list, /challenge-pane-history-list/);

	const messages = [
		configMsg,
		{ id: 3, sender_id: 10, sender_user_name: 'oceanman', created_at: '2020-01-02T00:00:00Z', body: JSON.stringify({ kind: 'challenge_submission', challenge_id: 'round-1', created_image_id: 55 }) },
		{ id: 4, sender_id: 20, created_at: '2020-01-03T00:00:00Z', body: JSON.stringify({ kind: 'challenge_submission', challenge_id: 'round-1', created_image_id: 56 }) }
	];
	const model = buildChallengesChannelModel(messages, { viewerId: 10, nowMs: Date.parse('2026-10-08T00:00:00Z') });
	const html = renderChallengesPaneHtml(model, { viewerId: 10, detailChallengeId: 'round-1' });
	assert.match(html, /data-challenge-detail/);
	assert.doesNotMatch(html, /challenge-pane-hero-image/);
	assert.doesNotMatch(html, /challenge-board-meta/);
	assert.match(html, /challenge-pane-entries-meta/);
	assert.match(html, /aria-label="Entries"/);
	assert.match(html, /aria-label="Creators"/);
	assert.match(html, /aria-label="Votes"/);
	assert.doesNotMatch(html, /Entries so far/);
	assert.doesNotMatch(html, /Creators entered/);
	assert.doesNotMatch(html, /Total votes/);
	assert.match(html, /class="creation-browse challenge-entries-lane"/);
	assert.match(html, /route-cards content-cards-image-grid creation-browse-grid/);
	assert.doesNotMatch(html, /challenge-pane-section-label">Entries</);
	assert.match(html, /data-creation-id="55"[^>]*data-challenge-winner="1"/);
	assert.match(html, /challenge-card-kind-dot--gold/);
	assert.match(html, /challenge-card-kind-rank">1st</);
	assert.match(html, /challenge-card-kind-sep[^>]*>·</);
	assert.match(html, /challenge-card-kind-user[^>]*>oceanman</);
	assert.doesNotMatch(html, /1st place/);
	assert.match(html, />All</);
	assert.match(html, />Mine</);
	const entries = html.split('challenge-entries-lane')[1] || '';
	assert.match(html, /data-challenge-ended="1"/);
	const announceAt = entries.indexOf('data-creation-id="12"');
	const winnerAt = entries.indexOf('data-creation-id="55"');
	const otherAt = entries.indexOf('data-creation-id="56"');
	assert.ok(announceAt > -1 && winnerAt > announceAt && otherAt > winnerAt);
	assert.equal(entries.indexOf('data-creation-id="55"', winnerAt + 1), -1);
	assert.match(entries, /Announce/);
	assert.match(entries, /data-creation-id="99"/);
	assert.doesNotMatch(html, /<details class="challenge-pane-about"[^>]* open/);
});

test('mine filter keeps a barred card only when it is the viewer’s creation', () => {
	function detailHtml(challengeId, { winnerUser, extra = [] }) {
		rememberChallengeDetailUi(challengeId, { filter: 'mine' });
		const messages = [
			{
				id: 1,
				created_at: '2020-01-01T00:00:00Z',
				body: JSON.stringify({
					kind: 'challenge_config',
					challenge_id: challengeId,
					title: 'Mine filter',
					submission_start_at: '2020-01-01T00:00:00Z',
					voting_end_at: '2020-01-08T00:00:00Z',
					results_published_at: '2020-01-09T00:00:00Z',
					hero_image_url: '/creations/12',
					results: { winners: [{ place: 1, message_id: 3, created_image_id: 55, user_id: winnerUser }] }
				})
			},
			{ id: 3, sender_id: winnerUser, created_at: '2020-01-02T00:00:00Z', body: JSON.stringify({ kind: 'challenge_submission', challenge_id: challengeId, created_image_id: 55 }) },
			{ id: 4, sender_id: 30, created_at: '2020-01-03T00:00:00Z', body: JSON.stringify({ kind: 'challenge_submission', challenge_id: challengeId, created_image_id: 56 }) },
			...extra
		];
		const model = buildChallengesChannelModel(messages, { viewerId: 10, nowMs: Date.parse('2026-10-08T00:00:00Z') });
		return renderChallengesPaneHtml(model, { viewerId: 10, detailChallengeId: challengeId });
	}
	function cardTag(html, id) {
		return html.match(new RegExp(`<a[^>]*data-creation-id="${id}"[^>]*>`))?.[0] || '';
	}
	const empty = detailHtml('mine-empty', { winnerUser: 20 });
	assert.match(cardTag(empty, 12), /\shidden/);
	assert.match(cardTag(empty, 55), /\shidden/);
	assert.match(cardTag(empty, 56), /\shidden/);
	assert.match(empty, /data-challenge-entries-grid hidden/);
	assert.match(empty, /data-challenge-entries-empty="mine"/);
	assert.doesNotMatch(empty, /data-challenge-entries-empty="mine"[^>]*hidden/);
	assert.match(empty, /No results/);
	assert.match(empty, /You have no entries in this challenge/);

	const own = detailHtml('mine-own', { winnerUser: 10 });
	assert.match(cardTag(own, 12), /\shidden/);
	assert.doesNotMatch(cardTag(own, 55), /\shidden/);
	assert.match(cardTag(own, 56), /\shidden/);
	assert.match(own, /data-challenge-entries-empty="mine"[^>]*hidden/);
	assert.doesNotMatch(own, /data-challenge-entries-grid hidden/);
});

test('an active challenge detail lists submissions newest first', () => {
	const messages = [
		{
			id: 1,
			created_at: '2026-10-01T00:00:00Z',
			body: JSON.stringify({
				kind: 'challenge_config',
				challenge_id: 'live-round',
				title: 'Live round',
				submission_start_at: '2026-10-01T00:00:00Z',
				submission_end_at: '2026-10-20T00:00:00Z',
				voting_end_at: '2026-10-22T00:00:00Z'
			})
		},
		{ id: 3, sender_id: 20, created_at: '2026-10-02T00:00:00Z', body: JSON.stringify({ kind: 'challenge_submission', challenge_id: 'live-round', created_image_id: 55 }) },
		{ id: 4, sender_id: 30, created_at: '2026-10-04T00:00:00Z', body: JSON.stringify({ kind: 'challenge_submission', challenge_id: 'live-round', created_image_id: 56 }) }
	];
	const model = buildChallengesChannelModel(messages, { viewerId: 10, nowMs: Date.parse('2026-10-08T00:00:00Z') });
	const html = renderChallengesPaneHtml(model, { viewerId: 10, detailChallengeId: 'live-round' });
	const entries = html.split('challenge-entries-lane')[1] || '';
	assert.ok(entries.indexOf('data-creation-id="56"') < entries.indexOf('data-creation-id="55"'));
});

test('a challenge detail page omits the title and about section', () => {
	const messages = [{
		id: 1,
		created_at: '2026-10-01T00:00:00Z',
		body: JSON.stringify({
			kind: 'challenge_config',
			challenge_id: 'empty-round',
			title: 'Empty round',
			details: 'Bring something blue.',
			hero_image_url: '/creations/12',
			submission_start_at: '2026-10-01T00:00:00Z',
			voting_end_at: '2026-10-20T00:00:00Z'
		})
	}];
	const model = buildChallengesChannelModel(messages, { viewerId: null, nowMs: Date.parse('2026-10-08T00:00:00Z') });
	const html = renderChallengesPaneHtml(model, { viewerId: null, detailChallengeId: 'empty-round' });
	assert.doesNotMatch(html, /challenge-pane-about/);
	assert.match(html, /challenge-pane-hero-image/);
	assert.match(html, /challenge-board-meta/);
	assert.doesNotMatch(html, /challenge-pane-entries-meta/);
	assert.doesNotMatch(html, /challenge-pane-title/);
	assert.match(html, /Entries so far/);
	assert.match(html, /Creators entered/);
	assert.match(html, /Total votes/);
	assert.match(html, /No submissions yet/);
	assert.doesNotMatch(html, /Bring something blue/);
	assert.doesNotMatch(html, /segmented-control/);
});

test('ended challenge entries are shown clear and without a trophy on the challenge page', () => {
	const item = {
		id: 55,
		status: 'completed',
		published: false,
		media_type: 'image',
		url: '/api/images/created/u/file.png',
		meta: { challenge_submissions: [{ challenge_id: 'round-1' }] }
	};
	const active = creationCardMarkup(item);
	assert.match(active, /variant=blur/);
	assert.match(active, /creation-challenge-entered-badge/);
	const onChallengePage = creationCardMarkup(item, { revealChallengeMedia: true, hideChallengeBadge: true });
	assert.doesNotMatch(onChallengePage, /variant=blur/);
	assert.doesNotMatch(onChallengePage, /feed-card-image--challenge-pending/);
	assert.doesNotMatch(onChallengePage, /creation-challenge-entered-badge/);
	assert.doesNotMatch(onChallengePage, /creation-challenge-locked-badge/);
	const ended = creationCardMarkup(
		{ ...item, challenge_entry: { all_ended: true }, challenge_ended: true },
		{ hideChallengeBadge: true }
	);
	assert.doesNotMatch(ended, /variant=blur/);
	assert.doesNotMatch(ended, /feed-card-image--challenge-pending/);
	assert.doesNotMatch(ended, /creation-challenge-entered-badge/);
	assert.doesNotMatch(ended, /creation-challenge-locked-badge/);
	const published = creationCardMarkup(
		{ ...item, published: true },
		{ revealChallengeMedia: true, hideChallengeBadge: true }
	);
	assert.match(published, /creation-published-badge/);
	assert.doesNotMatch(published, /creation-challenge-entered-badge/);
});

test('active challenges are ordered by least time left', () => {
	const messages = [
		{ id: 1, created_at: '2026-10-01T00:00:00Z', body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'monthly', track: 'monthly', title: 'Monthly challenge', submission_start_at: '2026-10-01T00:00:00Z', submission_end_at: '2026-10-20T00:00:00Z', voting_end_at: '2026-10-25T00:00:00Z' }) },
		{ id: 2, created_at: '2026-10-01T00:00:00Z', body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'weekly', track: 'weekly', title: 'Weekly challenge', submission_start_at: '2026-10-01T00:00:00Z', submission_end_at: '2026-10-08T00:00:00Z', voting_end_at: '2026-10-12T00:00:00Z' }) }
	];
	const model = buildChallengesChannelModel(messages, { viewerId: 10, nowMs: Date.parse('2026-10-05T00:00:00Z') });
	const html = renderChallengesPaneHtml(model, { viewerId: 10 });
	assert.ok(html.indexOf('Weekly challenge') < html.indexOf('Monthly challenge'));
});

test('challenge detail older and newer follow end time, including overlaps', () => {
	const messages = [
		{ id: 1, created_at: '2026-01-01T00:00:00Z', body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'older', title: 'Older', submission_start_at: '2026-01-01T00:00:00Z', voting_end_at: '2026-01-08T00:00:00Z' }) },
		{ id: 2, created_at: '2026-02-01T00:00:00Z', body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'current', title: 'Current', submission_start_at: '2026-02-01T00:00:00Z', voting_end_at: '2026-02-08T00:00:00Z' }) },
		{ id: 3, created_at: '2026-03-01T00:00:00Z', body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'newer', title: 'Newer', submission_start_at: '2026-03-01T00:00:00Z', voting_end_at: '2026-03-08T00:00:00Z' }) },
		{ id: 4, created_at: '2026-04-01T00:00:00Z', body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'draft', title: 'Draft', listed: false, submission_start_at: '2026-12-01T00:00:00Z', voting_end_at: '2026-12-08T00:00:00Z' }) }
	];
	const model = buildChallengesChannelModel(messages, { viewerId: null, nowMs: Date.parse('2026-10-08T00:00:00Z') });
	const middle = challengeDetailNeighbors(model.raw.configs, 'current', model.nowMs);
	assert.equal(middle.previous.challengeId, 'older');
	assert.equal(middle.next.challengeId, 'newer');
	const first = challengeDetailNeighbors(model.raw.configs, 'older', model.nowMs);
	assert.equal(first.previous, null);
	assert.equal(first.next.challengeId, 'current');
	const last = challengeDetailNeighbors(model.raw.configs, 'newer', model.nowMs);
	assert.equal(last.previous.challengeId, 'current');
	assert.equal(last.next, null);
	const overlapping = [
		{ id: 1, created_at: '2026-01-01T00:00:00Z', body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'long', title: 'Long', submission_start_at: '2026-01-01T00:00:00Z', voting_end_at: '2026-03-31T00:00:00Z' }) },
		{ id: 2, created_at: '2026-01-15T00:00:00Z', body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'nested', title: 'Nested', listed: false, submission_start_at: '2026-01-15T00:00:00Z', voting_end_at: '2026-01-22T00:00:00Z' }) },
		{ id: 3, created_at: '2026-02-01T00:00:00Z', body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'after-nested', title: 'After nested', submission_start_at: '2026-02-01T00:00:00Z', voting_end_at: '2026-02-08T00:00:00Z' }) }
	];
	const overlapModel = buildChallengesChannelModel(overlapping, { viewerId: null, nowMs: Date.parse('2026-10-08T00:00:00Z') });
	const oldest = challengeDetailNeighbors(overlapModel.raw.configs, 'nested', overlapModel.nowMs);
	assert.equal(oldest.previous, null);
	assert.equal(oldest.next.challengeId, 'after-nested');
	const middleOverlap = challengeDetailNeighbors(overlapModel.raw.configs, 'after-nested', overlapModel.nowMs);
	assert.equal(middleOverlap.previous.challengeId, 'nested');
	assert.equal(middleOverlap.next.challengeId, 'long');
	const newest = challengeDetailNeighbors(overlapModel.raw.configs, 'long', overlapModel.nowMs);
	assert.equal(newest.previous.challengeId, 'after-nested');
	assert.equal(newest.next, null);
});

test('suno entries use the suno player and audio covers use the full image', () => {
	const songId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
	const suno = challengeEntryLightboxMedia({
		id: 9,
		media_type: 'audio',
		url: '/api/creations/media/cover.png?creation_id=9&variant=thumbnail',
		thumbnail_url: '/api/creations/media/cover.png?creation_id=9&variant=thumbnail',
		audio_url: '/api/creations/9/audio',
		width: 1024,
		height: 1024,
		meta: { media_type: 'audio', import: { provider: 'suno', song_id: songId, title: 'Night Drive' } }
	});
	assert.equal(suno.kind, 'suno');
	assert.match(suno.url, new RegExp(`/suno-card\\.html\\?id=${songId}`));
	assert.match(suno.url, /Night%20Drive/);
	assert.doesNotMatch(suno.artwork, /variant=thumbnail/);
	assert.match(suno.artwork, /cover\.png/);
	const audio = challengeEntryLightboxMedia({
		id: 10,
		media_type: 'audio',
		url: '/api/creations/media/song.png?creation_id=10',
		thumbnail_url: '/api/creations/media/song.png?creation_id=10&variant=thumbnail',
		audio_url: '/api/creations/10/audio',
		meta: { media_type: 'audio' }
	});
	assert.equal(audio.kind, 'audio');
	assert.match(audio.artwork, /song\.png/);
	assert.doesNotMatch(audio.artwork, /variant=thumbnail/);
});

test('challenge entry preview opens detail for the viewer and a lightbox for everyone else', () => {
	const entry = { id: 55, user_id: 10, published: false };
	assert.deepEqual(challengeEntryPreviewPlan(entry, { viewerId: 20 }), { direct: false, showUser: true, showDetail: false });
	assert.deepEqual(challengeEntryPreviewPlan(entry, { post: true, viewerId: 20 }), { direct: false, showUser: false, showDetail: false });
	assert.deepEqual(challengeEntryPreviewPlan({ ...entry, published: true }, { viewerId: 20 }), { direct: true, showUser: false, showDetail: false });
	assert.deepEqual(challengeEntryPreviewPlan({ ...entry, published: true }, { winner: true, viewerId: 20 }), { direct: true, showUser: false, showDetail: false });
	assert.deepEqual(challengeEntryPreviewPlan(entry, { viewerId: 10 }), { direct: true, showUser: false, showDetail: false });
	assert.deepEqual(challengeEntryPreviewPlan({ ...entry, published: true }, { viewerId: 10 }), { direct: true, showUser: false, showDetail: false });
	const messages = [
		{ id: 1, body: JSON.stringify({ kind: 'challenge_config', challenge_id: 'round-1' }) },
		{ id: 3, body: JSON.stringify({ kind: 'challenge_submission', challenge_id: 'round-1', created_image_id: 55 }) }
	];
	assert.deepEqual(omitWithdrawnChallengeSubmissions(messages, [55]).map((message) => message.id), [1]);
	const clear = creationCardMarkup(
		{ ...entry, status: 'completed', media_type: 'image', url: '/api/images/created/u/file.png', meta: { challenge_submissions: [{ challenge_id: 'round-1' }] }, challenge_ended: true },
		{ revealChallengeMedia: true, hideChallengeBadge: true }
	);
	assert.doesNotMatch(clear, /variant=blur/);
	assert.doesNotMatch(clear, /feed-card-image--challenge-pending/);
});

test('detail header actions follow active and past challenge phases', () => {
	assert.deepEqual(detailOrganizerHeaderActions('submitting').map((action) => action.label), ['Manage', 'Results']);
	assert.deepEqual(detailOrganizerHeaderActions('voting').map((action) => action.label), ['Manage', 'Results']);
	assert.deepEqual(detailOrganizerHeaderActions('submit_and_vote').map((action) => action.label), ['Manage', 'Results']);
	assert.deepEqual(detailOrganizerHeaderActions('results').map((action) => action.label), ['View', 'Results']);
	assert.deepEqual(detailOrganizerHeaderActions('finalizing').map((action) => action.label), ['View', 'Results']);
	assert.deepEqual(detailOrganizerHeaderActions('deleted'), []);
});

test('challenge payouts use the established atomic credit-transfer RPC', async () => {
 const calls = [];
 const queries = createChallengeQueries({ async rpc(name, args) { calls.push({ name, args }); return { data: [{ balance: 5 }] }; } });
 await queries.transferCredits.run(1, 2, 10);
 assert.deepEqual(calls, [{ name: 'prsn_transfer_credits', args: { from_user_id: 1, to_user_id: 2, amount: 10 } }]);
});
