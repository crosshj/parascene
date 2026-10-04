import { isRecommendableCreationRow } from '../services/create/recommendableCreations.js';
import { runSemanticSearch } from '../services/explore/semanticSearch.js';

const FIELDS = 'id,title,summary,author,tags,created_at,created_image_id,prsn_created_images!inner(id,user_id,filename,file_path,width,height,color,status,created_at,published,published_at,title,description,meta,unavailable_at)';
async function data(query) { const r = await query; if (r.error) throw r.error; return r.data || []; }
function visibleQuery(client, viewer) {
 let q = client.from('prsn_feed_items').select(FIELDS).eq('prsn_created_images.published', true).is('prsn_created_images.unavailable_at', null).order('created_at', { ascending: false }).order('id', { ascending: false });
 if (viewer.meta?.enableNsfw !== true) q = q.or('meta->>nsfw.is.null,meta->>nsfw.eq.false', { referencedTable: 'prsn_created_images' });
 return q;
}
function flatten(row) { const image = row.prsn_created_images; return { ...image, title: image.title || row.title || 'Untitled', created_image_id: image.id, feed_item_id: row.id, summary: row.summary || image.description || '', author: row.author, tags: row.tags, feed_created_at: row.created_at }; }
export function createExploreStore(client) {
 async function enrich(rows, viewer) {
  if (!rows.length) return [];
  const ids = rows.map(row => row.id), authorIds = [...new Set(rows.map(row => row.user_id))];
  const [likes, comments, viewerLikes, profiles, users, likeRows, commentRows] = await Promise.all([
   data(client.from('prsn_created_image_like_counts').select('created_image_id,like_count').in('created_image_id', ids)),
   data(client.from('prsn_created_image_comment_counts').select('created_image_id,comment_count').in('created_image_id', ids)),
   data(client.from('prsn_likes_created_image').select('created_image_id').eq('user_id', viewer.id).in('created_image_id', ids)),
   data(client.from('prsn_user_profiles').select('user_id,user_name,display_name,avatar_url').in('user_id', authorIds)),
   data(client.from('prsn_users').select('id,meta').in('id', authorIds)),
   data(client.from('prsn_likes_created_image').select('created_image_id,user_id').in('created_image_id', ids).order('created_at', { ascending: false }).limit(1000)),
   data(client.from('prsn_comments_created_image').select('created_image_id,user_id').in('created_image_id', ids).order('created_at', { ascending: false }).limit(1000))
  ]);
  const whoIds = [...new Set([...likeRows, ...commentRows].map(row => row.user_id))];
  const whoProfiles = whoIds.length ? await data(client.from('prsn_user_profiles').select('user_id,user_name,display_name').in('user_id', whoIds)) : [];
  const who = new Map(whoProfiles.map(row => [Number(row.user_id), row.user_name ? `@${row.user_name}` : row.display_name || '']));
  const counts = new Map(likes.map(row => [Number(row.created_image_id), row.like_count])), commentCounts = new Map(comments.map(row => [Number(row.created_image_id), row.comment_count]));
  const liked = new Set(viewerLikes.map(row => Number(row.created_image_id))), byUser = new Map(profiles.map(row => [Number(row.user_id), row])), plans = new Map(users.map(row => [Number(row.id), row.meta?.plan]));
  const labels = (all, id, count) => { const people = [...new Set(all.filter(row => Number(row.created_image_id) === Number(id)).map(row => who.get(Number(row.user_id))).filter(Boolean))].slice(0, 5); const others = Math.max(0, count - people.length); return others ? [...people, others] : people; };
  return rows.map(row => {
   const profile = byUser.get(Number(row.user_id)); const likeCount = Number(counts.get(Number(row.id))) || 0, commentCount = Number(commentCounts.get(Number(row.id))) || 0;
   return { ...row, author_user_name: profile?.user_name, author_display_name: profile?.display_name, author_avatar_url: profile?.avatar_url, author_plan: plans.get(Number(row.user_id)) || 'free', like_count: likeCount, comment_count: commentCount, viewer_liked: liked.has(Number(row.id)), liked_by: labels(likeRows, row.id, likeCount), commented_by: labels(commentRows, row.id, commentCount) };
  });
 }
 return {
  async browse(viewer, { limit = 50, offset = 0 } = {}) {
   const follows = await data(client.from('prsn_user_follows').select('following_id').eq('follower_id', viewer.id));
   const excluded = [...new Set([Number(viewer.id), ...follows.map(row => Number(row.following_id))])].filter(id => Number.isSafeInteger(id) && id > 0);
   const rows = await data(visibleQuery(client, viewer).not('prsn_created_images.user_id', 'in', `(${excluded.join(',')})`).range(offset, offset + limit));
   return { rows: await enrich(rows.slice(0, limit).map(flatten), viewer), hasMore: rows.length > limit };
  },
  async search(viewer, { q, limit = 100, offset = 0, semantic = false } = {}) {
   if (!q) return { rows: [], hasMore: false };
   if (semantic) {
    const nearest = await runSemanticSearch(client, { q, limit, offset });
    if (!nearest.ids.length) return { rows: [], hasMore: nearest.hasMore };
    const rows = await data(visibleQuery(client, viewer).in('created_image_id', nearest.ids));
    const byId = new Map(rows.map(flatten).filter(isRecommendableCreationRow).map(row => [Number(row.id), row]));
    return { rows: await enrich(nearest.ids.map(id => byId.get(Number(id))).filter(Boolean), viewer), hasMore: nearest.hasMore };
   }
   const needle = q.toLowerCase(); let scanned = 0; const matches = [];
   // WWW searches titles, author, tags, description/metadata and the newest 300
   // creations' comments. Scan in bounded DB pages instead of an unbounded list.
   while (matches.length <= offset + limit) {
    const batch = await data(visibleQuery(client, viewer).range(scanned, scanned + 499));
    if (!batch.length) break;
    const extraIds = batch.slice(0, Math.max(0, 300 - scanned)).map(row => row.created_image_id);
    const comments = extraIds.length ? await data(client.from('prsn_comments_created_image').select('created_image_id,text').in('created_image_id', extraIds)) : [];
    const authorIds = [...new Set(batch.map(row => row.prsn_created_images.user_id))];
    const profiles = await data(client.from('prsn_user_profiles').select('user_id,user_name,display_name').in('user_id', authorIds));
    const authors = new Map(profiles.map(row => [Number(row.user_id), `${row.user_name || ''} ${row.display_name || ''}`]));
    for (const item of batch) {
     const image = item.prsn_created_images;
     const blob = [image.title, item.title, item.summary, item.tags, item.author, authors.get(Number(image.user_id)), image.description, JSON.stringify(image.meta), ...comments.filter(c => Number(c.created_image_id) === Number(image.id)).map(c => c.text)].join(' ').toLowerCase();
     if (isRecommendableCreationRow(image) && blob.includes(needle)) matches.push(flatten(item));
    }
    scanned += batch.length; if (batch.length < 500) break;
   }
   return { rows: await enrich(matches.slice(offset, offset + limit), viewer), hasMore: matches.length > offset + limit };
  }
 };
}
