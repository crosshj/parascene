import { parseAspectRatioString } from '../../shared/aspectRatio.js';
import { readImageUrlDimensions, readRasterFileDimensions } from '../../providers/create/transport.js';
import { isImageUrlField, isImageUrlArrayField, fieldMatchesShowWhen } from '../../components/ProviderFields/ProviderFields.js';

/** Mounted advisory; dimension reads and late results belong to this form. */
export function createAspectRatioWarning({ root, lifetime, getFields, getValues }) {
 const template = document.createElement('template');
 template.innerHTML = '<p class="create-aspect-ratio-warning" role="status" aria-live="polite" hidden></p>';
 const warning = template.content.firstElementChild;
 root.querySelector('[data-fields-group]').append(warning);
 const dimensions = new Map();
 let revision = 0;
 let queued = false;

 function visibleInput(key) {
  const input = root.querySelector(`#field-${CSS.escape(key)}`);
  if (!input || input.disabled || input.closest('[hidden]')) return null;
  const group = input.closest('.form-group');
  if (group && getComputedStyle(group).display === 'none') return null;
  return input;
 }
 function readDimensions(value) {
  if (!dimensions.has(value)) {
   const read = value instanceof File ? readRasterFileDimensions(value) : readImageUrlDimensions(value);
   dimensions.set(value, read.catch(() => null));
  }
  return dimensions.get(value);
 }
 async function evaluate() {
  const current = ++revision;
  const ratioInput = visibleInput('aspect_ratio');
  const target = ratioInput?.value;
  const ratio = parseAspectRatioString(target);
  if (!ratio) {
   warning.hidden = true;
   return;
  }
  const values = getValues();
  const images = [];
  for (const [key, field] of Object.entries(getFields())) {
   if (!fieldMatchesShowWhen(field, values) || !visibleInput(key)) continue;
   if (!isImageUrlField(field) && !isImageUrlArrayField(field)) continue;
   let value = values[key];
   if (isImageUrlArrayField(field) && typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = []; }
   }
   for (const image of Array.isArray(value) ? value : [value]) {
    if (image instanceof File || (typeof image === 'string' && image.trim())) images.push(image);
   }
  }
  // Release removed image/file references; keep cached reads for current inputs.
  for (const image of dimensions.keys()) if (!images.includes(image)) dimensions.delete(image);
  const sizes = await Promise.all(images.map(readDimensions));
  if (!lifetime.active || current !== revision) return;
  const targetRatio = ratio[0] / ratio[1];
  const mismatches = sizes.filter(size => size?.width > 0 && size?.height > 0 &&
   Math.abs((size.width / size.height) / targetRatio - 1) > 0.04).length;
  if (!mismatches) {
   warning.hidden = true;
   return;
  }
  const subject = images.length === 1 ? 'The input image does' : `${mismatches} of ${images.length} input images do`;
  warning.textContent = `${subject} not match the selected ${target} aspect ratio. Depending on the model, the result may crop, stretch, or pad the images, or use a different ratio.`;
  warning.hidden = false;
 }
 function refresh() {
  // Invalidate immediately, even if several changes happen before the next evaluation.
  revision++;
  if (queued || !lifetime.active) return;
  queued = true;
  queueMicrotask(() => {
   queued = false;
   if (lifetime.active) void evaluate();
  });
 }
 lifetime.listen(root, 'input', refresh);
 lifetime.listen(root, 'change', refresh);
 lifetime.own(() => { revision++; dimensions.clear(); warning.remove(); });
 return { refresh };
}
