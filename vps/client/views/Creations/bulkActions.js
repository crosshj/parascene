import { creationMetaHasChallengeAnnotation } from '../../shared/challengeSubmitMeta.js';
import { addToMutateQueue } from '../../shared/mutateQueue.js';
import { showToast } from '../../shared/toast.js';
import { copyBulkLinks } from '../../components/BulkActions/copyLinks.js';

export function creationBulkItem(card) {
 const row = card.__creationRecord;
 const id = Number(row?.created_image_id ?? row?.id);
 if (!Number.isInteger(id) || id <= 0) return null;
 let meta = row.meta;
 if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
 const published = card.dataset.published === '1';
 const challenge = creationMetaHasChallengeAnnotation(meta) || row.feed_pin?.active === true;
 return {
  id, label: row.title || `creation ${id}`, published,
  deleteBlock: published ? 'published' : challenge ? 'challenge' : null,
  challenge, type: card.dataset.mediaType || 'image', status: String(row.status || 'completed').toLowerCase(),
  group: card.dataset.groupCreation === '1', imageUrl: card.dataset.imageUrl || '',
  link: `https://www.parascene.com/creations/${id}`,
 };
}
export function canGroupCreations(items) {
 return items.length >= 2 && items.every(item => !item.published && !item.challenge && ['image', 'video'].includes(item.type) && item.status === 'completed')
  && new Set(items.map(item => item.type)).size === 1 && items.filter(item => item.group).length <= 1;
}
export function creationBulkActions({ api, refresh }) {
 return [
  { id: 'copy-links', label: 'Copy links', run: items => copyBulkLinks(items.map(item => item.link)) },
  { id: 'queue', label: 'Queue', enabled: items => items.some(item => item.imageUrl), run(items) {
   for (const item of items) if (item.imageUrl) addToMutateQueue({ sourceId: item.id, imageUrl: new URL(item.imageUrl, window.location.origin).href, published: item.published });
   return { exit: true };
  } },
  { id: 'group', label: 'Group', enabled: canGroupCreations, async run(items, options) {
   if (!canGroupCreations(items)) return;
   const count = items.length - 1, noun = items[0].type;
   const message = items.some(item => item.group) ? `Add ${count} ${noun}${count === 1 ? '' : 's'} to the selected group?` : `Group ${items.length} creations into a single creation?`;
   if (!window.confirm(message)) return;
   await api.group(items.map(item => item.id), options);
   if (options.signal?.aborted) return;
   await refresh();
   showToast('Creations grouped');
   return { exit: true };
  } },
 ];
}
