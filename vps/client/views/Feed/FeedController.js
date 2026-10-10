import { createFeedRequest } from '../../providers/feed/api.js';
import { createChatFeedFetchPage, getChatFeedItemKey } from '../../providers/feed/feed.js';
import { createChatFeedChannelElementsFromSegments, getChatFeedMobileSpotlightHtml, mountChatFeedLoadMoreSkeleton, removeChatFeedLoadMoreSkeleton } from './feedChannelView.js';
import { loadDeferredChatFeedChallenge, createChatFeedChallengePlaceholderElement, isChatFeedChallengePlaceholder } from './feedChannelChallenge.js';
import { partitionChatFeedMobileAlternating, isFeedRowVideoCreation } from '../../shared/chatFeedMobilePartition.js';
import { primeDoomAudiblePlayback, rememberFeedDoomVideo } from '../../shared/doomFeedVideoCache.js';
import { resumeMediaAudioLevelingFromGesture } from '../../shared/mediaAudioLeveling.js';
import { createFeedItemCard, getFeedGroupVideoPlayer, getFeedItemGroupVideoSlides } from '../../shared/feedCardBuild.js';
import { renderFeedCardsSkeleton, renderMobileFeedCardsSkeleton } from '../../shared/skeleton.js';
import { enableLikeButtons } from '../../shared/likes.js';
import { safeMediaPlay } from '../../shared/safeMediaPlay.js';
import { openChallengeVoteModalFromMessages } from '../Challenges/mountPane.js';
import { setFeedBetaEnabledClient } from '../../shared/feedBetaNav.js';
import { createScrollContext } from '../../core/scrollContext.js';

