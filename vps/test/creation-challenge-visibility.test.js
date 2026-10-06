import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCreationsRoutes } from '../routes/creations.js';
import { computeChallengeEndedByImageId } from '../services/create/challengeSubmitShared.js';
import { creationCardMarkup } from '../client/shared/creationGrid.js';
const entry = (id, challenges, nsfw = false) => ({ id, user_id: 1, file_path: `${id}.png`, published: false, meta: { nsfw, challenge_submissions: challenges.map(challenge_id => ({ thread_id: 10, challenge_id })) } });
const rows = [entry(1, ['ended']), entry(2, ['active']), entry(3, ['ended', 'active']), entry(4, ['deleted']), entry(5, ['missing']), entry(6, ['ended'], true)];
function resolver(fail = false) {
 return images => computeChallengeEndedByImageId({ images, sb: { from() {
  return { select() { return this; }, eq() { return this; }, order() { return this; }, async limit() {
   if (fail) throw Error('unavailable');
   return { data: [
    { kind: 'challenge_config', challenge_id: 'ended', submission_end_at: '2000-01-01T00:00:00Z' },
    { kind: 'challenge_config', challenge_id: 'active', submission_end_at: '2099-01-01T00:00:00Z' },
    { kind: 'challenge_config', challenge_id: 'deleted', deleted: true },
   ].map(body => ({ body: JSON.stringify(body) })) };
  } };
 } } });
}
test('list and per-ID refresh supply current challenge visibility to cards', async () => {
 const app = express(); app.use((req, _res, next) => { req.auth = { userId: 1 }; next(); });
 app.use(createCreationsRoutes({ creations: { list: async () => ({ rows, hasMore: false }), listByIds: async () => rows }, users: { byId: async () => ({ id: 1 }) }, resolveChallengeEnded: resolver() }));
 const server = app.listen(0);
 try {
  for (const query of ['', '?ids=1,2,3,4,5,6']) {
   const response = await fetch(`http://127.0.0.1:${server.address().port}/api/creations${query}`);
   assert.equal(response.status, 200);
   const { creations } = await response.json();
   assert.deepEqual(creations.map(row => row.challenge_ended), [true, false, false, true, false, true]);
   for (const [index, item] of creations.entries()) {
    const markup = creationCardMarkup(item);
    if ([0, 3].includes(index)) assert.doesNotMatch(markup, /variant=blur|feed-card-image--challenge-pending/);
    else assert.match(markup, /variant=blur/);
   }
  }
 } finally { await new Promise(resolve => server.close(resolve)); }
});
test('failed challenge lookup does not reveal unresolved entries', async () => {
 const ended = await resolver(true)(rows);
 assert.equal(ended.get(1), false); assert.equal(ended.get(2), false);
});
