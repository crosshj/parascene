import { buildProfilePath } from '../../shared/profileLinks.js';
import markup from './ConversationChrome.html';
import './ConversationChrome.css';
import { createTemplateFactory, escapeHtml } from '../../utils/dom.js';
import { createPopupMenu } from '../PopupMenu/PopupMenu.js';
import { processUserText, hydrateRichUserTextEmbeds } from '../../shared/userText.js';
import { bindChatInlineImageLightboxClickDelegation } from '../../shared/chatInlineImageLightbox.js';
import { createChatHistoryCopyModal } from '../../shared/chatHistoryCopyModal.js';
import { formatDateTime } from '../../shared/datetime.js';
import { renderCommentAvatarHtml } from '../../shared/commentItem.js';
import { getAvatarColor } from '../../shared/avatar.js';
import { isSelfDmThread } from '../../shared/chatSidebarRoster.js';
const clone = createTemplateFactory(markup);
const storageKey = 'prsn-chat-open-canvas-by-thread-v1';
const blocked = new Set(['comments', 'feed', 'explore', 'creations', 'challenges']);

export function createConversationChrome({ services, setHeaderMenu, setHeaderAccessories, setHeaderSwitcher, rightSidebar, actions }) {
 const provider = services.providers.threads;
 const abort = new AbortController();
 let destroyed = false, thread = null, inbox = null, controller = null, canvases = [], pinned = null, rail = null, activeId = null;
 let revision = 0, restored = false, editing = false, history = null;
 const dialogs = new Set();
 const eligible = () => thread?.type === 'channel' && thread.channel_slug && !blocked.has(thread.channel_slug);
 function preference(value) {
  try { const map = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (value == null) delete map[String(thread.id)]; else map[String(thread.id)] = value; localStorage.setItem(storageKey, JSON.stringify(map)); } catch {}
 }
 function showDialog(id) {
  const dialog = clone(id); document.body.append(dialog); dialogs.add(dialog);
  const dispose = () => { dialog.close(); dialog.remove(); dialogs.delete(dialog); };
  dialog.addEventListener('cancel', event => { event.preventDefault(); dispose(); });
  dialog.querySelector('[data-cancel]')?.addEventListener('click', dispose);
  dialog.addEventListener('click', event => { if (event.target === dialog) dispose(); });
  dialog.showModal(); return { dialog, dispose };
 }
 function failure(error) { if (!destroyed && error?.name !== 'AbortError') { if (error.status === 401) services.session.redirectToLogin(); else controller?.showError?.(error); } }
 function updateHeader() {
  if (destroyed || !thread) return;
  const items = [];
  const profileHref = thread.type === 'dm' && Number(thread.other_user_id) !== Number(services.providers.viewerId) ? buildProfilePath({ userName: thread.other_user?.user_name, userId: thread.other_user_id }) : null;
  if (profileHref) items.push({ label: 'View Profile', href: profileHref });
  if (thread.visibility === 'private') items.push({ id: 'members', label: 'Members' });
  if (eligible()) {
   if (canvases.length || inbox?.viewerIsFounder) items.push({ section: 'Canvases' });
   for (const row of canvases) items.push({ id: `canvas-${row.id}`, label: row.title, canvasId: row.id });
   if (inbox?.viewerIsFounder) items.push({ id: 'create', label: 'Create canvas…' });
   if (canvases.length || inbox?.viewerIsFounder) items.push({ separator: true });
  }
  items.push({ id: 'history', label: 'Copy chat history' }, { id: 'refresh', label: 'Refresh' });
  setHeaderMenu?.({ items, onSelect(item) {
   if (item.canvasId) openCanvas(item.canvasId);
   else if (item.id === 'create') createCanvas();
   else if (item.id === 'members') void showMembers();
   else if (item.id === 'history') copyHistory();
   else if (item.id === 'refresh') { void controller?.refresh(); void refresh(); }
  } });
  const row = canvases.find(row => Number(row.id) === Number(pinned));
  const viewing = rail?.isOpen && Number(activeId) === Number(pinned);
  const mobile = matchMedia('(max-width: 1023px)').matches;
  setHeaderAccessories?.(row && (!viewing || mobile) ? [{ label: row.title, ariaLabel: `${viewing ? 'Close' : 'Open'} ${row.title}`, onClick: () => viewing ? rail.close() : openCanvas(row.id) }] : []);
  const switchItems = [{ id: null, label: isSelfDmThread(thread, services.providers.viewerId) ? 'My Notes' : thread.title || (thread.type === 'dm' ? 'Direct message' : 'Channel'), current: !rail?.isOpen }];
  if (eligible()) {
   for (const canvas of canvases) switchItems.push({ id: Number(canvas.id), label: canvas.title || 'Canvas', current: rail?.isOpen && Number(activeId) === Number(canvas.id) });
  }
  setHeaderSwitcher?.({ channel: switchItems[0].label, items: switchItems, onSelect(id) { if (id == null) rail?.close(); else openCanvas(id); } });
 }
 async function refresh() {
  if (!eligible() || destroyed) { updateHeader(); return; }
  const version = ++revision;
  const apply = data => {
   if (destroyed || version !== revision) return;
   canvases = data.canvases || []; pinned = data.pinned_message_id;
   if (activeId && !canvases.some(row => Number(row.id) === Number(activeId))) rail?.close();
   else if (activeId && !editing) openCanvas(activeId, { remember: false });
   if (!restored) {
    restored = true;
    if (matchMedia('(max-width: 768px)').matches) {
     // Mobile always opens the conversation first; users can choose a canvas
     // from the channel switcher or the pinned-canvas shortcut.
     if (rightSidebar.restoration) rightSidebar.close({ forget: false });
    }
    else if (rightSidebar.restoreDismissed) preference(null);
    else {
     const savedKey = rightSidebar.restoration?.key;
     let id = savedKey?.startsWith(`canvas:${thread.id}:`) ? Number(savedKey.split(':').at(-1)) : null; try { id ||= JSON.parse(localStorage.getItem(storageKey) || '{}')[String(thread.id)]; } catch {}
     if (canvases.some(row => Number(row.id) === Number(id))) openCanvas(id);
     else { if (id) preference(null); if (rightSidebar.restoration) rightSidebar.close(); }
    }
   }
   updateHeader();
  };
  const cached = provider.getCanvases(thread.id);
  if (cached) apply(cached);
  try {
   const data = await provider.refreshCanvases(thread.id, { signal: abort.signal });
   if (destroyed || version !== revision) return;
   apply(data);
  } catch (error) { if (rightSidebar.restoration) rightSidebar.close({ forget: false }); failure(error); }
 }
 function openCanvas(id, { remember = true } = {}) {
  const row = canvases.find(row => Number(row.id) === Number(id)); if (!row || destroyed) return;
  // Refreshing a read view replaces only rail content, never the conversation.
  activeId = row.id; editing = false;
  rail = rightSidebar.open({ key: `canvas:${thread.id}:${row.id}`, title: matchMedia('(max-width: 768px)').matches ? (thread.title || 'Conversation') : 'Canvas', onClose({ forget = true } = {}) { activeId = null; editing = false; if (forget && !destroyed) preference(null); updateHeader(); }, mount({ outlet, close }) {
   const root = clone('canvas'); outlet.append(root);
   const title = root.querySelector('[data-chat-canvas-title-view]');
   const titleInput = root.querySelector('[data-chat-canvas-title-input]');
   const body = root.querySelector('[data-chat-canvas-body-view]');
   const bodyInput = root.querySelector('[data-chat-canvas-body-input]');
   const footer = root.querySelector('[data-chat-canvas-edit-footer]');
   const hint = root.querySelector('[data-chat-canvas-limit-hint]');
   const more = root.querySelector('[data-chat-canvas-more]');
   const ownerWrap = root.querySelector('[data-chat-canvas-more-wrap]');
   const errorLine = document.createElement('p'); errorLine.setAttribute('role', 'alert'); errorLine.hidden = true; root.append(errorLine);
   title.innerHTML = `<span class="chat-page-canvas-title-main">${escapeHtml(row.title || 'Canvas')}</span>${row.sender_user_name ? `<span class="chat-page-canvas-title-owner-sep" aria-hidden="true">•</span><span class="chat-page-canvas-title-owner-muted">@${escapeHtml(row.sender_user_name.replace(/^@+/, ''))}</span>` : ''}`;
   body.innerHTML = row.body_html || processUserText(row.body || '', { messageMarkdown: true }) + '<br><br><br>';
   body.classList.toggle('chat-page-canvas-body--markdown', !!row.body_html); hydrateRichUserTextEmbeds(body);
   const unbind = bindChatInlineImageLightboxClickDelegation(body, { bubbleSelector: null });
   const owner = Number(row.sender_id) === Number(services.providers.viewerId);
   ownerWrap.hidden = !owner;
   function edit(on) {
    editing = on; root.classList.toggle('chat-page-canvas-panel--editing', on);
    title.hidden = body.hidden = on; titleInput.hidden = bodyInput.hidden = footer.hidden = !on; ownerWrap.hidden = on || !owner;
    hint.hidden = !on;
    if (on) { titleInput.value = row.title; bodyInput.value = row.body; updateHint(); titleInput.focus(); }
   }
   function updateHint() { hint.textContent = `${Math.max(0, 4000 - bodyInput.value.length)}/4000 characters left`; }
   const items = [{ id: 'edit', label: 'Edit' }];
   if (Number(pinned) !== Number(row.id)) items.push({ id: 'pin', label: 'Pin to channel' });
   else items.push({ id: 'unpin', label: 'Remove channel pin' });
   const menu = createPopupMenu({ placement: 'below-end', items, onSelect(item) { if (item.id === 'edit') edit(true); else void act(() => provider.api.pinCanvas(thread.id, item.id === 'pin' ? row.id : null, { signal: abort.signal })); } });
   async function act(callback) {
    errorLine.hidden = true;
    const buttons = [...root.querySelectorAll('button')]; buttons.forEach(button => button.disabled = true);
    try { await callback(); if (!destroyed) { editing = false; await refresh(); await controller?.refresh(); } }
    catch (error) { if (!destroyed && root.isConnected) { errorLine.textContent = error.message; errorLine.hidden = false; } }
    finally { buttons.forEach(button => button.disabled = false); }
   }
   // WWW permits an admin to remove somebody else's channel pin.
   if (!owner && inbox?.viewerIsAdmin && Number(pinned) === Number(row.id)) {
    ownerWrap.hidden = false; menu.destroy();
   }
   const adminMenu = !owner && inbox?.viewerIsAdmin && Number(pinned) === Number(row.id) ? createPopupMenu({ placement: 'below-end', items: [{ id: 'unpin', label: 'Remove channel pin' }], onSelect: () => void act(() => provider.api.pinCanvas(thread.id, null, { signal: abort.signal })) }) : null;
   more.addEventListener('click', () => (adminMenu || menu).toggle(more));
   root.querySelector('[data-chat-canvas-close]').addEventListener('click', close);
   root.querySelector('[data-chat-canvas-edit]').addEventListener('click', () => edit(true));
   root.querySelector('[data-chat-canvas-cancel]').addEventListener('click', () => edit(false));
   bodyInput.addEventListener('input', updateHint);
   root.querySelector('[data-chat-canvas-save]').addEventListener('click', () => {
    const title = titleInput.value.trim(), body = bodyInput.value.trim(); if (!title || !body) return;
    void act(() => controller.editCanvas(row.id, { title, body }));
   });
   root.querySelector('[data-chat-canvas-delete]').addEventListener('click', () => { if (confirm('Delete this canvas?')) void act(() => provider.remove(thread, row.id)); });
   return { destroy() { unbind?.(); menu.destroy(); adminMenu?.destroy(); root.querySelectorAll('video,audio').forEach(media => media.pause()); root.remove(); } };
  } });
  activeId = row.id; preference(row.id); updateHeader();
 }
 function createCanvas() {
  const { dialog, dispose } = showDialog('create');
  const title = dialog.querySelector('input'), body = dialog.querySelector('textarea'), hint = dialog.querySelector('.chat-canvas-create-limit-hint'), error = dialog.querySelector('[role=alert]');
  function update() { hint.textContent = `${4000 - body.value.length}/4000 characters left`; } update(); body.addEventListener('input', update);
  dialog.querySelector('form').addEventListener('submit', async event => {
   event.preventDefault(); const button = dialog.querySelector('[type=submit]'); button.disabled = true;
   try { const data = await provider.api.createCanvas(thread.id, { title: title.value, body: body.value }, { signal: abort.signal }); if (destroyed) return; dispose(); await refresh(); await controller.refresh(); openCanvas(data.message.id); }
   catch (reason) { if (!destroyed) { error.textContent = reason.message; error.hidden = false; button.disabled = false; } }
  });
 }
 async function showMembers() {
  const { dialog } = showDialog('members');
  try {
   const data = await provider.api.loadMembers(thread.id, { signal: abort.signal }); if (destroyed || !dialog.isConnected) return;
   dialog.querySelector('[role=status]').hidden = true; dialog.querySelector('table').hidden = false;
   dialog.querySelector('tbody').innerHTML = data.members.map(row => {
    const label = row.user_name ? `@${row.user_name}` : `User ${row.user_id}`;
    const avatar = renderCommentAvatarHtml({ avatarUrl: row.avatar_url, displayName: label, color: getAvatarColor(row.user_name || String(row.user_id)), href: '', isFounder: false, flairSize: 'xs' });
    return `<tr><td><div class="chat-private-members-user-cell">${avatar}<span class="chat-private-members-username">${escapeHtml(label)}</span></div></td><td><span class="chat-private-members-status chat-private-members-status--${row.status === 'joined' ? 'joined' : 'invited'}">${row.status === 'joined' ? 'Joined' : 'Invited'}</span></td></tr>`;
   }).join('');
  } catch (error) { if (!destroyed && dialog.isConnected) dialog.querySelector('[role=status]').textContent = error.message; }
 }
 function copyHistory() {
  if (!history) { const dialog = clone('history'); document.body.append(dialog); history = createChatHistoryCopyModal(dialog); }
  history.open({ loadHistory: async () => {
   let messages = [], before;
   do { const page = await provider.api.loadMessages(thread.id, { limit: 100, before, signal: abort.signal }); messages = [...page.messages, ...messages]; if (!page.hasMore || !page.nextBefore || page.nextBefore === before) break; before = page.nextBefore; } while (!destroyed);
   const byId = new Map(messages.map(row => [Number(row.id), row]));
   const lines = [`Chat: ${thread.title || 'Chat'}`, ''];
   for (const message of messages) {
    const body = String(message.body || '').trim(); if (!body) continue;
    lines.push(`${message.sender_user_name?.trim() || 'Unknown'} · ${formatDateTime(message.created_at) || message.created_at || ''}`);
    const reply = message.meta?.reply;
    if (reply) { const parent = byId.get(Number(reply.referenced_id)); const who = parent?.sender_user_name || reply.sender_user_name; const quoted = reply.preview_text || parent?.body?.trim().replace(/\s+/g, ' '); lines.push(`↳ Reply to ${message.reply_parent_exists === false ? '(unavailable)' : who ? '@' + who : 'Unknown'}${quoted ? ': ' + quoted : ''}`); }
    lines.push(body, '');
   }
   return lines.join('\n').trimEnd();
  } });
 }
 const onResize = () => updateHeader(); window.addEventListener('resize', onResize);
 return {
  connect(value) { controller = value; },
  setThread(value, data) { thread = value; inbox = data; updateHeader(); void refresh(); },
  refresh,
  openCanvas,
  destroy() { destroyed = true; abort.abort(); revision++; rail?.close({ forget: false }); history?.destroy(); for (const dialog of dialogs) { dialog.close(); dialog.remove(); } dialogs.clear(); window.removeEventListener('resize', onResize); setHeaderAccessories?.(); setHeaderSwitcher?.(); setHeaderMenu?.(); },
 };
}
