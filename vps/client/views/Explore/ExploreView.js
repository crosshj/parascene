import { fetchExplorePage } from '../../providers/explore/api.js';
import { mergeExploreSearchKeywordSemantic } from '../../providers/explore/model.js';
import { creationCardMarkup, createCreationMediaLoader } from '../../shared/creationGrid.js';
import { createFeedItemCard } from '../../shared/feedCardBuild.js';
import '../../components/CreationGrid/CreationGrid.css';
import './ExploreView.css';
import { bindSearchComposer } from '../../components/SearchComposer/SearchComposer.js';
import { gridSkeletonMarkup } from '../../components/CreationGrid/skeleton.js';

export const ExploreView = Object.freeze({
 mount({ outlet, actions, services, search = '', searchComposer, setHeaderMenu }) {
  const root = document.createElement('section'); root.className = 'explore-view creation-browse chat-feed-channel-route--browse-view';
  root.innerHTML = `<div class="explore-view__status" role="status"></div><div class="route-cards content-cards-image-grid creation-browse-grid" aria-label="Community creations"></div><button class="explore-view__more" type="button" hidden>Load more</button>`;
  outlet.replaceChildren(root); document.title = 'Explore · Parascene beta';
  const grid = root.querySelector('.route-cards'), status = root.querySelector('[role="status"]'), more = root.querySelector('.explore-view__more');
  const media = createCreationMediaLoader(grid); const scroll = root.closest('.beta-outlet__scroll');
  let q = new URLSearchParams(search).get('q')?.trim() || '', offset = 0, hasMore = false, busy = false, destroyed = false, epoch = 0, request, rows = [], large = false;
  try { large = localStorage.getItem('parascene:explore-large') === '1'; } catch {}
  function disposeCards() { grid.querySelectorAll('.feed-card').forEach(card => card.__disposeFeedCard?.()); }
  function paint() {
   disposeCards();
   media.disconnect();grid.querySelectorAll('video,audio').forEach(player=>{player.pause();player.removeAttribute('src');player.load()}); grid.replaceChildren();
   grid.classList.toggle('content-cards-image-grid', !large); root.classList.toggle('explore-view--large', large);
   for (const [index, item] of rows.entries()) {
    const card = large ? createFeedItemCard(item, index, { preferThumbnail: true, hideFeedCardMetadata: false, hidePublishedBadge: true, performCreationNavigation: href => actions.navigate(href, { seed: item }), performShellNavigation: href => actions.navigate(href) }) : document.createRange().createContextualFragment(creationCardMarkup(item, { hidePublishedBadge: true })).firstElementChild;
    if (!card) continue; card.__creationRecord = item; grid.append(card);
   }
   media.observe();
  }
  function show(message, error = false) { status.textContent = message; status.hidden = !message; status.classList.toggle('is-error', error); }
  function menu() { setHeaderMenu?.({ label: 'Explore', items: [{ label: 'Refresh', action: 'refresh' }, { label: large ? 'Grid view' : 'Large cards', action: 'toggle' }], onSelect: ({ action }) => { if (action === 'toggle') { large = !large; try { localStorage.setItem('parascene:explore-large', large ? '1' : '0'); } catch {} paint(); menu(); } else void load(true); } }); }
  function skeleton() { disposeCards(); media.disconnect(); grid.replaceChildren(); grid.innerHTML = gridSkeletonMarkup(); }
  async function load(reset = false) {
   if (destroyed || (busy && !reset)) return;
   request?.abort(); request = new AbortController(); const token = ++epoch; busy = true; more.disabled = true;
   const signal = request.signal; searchBinding.setQuery(q); root.setAttribute('aria-busy', 'true');
   if (reset) { offset = 0; rows = []; skeleton(); }
   show('');
   const current = () => !destroyed && epoch === token;
   try {
    if (q) {
     let keyword = [], semantic = [], settled = 0, success = 0, first = '', errors = [];
     const handle = async kind => {
      try {
       const page = await fetchExplorePage({ q, semantic: kind === 'semantic', limit: 100, signal });
       if (!current()) return; success++; if (page.items?.length && !first) first = kind;
       if (kind === 'semantic') semantic = page.items || []; else keyword = page.items || [];
      } catch (error) { if (!current() || error.name === 'AbortError') return; if (error.status === 401) services.session.redirectToLogin(); errors.push(error); }
      finally {
       if (current()) {
        settled++; rows = mergeExploreSearchKeywordSemantic(keyword, semantic, first === 'semantic');
        if (rows.length || settled === 2) { paint(); show(rows.length ? (errors.length ? 'Some search results could not be loaded. Refresh to retry.' : '') : settled === 2 ? success ? 'No creations found.' : 'Unable to search. Refresh to retry.' : '', settled === 2 && !success); }
       }
      }
     };
     await Promise.all([handle('keyword'), handle('semantic')]); hasMore = false;
    } else {
     const page = await fetchExplorePage({ offset, limit: 50, signal }); if (!current()) return;
     const ids = new Set(rows.map(row => String(row.id))); rows.push(...(page.items || []).filter(row => !ids.has(String(row.id))));
     offset += page.items?.length || 0; hasMore = page.hasMore === true; paint(); show(rows.length ? '' : 'Nothing to explore yet. Published creations from the community will appear here.');
    }
    if (current()) { more.hidden = !hasMore; more.textContent = 'Load more'; if (reset) scroll?.scrollTo?.({ top: 0 }); }
   } catch (error) { if (current() && error.name !== 'AbortError') { if (error.status === 401) return services.session.redirectToLogin(); grid.querySelectorAll('.skeleton-grid-tile').forEach(tile => tile.remove()); show(error.message || 'Unable to load Explore.', true); more.hidden = false; more.textContent = 'Retry'; } }
   finally { if (current()) { busy = false; more.disabled = false; root.removeAttribute('aria-busy'); } }
  }
  async function onCreationMutation(event) {
   if (!['published', 'unpublished', 'edited'].includes(event.detail?.reason) || destroyed) return;
   const scrollTop = scroll?.scrollTop ?? 0;
   await load(true);
   if (!destroyed && scroll) requestAnimationFrame(() => { if (!destroyed) scroll.scrollTop = scrollTop; });
  }
  document.addEventListener('creation-detail:mutation', onCreationMutation);
  function submit(value) { const params = new URLSearchParams(); if (value.trim()) params.set('q', value.trim()); void actions.navigate(`/explore${params.size ? `?${params}` : ''}`); }
  const searchBinding = bindSearchComposer({ form: searchComposer, onSearch: submit });
  grid.addEventListener('click', event => { if (large || event.target.closest('a,button')) return; const card = event.target.closest('.creation-grid__card[data-creation-id]'); if (card) void actions.navigate(`/creations/${card.dataset.creationId}`, { seed: card.__creationRecord }); });
  grid.addEventListener('keydown', event => { if (large || !['Enter', ' '].includes(event.key)) return; const card = event.target.closest('.creation-grid__card[data-creation-id]'); if (card && event.target === card) { event.preventDefault(); void actions.navigate(`/creations/${card.dataset.creationId}`, { seed: card.__creationRecord }); } });
  more.addEventListener('click', () => void load(!rows.length));
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting) && hasMore && !busy && !status.classList.contains('is-error')) void load(); }, { root: scroll, rootMargin: '1000px' }) : null;
  observer?.observe(more); menu(); void load(true);
  return { update({ search = '' }) { const next = new URLSearchParams(search).get('q')?.trim() || ''; if (next !== q) { q = next; void load(true); } }, destroy() { document.removeEventListener('creation-detail:mutation', onCreationMutation); searchBinding.destroy(); disposeCards(); destroyed = true; ++epoch; request?.abort(); observer?.disconnect(); media.disconnect(); root.querySelectorAll('audio,video').forEach(player => { player.pause(); player.removeAttribute('src'); player.load(); }); root.remove(); } };
 }
});
