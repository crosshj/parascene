import { enrichCreationComments } from './creations.js';
import { REACTION_ORDER } from '../shared/reactions.js';
import { plainTextReplyPreview } from '../client/shared/plainTextReplyPreview.js';

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function result(query) { const { data, error, count } = await query; if (error) throw error; return { data, count }; }

export function createCommentsStore(client, { creations, queries }) {
 async function imageFor(viewer, imageId) {
  const image = await creations.byIdForViewer(viewer.id, imageId, { isAdmin: viewer.role === 'admin' });
  if (!image || (image.meta?.nsfw && !viewer.meta?.enableNsfw && Number(image.user_id) !== Number(viewer.id) && viewer.role !== 'admin')) fail(404, 'Image not found');
  return image;
 }
 async function commentFor(viewer, id, own = false) {
  const { data: comment } = await result(client.from('prsn_comments_created_image').select('id,user_id,created_image_id,text,created_at,meta').eq('id', id).maybeSingle());
  if (!comment) fail(404, 'Comment not found');
  await imageFor(viewer, comment.created_image_id);
  if (own && Number(comment.user_id) !== Number(viewer.id) && viewer.role !== 'admin') fail(403, 'Forbidden');
  return comment;
 }
 return {
  async latest(viewer, { limit = 50, before, before_id } = {}) {
   const rows = []; let cursor = { before, before_id }; let hasMore = true;
   // Advance by the raw scan cursor, including filtered rows. Filtering must not
   // strand the browser at a page containing only private or NSFW comments.
   while (rows.length <= limit && hasMore) {
    const page = await queries.selectLatestCreatedImageComments.all({ limit: 200, ...cursor, page: true });
    rows.push(...page.rows.filter(row => viewer.meta?.enableNsfw === true || !row.nsfw));
    hasMore = page.has_more;
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
   }
   const visible = rows.slice(0, limit);
   const tail = visible.at(-1);
   return { comments: await enrichCreationComments(client, visible, viewer.id), has_more: rows.length > limit, next_cursor: tail ? { before: tail.created_at, before_id: tail.id } : null };
  },
  async react(viewer, commentId, key, requestedOp = 'toggle') {
   if (!REACTION_ORDER.includes(key)) fail(400, 'Invalid or missing emoji_key');
   const op = ['add', 'remove', 'toggle'].includes(requestedOp) ? requestedOp : 'toggle';
   const scope = { comment_id: commentId, user_id: viewer.id, emoji_key: key };
   let stage = 'checking comment access';
   try {
    await commentFor(viewer, commentId);
    let shouldExist = op === 'add';
    if (op === 'toggle') {
     stage = 'reading existing reaction';
     const { data: existing } = await result(client.from('prsn_comment_reactions').select('id').match(scope).maybeSingle());
     shouldExist = !existing;
    }
    if (shouldExist) {
     stage = 'adding reaction';
     await result(client.from('prsn_comment_reactions').upsert(scope, { onConflict: 'comment_id,user_id,emoji_key', ignoreDuplicates: true }));
    } else {
     stage = 'removing reaction';
     await result(client.from('prsn_comment_reactions').delete().match(scope));
    }
    return { added: shouldExist };
   } catch (cause) {
    const detail = [cause?.message, cause?.details, cause?.hint, cause?.code && `code ${cause.code}`].filter(Boolean).join(' — ')
     || (() => { try { return JSON.stringify(cause); } catch { return String(cause); } })();
    throw Object.assign(new Error(`Reaction save failed while ${stage}${detail ? `: ${detail}` : ''}`, { cause }), {
     ...(cause?.status ? { status: cause.status } : {}),
     ...(cause?.code ? { code: cause.code } : {}),
    });
   }
  },
  async post(viewer, imageId, text, extras = {}) {
   const image = await imageFor(viewer, imageId); const meta = {};
   const ref = extras.referenced_comment_id ?? extras.reply_to_comment_id;
   if (ref != null) {
    const parent = await commentFor(viewer, Number(ref));
    if (Number(parent.created_image_id) !== Number(imageId)) fail(400, 'Invalid referenced comment');
    const { data: profile } = await result(client.from('prsn_user_profiles').select('user_name,avatar_url').eq('user_id', parent.user_id).maybeSingle());
    const { data: author } = await result(client.from('prsn_users').select('meta').eq('id', parent.user_id).maybeSingle());
    meta.reply = { referenced_id: parent.id, sender_id: parent.user_id, sender_user_name: profile?.user_name || null, sender_avatar_url: profile?.avatar_url || null, sender_plan: author?.meta?.plan === 'founder' ? 'founder' : 'free', preview_text: plainTextReplyPreview(parent.text).slice(0, 500) };
   }
   const { data: comment } = await result(client.from('prsn_comments_created_image').insert({ user_id: viewer.id, created_image_id: imageId, text, meta }).select('*').single());
   // Match WWW's best-effort in-app notifications for the owner, participants,
   // and mentioned users; failure must not roll back a successfully posted comment.
   try {
    const { data: participants } = await result(client.from('prsn_comments_created_image').select('user_id').eq('created_image_id', imageId));
    const handles = [...new Set((text.match(/@([a-z0-9_]{3,24})/gi) || []).map(value => value.slice(1).toLowerCase()))];
    const mentions = handles.length ? (await result(client.from('prsn_user_profiles').select('user_id').in('user_name', handles))).data || [] : [];
    const recipients = new Set([image.user_id, ...participants.map(row => row.user_id), ...mentions.map(row => row.user_id)].map(Number)); recipients.delete(Number(viewer.id));
    if (recipients.size) await result(client.from('prsn_notifications').insert([...recipients].map(user_id => ({ user_id, actor_user_id: viewer.id, title: 'New comment', message: image.title ? `Someone commented on “${image.title}”.` : 'Someone commented on a creation.', link: `/creations/${imageId}`, type: user_id === Number(image.user_id) ? 'comment' : 'comment_thread', target: { creation_id: imageId }, meta: { creation_title: image.title || '' } }))));
   } catch (error) { console.warn('[comments] notification failed', error.message); }
   const { count } = await result(client.from('prsn_comments_created_image').select('id', { count: 'exact', head: true }).eq('created_image_id', imageId));
   return { comment: { ...(await enrichCreationComments(client, [comment], viewer.id))[0], ...(meta.reply ? { reply_parent_exists: true } : {}) }, comment_count: count || 0 };
  },
  async update(viewer, id, text) { await commentFor(viewer, id, true); await result(client.from('prsn_comments_created_image').update({ text, updated_at: new Date().toISOString() }).eq('id', id)); return { ok: true, comment: { id, text } }; },
  async remove(viewer, id) {
   const comment = await commentFor(viewer, id, true);
   await result(client.from('prsn_comments_created_image').delete().eq('id', id));
   const { count } = await result(client.from('prsn_comments_created_image').select('id', { count: 'exact', head: true }).eq('created_image_id', comment.created_image_id));
   return { ok: true, comment_count: count || 0 };
  }
 };
}
