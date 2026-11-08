import { validateInputBindings, creationInputParentId } from '../../../shared/creationInputs.js';
import { groupV2Items, groupActionSupportedForMeta, parseMeta } from './groupV2.js';
import { getCdnOrigin } from './url.js';

const allowed = (row, user) => row && (Number(row.user_id) === Number(user.id) || user.role === 'admin' ||
 ((row.published === 1 || row.published === true) && (row.status || 'completed') === 'completed' && !row.unavailable_at));
const failure = (code, status = 404) => Object.assign(new Error(code), { code, status });

function containsCreation(meta, creationId) {
 const group = meta?.group;
 if (group?.kind === 'group_v2') return groupV2Items(meta).some(item => item.pointer?.kind === 'creation' && Number(item.pointer.creationId) === creationId);
 if (group?.kind !== 'group_creations') return false;
 return (group.source_creation_ids || []).some(id => Number(id) === creationId) ||
  (group.source_creations || []).some(item => Number(item?.id) === creationId);
}

export async function resolveCreationInputs({ inputs, bindings, fields, args, queries, user, shareUrlForImage, providerBase, resolveInternalUrl, materializeArchived }) {
 const normalized = validateInputBindings(inputs, bindings, fields);
 const byId = new Map(normalized.map(input => [input.id, input]));
 const resolved = new Map();
 const providerArgs = { ...args };
 const recipeInputs = [];
 const directParentIds = [];
 for (const binding of bindings) {
  const urls = [];
  for (const id of binding.attachmentIds) {
   const input = byId.get(id);
   if (!resolved.has(id)) {
    const source = input.source;
    let url;
    let revision = null;
    if (source.kind === 'creation' || source.kind === 'group-member') {
     const creationId = creationInputParentId(input);
     let groupMeta = null;
     if (source.kind === 'group-member') {
      const group = await queries.selectCreatedImageByIdAnyUser?.get(source.groupId);
      if (!allowed(group, user)) throw failure('source_unavailable');
      groupMeta = parseMeta(group.meta);
      if (!groupActionSupportedForMeta(groupMeta, 'remix')) throw failure('source_kind_unsupported', 403);
      if (!containsCreation(groupMeta, creationId)) throw failure('member_not_in_group');
     }
     const row = await queries.selectCreatedImageByIdAnyUser?.get(creationId);
     if (!row && source.kind === 'group-member' && groupMeta?.group?.kind === 'group_creations') {
      const snapshot = (groupMeta.group.source_creations || []).find(item => Number(item?.id) === creationId);
      const filename = typeof snapshot?.filename === 'string' ? snapshot.filename.trim() : '';
      if (snapshot?.status && snapshot.status !== 'completed') throw failure('source_not_ready', 409);
      if (!filename || filename.startsWith('group/') || snapshot?.meta?.media_type === 'video' || !materializeArchived) throw failure('source_unavailable');
      revision = `${filename}:${snapshot.updated_at || snapshot.created_at || ''}`;
      if (input.media?.revision && input.media.revision !== revision) throw failure('source_changed', 409);
      url = await materializeArchived({ groupId: source.groupId, creationId, filename });
      if (!url) throw failure('source_unavailable');
     } else {
      if (!row) throw failure('source_unavailable');
      if ((row.status || '') !== 'completed') throw failure('source_not_ready', 409);
      if (row.unavailable_at || !row.filename || parseMeta(row.meta)?.media_type === 'video') throw failure('source_unavailable');
      if (source.kind === 'creation' && !allowed(row, user)) throw failure('source_unavailable');
      url = shareUrlForImage(creationId, user.id);
      if (!url) throw failure('source_unavailable');
      revision = `${row.filename}:${row.updated_at || row.created_at || ''}`;
     }
     if (input.media?.revision && input.media.revision !== revision) throw failure('source_changed', 409);
     if (!directParentIds.includes(creationId)) directParentIds.push(creationId);
    } else if (source.kind === 'external-image' || source.kind === 'upload' || source.kind === 'derived-still') {
     url = source.url;
     if (!/^https?:\/\//i.test(url) && !url.startsWith('/api/images/generic/')) throw failure('source_kind_unsupported', 400);
     const parsed = new URL(url, url.startsWith('/api/images/generic/') ? getCdnOrigin() : providerBase);
     const ownOrigin = new URL(providerBase).origin;
     const parasceneHost = parsed.hostname === 'parascene.com' || parsed.hostname.endsWith('.parascene.com');
     const internalMediaPath = /^\/(?:api\/images\/created|images\/created|api\/creations\/media|api\/share)\//.test(parsed.pathname);
     if (parasceneHost && internalMediaPath) throw failure('source_kind_unsupported', 400);
     if (source.kind === 'derived-still' &&
      (!parsed.pathname.startsWith('/api/images/generic/edited/') || ![getCdnOrigin(), ownOrigin].includes(parsed.origin))) {
      throw failure('source_kind_unsupported', 400);
     }
     if (parsed.origin === ownOrigin && !parsed.pathname.startsWith('/api/images/generic/')) throw failure('source_kind_unsupported', 400);
     if (await resolveInternalUrl?.(url)) throw failure('source_kind_unsupported', 400);
     url = parsed.href;
     if (source.kind === 'derived-still' && source.parentCreationId) {
      const parent = await queries.selectCreatedImageByIdAnyUser?.get(source.parentCreationId);
      if (!allowed(parent, user)) throw failure('source_unavailable');
      if (!directParentIds.includes(source.parentCreationId)) directParentIds.push(source.parentCreationId);
     }
    } else throw failure('source_kind_unsupported', 400);
    resolved.set(id, { url, revision });
    recipeInputs.push({ id, source, media: input.media, revision });
   }
   urls.push(resolved.get(id).url);
  }
  providerArgs[binding.field] = fields[binding.field]?.type === 'image_url_array' || binding.field === 'input_images' ? urls : urls[0];
 }
 return { args: providerArgs, recipe: { version: 1, inputs: recipeInputs, bindings }, directParentIds };
}
