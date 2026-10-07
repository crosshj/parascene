import { escapeHtml } from '../../utils/dom.js';
import { requestJson } from '../../core/request.js';
import './HelpView.css';

function navigationMarkup(groups) {
 return '<a class="help-nav-item" href="/help">Help home</a>' + groups.map(group => `<div class="help-nav-section"><h3 class="help-nav-section-title">${escapeHtml(group.section.replace(/-/g, ' '))}</h3>${group.items.map(item => `<a class="help-nav-item${item.active ? ' active' : ''}" href="/help/${escapeHtml(item.slug)}">${escapeHtml(item.title)}</a>`).join('')}</div>`).join('');
}
export const HelpView = Object.freeze({
 mount({ outlet, actions, url = '/help' }) {
  const root = document.createElement('section'); root.className = 'help-view'; outlet.replaceChildren(root);
  let controller, searchController, epoch = 0, searchEpoch = 0, closed = false;
  async function load(url) {
   if (closed) return;
   controller?.abort(); searchController?.abort(); controller = new AbortController(); const token = ++epoch;
   root.innerHTML = '<p role="status">Loading help…</p>';
   try {
    const route = new URL(url, location.origin), slug = route.pathname.replace(/^\/help\/?/, '');
    const page = await requestJson('/api/help?' + new URLSearchParams({ slug }), { signal: controller.signal });
    if (closed || token !== epoch) return;
    document.title = `${page.article.title} · parascene`;
    root.innerHTML = `<div class="help-container"><aside class="help-sidebar"><nav class="help-nav" aria-label="Help articles">${navigationMarkup(page.navigation)}</nav></aside><div class="help-article-wrapper"><form class="help-search-bar" role="search"><a class="help-mobile-home btn-secondary" href="/help">Overview</a><input type="search" name="q" aria-label="Search help" placeholder="Search help…"><button type="submit">Search</button></form><article class="help-article"><div class="help-content"><h1>${escapeHtml(page.article.title)}</h1><div class="help-body">${page.article.html}</div></div></article></div></div>`;
    root.querySelector('form').onsubmit = async event => {
     event.preventDefault(); searchController?.abort(); searchController = new AbortController(); const searchToken = ++searchEpoch;
     const article = root.querySelector('article'); article.innerHTML = '<p role="status">Searching…</p>';
     try {
      const result = await requestJson('/api/help/search?' + new URLSearchParams({ q: new FormData(event.target).get('q') }), { signal: searchController.signal });
      if (closed || token !== epoch || searchToken !== searchEpoch) return;
      const list = document.createElement('ul');
      for (const item of result.results) { const li = document.createElement('li'), link = document.createElement('a'); link.href = '/help/' + item.slug; link.textContent = item.title; li.append(link); list.append(li); }
      article.replaceChildren(list); if (!result.results.length) article.textContent = 'No matching articles.';
     } catch (error) { if (!closed && token === epoch && searchToken === searchEpoch && error.name !== 'AbortError') article.textContent = error.message || 'Unable to search help.'; }
    };
   } catch (error) { if (!closed && token === epoch && error.name !== 'AbortError') root.querySelector('[role="status"]').textContent = error.message; }
  }
  root.addEventListener('click', event => { const link = event.target.closest('a[href]'); if (link && link.origin === location.origin && !event.defaultPrevented && !link.target && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { event.preventDefault(); actions.navigate(link.pathname + link.search + link.hash); } });
  void load(url);
  return { update({ url }) { void load(url); }, destroy() { closed = true; ++epoch; controller?.abort(); searchController?.abort(); root.remove(); } };
 },
});
