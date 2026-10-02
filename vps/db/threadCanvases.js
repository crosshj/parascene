import crypto from 'node:crypto';
import { canvasBodyMarkdownToSafeHtml } from '../utils/canvasBodyHtml.js';
const blocked = new Set(['comments', 'feed', 'explore', 'creations', 'challenges']);
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function result(query) { const { data, error } = await query; if (error) throw error; return data; }
function encode(body, secret) {
 const iv = crypto.randomBytes(12);
 const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(secret).digest(), iv);
 const packed = Buffer.concat([cipher.update(body, 'utf8'), cipher.final(), cipher.getAuthTag()]);
 return `enc:v1:${iv.toString('base64url')}.${packed.toString('base64url')}`;
}
export function createThreadCanvases({ client, users, threadForMember, privateSecret, decrypt, broadcast }) {
 async function dirty(threadId, messageId = 0) {
  void broadcast(client, `room:${threadId}`, { roomId: String(threadId), afterMessageId: String(messageId) });
 }
 async function list(userId, threadId) {
  const thread = await threadForMember(userId, threadId);
  if (thread.type !== 'channel') return { canvases: [], pinned_message_id: null };
  const rows = await result(client.from('prsn_chat_messages').select('id,sender_id,body,created_at,meta').eq('thread_id', threadId).contains('meta', { canvas: {} }).order('id', { ascending: true }).limit(200)) || [];
  const ids = [...new Set(rows.map(row => Number(row.sender_id)))];
  const profiles = ids.length ? await result(client.from('prsn_user_profiles').select('user_id,user_name').in('user_id', ids)) : [];
  const names = new Map(profiles.map(row => [Number(row.user_id), row.user_name]));
  const secret = thread.visibility === 'private' ? await privateSecret(userId, threadId) : '';
  return { canvases: rows.filter(row => row.meta?.canvas?.title?.trim()).map(row => {
   const body = thread.visibility === 'private' ? (String(row.body).startsWith('enc:v1:') ? decrypt(String(row.body).slice(7), secret) : null) ?? '[Encrypted message]' : row.body;
   return { id: Number(row.id), sender_id: Number(row.sender_id), sender_user_name: names.get(Number(row.sender_id)) || null, title: row.meta.canvas.title.trim(), body, body_html: canvasBodyMarkdownToSafeHtml(body), created_at: row.created_at };
  }), pinned_message_id: Number(thread.meta?.canvas?.pinned_message_id ?? thread.meta?.canvas?.pinnedMessageId) || null };
 }
 async function create(userId, threadId, payload) {
  const thread = await threadForMember(userId, threadId);
  const user = await users.byId(userId);
  if (user?.meta?.plan !== 'founder') fail(403, 'Founder plan required');
  if (thread.type !== 'channel' || !thread.channel_slug || blocked.has(thread.channel_slug)) fail(403, 'Canvases cannot be created in this channel');
  const title = typeof payload?.title === 'string' ? payload.title.replace(/\u0000/g, '').trim() : '';
  let body = typeof payload?.body === 'string' ? payload.body.replace(/\u0000/g, '').trim() : '';
  if (!title || title.length > 200 || !body || body.length > 4000) fail(400, 'Title (1–200) and body (1–4000 characters) required');
  if (thread.visibility === 'private') { const secret = await privateSecret(userId, threadId); if (!secret) fail(403, 'Private channel key missing'); body = encode(body, secret); }
  const message = await result(client.from('prsn_chat_messages').insert({ thread_id: threadId, sender_id: userId, body, meta: { canvas: { title } }, reactions: {} }).select('id,thread_id,sender_id,body,created_at,meta,reactions').single());
  await result(client.from('prsn_chat_members').update({ last_read_message_id: message.id }).eq('thread_id', threadId).eq('user_id', userId));
  await dirty(threadId, message.id);
  const members = await result(client.from('prsn_chat_members').select('user_id').eq('thread_id', threadId));
  for (const member of members || []) void broadcast(client, `user:${member.user_id}`, { threadId: String(threadId) });
  return { message };
 }
 async function pin(userId, threadId, messageId) {
  if (messageId != null && (!Number.isSafeInteger(Number(messageId)) || Number(messageId) <= 0)) fail(400, 'Invalid message id');
  const user = await users.byId(userId);
  for (let attempt = 0; attempt < 5; attempt++) {
   const thread = await threadForMember(userId, threadId);
   if (thread.type !== 'channel') fail(400, 'Pinned canvas is only for channels');
   const current = Number(thread.meta?.canvas?.pinned_message_id ?? thread.meta?.canvas?.pinnedMessageId) || null;
   const id = messageId == null ? current : Number(messageId);
   if (id) {
    const message = await result(client.from('prsn_chat_messages').select('id,thread_id,sender_id,meta').eq('id', id).maybeSingle());
    if (messageId != null && (!message?.meta?.canvas?.title || Number(message.thread_id) !== threadId)) fail(400, 'Only a canvas in this channel can be pinned');
    if (Number(message?.sender_id) !== Number(userId) && !(messageId == null && user?.role === 'admin')) fail(403, 'Only the canvas author can pin; author or admin can remove a pin');
   }
   const meta = { ...thread.meta, canvas: { ...thread.meta?.canvas } };
   delete meta.canvas.pinnedMessageId;
   if (messageId == null) { delete meta.canvas.pinned_message_id; if (!Object.keys(meta.canvas).length) delete meta.canvas; }
   else meta.canvas.pinned_message_id = Number(messageId);
   let update = client.from('prsn_chat_threads').update({ meta }).eq('id', threadId);
   update = thread.meta == null ? update.is('meta', null) : update.eq('meta', JSON.stringify(thread.meta));
   const saved = await result(update.select('id').maybeSingle());
   if (saved) { await dirty(threadId); return { ok: true, pinned_message_id: messageId == null ? null : Number(messageId) }; }
  }
  fail(409, 'Thread changed while pinning. Please try again.');
 }
 async function members(userId, threadId) {
  const thread = await threadForMember(userId, threadId);
  if (thread.type !== 'channel' || thread.visibility !== 'private') fail(400, 'Only private channels are supported');
  const joined = await result(client.from('prsn_chat_members').select('user_id').eq('thread_id', threadId));
  const joinedIds = new Set(joined.map(row => Number(row.user_id)));
  const invites = await result(client.from('prsn_chat_messages').select('meta').eq('thread_id', threadId).contains('meta', { system_event: { kind: 'channel_invite_sent' } }).order('id', { ascending: false }).limit(200));
  const ids = [...new Set([...joinedIds, ...invites.flatMap(row => row.meta?.system_event?.invited_user_ids || []).map(Number)])].filter(id => Number.isSafeInteger(id) && id > 0);
  const profiles = ids.length ? await result(client.from('prsn_user_profiles').select('user_id,user_name,avatar_url').in('user_id', ids)) : [];
  return { members: ids.map(id => { const profile = profiles.find(row => Number(row.user_id) === id); return { user_id: id, user_name: profile?.user_name || null, avatar_url: profile?.avatar_url || null, status: joinedIds.has(id) ? 'joined' : 'invited' }; }).sort((a,b) => (a.status === b.status ? String(a.user_name || '').localeCompare(String(b.user_name || '')) : a.status === 'joined' ? -1 : 1)) };
 }
 return { list, create, pin, members };
}
