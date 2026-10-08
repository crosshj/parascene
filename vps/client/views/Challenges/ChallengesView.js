import { challengesDetailsHref } from '../../shared/challenges/model/detailsRoute.js';
import { createChallengesController } from './ChallengesController.js';
import { hydrateChallengeHistoryThumbnails } from '../../shared/challengeHistoryThumb.js';
import { mountChallengesPane, renderCachedPreviousChallengesHtml } from './mountPane.js';
import { omitWithdrawnChallengeSubmissions } from './views/entryBoardView.js';
import { outstandingChallengeVotes } from '../../shared/challenges/model/outstandingVotes.js';
import { mountOrganizeSnapshot } from './organizePageMain.js';
import { isChallengeChannelAdmin, pickLatestChallengesGlobalConfig, resolveChallengeOrganizerAllowlistFromMessages } from '../../shared/challenges/challengeAdmin.js';
import { mountChallengesOrganizerTools } from './mountOrganizerSidebar.js';
import { detailOrganizerHeaderActions } from './views/organizeBoardView.js';
import { challengesMessagesFingerprint } from '../../shared/challenges/challengesChannelCache.js';
import { REACTION_ICONS } from '../../icons/svg-strings.js';
import { renderChallengePaneSkeleton, renderChallengesOrganizeBoardSkeleton } from '../../shared/skeleton.js';
import '../../components/Modal/Modal.css';
import '../../components/ChallengeCard/ChallengeCard.css';
import '../../components/CreationGrid/CreationGrid.css';
import '../../components/SegmentedControl/SegmentedControl.css';
import './ChallengesView.css';
import './ChallengesOrganize.css';
import './ChallengesOverrides.css';
import './ChallengeModals.css';

const NAV_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"></path><path d="M11 6 5 12l6 6"></path></svg>';

function challengeNavControl(kind, item) {
	const label = kind === 'previous' ? 'Older' : 'Newer';
	const control = document.createElement(item ? 'a' : 'button');
	control.className = `challenge-detail-nav-btn challenge-detail-nav-btn--${kind}`;
	if (item) {
		control.href = challengesDetailsHref(item.challengeId);
		control.dataset.spaLink = '';
		control.setAttribute('aria-label', `${label} challenge, ${item.title}`);
	} else {
		control.type = 'button';
		control.disabled = true;
		control.setAttribute('aria-label', `No ${label.toLowerCase()} challenge`);
	}
	const icon = document.createElement('span');
	icon.innerHTML = NAV_CHEVRON;
	const text = document.createElement('span');
	text.textContent = label;
	if (kind === 'next') control.append(text, icon);
	else control.append(icon, text);
	return control;
}

function paintChallengeNav(host, nav) {
	if (!(host instanceof HTMLElement)) return;
	host.replaceChildren();
	const shell = document.createElement('div');
	shell.className = 'beta-outlet__composer-shell';
	const row = document.createElement('div');
	row.className = 'beta-outlet__composer-input-row challenge-detail-nav-row';
	row.append(
		challengeNavControl('previous', nav?.previous || null),
		challengeNavControl('next', nav?.next || null)
	);
	shell.append(row);
	host.append(shell);
}

