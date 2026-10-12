import template from './LibraryView.html';
import './LibraryView.css';
import './AudioClipModals.css';
import '../../components/CreationGrid/CreationGrid.css';
import { mountTemplate } from '../../utils/dom.js';
import { requestJson } from '../../core/request.js';
import { getAvatarColor } from '../../shared/avatar.js';
import { getStyleThumbUrl } from '../../shared/createStyles.js';
import { gridSkeletonMarkup } from '../../components/CreationGrid/skeleton.js';
import { createAudioClipIngestModal } from './audioClipIngestModal.js';
import { createStyleModal } from './styleModal.js';
import { createAudioClipModal } from './audioClipModal.js';
import { createAudioClipEditModal } from './audioClipEditModal.js';

function metadata(raw) { try { return typeof raw === 'string' ? JSON.parse(raw) || {} : raw || {}; } catch { return {}; } }
const PAGE_SIZE = 24;
export const LibraryView = Object.freeze({
 mount({ outlet, actions, services, hash = '', url = '/library', setHeaderMenu, setHeaderAccessories }) {
  const root = mountTemplate(outlet, template), tabs = root.querySelector('app-tabs'), more = root.querySelector('.library-view__more');
  const lifetime = new AbortController(), ingest = createAudioClipIngestModal(), edit = createAudioClipEditModal();
  const states = Object.fromEntries(['personas', 'styles', 'audio-clips'].map(id => [id, { rows: [], shown: PAGE_SIZE, ready: false, busy: false, hasMore: false, error: '', epoch: 0, request: null }]));
  let active = 'personas', destroyed = false, canAdd = false, catalogPromise = null, currentHash = hash;
  services.providers.document.setTitle('Library · Parascene beta');
  const directStyle = /^\/styles\/([^/]+)$/.exec(new URL(url, location.origin).pathname);
  const directAddStyle = directStyle?.[1] === 'new';
  const directAudioClip = /^\/audio-clips\/(\d+)$/.exec(new URL(url, location.origin).pathname);
  const audioModal = createAudioClipModal({ services, actions, onDismiss: () => { if (directAudioClip && !destroyed) void actions.navigate('/library#audio-clips', { replace: true }); }, onEdit: row => edit.openAudioClipEditModal({ clipId: Number(row.id), title: row.title, description: row.description, thumbUrl: row.thumb_url, thumbCreationId: row.thumb_creation_id, hasCustomThumb: row.has_custom_thumb, onSaved: () => { if (!destroyed) void load('audio-clips', true); } }) });
  const styleModal = createStyleModal({ services, actions, onDismiss: () => { if (directStyle && !destroyed) void actions.navigate('/library#styles', { replace: true }); }, onSaved: () => { if (!destroyed) { catalogPromise = null; states.styles.ready = false; states.personas.ready = false; void load('styles', true); } } });
  function grid(id) { return root.querySelector(`[data-grid="${id}"]`); }
  function syncHeader() {
   const buttons = [];
   if (active === 'styles' && canAdd) buttons.push({ label: 'Add style', onClick: () => styleModal.open() });
   if (active === 'audio-clips') buttons.push({ label: 'Record clip', onClick: () => ingest.openAudioClipIngestModal({ mode: 'record', onSaved: () => { if (!destroyed) void load('audio-clips', true); } }) });
   setHeaderAccessories?.(buttons);
   setHeaderMenu?.({ label: 'Library', items: [{ label: 'Refresh', action: 'refresh' }], onSelect() {
    if (active !== 'audio-clips') { catalogPromise = null; states.styles.ready = false; states.personas.ready = false; }
    void load(active, true);
   } });
  }
  function updateMore() { const state = states[active]; more.hidden = !state.hasMore && !state.error; more.disabled = state.busy; more.textContent = state.error ? 'Retry' : 'Load more'; }
  function itemInfo(row, id) {
   const meta = metadata(row.meta), audio = id === 'audio-clips', tag = String(row.tag || '').toLowerCase();
   return { title: row.title || (audio ? `Clip #${row.id}` : tag), key: id === 'personas' ? `@${tag}` : tag,
    artwork: audio ? row.thumb_url : id === 'personas' ? meta.persona_avatar_url : meta.style_thumb_url || getStyleThumbUrl(tag),
    href: audio ? `/audio-clips/${encodeURIComponent(row.id)}` : id === 'personas' ? `/p/${encodeURIComponent(tag)}` : `/styles/${encodeURIComponent(tag)}`,
   };
  }
  function openItem(row, id) {
   if (id === 'styles') { styleModal.open(row); return; }
   if (id === 'audio-clips') { audioModal.open(row); return; }
   const info = itemInfo(row, id);
   void actions.navigate(info.href);
  }
  function paint(id) {
   const state = states[id], list = grid(id), status = root.querySelector(`[data-status="${id}"]`);
   list.removeAttribute('aria-busy'); list.replaceChildren();
   status.hidden = !state.error && state.rows.length > 0; status.textContent = state.error || (id === 'audio-clips' ? 'No audio clips yet. Record a clip to get started.' : 'No items yet.'); status.classList.toggle('is-error', !!state.error);
   for (const row of state.rows.slice(0, state.shown)) {
    const info = itemInfo(row, id), card = document.createElement('button'); card.type = 'button'; card.className = 'creation-grid__card library-view__card'; card.dataset.libraryId = row.id ?? row.tag; card.setAttribute('aria-label', `View ${info.title}`); card.title = info.title;
    const preview = document.createElement('div'); preview.className = 'library-view__preview'; preview.style.setProperty('--library-fallback', getAvatarColor(info.key || String(row.id)));
    const fallback = document.createElement('span'); fallback.className = 'library-view__fallback'; fallback.textContent = id === 'audio-clips' ? '♫' : String(info.title).slice(0, 1).toUpperCase(); preview.append(fallback);
    if (info.artwork) { const img = document.createElement('img'); img.src = info.artwork; img.alt = ''; img.loading = 'lazy'; img.addEventListener('error', () => img.remove(), { once: true }); preview.append(img); }
    const label = document.createElement('span'); label.className = 'library-view__label'; label.textContent = info.title; preview.append(label); card.append(preview); card.addEventListener('click', () => openItem(row, id)); list.append(card);
   }
   if (id !== 'audio-clips') state.hasMore = state.shown < state.rows.length;
   if (active === id) updateMore();
  }
  async function catalog() {
   if (!catalogPromise) catalogPromise = requestJson('/api/prompt-injections', { signal: lifetime.signal }).then(data => { if (!destroyed) { canAdd = !!data.canAddStyle; syncHeader(); } return data.items || []; }).catch(error => { catalogPromise = null; throw error; });
   return catalogPromise;
  }
  async function load(id, reset = false) {
   const state = states[id]; if (destroyed || state.busy && !reset) return;
   if (!reset && state.ready && id !== 'audio-clips') { state.shown += PAGE_SIZE; paint(id); return; }
   state.request?.abort(); state.request = new AbortController(); const token = ++state.epoch; state.busy = true; state.error = '';
   if (reset || !state.ready) { state.shown = PAGE_SIZE; grid(id).innerHTML = gridSkeletonMarkup(); grid(id).setAttribute('aria-busy', 'true'); root.querySelector(`[data-status="${id}"]`).hidden = true; }
   updateMore();
   try {
    if (id === 'audio-clips') {
     const offset = reset ? 0 : state.rows.length;
     const data = await requestJson('/api/audio-clips?' + new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), sort: 'created_at_asc' }), { signal: state.request.signal });
     if (destroyed || token !== state.epoch) return;
     const rows = data.items || []; state.rows = reset ? rows : [...new Map([...state.rows, ...rows].map(row => [row.id, row])).values()]; state.shown = state.rows.length; state.hasMore = rows.length > 0 && offset + rows.length < (Number(data.total) || offset + rows.length);
    } else {
     const rows = await catalog(); if (destroyed || token !== state.epoch) return;
     state.rows = rows.filter(row => row.tag_type === (id === 'styles' ? 'style' : 'persona'));
    }
    state.ready = true; paint(id);
   } catch (error) { if (destroyed || token !== state.epoch || error.name === 'AbortError') return; if (error.status === 401) return services.session.redirectToLogin(); state.error = error.message || 'Unable to load Library.'; paint(id); }
   finally { if (!destroyed && token === state.epoch) { state.busy = false; updateMore(); } }
  }
  function applyTab(hash) { const id = hash.replace(/^#/, '').toLowerCase(); active = Object.hasOwn(states, id) ? id : 'personas'; if (tabs.getAttribute('active') !== active) tabs.setActiveTab(active, { focus: false }); syncHeader(); updateMore(); if (!states[active].ready && !states[active].busy) void load(active); }
  tabs.addEventListener('tab-change', event => { const id = event.detail?.id; if (!Object.hasOwn(states, id)) return; active = id; syncHeader(); updateMore(); if (!states[id].ready && !states[id].busy) void load(id); if (currentHash !== `#${id}`) void actions.navigate(`/library#${id}`); });
  more.addEventListener('click', () => { const state = states[active]; void load(active, !!state.error); });
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting) && states[active].hasMore && !states[active].busy && !states[active].error) void load(active); }, { root: root.closest('.beta-outlet__scroll'), rootMargin: '1000px' }) : null;
  observer?.observe(more); applyTab(directStyle ? '#styles' : directAudioClip ? '#audio-clips' : hash); if (directStyle) styleModal.open(directAddStyle ? null : decodeURIComponent(directStyle[1])); if (directAudioClip) audioModal.open({ id: Number(directAudioClip[1]) });
  return { update({ hash = '' }) { if (hash !== currentHash) { currentHash = hash; applyTab(hash); } }, destroy() { destroyed = true; setHeaderAccessories?.(); lifetime.abort(); Object.values(states).forEach(state => state.request?.abort()); observer?.disconnect(); styleModal.destroy(); audioModal.destroy(); ingest.destroy(); edit.destroy(); root.remove(); } };
 },
});
