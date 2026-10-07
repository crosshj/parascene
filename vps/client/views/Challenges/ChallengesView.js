import { mountChallengesPane } from './mountPane.js';
import { outstandingChallengeVotes } from '../../shared/challenges/model/outstandingVotes.js';
import { mountOrganizeSnapshot } from './organizePageMain.js';
import { isChallengeChannelAdmin, resolveChallengeOrganizerAllowlistFromMessages } from '../../shared/challenges/challengeAdmin.js';
import { challengesMessagesFingerprint } from '../../shared/challenges/challengesChannelCache.js';
import { captureChallengeSubmitThread } from '../../shared/challengeSubmitContext.js';
import { REACTION_ICONS } from '../../icons/svg-strings.js';
import { renderChallengePaneSkeleton, renderChallengesOrganizeBoardSkeleton } from '../../shared/skeleton.js';
import './ChallengesView.css';
import './ChallengesOrganize.css';
import './ChallengesOverrides.css';
import './ChallengeModals.css';

export const ChallengesView = Object.freeze({
 mount({ outlet, services, actions, setHeaderMenu, setHeaderBreadcrumb, setHeaderTitle, title = 'Challenges' }) {
  const threads = services.providers.threads;
  const viewer = { id: services.providers.viewerId, user_name: services.session.user?.profile?.user_name || '' };
  const organizing = location.pathname === '/challenges/organize';
  const wrapper = document.createElement('section');
  const status = document.createElement('p'); status.className = 'challenge-sync-status'; status.setAttribute('role', 'status'); status.hidden = true;
  const retry = document.createElement('button'); retry.className = 'btn-outlined'; retry.textContent = 'Retry'; retry.hidden = true;
  const root = document.createElement('div'); root.className = organizing ? 'challenges-organize-root challenges-organize-root--spa' : 'challenge-pane-root';
  wrapper.append(status, retry, root); outlet.replaceChildren(wrapper);
  root.innerHTML = organizing ? renderChallengesOrganizeBoardSkeleton() : renderChallengePaneSkeleton();
  services.providers.document.setTitle(`${title} · Parascene beta`);
  let destroyed = false, mounted = null, lease = null, unsubscribeMessages = null, threadId = null, fingerprint = '', latest = null, readId = 0, participantPainted = false;
  function delivery() {
   if (destroyed) return;
   const pending = threads.votes.pending();
   const blocked = pending.find(entry => entry.status === 'blocked');
   const failed = lease?.query.error;
   status.textContent = blocked ? `Vote not saved: ${blocked.error}. Your selection is kept.`
    : pending.length ? `${pending.length} vote${pending.length === 1 ? '' : 's'} waiting to save${threads.votes.durable ? '.' : ' — keep this tab open; browser storage is unavailable.'}`
    : failed ? 'Showing cached challenges. Refresh failed; try again.' : '';
   status.hidden = !status.textContent; retry.hidden = !blocked && !failed;
  }
  async function refresh() {
   try { await lease?.query.refresh(); } catch { /* Query retains cached data and publishes the error. */ }
  }
  function header(eligible = false) {
   setHeaderMenu?.({ label: 'Challenges', items: [
    { label: 'Refresh', action: 'refresh' },
    ...(eligible && !organizing ? [{ label: 'Organize challenges', action: 'organize' }] : []),
    ...(organizing ? [{ label: 'Back to Challenges', action: 'back' }] : []),
    ...(mounted?.isOceanman?.() ? [{ label: 'Organizer settings', action: 'settings' }] : []),
   ], onSelect({ action }) {
    if (action === 'organize') actions.navigate('/challenges/organize');
    else if (action === 'back') actions.navigate('/challenges');
    else if (action === 'settings') mounted?.openGlobalSettings?.();
    else void refresh();
   } });
  }
  const afterClose = () => queueMicrotask(() => { if (!destroyed && latest) paint(latest); });
  function paint(snapshot) {
   if (destroyed) return;
   latest = snapshot; delivery();
   if (!snapshot.data?.complete) {
    if (snapshot.error && !mounted) { root.replaceChildren(); const error = document.createElement('p'); error.textContent = snapshot.error.message; root.append(error); }
    return;
   }
   const messages = threads.votes.project(snapshot.data.messages);
   const outstanding = outstandingChallengeVotes(messages, viewer.id);
   threads.setChallengeAttention?.(outstanding);
   const last = Number(messages.at(-1)?.id) || 0;
   if (outstanding === 0 && last > readId) { readId = last; void threads.markRead(threadId, last).catch(() => { readId = 0; }); }
   if (mounted?.isVoteOpen?.()) { mounted.updateVotes(messages); return; }
   if (mounted?.isModalOpen?.()) return;
   const next = `${challengesMessagesFingerprint(messages)}:${Math.floor(Date.now() / 60000)}`;
   if (mounted && next === fingerprint) return;
   mounted?.destroy(); mounted = null;
   const eligible = isChallengeChannelAdmin(viewer.user_name, resolveChallengeOrganizerAllowlistFromMessages(messages));
   if (organizing) mounted = mountOrganizeSnapshot(root, { messages, viewer, threadId, threads, query: lease.query, reload: refresh, onClose: afterClose });
   else mounted = mountChallengesPane({ root, threadId, viewerId: viewer.id, messages, showOrganizeEntry: eligible, autoOpenVote: !participantPainted,
    setVote: (id, score) => threads.votes.set(threadId, id, score),
    getVoteDelivery: id => threads.votes.get(id), subscribeVotes: callback => threads.votes.subscribe(callback), onVoteClose: afterClose,
    reactionIconHtml: (key, cls) => REACTION_ICONS[key]?.(cls) || '',
    onDetailsChrome: info => {
     const headerTitle = typeof info?.title === 'string' && info.title.trim() ? info.title.trim() : title;
     if (location.pathname.startsWith('/challenges/details/')) {
      setHeaderBreadcrumb?.({ parent: 'Challenges', href: '/challenges', current: headerTitle });
     } else {
      setHeaderTitle?.(title);
     }
     services.providers.document.setTitle(info?.title ? `${headerTitle} · Challenges · Parascene beta` : `${title} · Parascene beta`);
    },
   });
   participantPainted = true; fingerprint = next; header(eligible);
  }
  function connect(inboxSnapshot) {
   if (destroyed || lease) return;
   const thread = inboxSnapshot.data?.threads?.find(row => row.channel_slug === 'challenges');
   if (!thread) {
    if (inboxSnapshot.error) { status.textContent = inboxSnapshot.error.message; status.hidden = false; retry.hidden = false; }
    else if (inboxSnapshot.data) { status.textContent = 'The Challenges channel could not be found.'; status.hidden = false; }
    return;
   }
   threadId = Number(thread.id); captureChallengeSubmitThread(threadId);
   lease = threads.acquireMessages(threadId, { persist: true, complete: true });
   unsubscribeMessages = lease.query.subscribe(paint);
   // The shared query paints synchronously from cache, then reconciles in place.
   void refresh();
  }
  header();
  const unsubscribeVotes = threads.votes.subscribe(delivery);
  const unsubscribeInbox = threads.query?.subscribe(connect);
  if (threads.query) void threads.query.loadIfNeeded().catch(() => undefined);
  retry.addEventListener('click', () => { threads.votes.retry(); if (lease) void refresh(); else void threads.query?.refresh().catch(() => undefined); });
  wrapper.addEventListener('click', event => {
   const link = event.target.closest('a[href]');
   if (!link || event.defaultPrevented || link.target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
   const url = new URL(link.href, location.origin);
   if (url.origin !== location.origin) return;
   event.preventDefault(); void actions.navigate(url.pathname + url.search + url.hash);
  });
  const phaseTimer = setInterval(() => { if (latest && document.visibilityState !== 'hidden') paint(latest); }, 60000);
  return { destroy() { destroyed = true; clearInterval(phaseTimer); unsubscribeInbox?.(); unsubscribeMessages?.(); unsubscribeVotes(); lease?.release(); mounted?.destroy(); root.querySelectorAll('video,audio').forEach(media => media.pause()); wrapper.remove(); } };
 },
});
