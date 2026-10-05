import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeCreationForViewer, appendChallengeMediaProof } from '../services/challenges/creationAccess.js';
import { buildChallengesChannelModel } from '../client/shared/challenges/model/buildChannelModel.js';
import { renderChallengesPaneHtml } from '../client/views/Challenges/mountPane.js';
import { createChallengeQueries } from '../db/challenges.js';

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
test('challenge proof travels with native media and audio URLs', () => {
 const payload = { url: '/api/images/created/20/image.jpg?creation_id=42', audio_url: '/api/create/images/42/audio', thumbnail_url: 'https://cdn.example/42.jpg' };
 appendChallengeMediaProof(payload, 7);
 assert.match(payload.url, /creation_id=42&challenge_message_id=7/);
 assert.match(payload.audio_url, /challenge_message_id=7/);
 assert.equal(payload.thumbnail_url, 'https://cdn.example/42.jpg');
});
test('participant board retains concurrent tracks, detail links, and organizer entry', () => {
 const messages = ['monthly', 'weekly'].map((track, index) => ({ id: index + 1, created_at: '2026-10-01T00:00:00Z', body: JSON.stringify({ kind: 'challenge_config', challenge_id: track, track, title: `${track} challenge`, submission_start_at: '2026-10-01T00:00:00Z', submission_end_at: '2026-10-20T00:00:00Z', voting_end_at: '2026-10-22T00:00:00Z' }) }));
 const model = buildChallengesChannelModel(messages, { viewerId: 10, nowMs: Date.parse('2026-10-05') });
 const html = renderChallengesPaneHtml(model, { viewerId: 10, showOrganizeEntry: true });
 assert.match(html, /monthly challenge/); assert.match(html, /weekly challenge/);
 assert.match(html, /\/challenges\/details\/monthly/); assert.match(html, /\/challenges\/organize/);
 const detail = renderChallengesPaneHtml(model, { viewerId: 10, detailChallengeId: 'weekly' });
 assert.match(detail, /data-challenge-detail/); assert.match(detail, /data-challenge-id="weekly"/);
});
test('challenge payouts use the established atomic credit-transfer RPC', async () => {
 const calls = [];
 const queries = createChallengeQueries({ async rpc(name, args) { calls.push({ name, args }); return { data: [{ balance: 5 }] }; } });
 await queries.transferCredits.run(1, 2, 10);
 assert.deepEqual(calls, [{ name: 'prsn_transfer_credits', args: { from_user_id: 1, to_user_id: 2, amount: 10 } }]);
});
