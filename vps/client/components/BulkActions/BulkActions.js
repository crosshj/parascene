import template from './BulkActions.html';
import './BulkActions.css';
import { bindMobileCreationsBulkLongPress } from '../../shared/creationsBulkLongPress.js';

// WWW's creations bulk interaction, shared by creations and personal files.
// The view owns rows; adapters own eligibility and API mutations.
export function createBulkActions({ root, grid, cardSelector, getItem, actions = [], remove, onRemoved, onComplete, onUnauthorized, noun = 'creations', permanent = false }) {
 const lifetime = new AbortController();
 const { signal } = lifetime;
 const shell = document.createElement('div');
 shell.innerHTML = template;
 const bar = shell.querySelector('[data-creations-bulk-bar]');
 const modal = shell.querySelector('dialog');
 grid.before(bar);
 root.append(modal);
 root.classList.add('bulk-actions-host');
 const actionHost = bar.querySelector('[data-bulk-actions]');
 const error = bar.querySelector('[data-bulk-error]');
 const message = modal.querySelector('[data-creations-bulk-delete-message]');
 const modalError = modal.querySelector('[data-creations-bulk-delete-error]');
 const confirm = modal.querySelector('[data-creations-bulk-delete-confirm]');
 const cancel = modal.querySelector('[data-creations-bulk-delete-cancel]');
 modal.querySelector('h3').textContent = `Delete selected ${noun}?`;
 let active = false, busy = false, destroyed = false, suppressUntil = 0;
 const selected = new Set();
 let deleteItems = [];
 const cards = () => [...grid.querySelectorAll(cardSelector)];
 const selectedItems = () => cards().map(getItem).filter(item => item && selected.has(String(item.id)));
 const buttons = new Map();
 const descriptors = [...actions, { id: 'delete', label: 'Delete', run: openDelete }];
 for (const action of descriptors) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = `btn-secondary creations-bulk-${action.id}-btn`;
  button.setAttribute(`data-creations-bulk-${action.id}`, '');
  button.textContent = action.label; button.disabled = true;
  button.addEventListener('click', async () => {
   if (busy || destroyed) return;
   const items = selectedItems();
   error.hidden = true;
   try {
    busy = true; update();
    const result = await action.run(items, { signal });
    if (destroyed) return;
    if (result?.exit) exit();
   } catch (err) {
    if (destroyed || err?.name === 'AbortError') return;
    if (err?.status === 401) onUnauthorized?.();
    error.textContent = err?.message || 'Action failed. Please try again.'; error.hidden = false;
   } finally { busy = false; if (!destroyed) update(); }
  }, { signal });
  actionHost.append(button); buttons.set(action.id, button);
 }
 function update() {
  const items = selectedItems();
  bar.classList.toggle('has-selection', items.length > 0);
  for (const action of descriptors) buttons.get(action.id).disabled = busy || !items.length || (action.enabled ? !action.enabled(items) : false);
 }
 function sync() {
  if (destroyed) return;
  const visible = new Set();
  for (const card of cards()) {
   const item = getItem(card);
   if (!item) continue;
   const id = String(item.id); visible.add(id);
   let overlay = card.querySelector('[data-creations-bulk-overlay]');
   if (!overlay) {
    overlay = document.createElement('div'); overlay.className = 'creations-card-bulk-overlay';
    overlay.setAttribute('data-creations-bulk-overlay', '');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'creations-card-bulk-checkbox';
    checkbox.setAttribute('data-creations-bulk-checkbox', ''); checkbox.setAttribute('aria-label', `Select ${item.label || noun.replace(/s$/, '')}`);
    overlay.append(checkbox); card.append(overlay);
   }
   overlay.hidden = !active;
   overlay.querySelector('input').checked = selected.has(id);
  }
  for (const id of selected) if (!visible.has(id)) selected.delete(id);
  update();
 }
 function enter() {
  if (destroyed || busy) return;
  modal.close(); selected.clear(); active = true;
  root.classList.add('is-bulk-mode'); bar.removeAttribute('aria-hidden');
  error.hidden = true; sync();
 }
 function exit() {
  modal.close(); selected.clear(); active = false;
  root.classList.remove('is-bulk-mode'); bar.setAttribute('aria-hidden', 'true'); sync();
 }
 function toggle(card) {
  if (busy) return;
  const item = getItem(card); if (!item) return;
  const id = String(item.id);
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  sync();
 }
 grid.addEventListener('click', event => {
  const card = event.target.closest?.(cardSelector);
  if (!card) return;
  if (Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  if (!active && event.shiftKey) {
   event.preventDefault(); event.stopImmediatePropagation(); enter();
   const item = getItem(card); if (item) selected.add(String(item.id));
   sync(); return;
  }
  if (!active) return;
  event.stopImmediatePropagation();
  if (event.target.matches('[data-creations-bulk-checkbox]')) {
   const item = getItem(card);
   if (busy || !item) { event.preventDefault(); return; }
   if (event.target.checked) selected.add(String(item.id)); else selected.delete(String(item.id));
   update();
  } else { event.preventDefault(); toggle(card); }
 }, { capture: true, signal });
 grid.addEventListener('keydown', event => {
  if (!active || !['Enter', ' '].includes(event.key)) return;
  const card = event.target.closest?.(cardSelector); if (!card) return;
  event.preventDefault(); event.stopImmediatePropagation(); toggle(card);
 }, { capture: true, signal });
 bindMobileCreationsBulkLongPress({
  container: grid, cardSelector,
  isEnabled: () => window.matchMedia('(max-width: 768px)').matches,
  isBulkActive: () => active,
  shouldIgnoreTarget: target => {
   const interactive = target?.closest?.('a,button,input,textarea,select,label,video,.feed-card-group-nav');
   return Boolean(interactive && !interactive.matches(cardSelector));
  },
  onLongPress(card) { enter(); const item = getItem(card); if (item) selected.add(String(item.id)); sync(); suppressUntil = Date.now() + 900; },
  signal,
 });
 bar.querySelector('[data-creations-bulk-close]').addEventListener('click', () => { if (!busy) exit(); }, { signal });
 document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !active || !root.isConnected || busy) return;
  // A route overlay or another native modal owns Escape while it covers this view.
  if (root.closest('[inert]') || (document.querySelector('dialog[open]') && !modal.open)) return;
  event.preventDefault(); exit();
 }, { signal });
 function openDelete(items) {
  deleteItems = items.filter(item => !item.deleteBlock);
  const published = items.filter(item => item.deleteBlock === 'published').length;
  const locked = items.filter(item => item.deleteBlock === 'challenge').length;
  const n = deleteItems.length;
  const parts = [n ? `${n} item${n === 1 ? '' : 's'} will be ${permanent ? 'permanently ' : ''}deleted.` : 'No items will be deleted.'];
  if (published) parts.push(`${published} published item${published === 1 ? '' : 's'} selected will not be deleted.`);
  if (locked) parts.push(`${locked} challenge ${locked === 1 ? 'entry' : 'entries'} selected will not be deleted. Remove ${locked === 1 ? 'it' : 'them'} from the challenge first.`);
  message.textContent = parts.join(' '); modalError.textContent = ''; modalError.classList.remove('visible');
  confirm.disabled = !n; modal.showModal();
 }
 cancel.addEventListener('click', () => { if (!busy) modal.close(); }, { signal });
 modal.addEventListener('cancel', event => { if (busy) event.preventDefault(); }, { signal });
 modal.addEventListener('click', event => { if (event.target === modal && !busy) { const r = modal.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) modal.close(); } }, { signal });
 confirm.addEventListener('click', async () => {
  if (busy || !deleteItems.length) return;
  busy = true; confirm.disabled = true; cancel.disabled = true; confirm.classList.add('is-loading'); update();
  modalError.classList.remove('visible');
  try {
   // WWW stops on the first failure. Retire each successful row immediately so retry cannot delete it twice.
   while (deleteItems.length && !destroyed) {
    const item = deleteItems[0];
    await remove(item, { signal });
    if (destroyed) return;
    deleteItems.shift(); selected.delete(String(item.id)); onRemoved?.(item); sync();
   }
   await onComplete?.();
   if (!destroyed) exit();
  } catch (err) {
   if (destroyed || err?.name === 'AbortError') return;
   if (err?.status === 401) onUnauthorized?.();
   modalError.textContent = err?.message || 'Delete failed'; modalError.classList.add('visible');
  } finally {
   busy = false;
   if (!destroyed) { confirm.disabled = !deleteItems.length; cancel.disabled = false; confirm.classList.remove('is-loading'); update(); }
  }
 }, { signal });
 return { enter, sync, get active() { return active; }, destroy() { destroyed = true; lifetime.abort(); modal.close(); modal.remove(); bar.remove(); root.classList.remove('is-bulk-mode', 'bulk-actions-host'); } };
}
