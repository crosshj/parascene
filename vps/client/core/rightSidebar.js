import markup from './rightSidebar.html';
import { createTemplateFactory } from '../utils/dom.js';
import { CHAT_PAGE_BACK_ICON_HTML } from '../shared/chatPageHeader.js';
const clone = createTemplateFactory(markup);

// Layout owns the rail. Features supply a mount function and release their lease
// at teardown; a stale lease can never close another feature's content.
export function createRightSidebar({ root }) {
 const host = clone('right-sidebar');
 host.querySelector('.beta-right-sidebar__back').innerHTML = CHAT_PAGE_BACK_ICON_HTML;
 root.append(host);
 const content = host.querySelector('.beta-right-sidebar__content');
 const title = host.querySelector('h2');
 const handle = host.querySelector('[role=separator]');
 const closeButton = host.querySelector('.beta-right-sidebar__close');
 const backButton = host.querySelector('.beta-right-sidebar__back');
 const listeners = new AbortController();
 let active = null, dragging = false, origin = 0, startWidth = 0, frame = 0, pending = 360;
 const maximum = () => Math.max(220, innerWidth - (matchMedia('(min-width: 1024px)').matches ? Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--beta-sidebar-width')) || 272 : 0) - 180);
 const clamp = value => Math.min(maximum(), Math.max(220, Number(value) || 360));
 const routeStorage = 'prsn-right-sidebar-open-by-route-v1';
 let restoration = null, restoreDismissed = false, routePath = location.pathname;
 try { restoration = JSON.parse(localStorage.getItem(routeStorage) || '{}')[location.pathname] || null; } catch {}
 function saveRoute(path, value) {
  try { const map = JSON.parse(localStorage.getItem(routeStorage) || '{}'); if (value) map[path] = value; else delete map[path]; localStorage.setItem(routeStorage, JSON.stringify(map)); } catch {}
 }
 let width = 360;
 try { width = clamp(localStorage.getItem('prsn-right-sidebar-width-px')); } catch {}
 function setWidth(value, persist = false) {
  width = clamp(value); document.body.style.setProperty('--beta-right-sidebar-width', `${width}px`);
  handle.setAttribute('aria-valuemax', String(Math.round(maximum())));
  handle.setAttribute('aria-valuenow', String(Math.round(width)));
  if (persist) try { localStorage.setItem('prsn-right-sidebar-width-px', String(width)); } catch {}
 }
 function stop() {
  if (!dragging) return;
  cancelAnimationFrame(frame); frame = 0; setWidth(pending, true); dragging = false;
  handle.classList.remove('is-resizing'); document.body.classList.remove('is-resizing-sidebar');
 }
 // Dispose only feature content. Visibility and width belong to the rail.
 function retire({ forget = false } = {}) {
  const prior = active; active = null;
  if (forget) saveRoute(prior?.path || routePath, null);
  prior?.handle?.destroy?.(); content.replaceChildren();
  prior?.onClose?.({ forget });
 }
 function close({ forget = true } = {}) {
  stop();
  if (forget && !active && restoration) restoreDismissed = true;
  retire({ forget }); restoration = null;
  document.documentElement.classList.remove('beta-right-sidebar-restoring');
  host.hidden = true; document.body.classList.remove('beta-right-sidebar-open');
 }
 function open({ key, title: label = '', mount, onClose } = {}) {
  retire(); restoration = null;
  document.documentElement.classList.remove('beta-right-sidebar-restoring');
  const record = { key, onClose, handle: null, path: routePath }; active = record;
  saveRoute(record.path, { key, title: label });
  title.textContent = label; closeButton.hidden = false; host.setAttribute('aria-label', label || 'Sidebar');
  host.hidden = false; document.body.classList.add('beta-right-sidebar-open');
  try { record.handle = mount?.({ outlet: content, close: () => { if (active === record) close(); } }); }
  catch (error) { close(); throw error; }
  return { close(options) { if (active === record) close(options); }, get isOpen() { return active === record; } };
 }
 handle.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  dragging = true; origin = event.clientX; startWidth = width; pending = width;
  handle.setPointerCapture(event.pointerId); handle.classList.add('is-resizing');
  document.body.classList.add('is-resizing-sidebar'); event.preventDefault();
 }, { signal: listeners.signal });
 handle.addEventListener('pointermove', event => {
  if (!dragging) return; pending = startWidth + origin - event.clientX;
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; setWidth(pending); });
 }, { signal: listeners.signal });
 for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(event, stop, { signal: listeners.signal });
 handle.addEventListener('keydown', event => {
  const next = { ArrowLeft: width + 8, ArrowRight: width - 8, Home: 220, End: maximum() }[event.key];
  if (next !== undefined) { event.preventDefault(); setWidth(next, true); }
 }, { signal: listeners.signal });
 closeButton.addEventListener('click', () => close(), { signal: listeners.signal });
 backButton.addEventListener('click', () => close(), { signal: listeners.signal });
 document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented || host.hidden || document.querySelector('dialog[open]')) return;
  // Menus and dialogs receive Escape first.
  queueMicrotask(() => { if (!event.defaultPrevented && !host.hidden) { event.preventDefault(); close(); } });
 }, { signal: listeners.signal });
 setWidth(width);
 function fillSkeleton() {
  const loading = content.querySelector('.beta-right-sidebar__loading');
  if (!loading || host.hidden || !content.clientHeight) return;
  const paragraph = loading.firstElementChild;
  const step = paragraph.getBoundingClientRect().height + 24;
  if (!step) return;
  const count = Math.max(1, Math.ceil(content.clientHeight / step) + 1);
  while (loading.children.length < count) loading.append(clone('right-sidebar-loading-paragraph'));
  while (loading.children.length > count) loading.lastElementChild.remove();
 }
 const loadingResize = new ResizeObserver(fillSkeleton);
 loadingResize.observe(content);
 function prepare(path = routePath) {
  stop();
  const nextPath = new URL(path, location.origin).pathname;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(routeStorage) || '{}')[nextPath] || null; } catch {}
  // WWW enters mobile channels on the message view; a remembered canvas is
  // available from the title switcher but never replaces the conversation.
  if (matchMedia('(max-width: 768px)').matches && root.dataset.mobileMode === 'conversation') saved = null;
  // Invalidate the old feature lease before its view tears down. When the
  // destination has a sidebar, its loading content replaces the old content
  // without hiding the rail or changing the outlet's reserved space.
  if (saved) retire(); else close({ forget: false });
  restoreDismissed = false; routePath = nextPath; restoration = saved;
  if (restoration) {
   host.hidden = false; closeButton.hidden = true; title.replaceChildren();
   const titleSkeleton = document.createElement('span');
   titleSkeleton.className = 'skeleton skeleton-line beta-right-sidebar__skeleton-title';
   title.append(titleSkeleton); content.replaceChildren(clone('right-sidebar-loading'));
   document.body.classList.add('beta-right-sidebar-open');
   fillSkeleton();
  }
 }
 prepare(routePath);
 window.addEventListener('resize', () => setWidth(width), { signal: listeners.signal });
 return { open, close, prepare, header: host.querySelector('.beta-right-sidebar__header'), get restoreDismissed() { return restoreDismissed; }, get restoration() { return restoration; }, get key() { return active?.key; }, destroy() { close({ forget: false }); loadingResize.disconnect(); listeners.abort(); host.remove(); document.body.style.removeProperty('--beta-right-sidebar-width'); } };
}
