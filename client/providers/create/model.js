import { resolveRenderableFields, fieldMatchesShowWhen } from '../../shared/providerFormFieldVisibility.js';
import { projectCreateDraft } from './draft.js';
import * as defaults from '../../shared/generationDefaults.js';

// Mode is a projection of the retained draft, never a replacement draft.
export function createModeChange({ mode, engine = 'ltx', prompt, aspectRatio, serverId, methodKey, model, styleKey } = {}) {
 const video = mode === 'image-to-video';
 const ltx = video && engine === 'ltx';
 const standard = ['basic', 'image-edit', 'mutate', 'image-to-image', 'image-to-video'].includes(mode);
 const change = { ...(mode ? { mode } : {}), fieldValues: {} };
 if (standard) Object.assign(change, {
  serverId: ltx ? defaults.MUTATE_VIDEO_LTX_SERVER_ID : defaults.MUTATE_DEFAULT_SERVER_ID,
  methodKey: ltx ? defaults.MUTATE_VIDEO_LTX_METHOD_KEY : video ? defaults.MUTATE_VIDEO_DEFAULT_METHOD_KEY : defaults.MUTATE_DEFAULT_METHOD_KEY,
  outputMode: video ? 'video' : 'image',
 });
 if (standard) change.fieldValues.model = ltx ? defaults.MUTATE_VIDEO_LTX_MODEL : video ? defaults.MUTATE_VIDEO_DEFAULT_MODEL : defaults.MUTATE_DEFAULT_MODEL;
 if (serverId !== undefined) change.serverId = serverId;
 if (methodKey !== undefined) change.methodKey = methodKey;
 if (model !== undefined) change.fieldValues.model = model;
 if (prompt !== undefined) change.fieldValues.prompt = prompt;
 if (aspectRatio !== undefined) change.fieldValues.aspect_ratio = aspectRatio;
 if (styleKey !== undefined) change.styleKey = styleKey;
 if (video) change.videoEngine = engine;
 return change;
}

export function projectCreateMode(draft, { mode = draft.mode, fields, values } = {}) {
 const form = draft.fieldValues;
 if (mode === 'basic') return { prompt: form.prompt || '', model: form.model };
 if (['image-edit', 'mutate', 'image-to-image'].includes(mode)) return { prompt: form.prompt || '', image_url: draft.inputImages[0] || '', model: form.model };
 if (mode === 'image-to-video') return draft.methodKey === defaults.MUTATE_VIDEO_LTX_METHOD_KEY
  ? { seed: '', model: form.model, prompt: form.prompt || '', input_images: draft.inputImages.slice(0, 1), aspect_ratio: form.aspect_ratio || '1:1' }
  : { prompt: form.prompt || '', image: draft.inputImages[0] || '', model: form.model };
 if (!fields) throw new TypeError('Advanced creation requires a field schema');
 const projectFields = schema => {
  const result = projectCreateDraft(draft, schema);
  for (const [key, field] of Object.entries(schema)) {
   if (!field || typeof field !== 'object') continue;
   if (!Object.hasOwn(result, key) && field.default !== undefined) result[key] = Array.isArray(field.default) ? [...field.default] : field.default;
   // Live values carry unuploaded Files and computed controls; normalize select choices afterwards.
   if (values && Object.hasOwn(values, key)) result[key] = values[key];
   if (field.type === 'select' && Array.isArray(field.options) && field.options.length) {
    const choices = field.options.map(option => typeof option === 'object' ? option.value ?? option.id ?? option.label : option);
    if (!choices.some(value => String(value) === String(result[key]))) result[key] = choices.some(value => String(value) === String(field.default)) ? field.default : choices[0];
   }
  }
  return result;
 };
 const baseValues = projectFields(fields);
 fields = resolveRenderableFields(fields, baseValues);
 const result = projectFields(fields);
 for (const [key, field] of Object.entries(fields)) if (!fieldMatchesShowWhen(field, result)) delete result[key];
 return result;
}

export function createSourceChange({ imageUrl, sourceId, published } = {}) {
 if (typeof imageUrl !== 'string' || !imageUrl.trim()) throw new TypeError('A source image URL is required');
 const url = imageUrl.trim();
 return { imageChange: { type: 'replace', images: [url] }, recipeLineage: null, imageSources: { [url]: { sourceId: Number(sourceId) > 0 ? Number(sourceId) : null, published: published === true } } };
}

export function deriveCreateLineage(draft, imageUrls) {
 const used = [...new Set(imageUrls)];
 const recipe = draft.recipeLineage;
 const recipeIds = recipe?.images?.length && used.length === new Set(recipe.images).size && used.every(url => recipe.images.includes(url)) ? recipe.parentIds || [] : [];
 const ids = [...new Set([...recipeIds, ...imageUrls.map(url => Number(draft.imageSources?.[url]?.sourceId)).filter(id => Number.isFinite(id) && id > 0)])];
 return ids.length ? { mutateParentIds: ids, ...(ids.length === 1 ? { mutateOfId: ids[0] } : {}) } : {};
}
