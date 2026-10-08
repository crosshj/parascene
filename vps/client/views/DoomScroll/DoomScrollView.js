import './DoomScrollView.css';
import { mountChatDoomScroll, teardownChatDoomScroll } from './doomScrollMount.js';
import { openDoomCommentsPopover, destroyDoomCommentsPopover } from './doomCommentsPopover.js';
import { createFeedRequest } from '../../providers/feed/api.js';
import { getHiddenFeedItems } from '../../shared/feedHiddenItems.js';
import { doomSeedItem } from '../../shared/doomFeedVideoCache.js';

function showPendingIndicator(root) {
	const pending = document.createElement('div');
	pending.className = 'chat-doom-pending';
	pending.setAttribute('role', 'status');
	pending.setAttribute('aria-label', 'Loading');
	pending.innerHTML = '<span class="chat-doom-pending-spinner" aria-hidden="true"></span>';
	root.replaceChildren(pending);
}

export const DoomScrollView = Object.freeze({
 mount({ outlet, creationId, services, actions, seed }) {
  const root = document.createElement('section');
  root.className = 'doom-scroll-view';
  root.id = 'chat-doom-scroll-overlay';
  outlet.replaceChildren(root);
  services.providers.document.setTitle('Doom Scroll · Parascene beta');
  let request, destroyed = false, activeId = Number(creationId);

  function loadTimeline(id) {
   activeId = Number(id);
   request?.abort();
   teardownChatDoomScroll();
   request = new AbortController();
   const signal = request.signal;
   root.innerHTML = '';
   showPendingIndicator(root);
   return mountChatDoomScroll({
    hostEl: root, startCreationId: Number(id), signal,
    seedItem: doomSeedItem(seed, id),
    fetchJsonWithStatusDeduped: createFeedRequest(signal), getHiddenFeedItems,
    viewerUserId: services.providers.viewerId, viewer: services.session.user,
    onDismiss: () => actions.dismissOverlay(),
    onSlideChange(id) {
     if (destroyed || Number(id) === activeId) return;
     activeId = Number(id);
     void actions.navigate(`/feed/doom/${encodeURIComponent(id)}`, { replace: true });
    },
   }).catch(error => {
    if (destroyed || signal.aborted || error.name === 'AbortError') return;
    if (error.status === 401) return services.session.redirectToLogin();
    const message = document.createElement('p');
    message.className = 'chat-doom-error';
    message.textContent = error.message || 'Unable to load video.';
    const back = document.createElement('button');
    back.textContent = 'Back to feed';
    back.addEventListener('click', () => actions.dismissOverlay());
    root.replaceChildren(message, back);
   });
  }

  const backgroundReady = loadTimeline(creationId);
  root.addEventListener('click', event => {
   if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
   const bar = event.target.closest('[data-chat-doom-detail]');
   if (bar && !event.target.closest('a,button,input,textarea,select')) {
    event.preventDefault();
    void actions.navigate(bar.getAttribute('data-chat-doom-detail-href'));
    return;
   }
   const link = event.target.closest('a[href]');
   if (!link) return;
   if (link.matches('[data-chat-doom-comments]')) {
    event.preventDefault();
    event.stopPropagation();
    const countEl = link.querySelector('.chat-doom-rail-count');
    const commentCountLabel = countEl && typeof countEl.textContent === 'string' ? countEl.textContent.trim() : '';
    openDoomCommentsPopover({
     commentCountLabel,
     detailHref: link.getAttribute('href'),
     viewer: services.session.user,
     isAdmin: services.session.user?.role === 'admin',
    });
    return;
   }
   const url = new URL(link.href, location.origin);
   if (url.origin === location.origin) {
    event.preventDefault();
    void actions.navigate(url.pathname + url.search + url.hash);
   }
  });

  return {
   backgroundReady,
   update({ creationId: next }) {
    const id = Number(next);
    if (id === activeId) return;
    const slide = root.querySelector(`[data-creation-id="${id}"]`);
    if (slide) { activeId = id; slide.scrollIntoView({ block: 'start' }); }
    else void loadTimeline(id);
   },
   destroy() {
    destroyed = true;
    request?.abort();
    destroyDoomCommentsPopover();
    teardownChatDoomScroll();
    root.remove();
   },
  };
 },
});
