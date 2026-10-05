import { createFeedRequest } from '../../providers/feed/api.js';
import { createChatFeedFetchPage, getChatFeedItemKey } from '../../providers/feed/feed.js';
import { createChatFeedChannelElementsFromSegments, mountChatFeedLoadMoreSkeleton, removeChatFeedLoadMoreSkeleton } from './feedChannelView.js';
import { loadDeferredChatFeedChallenge, createChatFeedChallengePlaceholderElement, isChatFeedChallengePlaceholder } from './feedChannelChallenge.js';
import { partitionChatFeedMobileAlternating, isFeedRowVideoCreation } from '../../shared/chatFeedMobilePartition.js';
import { createFeedItemCard, getFeedGroupVideoPlayer } from '../../shared/feedCardBuild.js';
import { renderFeedCardsSkeleton } from '../../shared/skeleton.js';
import { enableLikeButtons } from '../../shared/likes.js';
import { safeMediaPlay } from '../../shared/safeMediaPlay.js';
import { openChallengeVoteModalFromMessages } from '../Challenges/mountPane.js';
import { setFeedBetaEnabledClient, feedBetaActiveFromProfile } from '../../shared/feedBetaNav.js';

export function createFeedController({ root, actions, services, setHeaderMenu }) {
 const content = root.querySelector('[data-feed-content]'), status = root.querySelector('[role="status"]'), more = root.querySelector('button');
 const scroll = root.closest('.beta-outlet__scroll');
 const lifetime = new AbortController();
 let request, fetchPage, rows = [], hasMore = false, busy = false, destroyed = false, epoch = 0, routeWrap, cards, version, versionBusy = false, challengeLease, voteModal, voteBusy = false, overlayActive = false;
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
 const videoObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const {target, isIntersecting, intersectionRatio} of entries) {
   if (!videoTargets.has(target)) continue;
   if (isIntersecting && intersectionRatio >= .5) visibleVideos.add(target); else visibleVideos.delete(target);
   updateVideo(target);
  }
 }, { root: scroll, threshold: .5 }) : null;
 function setupFeedVideo(target) {
  videoTargets.add(target);
  if (videoObserver) videoObserver.observe(target);
  else { visibleVideos.add(target); updateVideo(target); }
 }
 function pauseMedia() { root.querySelectorAll('video,audio').forEach(player => player.pause()); for (const target of videoTargets) { target.classList.remove('is-active'); getFeedGroupVideoPlayer(target)?.pause(); } }
 function resumeMedia() { for (const target of videoTargets) updateVideo(target); }
 const unsubscribeState = services.state?.subscribe(state => {
  const next = Boolean(state.navigation?.overlay);
  if (next === overlayActive) return; overlayActive = next;
  if (next) pauseMedia(); else resumeMedia();
 });
 function doomHref(item) { return mobile() && isFeedRowVideoCreation(item) ? `/feed/doom/${encodeURIComponent(item.created_image_id ?? item.id)}` : undefined; }
 function render(item, index) {
  if (isChatFeedChallengePlaceholder(item)) return createChatFeedChallengePlaceholderElement();
  return createFeedItemCard(item, index, {
   setupFeedVideo, enableComposerDragSource: true, inlineActions: true, nsfwIcon: true,
   resolveCreationCardHref: doomHref,
   performCreationNavigation: href => actions.navigate(href, { seed: item }),
   performShellNavigation: href => actions.navigate(href),
  });
 }
 function show(message = '') { status.textContent = message; status.hidden = !message; }
 function disposeCards() { videoTargets.clear(); visibleVideos.clear(); content.querySelectorAll('.feed-card').forEach(card => card.__disposeFeedCard?.()); content.querySelectorAll('video,audio').forEach(player => { player.pause(); player.removeAttribute('src'); player.load(); }); }
 function skeleton() {
  disposeCards(); videoObserver?.disconnect();
  const route = document.createElement('div'); route.className = 'feed-route chat-feed-channel-route';
  const cardList = document.createElement('div'); cardList.className = 'route-cards feed-cards';
  const generic = document.createElement('div'); generic.innerHTML = renderFeedCardsSkeleton(3);
  const cards = Array.from(generic.children);
  if (cards[0]) cardList.append(cards[0]);
  cardList.append(createChatFeedChallengePlaceholderElement());
  for (const card of cards.slice(1)) cardList.append(card);
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
   if (reset) {
    disposeCards(); videoObserver?.disconnect(); content.replaceChildren();
    const result = createChatFeedChannelElementsFromSegments(mobile() ? partitionChatFeedMobileAlternating(rows, { reserveChallengeSlot: true }).segments : [{ type: 'cards', items: rows }], render, { resolveSpotlightHref: doomHref, performSpotlightNavigation: href => actions.navigate(href) });
    routeWrap = result.routeWrap; cards = result.cards; content.append(routeWrap);
    void loadDeferredChatFeedChallenge({ messagesEl: content, routeWrap, mobileLayout: mobile(), fetchJson: createFeedRequest(request.signal), renderCard: render, isStale: () => destroyed || epoch !== token });
    scroll?.scrollTo?.({top:0});
   } else { removeChatFeedLoadMoreSkeleton(cards); fresh.forEach((item,index) => cards.append(render(item, rows.length-fresh.length+index))); }
   enableLikeButtons(root);
   show(rows.length ? '' : 'Your feed is empty. Explore the community and follow creators to see their creations here.');
   more.hidden = !hasMore; more.textContent = 'Load more';
  } catch(error) {
   if (destroyed || token !== epoch || error.name === 'AbortError') return;
   if (error.status === 401) { services.session.redirectToLogin(); return; }
   if (reset) content.replaceChildren();
   show(error.message || 'Unable to load your feed.'); more.hidden = false; more.textContent = 'Retry';
  } finally { if (!destroyed && token === epoch) { removeChatFeedLoadMoreSkeleton(cards); busy = false; more.disabled = false; root.removeAttribute('aria-busy'); } }
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
  const scrollTop = scroll?.scrollTop ?? 0;
  await load(true);
  if (!destroyed && scroll) requestAnimationFrame(() => { if (!destroyed) scroll.scrollTop = scrollTop; });
 }
 const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { if (entries.some(entry=>entry.isIntersecting) && hasMore && !busy && status.hidden) void load(); }, {root:scroll,rootMargin:'800px'}) : null;
 observer?.observe(more);
 more.addEventListener('click',()=>void load(!rows.length),{signal:lifetime.signal});
 window.addEventListener('ps:challenge-vote-modal-request',vote,{signal:lifetime.signal});
 document.addEventListener('visibilitychange',()=>{ if (document.hidden) pauseMedia(); else { resumeMedia(); void checkVersion(); } },{signal:lifetime.signal});
 window.addEventListener('focus',checkVersion,{signal:lifetime.signal});
 document.addEventListener('nsfw-preference-changed',()=>void load(true),{signal:lifetime.signal});
 document.addEventListener('creation-detail:mutation',onCreationMutation,{signal:lifetime.signal});
 const timer = setInterval(checkVersion,60000);
 setHeaderMenu?.({label:'Feed',items:[{label:'Refresh',action:'refresh'}],onSelect:()=>void load(true)});
 setFeedBetaEnabledClient(feedBetaActiveFromProfile(services.session.user));
 void load(true); void checkVersion();
 return { destroy() { destroyed=true; ++epoch; lifetime.abort(); unsubscribeState?.(); request?.abort(); clearInterval(timer); observer?.disconnect(); videoObserver?.disconnect(); voteModal?.destroy(); challengeLease?.release(); disposeCards(); } };
}
