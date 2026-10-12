import { CHALLENGE_SCORE_REACTION_KEYS, challengeScoreToReactionKey } from '../../shared/challenges/constants.js';

export const compareIntent = (a, b) => Number(a?.at || 0) - Number(b?.at || 0) || String(a?.id || '').localeCompare(String(b?.id || ''));
const valid = entry => Number.isSafeInteger(entry?.messageId) && entry.messageId > 0 && Number.isSafeInteger(entry?.threadId) && entry.threadId > 0 && Number.isInteger(entry.score) && entry.score >= 0 && entry.score <= 10 && Number.isSafeInteger(entry.intent?.at) && typeof entry.intent?.id === 'string';

// Owned by the authenticated threads provider, never by a modal or route.
// Each intent is written synchronously before it is scheduled for delivery.
export function createChallengeVotes({ viewerId, send, onChange = () => {}, onSaved = () => {}, storage = () => localStorage, now = Date.now, retryMs = 1000, debounceMs = 180, timeoutMs = 15000 } = {}) {
 const prefix = `prsn-vps-challenge-vote-v1:${viewerId}:`;
 const observed = new Map();
 const entries = new Map(), running = new Map(), timers = new Map(), subscribers = new Set();
 let destroyed = false, durable = true;
 function readAll() {
  try {
   const store = storage();
   for (let i = 0; i < store.length; i++) {
    const key = store.key(i); if (!key?.startsWith(prefix)) continue;
    try { const entry = JSON.parse(store.getItem(key)); if (valid(entry)) merge(entry); } catch { /* Ignore corrupt records. */ }
   }
  } catch { durable = false; }
 }
 function merge(entry) {
  const old = entries.get(entry.messageId);
  const order = old ? compareIntent(entry.intent, old.intent) : 1;
  if (order > 0 || (order === 0 && old.status !== 'saved' && entry.status === 'saved')) entries.set(entry.messageId, entry);
 }
 function persist(entry) {
  try {
   const store = storage();
   store.setItem(`${prefix}${entry.messageId}:${entry.intent.id}`, JSON.stringify(entry));
   durable = true;
   // Separate intent keys prevent an older tab's acknowledgement from replacing
   // a newer unsent vote. Prune only records strictly older than this intent.
   const obsolete = [];
   for (let i = 0; i < store.length; i++) {
    const key = store.key(i); if (!key?.startsWith(prefix)) continue;
    try { const saved = JSON.parse(store.getItem(key)); if (saved.messageId === entry.messageId && compareIntent(saved.intent, entry.intent) < 0) obsolete.push(key); } catch {}
   }
   for (const key of obsolete) store.removeItem(key);
  }
  catch { durable = false; }
 }
 function notify() { if (destroyed) return; onChange(); for (const fn of subscribers) fn(); }
 function schedule(mid, delay = debounceMs) {
  if (destroyed || !viewerId) return;
  clearTimeout(timers.get(mid));
  timers.set(mid, setTimeout(() => { timers.delete(mid); void drain(mid); }, delay));
 }
 async function drain(mid) {
  if (destroyed || running.has(mid)) return;
  const entry = entries.get(mid);
  if (!entry || entry.status === 'saved' || entry.status === 'blocked') return;
  running.set(mid, entry.intent.id);
  let retry = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
   const response = await send(mid, { score: entry.score, intent: entry.intent, viewer_id: viewerId }, { signal: controller.signal });
   if (!response?.ok || !response.intent || !Number.isInteger(response.score)) throw new Error('The server did not confirm your vote');
   if (destroyed) return;
   const current = entries.get(mid);
   if (current?.intent.id === entry.intent.id) {
    const acknowledged = { ...current, score: response.score, intent: response.intent, status: 'saved', error: null, attempts: 0 };
    entries.set(mid, acknowledged); persist(acknowledged);
   }
   onSaved(entry.threadId, mid); notify();
  } catch (error) {
   if (destroyed) return;
   const current = entries.get(mid);
   if (current?.intent.id === entry.intent.id) {
    const blocked = [400, 401, 403, 404, 410, 422].includes(error.status);
    const failed = { ...current, status: blocked ? 'blocked' : 'pending', error: error.message || 'Vote not saved yet', errorStatus: error.status, errorCode: error.data?.code, attempts: (current.attempts || 0) + 1 };
    entries.set(mid, failed); persist(failed); retry = !blocked; notify();
   }
  } finally {
   clearTimeout(timeout);
   running.delete(mid);
   if (!destroyed) {
    const current = entries.get(mid);
    if (current?.intent.id !== entry.intent.id && current?.status === 'pending') schedule(mid, 0);
    else if (retry) schedule(mid, Math.min(30000, retryMs * 2 ** Math.min(current.attempts - 1, 5)));
   }
  }
 }
 function project(messages) {
  return messages.map(message => {
   const server = message.viewer_vote_intent;
   if (server && compareIntent(server, observed.get(Number(message.id))) > 0) observed.set(Number(message.id), server);
   const entry = entries.get(Number(message.id));
   if (!entry) return message;
   if (server && compareIntent(server, entry.intent) >= 0) {
    // A newer vote in another tab/device supersedes an older retry or receipt.
    if (compareIntent(server, entry.intent) > 0 || entry.status !== 'saved') {
     const next = { ...entry, intent: server, score: server.score, status: 'saved', error: null };
     entries.set(entry.messageId, next); persist(next);
    }
    return message;
   }
   const selected = challengeScoreToReactionKey(entry.score);
   const old = (message.viewer_reactions || []).find(key => CHALLENGE_SCORE_REACTION_KEYS.includes(key));
   const reactions = { ...message.reactions };
   if (old !== selected) {
    if (old) reactions[old] = Math.max(0, (Number(reactions[old]) || 0) - 1);
    if (selected) reactions[selected] = (Number(reactions[selected]) || 0) + 1;
   }
   return { ...message, reactions, viewer_reactions: [...(message.viewer_reactions || []).filter(key => !CHALLENGE_SCORE_REACTION_KEYS.includes(key)), ...(selected ? [selected] : [])], vote_delivery: entry.status };
  });
 }
 function resume() {
  readAll();
  for (const entry of entries.values()) if (entry.status === 'pending') schedule(entry.messageId, 0);
  notify();
 }
 readAll();
 const api = {
  get durable() { return durable; },
  get(messageId) { return entries.get(Number(messageId)) || null; },
  pending() { return [...entries.values()].filter(entry => entry.status !== 'saved'); },
  project,
  set(threadId, messageId, score) {
   if (destroyed || !viewerId) throw new Error('Sign in before voting');
   readAll();
   const previous = entries.get(Number(messageId));
   const entry = { threadId: Number(threadId), messageId: Number(messageId), score, intent: { at: Math.max(now(), Number(previous?.intent.at || 0) + 1, Number(observed.get(Number(messageId))?.at || 0) + 1), id: globalThis.crypto?.randomUUID?.() || `${now()}-${Math.random().toString(36).slice(2)}` }, status: 'pending', attempts: 0 };
   if (!valid(entry)) throw new Error('Invalid vote');
   entries.set(entry.messageId, entry); persist(entry); schedule(entry.messageId); notify();
   return entry;
  },
  retry() { for (const entry of entries.values()) if (entry.status !== 'saved') { entry.status = 'pending'; entry.error = null; persist(entry); schedule(entry.messageId, 0); } notify(); },
  subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
  syncExternalCache(event) { if (event.key?.startsWith(prefix)) resume(); },
  clear() { try { const store = storage(); for (const entry of entries.values()) if (entry.status === 'saved') store.removeItem(`${prefix}${entry.messageId}:${entry.intent.id}`); } catch {} entries.clear(); },
  destroy() { destroyed = true; for (const timer of timers.values()) clearTimeout(timer); timers.clear(); subscribers.clear(); globalThis.window?.removeEventListener('online', resume); globalThis.document?.removeEventListener('visibilitychange', onVisible); },
 };
 function onVisible() { if (globalThis.document?.visibilityState !== 'hidden') resume(); }
 globalThis.window?.addEventListener('online', resume);
 globalThis.document?.addEventListener('visibilitychange', onVisible);
 for (const entry of entries.values()) {
  if (entry.status === 'blocked' && (entry.errorStatus === 401 || entry.errorCode === 'VIEWER_CHANGED')) { entry.status = 'pending'; persist(entry); }
  if (entry.status === 'pending') schedule(entry.messageId, 0);
 }
 return api;
}
