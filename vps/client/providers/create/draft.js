// Pure shared draft model. Editors project it; only explicit actions remove values.
export const CREATE_DRAFT_VERSION = 2;
const clone = value => Array.isArray(value) ? value.map(clone) : value && Object.getPrototypeOf(value) === Object.prototype ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
const imageKeys = new Set(['input_images', 'image_url', 'image']);
const urls = value => (Array.isArray(value) ? value : []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function normalizeCreateDraft(value) {
 const source = clone(record(value));
 const fields = { ...record(source.fieldValues) };
 for (const key of Object.keys(fields)) if (Array.isArray(fields[key])) fields[key] = [...fields[key]];
 const images = Array.isArray(source.inputImages) ? urls(source.inputImages) : Array.isArray(fields.input_images)
  ? urls(fields.input_images) : urls([fields.image_url || fields.image]);
 return { ...source, draftVersion: CREATE_DRAFT_VERSION, revision: Number(source.revision) || 0,
  imageSources: Object.fromEntries(Object.entries(record(source.imageSources)).filter(([url]) => images.includes(url))), imagesRevision: Number(source.imagesRevision) || 0, fieldRevisions: { ...record(source.fieldRevisions) }, inputImages: images, fieldValues: { ...fields, input_images: [...images], image_url: images[0] || '', image: images[0] || '' } };
}

export function applyCreateDraftChange(current, change = {}) {
 const draft = normalizeCreateDraft(current);
 const { fieldValues = {}, imageChange, imageFieldKeys = [], clearFields = [], ...properties } = change;
 const ignoredImages = new Set([...imageKeys, ...imageFieldKeys]);
 const fields = { ...draft.fieldValues };
 for (const key of clearFields) {
  if (imageKeys.has(key)) throw new TypeError('Use an explicit image action to clear images');
  delete fields[key];
 }
 for (const [key, value] of Object.entries(record(fieldValues))) {
  if (ignoredImages.has(key) || value === undefined || value === null) continue;
  if (Array.isArray(value)) fields[key] = value.filter(item => ['string', 'number', 'boolean'].includes(typeof item));
  else if (['string', 'number', 'boolean'].includes(typeof value)) fields[key] = value;
 }
 let images = [...draft.inputImages];
 if (imageChange) {
  switch (imageChange.type) {
   case 'replace': images = urls(imageChange.images); break;
   case 'replaceFirst': {
    const first = urls([imageChange.image])[0];
    if (!first) throw new TypeError('Replacing the first image requires a URL');
    images = images.length ? [first, ...images.slice(1)] : [first]; break;
   }
   case 'removeFirst': images = images.slice(1); break;
   case 'clear': images = []; break;
   default: throw new TypeError(`Unknown image draft action: ${imageChange.type}`);
  }
 }
 for (const key of imageFieldKeys) {
  if (Array.isArray(fieldValues[key])) fields[key] = [...images];
  else fields[key] = images[0] || '';
 }
 const fieldRevisions = { ...draft.fieldRevisions };
 for (const key of new Set([...Object.keys(fields), ...Object.keys(draft.fieldValues)])) if (JSON.stringify(fields[key]) !== JSON.stringify(draft.fieldValues[key])) fieldRevisions[key] = draft.revision + 1;
 return normalizeCreateDraft({ ...draft, ...properties, revision: draft.revision + 1, fieldRevisions, imagesRevision: imageChange ? draft.revision + 1 : draft.imagesRevision,
  inputImages: images, fieldValues: fields });
}

export function projectCreateDraft(draft, fields = {}) {
 const saved = normalizeCreateDraft(draft);
 const values = {};
 for (const [key, field] of Object.entries(fields)) {
  if (field?.type === 'image_url_array') values[key] = [...saved.inputImages];
  else if (field?.type === 'image_url') values[key] = saved.inputImages[0] || '';
  else if (Object.hasOwn(saved.fieldValues, key)) values[key] = saved.fieldValues[key];
 }
 return values;
}

export function createCreateDraftStore({ storage, key = 'create-page-selections', onChange } = {}) {
 let memory;
 let storageDirty = false;
 const notify = () => { onChange?.(normalizeCreateDraft(memory)); for (const listener of listeners) { try { listener(normalizeCreateDraft(memory)); } catch (error) { console.error('Create draft subscriber failed', error); } } };
 const listeners = new Set();
 function read() {
  try { const raw = storage?.getItem(key); if (raw && !storageDirty) memory = normalizeCreateDraft(JSON.parse(raw)); } catch {}
  return normalizeCreateDraft(memory);
 }
 return {
  read,
  update(change) {
   memory = applyCreateDraftChange(read(), change);
   try { storage?.setItem(key, JSON.stringify(memory)); storageDirty = false; } catch { storageDirty = true; }
   notify();
   return normalizeCreateDraft(memory);
  },
  subscribe(listener) { listeners.add(listener); listener(read()); return () => listeners.delete(listener); },
  clear() { memory = normalizeCreateDraft({ fieldValues: { prompt: '' } }); try { storage?.removeItem(key); storageDirty = false; } catch { storageDirty = true; } notify(); },
 };
}
