import { CHALLENGE_SCORE_REACTION_KEYS, challengeScoreToReactionKey } from '../../src/chat/challenges/constants.js';

// Keep revisions with the reaction document so one conditional UPDATE commits
// both the score and its ordering token. API serialization only exposes known keys.
const VERSIONS = '_challenge_vote_versions';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function compareVoteIntent(a, b) {
 return Number(a?.at || 0) - Number(b?.at || 0) || String(a?.id || '').localeCompare(String(b?.id || ''));
}
export async function saveChallengeVote({ sb, userId, messageId, score, intent, emojiKey, op = 'add', attempts = 16 }) {
 const uid = Number(userId), mid = Number(messageId);
 if (!Number.isSafeInteger(mid) || mid <= 0) fail(400, 'Invalid message id');
 if (intent && (!Number.isSafeInteger(intent.at) || intent.at <= 0 || typeof intent.id !== 'string' || !/^[\w-]{1,80}$/.test(intent.id))) fail(400, 'Invalid vote intent');
 if (score !== undefined && (!Number.isInteger(score) || score < 0 || score > 10)) fail(400, 'Score must be between 0 and 10');
 for (let attempt = 0; attempt < attempts; attempt++) {
  const { data: message, error } = await sb.from('prsn_chat_messages').select('id, thread_id, sender_id, body, reactions').eq('id', mid).maybeSingle();
  if (error) throw error;
  if (!message) fail(404, 'Entry not found');
  const [membership, thread] = await Promise.all([
   sb.from('prsn_chat_members').select('user_id').eq('thread_id', message.thread_id).eq('user_id', uid).maybeSingle(),
   sb.from('prsn_chat_threads').select('channel_slug').eq('id', message.thread_id).maybeSingle(),
  ]);
  if (membership.error) throw membership.error;
  if (thread.error) throw thread.error;
  if (!membership.data || thread.data?.channel_slug !== 'challenges') fail(403, 'Not a member of the Challenges channel');
  let payload; try { payload = JSON.parse(message.body); } catch { /* Not an entry. */ }
  if (payload?.kind !== 'challenge_submission') fail(400, 'This message is not a challenge entry');
  if (Number(message.sender_id) === uid) fail(403, 'You cannot vote for your own entry');
  const original = message.reactions || {};
  const previous = original[VERSIONS]?.[uid];
  const keysForViewer = CHALLENGE_SCORE_REACTION_KEYS.filter(key => Array.isArray(original[key]) && original[key].map(Number).includes(uid));
  const currentScore = keysForViewer.length ? CHALLENGE_SCORE_REACTION_KEYS.indexOf(keysForViewer[0]) + 1 : 0;
  if (intent && previous && compareVoteIntent(intent, previous) <= 0) {
   return { ok: true, score: currentScore, intent: previous, thread_id: message.thread_id, message_id: mid };
  }
  let nextScore = score;
  if (nextScore === undefined) {
   const has = keysForViewer.includes(emojiKey);
   const add = op === 'add' || (op === 'toggle' && !has);
   nextScore = add ? CHALLENGE_SCORE_REACTION_KEYS.indexOf(emojiKey) + 1 : has ? 0 : currentScore;
  }
  const revision = intent || { at: Math.max(Date.now(), Number(previous?.at || 0) + 1), id: `legacy-${uid}` };
  const next = structuredClone(original);
  for (const key of CHALLENGE_SCORE_REACTION_KEYS) {
   const voters = Array.isArray(next[key]) ? [...new Set(next[key].map(Number).filter(id => Number.isSafeInteger(id) && id > 0 && id !== uid))] : [];
   if (key === challengeScoreToReactionKey(nextScore)) voters.push(uid);
   if (voters.length) next[key] = voters; else delete next[key];
  }
  next[VERSIONS] = { ...(original[VERSIONS] || {}), [uid]: { ...revision, score: nextScore } };
  let update = sb.from('prsn_chat_messages').update({ reactions: next }).eq('id', mid);
  update = message.reactions == null ? update.is('reactions', null) : update.eq('reactions', JSON.stringify(message.reactions));
  const saved = await update.select('id');
  if (saved.error) throw saved.error;
  if (saved.data?.length) return { ok: true, score: nextScore, intent: next[VERSIONS][uid], thread_id: message.thread_id, message_id: mid, added: nextScore > 0, count: (next[challengeScoreToReactionKey(nextScore)] || []).length };
  // Another writer won. Reread and merge; never overwrite its reaction document.
 }
 fail(409, 'Voting is busy. Your vote can be retried safely.');
}
