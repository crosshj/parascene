import { requestJson } from '../../core/request.js';
import { createConnectCommentRowElement } from '../../shared/connectCommentCard.js';
import { hydrateRichUserTextEmbeds } from '../../shared/userText.js';
import '../../components/Comments/Comments.css';
import './CommentsView.css';
import { renderChatThreadSkeleton } from '../../shared/skeleton.js';
import '../../components/Messages/Messages.css';

export const CommentsView = Object.freeze({
 mount({ outlet, services, actions, setHeaderMenu }) {
  const root = document.createElement('section'); root.className = 'comments-view';

  root.innerHTML = '<div class="comments-view__status" role="status" hidden></div><div class="connect-comment-list" aria-label="Recent comments"></div><button class="comments-view__more" type="button" hidden>Load more</button>';
  outlet.replaceChildren(root); services.providers.document.setTitle('Comments · Parascene beta');
  const status = root.querySelector('[role="status"]'), list = root.querySelector('.connect-comment-list'), more = root.querySelector('button');
  let cursor = null, hasMore = false, busy = false, destroyed = false, epoch = 0, request;
  const seen = new Set(); const scroll = root.closest('.beta-outlet__scroll');
  async function load(reset = false) {
   if (destroyed || (busy && !reset)) return;
   request?.abort(); request = new AbortController(); const token = ++epoch; busy = true; more.disabled = true;
   status.hidden = true; status.classList.remove('is-error');
   root.setAttribute('aria-busy', 'true');
   if (reset) list.innerHTML = renderChatThreadSkeleton(); else list.insertAdjacentHTML('beforeend', renderChatThreadSkeleton(3));
   if (reset) { cursor = null; seen.clear(); }
   try {
    const qs = new URLSearchParams({ limit: '50', ...(cursor || {}) });
    const page = await requestJson(`/api/comments/latest?${qs}`, { signal: request.signal });
    if (destroyed || token !== epoch) return;
    if (reset) list.replaceChildren();
    for (const comment of page.comments || []) {
     if (seen.has(String(comment.id))) continue; seen.add(String(comment.id));
     const row = createConnectCommentRowElement(comment, { extraRootClass: 'comments-channel-plain-msg', navigate: actions.navigate });
     row.dataset.commentId = comment.id; list.append(row);
    }
    hydrateRichUserTextEmbeds(list);
    hasMore = page.has_more === true; cursor = page.next_cursor;
    more.hidden = !hasMore; status.textContent = seen.size ? '' : 'No comments yet.'; status.hidden = seen.size > 0;
    if (reset) scroll?.scrollTo?.({ top: 0 });
   } catch (error) {
    if (destroyed || token !== epoch || error.name === 'AbortError') return;
    if (error.status === 401) return services.session.redirectToLogin();
    status.hidden = false; status.classList.add('is-error'); status.textContent = error.message || 'Unable to load comments.';
    more.hidden = false; more.textContent = 'Retry';
   } finally { if (token === epoch && !destroyed) { busy = false; more.disabled = false; root.removeAttribute('aria-busy'); list.querySelectorAll('.skeleton-chat-thread').forEach(skeleton => skeleton.remove()); } }
  }
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
   if (entries.some(entry => entry.isIntersecting) && hasMore && !busy && !status.classList.contains('is-error')) void load();
  }, { root: scroll, rootMargin: '0px 0px 1400px 0px' }) : null;
  observer?.observe(more);
  root.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(!link||event.defaultPrevented||link.target||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const target=new URL(link.href,location.origin);if(target.origin===location.origin){event.preventDefault();actions.navigate(target.pathname+target.search+target.hash)}});
  more.addEventListener('click', () => { more.textContent = 'Load more'; void load(!cursor); });
  setHeaderMenu?.({ label: 'Comments', items: [{ label: 'Refresh', action: 'refresh' }], onSelect: () => void load(true) });
  const onPreference=()=>void load(true);document.addEventListener('nsfw-preference-changed',onPreference);
  void load(true);
  return { destroy() { destroyed = true;document.removeEventListener('nsfw-preference-changed',onPreference); ++epoch; request?.abort(); observer?.disconnect(); root.querySelectorAll('video,audio').forEach(media => { media.pause(); media.removeAttribute('src'); media.load(); }); root.remove(); } };
 },
});