export function createFeedController({ root, actions, services, setHeaderMenu }) {
 const content = root.querySelector('[data-feed-content]'), status = root.querySelector('[role="status"]'), more = root.querySelector('button');
 const scroll = createScrollContext(root);
 const lifetime = new AbortController();
 let request, fetchPage, rows = [], hasMore = false, emptyPages = 0, busy = false, destroyed = false, epoch = 0, routeWrap, cards, version, versionBusy = false, challengeLease, voteModal, voteBusy = false, overlayActive = false;
 const mobile = () => matchMedia('(max-width: 768px)').matches;
 const videoTargets = new Set();
 const visibleVideos = new Set();
 function updateVideo(target) {
  const active = visibleVideos.has(target) && !document.hidden && !overlayActive && !destroyed;
  target.classList.toggle('is-active', active);
  if (target instanceof HTMLVideoElement) {
   if (active) {
    target.muted = true;
    if (!target.getAttribute('src') && target.dataset.feedVideoSrc) target.src = target.dataset.feedVideoSrc;
    safeMediaPlay(target);
   } else target.pause();
  } else {
   const player = getFeedGroupVideoPlayer(target);
   if (active) { player?.setMuted(true); player?.play(); } else player?.pause();
  }
 }
 let videoObserver = null;
 let observer = null;
 function bindScrollObservers() {
  videoObserver?.disconnect();
  observer?.disconnect();
  if (typeof IntersectionObserver !== 'function') return;
  videoObserver = new IntersectionObserver(entries => {
  for (const {target, isIntersecting, intersectionRatio} of entries) {
   if (!videoTargets.has(target)) continue;
   if (isIntersecting && intersectionRatio >= .5) visibleVideos.add(target); else visibleVideos.delete(target);
   updateVideo(target);
  }
  }, { root: scroll.intersectionRoot, threshold: .5 });
  for (const target of videoTargets) videoObserver.observe(target);
  observer = new IntersectionObserver(entries => { if (entries.some(entry=>entry.isIntersecting) && hasMore && !busy && status.hidden) void load(); }, { root: scroll.intersectionRoot, rootMargin:'800px' });
  if (more && !more.hidden) observer.observe(more);
 }
 function rearmFeedSentinel() {
  if (!observer || !more || more.hidden || destroyed) return;
  observer.unobserve(more);
  observer.observe(more);
 }
 document.addEventListener('beta-mobile-scroll-owner-changed', bindScrollObservers);
 bindScrollObservers();
 function setupFeedVideo(target) {
  videoTargets.add(target);
  if (videoObserver) videoObserver.observe(target);
  else { visibleVideos.add(target); updateVideo(target); }
 }
 function pauseMedia() { root.querySelectorAll('video,audio').forEach(player => player.pause()); for (const target of videoTargets) { target.classList.remove('is-active'); getFeedGroupVideoPlayer(target)?.pause(); } }
 function resumeMedia() {
  for (const item of rows) rememberFeedDoomVideo(item);
  for (const target of videoTargets) updateVideo(target);
 }
 const unsubscribeState = services.state?.subscribe(state => {
  const next = Boolean(state.navigation?.overlay);
  if (next === overlayActive) return; overlayActive = next;
  if (next) pauseMedia(); else resumeMedia();
 });
 function doomHref(item) { return mobile() && isFeedRowVideoCreation(item) ? `/feed/doom/${encodeURIComponent(item.created_image_id ?? item.id)}` : undefined; }
 function beginDoomFromFeedTap(href, item) {
  if (typeof href !== 'string' || !href.startsWith('/feed/doom/')) return;
  try {
   if (getFeedItemGroupVideoSlides(item).length > 1) {
    resumeMediaAudioLevelingFromGesture();
    return;
   }
   primeDoomAudiblePlayback(item);
  } catch {
   // Playback unlock must not block opening the scroll.
  }
 }
 function render(item, index) {
  if (isChatFeedChallengePlaceholder(item)) return createChatFeedChallengePlaceholderElement();
  return createFeedItemCard(item, index, {
   setupFeedVideo, enableComposerDragSource: true, inlineActions: true, nsfwIcon: true,
   resolveCreationCardHref: doomHref,
   performCreationNavigation: href => { beginDoomFromFeedTap(href, item); actions.navigate(href, { seed: item }); },
   performShellNavigation: href => actions.navigate(href),
  });
 }
 function show(message = '') { status.textContent = message; status.hidden = !message; }
 function disposeCards() { videoTargets.clear(); visibleVideos.clear(); content.querySelectorAll('.feed-card').forEach(card => card.__disposeFeedCard?.()); content.querySelectorAll('video,audio').forEach(player => { player.pause(); player.removeAttribute('src'); player.load(); }); }
 function skeleton() {
  disposeCards(); videoObserver?.disconnect();
  const route = document.createElement('div'); route.className = 'feed-route chat-feed-channel-route';
  if (mobile()) {
   const spotlight = document.createElement('div'); spotlight.innerHTML = getChatFeedMobileSpotlightHtml();
   if (spotlight.firstElementChild) route.append(spotlight.firstElementChild);
  }
  const cardList = document.createElement('div'); cardList.className = 'route-cards feed-cards';
  const generic = document.createElement('div'); generic.innerHTML = mobile() ? renderMobileFeedCardsSkeleton(4) : renderFeedCardsSkeleton(3);
  const cards = Array.from(generic.children);
  if (mobile()) {
   // WWW keeps the loading state to a simple run of full feed-card skeletons;
   // challenge engagement is inserted only after the feed response arrives.
   for (const card of cards) cardList.append(card);
  } else {
   if (cards[0]) cardList.append(cards[0]);
   cardList.append(createChatFeedChallengePlaceholderElement());
   for (const card of cards.slice(1)) cardList.append(card);
  }
  route.append(cardList); content.replaceChildren(route);
 }
 async function load(reset = false) {
  if (destroyed || busy && !reset) return;
  if (reset) { request?.abort(); request = new AbortController(); rows = []; hasMore = false; fetchPage = createChatFeedFetchPage({ fetchJsonWithStatusDeduped: createFeedRequest(request.signal), mobileChatSlotPack: mobile() }); skeleton(); }
  const token = reset ? ++epoch : epoch; busy = true; more.disabled = true; root.setAttribute('aria-busy','true'); show();
  if (!reset && cards) mountChatFeedLoadMoreSkeleton(cards);
  try {
   const page = await fetchPage({ initial: reset, items: rows });
   if (destroyed || token !== epoch) return;
   const seen = new Set(rows.map(getChatFeedItemKey));
   const fresh = page.pageItems.filter(item => { const key = getChatFeedItemKey(item); if (seen.has(key)) return false; seen.add(key); return true; });
   rows.push(...fresh); hasMore = page.hasMore;
   if (reset || fresh.length) emptyPages = 0; else emptyPages += 1;
   if (emptyPages >= 2) hasMore = false;
   if (reset) {
    disposeCards(); content.replaceChildren(); bindScrollObservers();
    const result = createChatFeedChannelElementsFromSegments(mobile() ? partitionChatFeedMobileAlternating(rows, { reserveChallengeSlot: true }).segments : [{ type: 'cards', items: rows }], render, { resolveSpotlightHref: doomHref, performSpotlightNavigation: (href, _event, item) => { beginDoomFromFeedTap(href, item); actions.navigate(href, { seed: item }); } });
    routeWrap = result.routeWrap; cards = result.cards; content.append(routeWrap);
    void loadDeferredChatFeedChallenge({ messagesEl: content, routeWrap, mobileLayout: mobile(), fetchJson: createFeedRequest(request.signal), renderCard: render, isStale: () => destroyed || epoch !== token });
    scroll.to(0);
   } else { removeChatFeedLoadMoreSkeleton(cards); fresh.forEach((item,index) => cards.append(render(item, rows.length-fresh.length+index))); }
   enableLikeButtons(root);
   show(rows.length ? '' : 'Your feed is empty. Explore the community and follow creators to see their creations here.');
   more.hidden = !hasMore; more.textContent = 'Load more';
  } catch(error) {
   if (destroyed || token !== epoch || error.name === 'AbortError') return;
   if (error.status === 401) { services.session.redirectToLogin(); return; }
   if (reset) content.replaceChildren();
   show(error.message || 'Unable to load your feed.'); more.hidden = false; more.textContent = 'Retry';
  } finally { if (!destroyed && token === epoch) { removeChatFeedLoadMoreSkeleton(cards); busy = false; more.disabled = false; root.removeAttribute('aria-busy'); if (hasMore && status.hidden) rearmFeedSentinel(); } }
 }
 async function vote(event) {
  if (destroyed || event.detail?.source !== 'feed_challenge_card') return;
  event.preventDefault();
  if (voteBusy || voteModal?.isOpen()) return; voteBusy = true;
  const threads = services.providers.threads;
  try {
   await threads.query.loadIfNeeded(); if (destroyed) return;
   const thread = threads.query.data?.threads?.find(row => row.channel_slug === 'challenges');
   if (!thread) return actions.navigate('/challenges');
   challengeLease?.release(); challengeLease = threads.acquireMessages(Number(thread.id), { persist:true, complete:true });
   await challengeLease.query.loadIfNeeded(); if (destroyed) return;
   openChallengeVoteModalFromMessages({ messages: threads.votes.project(challengeLease.query.data?.messages || []), viewerId: services.providers.viewerId, challengeId: event.detail?.challengeId,
    toggleReaction: () => Promise.resolve({ok:true}), setVote: (id,score) => threads.votes.set(Number(thread.id),id,score), getVoteDelivery: id => threads.votes.get(id), subscribeVotes: cb => threads.votes.subscribe(cb), onModal: modal => { voteModal = modal; }, onVoteClose: () => { if (!destroyed) void refreshChallenge(); },
   });
  } catch(error) { if (!destroyed) show(error.message); } finally { voteBusy = false; }
 }
 async function refreshChallenge() {
  if (!routeWrap || destroyed) return;
  const current = epoch;
  await loadDeferredChatFeedChallenge({messagesEl:content,routeWrap,mobileLayout:mobile(),fetchJson:createFeedRequest(request.signal),renderCard:render,isStale:()=>destroyed||epoch!==current}); enableLikeButtons(root);
 }
 async function checkVersion() {
  if (destroyed || document.hidden || overlayActive || versionBusy || busy) return;
  versionBusy = true;
  try { const response = await createFeedRequest(lifetime.signal)('/api/feed/version'); if (destroyed) return; if (version !== undefined && version !== response.data.version) void load(true); version = response.data.version; } catch {} finally { versionBusy = false; }
 }
 async function onCreationMutation(event) {
  const reason = event.detail?.reason;
  if (!['published', 'unpublished', 'edited'].includes(reason) || destroyed) return;
  const scrollTop = scroll.top;
  await load(true);
  if (!destroyed) requestAnimationFrame(() => scroll.set(scrollTop));
 }
 more.addEventListener('click',()=>void load(!rows.length),{signal:lifetime.signal});
 window.addEventListener('ps:challenge-vote-modal-request',vote,{signal:lifetime.signal});
 document.addEventListener('visibilitychange',()=>{ if (document.hidden) pauseMedia(); else { resumeMedia(); void checkVersion(); } },{signal:lifetime.signal});
 window.addEventListener('focus',checkVersion,{signal:lifetime.signal});
 document.addEventListener('nsfw-preference-changed', (event) => {
  if (event.detail?.membershipChanged === false) {
   for (const card of [...content.querySelectorAll('.feed-card[data-creation-id]')]) {
    const id = card.getAttribute('data-creation-id');
    const index = rows.findIndex((item) => String(item?.created_image_id ?? item?.id ?? '') === id);
    if (index < 0) continue;
    for (const target of [...videoTargets]) {
     if (card.contains(target)) {
      videoTargets.delete(target);
      visibleVideos.delete(target);
     }
    }
    card.__disposeFeedCard?.();
    card.replaceWith(render(rows[index], index));
   }
   return;
  }
  void load(true);
 }, {signal:lifetime.signal});
 document.addEventListener('creation-detail:mutation',onCreationMutation,{signal:lifetime.signal});
 const timer = setInterval(checkVersion,60000);
 setHeaderMenu?.({label:'Feed',items:[{label:'Refresh',action:'refresh'}],onSelect:()=>void load(true)});
 setFeedBetaEnabledClient(true);
 void load(true); void checkVersion();
 return { destroy() { destroyed=true; ++epoch; lifetime.abort(); unsubscribeState?.(); request?.abort(); clearInterval(timer); document.removeEventListener('beta-mobile-scroll-owner-changed', bindScrollObservers); observer?.disconnect(); videoObserver?.disconnect(); voteModal?.destroy(); challengeLease?.release(); disposeCards(); } };
}
