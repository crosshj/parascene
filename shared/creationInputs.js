// A preview URL is presentation data. Source identity belongs to the attachment.
export const CREATION_INPUT_CONTRACT_VERSION = 1;

const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const nonempty = value => typeof value === 'string' ? value.trim() : '';

export function normalizeCreationInput(value) {
 if (!value || typeof value !== 'object') throw new TypeError('Invalid creation input');
 const id = nonempty(value.id);
 const source = value.source || {};
 const previewUrl = nonempty(value.preview?.url);
 if (!id || !previewUrl) throw new TypeError('Creation input needs an ID and preview');
 if (value.media?.kind && value.media.kind !== 'image') throw new TypeError('Unsupported creation input media');
 let normalizedSource;
 if (source.kind === 'group-member') {
  const groupId = positiveId(source.groupId);
  const creationId = positiveId(source.member?.creationId);
  if (!groupId || source.member?.kind !== 'creation' || !creationId) throw new TypeError('Invalid group member');
  normalizedSource = { kind: 'group-member', groupId, member: { kind: 'creation', creationId } };
 } else if (source.kind === 'creation') {
  const creationId = positiveId(source.creationId);
  if (!creationId) throw new TypeError('Invalid creation source');
  normalizedSource = { kind: 'creation', creationId };
 } else if (source.kind === 'external-image' || source.kind === 'upload') {
  normalizedSource = { kind: source.kind, url: nonempty(source.url) || previewUrl };
 } else if (source.kind === 'derived-still') {
  const parentCreationId = positiveId(source.parentCreationId);
  const frameTimeSec = Number(source.frameTimeSec);
  normalizedSource = { kind: 'derived-still', url: nonempty(source.url) || previewUrl,
   ...(parentCreationId ? { parentCreationId } : {}),
   ...(Number.isFinite(frameTimeSec) && frameTimeSec >= 0 ? { frameTimeSec } : {}) };
 } else throw new TypeError('Unsupported creation input source');
 return { id, source: normalizedSource, media: { kind: 'image', ...(nonempty(value.media?.revision) ? { revision: nonempty(value.media.revision) } : {}) }, preview: { url: previewUrl } };
}

export function inputFromLegacyImage(url, provenance = {}, id) {
 const previewUrl = nonempty(url);
 if (!previewUrl) throw new TypeError('Image URL is required');
 const creationId = positiveId(provenance.sourceId);
 const groupId = positiveId(provenance.groupId);
 const source = provenance.fromFrame === true ? { kind: 'derived-still', url: previewUrl,
  ...(creationId ? { parentCreationId: creationId } : {}),
  ...(Number.isFinite(Number(provenance.frameTimeSec)) && Number(provenance.frameTimeSec) >= 0 ? { frameTimeSec: Number(provenance.frameTimeSec) } : {}) }
  : creationId ? groupId
  ? { kind: 'group-member', groupId, member: { kind: 'creation', creationId } }
  : { kind: 'creation', creationId }
  : { kind: 'external-image', url: previewUrl };
 return normalizeCreationInput({ id: id || `input-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`, source, preview: { url: previewUrl } });
}

export function creationInputParentId(input) {
 return input?.source?.kind === 'group-member' ? input.source.member.creationId
  : input?.source?.kind === 'creation' ? input.source.creationId : null;
}

export function bindingsForImageArgs(inputs, args, fields = {}) {
 const remaining = [...inputs];
 const result = [];
 for (const [field, value] of Object.entries(args || {})) {
  const type = fields[field]?.type || (field === 'input_images' ? 'image_url_array' : ['image_url', 'image'].includes(field) ? 'image_url' : null);
  if (!['image_url', 'image_url_array'].includes(type)) continue;
  const urls = (Array.isArray(value) ? value : [value]).filter(v => typeof v === 'string' && v.trim());
  const attachmentIds = [];
  for (const url of urls) {
   const index = remaining.findIndex(input => input.preview.url === url);
   if (index < 0) continue;
   attachmentIds.push(remaining.splice(index, 1)[0].id);
  }
  if (attachmentIds.length) result.push({ field, attachmentIds });
 }
 return result;
}

export function materializeInputBindings(inputs, args, fields = {}) {
 const remaining = [...inputs];
 const selected = [];
 const bindings = [];
 for (const [field, value] of Object.entries(args || {})) {
  const type = fields[field]?.type || (field === 'input_images' ? 'image_url_array' : ['image_url', 'image'].includes(field) ? 'image_url' : null);
  if (!['image_url', 'image_url_array'].includes(type)) continue;
  const values = (Array.isArray(value) ? value : [value]).filter(url => typeof url === 'string' && url.trim());
  if (!values.length) continue;
  const attachmentIds = values.map(url => {
   let index = remaining.findIndex(input => input.preview.url === url);
   let input = index >= 0 ? remaining.splice(index, 1)[0] : null;
   if (!input) {
    const prior = inputs.find(candidate => candidate.preview.url === url);
    input = prior ? normalizeCreationInput({ ...prior, id: `input-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}` }) : inputFromLegacyImage(url);
   }
   selected.push(input);
   return input.id;
  });
  bindings.push({ field, attachmentIds });
 }
 return { inputs: selected, bindings };
}

export function validateInputBindings(inputs, bindings, fields = {}) {
 if (!Array.isArray(inputs) || !Array.isArray(bindings)) throw new TypeError('Invalid input bindings');
 const ids = new Set();
 const normalized = inputs.map(value => {
  const input = normalizeCreationInput(value);
  if (ids.has(input.id)) throw new TypeError('Duplicate creation input ID');
  ids.add(input.id);
  return input;
 });
 const bound = new Set();
 const seenFields = new Set();
 for (const binding of bindings) {
  const type = fields[binding?.field]?.type || (binding?.field === 'input_images' ? 'image_url_array' : ['image_url', 'image'].includes(binding?.field) ? 'image_url' : null);
  if (!['image_url', 'image_url_array'].includes(type) || seenFields.has(binding.field) || !Array.isArray(binding.attachmentIds) || !binding.attachmentIds.length) throw new TypeError('Invalid image field binding');
  if (type === 'image_url' && binding.attachmentIds.length !== 1) throw new TypeError('Scalar image field accepts one input');
  seenFields.add(binding.field);
  for (const id of binding.attachmentIds) {
   if (!ids.has(id) || bound.has(id)) throw new TypeError('Missing or duplicate bound input');
   bound.add(id);
  }
 }
 return normalized;
}
