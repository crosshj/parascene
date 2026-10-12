import { isChallengeChannelAdmin, isImpliedChallengeOrganizer, pickLatestChallengesGlobalConfig, resolveChallengeOrganizerAllowlistFromMessages } from '../../shared/challenges/challengeAdmin.js';
import { mountChallengesOrganizerTools } from './mountOrganizerSidebar.js';

// The organizer and participant routes consume the same complete thread query.
// This adapter owns forms only; loading, caching and realtime belong to Threads.
export function mountOrganizeSnapshot(root, { messages, viewer, threadId, threads, query, reload, onClose }) {
 const organizerUserNames = resolveChallengeOrganizerAllowlistFromMessages(messages);
 if (!isChallengeChannelAdmin(viewer.user_name, organizerUserNames)) {
  root.innerHTML = '<p class="challenge-pane-muted">You are not on the challenge organizer team.</p><a class="btn-outlined" href="/challenges">Back to Challenges</a>';
  return { destroy() { root.replaceChildren(); }, isOceanman: () => false };
 }
 const host = document.createElement('div'); host.className = 'challenges-organize-host'; root.replaceChildren(host);
 const run = async action => { try { return { ok: true, ...await action() }; } catch(error) { return { ok: false, error: error.message }; } };
 const global = pickLatestChallengesGlobalConfig(messages);
 const api = mountChallengesOrganizerTools(host, {
  messages, viewerId: viewer.id, viewerUserName: viewer.user_name, organizerUserNames, threadId,
  globalConfigMessageId: Number(global?.messageId) || null,
  postMessage: body => run(() => threads.api.sendMessage(threadId, { body })),
  patchMessage: (id, body) => run(() => threads.api.editMessage(id, { body })),
  fetchMessage: id => run(async () => {
   const data = await query.refresh();
   const message = data.messages.find(row => Number(row.id) === Number(id));
   return message ? { message, messages: data.messages } : { ok: false, error: 'Challenge config no longer exists.' };
  }),
  reload, onClose,
 });
 return { ...api, isOceanman: () => isImpliedChallengeOrganizer(viewer.user_name), isModalOpen: () => !!host.querySelector('[data-challenges-organizer-modal][open]') };
}