export const ChallengesView = Object.freeze({
 mount({ outlet, services, actions, setHeaderMenu, setHeaderAccessories, setHeaderBreadcrumb, setHeaderTitle, challengeNav, title = 'Challenges' }) {
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
  let destroyed = false, mounted = null, historyPainted = false, organizerTools = null, detailChrome = null, lease = null, threadId = null, fingerprint = '', latest = null, readId = 0, participantPainted = false;
  const withdrawnCreationIds = new Set();
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
  let controller = null;
  async function refresh() {
   try { await controller?.refresh(); } catch { /* Query retains cached data and publishes the error. */ }
  }
  function mountDetailOrganizerTools(messages) {
   organizerTools?.destroy();
   const host = document.createElement('div');
   host.className = 'challenge-detail-organizer-host';
   wrapper.append(host);
   const run = async action => { try { return { ok: true, ...await action() }; } catch (error) { return { ok: false, error: error.message }; } };
   const global = pickLatestChallengesGlobalConfig(messages);
   organizerTools = mountChallengesOrganizerTools(host, {
    messages,
    actionsOnly: true,
    viewerId: viewer.id,
    viewerUserName: viewer.user_name,
    organizerUserNames: resolveChallengeOrganizerAllowlistFromMessages(messages),
    threadId,
    globalConfigMessageId: Number(global?.messageId) || null,
    postMessage: body => run(() => threads.api.sendMessage(threadId, { body })),
    patchMessage: (id, body) => run(() => threads.api.editMessage(id, { body })),
    fetchMessage: id => run(async () => {
     const data = await lease?.query.refresh();
     const message = data?.messages?.find(row => Number(row.id) === Number(id));
     return message ? { message, messages: data.messages } : { ok: false, error: 'Challenge config no longer exists.' };
    }),
    reload: refresh,
    onClose: afterClose,
   });
  }
  function header(eligible = false) {
   const accessories = [];
   if (eligible && location.pathname === '/challenges') {
    accessories.push({
     label: 'Organize',
     ariaLabel: 'Organize challenges',
     onClick: () => actions.navigate('/challenges/organize'),
    });
   }
   if (eligible && detailChrome?.challengeId && location.pathname.startsWith('/challenges/details/')) {
    for (const action of detailOrganizerHeaderActions(detailChrome.phase)) {
     accessories.push({
      label: action.label,
      ariaLabel: action.ariaLabel,
      onClick: () => {
       const id = detailChrome?.challengeId;
       if (!id) return;
       if (action.id === 'manage') organizerTools?.openManage(id);
       else if (action.id === 'view') organizerTools?.openView(id);
       else organizerTools?.openResults(id);
      },
     });
    }
   }
   if (organizing && mounted?.isOceanman?.()) {
    accessories.push({
     label: 'Settings',
     ariaLabel: 'Organizer settings',
     onClick: () => mounted?.openGlobalSettings?.(),
    });
   }
   setHeaderAccessories?.(accessories);
   setHeaderMenu?.({
    label: 'Challenges',
    items: [{ label: 'Refresh', action: 'refresh' }],
    onSelect() { void refresh(); },
   });
  }
  const afterClose = () => queueMicrotask(() => { if (!destroyed) controller?.repaint(); });
  function showPrevious(messages) {
   if (location.pathname !== '/challenges' || mounted || historyPainted) return;
   historyPainted = true;
   root.innerHTML = `<div class="challenge-pane"><div class="challenge-pane-column">${renderChallengePaneSkeleton()}</div>${renderCachedPreviousChallengesHtml(messages, Date.now())}</div>`;
   void hydrateChallengeHistoryThumbnails(root);
  }
  function showError(message) {
   root.replaceChildren();
   const error = document.createElement('p');
   error.textContent = message;
   root.append(error);
  }
  function paintMessages(messages) {
   if (destroyed || !lease) return;
   const projected = omitWithdrawnChallengeSubmissions(threads.votes.project(messages), withdrawnCreationIds);
   const outstanding = outstandingChallengeVotes(projected, viewer.id);
   threads.setChallengeAttention?.(outstanding);
   const last = Number(projected.at(-1)?.id) || 0;
   if (outstanding === 0 && last > readId) { readId = last; void threads.markRead(threadId, last).catch(() => { readId = 0; }); }
   if (mounted?.isVoteOpen?.()) { mounted.updateVotes(projected); return; }
   if (mounted?.isModalOpen?.() || organizerTools?.isModalOpen?.()) return;
   const next = `${challengesMessagesFingerprint(projected)}:w${[...withdrawnCreationIds].sort((a, b) => a - b).join('.')}:${Math.floor(Date.now() / 60000)}`;
   if (mounted && next === fingerprint) return;
   mounted?.destroy(); mounted = null;
   organizerTools?.destroy(); organizerTools = null;
   detailChrome = null;
   const eligible = isChallengeChannelAdmin(viewer.user_name, resolveChallengeOrganizerAllowlistFromMessages(projected));
   if (organizing) mounted = mountOrganizeSnapshot(root, { messages: projected, viewer, threadId, threads, query: lease.query, reload: refresh, onClose: afterClose });
   else mounted = mountChallengesPane({ root, threadId, viewerId: viewer.id, messages: projected, autoOpenVote: !participantPainted,
    entryCreations: {
     cached: (challengeId) => services.providers.challengeHistory?.entryCreations?.(threadId, challengeId) || null,
     load: (challengeId, items) => services.providers.challengeHistory?.ensureEntryCreations?.(threadId, challengeId, items) || Promise.resolve([])
    },
    setVote: (id, score) => threads.votes.set(threadId, id, score),
    getVoteDelivery: id => threads.votes.get(id), subscribeVotes: callback => threads.votes.subscribe(callback), onVoteClose: afterClose,
    reactionIconHtml: (key, cls) => REACTION_ICONS[key]?.(cls) || '',
    onChallengeNav: nav => paintChallengeNav(challengeNav, nav),
    onDetailsChrome: info => {
     detailChrome = info?.challengeId ? { challengeId: info.challengeId, phase: info.phase || '', title: info.title || '' } : null;
     const headerTitle = typeof info?.title === 'string' && info.title.trim() ? info.title.trim() : title;
     if (location.pathname.startsWith('/challenges/details/')) {
      setHeaderBreadcrumb?.({ parent: 'Challenges', href: '/challenges', current: headerTitle });
     } else {
      setHeaderTitle?.(title);
     }
     services.providers.document.setTitle(info?.title ? `${headerTitle} · Challenges · Parascene beta` : `${title} · Parascene beta`);
    },
   });
   participantPainted = true; fingerprint = next;
   if (eligible && detailChrome?.challengeId) mountDetailOrganizerTools(projected);
   header(eligible);
  }
  function onQuery(snapshot) {
   if (destroyed) return;
   latest = snapshot;
   delivery();
   if (!organizing) {
    if (snapshot.error && !mounted && !historyPainted) showError(snapshot.error.message);
    return;
   }
   if (!snapshot.data?.complete) {
    if (snapshot.error && !mounted) showError(snapshot.error.message);
    return;
   }
   paintMessages(snapshot.data.messages);
  }
  function onDelivery(delivery) {
   if (destroyed || organizing) return;
   if (delivery.error && delivery.paint === 'pending' && !mounted && !historyPainted) {
    showError(delivery.error.message);
    return;
   }
   if (delivery.paint === 'previous') showPrevious(delivery.messages);
   else if (delivery.paint === 'board' || delivery.paint === 'challenge') paintMessages(delivery.messages);
  }
  header();
  const unsubscribeVotes = threads.votes.subscribe(delivery);
  controller = createChallengesController({
   services,
   organizing,
   bindChannel(channel) { threadId = channel.threadId; lease = channel.lease; },
   onQuery,
   onDelivery,
   onThreadMissing(snapshot) {
    if (snapshot.error) { status.textContent = snapshot.error.message; status.hidden = false; retry.hidden = false; }
    else if (snapshot.data) { status.textContent = 'The Challenges channel could not be found.'; status.hidden = false; }
   },
  });
  retry.addEventListener('click', () => { threads.votes.retry(); void refresh(); });
  wrapper.addEventListener('click', event => {
   const link = event.target.closest('a[href]');
   if (!link || event.defaultPrevented || link.target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
   const url = new URL(link.href, location.origin);
   if (url.origin !== location.origin) return;
   event.preventDefault(); void actions.navigate(url.pathname + url.search + url.hash);
  });
  const phaseTimer = setInterval(() => {
   if (document.visibilityState === 'hidden') return;
   if (organizing) { if (latest?.data?.complete) paintMessages(latest.data.messages); return; }
   historyPainted = false;
   controller?.repaint();
  }, 60000);
  const onCreationMutation = (event) => {
   if (destroyed || event.detail?.reason !== 'challenge-withdrawn') return;
   const creationId = Number(event.detail.creationId);
   if (!Number.isFinite(creationId) || creationId <= 0) return;
   withdrawnCreationIds.add(creationId);
   root.querySelectorAll(`[data-challenge-entry-card][data-creation-id="${creationId}"]`).forEach((card) => card.remove());
   historyPainted = false;
   controller?.repaint();
   void refresh();
  };
  document.addEventListener('creation-detail:mutation', onCreationMutation);
  return { destroy() { destroyed = true; clearInterval(phaseTimer); document.removeEventListener('creation-detail:mutation', onCreationMutation); unsubscribeVotes(); controller?.destroy(); organizerTools?.destroy(); mounted?.destroy(); setHeaderAccessories?.(); challengeNav?.replaceChildren(); root.querySelectorAll('video,audio').forEach(media => media.pause()); wrapper.remove(); } };
 },
});
