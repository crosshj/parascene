import { quoteCreation } from './quote.js';
import { projectCreateMode, createModeChange, createSourceChange, deriveCreateLineage } from './model.js';

function cancelled(message = 'Cancelled') {
 const error = new Error(message); error.name = 'AbortError'; return error;
}
const isFile = value => typeof File !== 'undefined' && value instanceof File;

// No DOM dependency: controllers supply confirmation UI; adapters supply transport.
export function createCreationWorkflow({ draft, request, send, upload, importSend, importer, restoreRecipe, lineage = () => ({}), formatMentions = () => 'Some mentions could not be resolved. Submit anyway?' }) {
 let destroyed = false;
 let editingCreation = null;
 let editingRevision = 0;
 let editorTransition = null;
 const lifetime = new AbortController();
 let activeSubmission = null;
 let imagesGeneration = 0;
 let pendingImages = null;
 const uploads = new WeakMap();
 const listeners = new Set();
 let status = { phase: 'idle', error: null };
 const publish = (phase, error = null) => { status = { phase, error }; for (const listener of listeners) { try { listener({ ...status }); } catch (error) { console.error('Create workflow subscriber failed', error); } } };
 const uploadFile = file => {
  if (!isFile(file)) return Promise.resolve(file);
  if (!uploads.has(file)) {
   const promise = Promise.resolve().then(() => upload(file));
   uploads.set(file, promise); promise.catch(() => uploads.delete(file));
  }
  return uploads.get(file);
 };
 const assertAlive = signal => { if (destroyed || signal?.aborted) throw cancelled(); };
 async function ask(confirm, question, signal) {
  assertAlive(signal);
  if (!confirm) throw new Error('A confirmation handler is required');
  let onAbort;
  const aborted = new Promise((_, reject) => { onAbort = () => reject(cancelled()); signal?.addEventListener('abort', onAbort, { once: true }); });
  try { const accepted = await Promise.race([Promise.resolve().then(() => confirm(question)), aborted]); assertAlive(signal); if (!accepted) throw cancelled(); return accepted; }
  finally { signal?.removeEventListener('abort', onAbort); }
 }
 function edit(change, options) {
  if (destroyed) throw cancelled();
  if (change.imageChange) imagesGeneration++;
  return draft.update(change, options);
 }
 async function resolveImages(values, { first = false, signal } = {}) {
  const generation = ++imagesGeneration;
  const initialImagesRevision = draft.read().imagesRevision;
  const images = await Promise.all((Array.isArray(values) ? values : [values]).map(uploadFile));
  // Any intervening explicit change (including changes through compatibility adapters) wins.
  if (destroyed || signal?.aborted || generation !== imagesGeneration || initialImagesRevision !== draft.read().imagesRevision) return null;
  return edit({ imageChange: first ? images[0] ? { type: 'replaceFirst', image: images[0] } : { type: 'removeFirst' } : { type: 'replace', images } });
 }
 async function run(intent, { signal, confirm } = {}) {
  assertAlive(signal);
  const snapshot = draft.read();
  const submittedEditingRevision = editingRevision;
  if (intent.type === 'import') {
   if (!importSend || !importer) throw new Error('Media import is unavailable');
   publish('submitting');
   const result = await importSend({ runImport: context => importer(intent, context), navigate: intent.navigate || 'none', signal, clearPrompt: false, isCurrent: () => !destroyed });
   if (!destroyed && result?.id && submittedEditingRevision === editingRevision) endEditing();
   clearSubmittedPrompt(snapshot, snapshot.fieldValues.prompt, result);
   return result;
  }
  // Composer controls build provider-specific arguments from the selected model's
  // capabilities. Accept those explicit args while keeping upload, occupancy,
  // lineage, pending-creation, and prompt-clear handling in this workflow.
  let args = intent.args && typeof intent.args === 'object'
   ? { ...intent.args }
   : projectCreateMode(snapshot, intent);
  let creditCost = intent.creditCost;
  const serverId = intent.serverId ?? snapshot.serverId;
  const methodKey = intent.methodKey ?? snapshot.methodKey;
  if (!serverId || !methodKey) throw new Error('Choose a server and method before creating');
  if (['basic', 'image-edit', 'mutate', 'image-to-image', 'image-to-video'].includes(intent.mode) && !String(args.prompt || '').trim()) throw new Error('Enter a prompt before creating');
  if (['image-edit', 'mutate', 'image-to-image', 'image-to-video'].includes(intent.mode) && !snapshot.inputImages.length) throw new Error('Choose an image before creating');
  for (const [key, field] of Object.entries(intent.fields || {})) {
   if (!field.required || field.show_when && String(args[field.show_when.field] ?? '') !== String(field.show_when.equals ?? '')) continue;
   const value = args[key];
   if (value === undefined || value === null || value === '' || Array.isArray(value) && !value.length) throw new Error(`Enter ${field.label || key} before creating`);
  }
  publish('preparing');
  for (const [key, value] of Object.entries(args)) {
   args[key] = Array.isArray(value) ? await Promise.all(value.map(uploadFile)) : await uploadFile(value);
   assertAlive(signal);
  }
  if (intent.quote) {
   publish('confirming');
   const quoted = await quoteCreation({ request, serverId, args, signal, ask: question => ask(confirm, question, signal) });
   args = quoted.args; creditCost = quoted.creditCost; assertAlive(signal);
  }
  // The submitted snapshot is immutable; late completion cannot clear a newly edited prompt.
  let hydrateMentions = intent.hydrateMentions === true;
  if (intent.validateMentions !== false && /@([a-zA-Z0-9_]+)/.test(args.prompt || '')) {
   publish('validating');
   let valid;
   try {
    const response = await request('/api/create/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args }), signal });
    const data = await response.json().catch(() => ({}));
    valid = { ok: response.ok, data };
   } catch (error) { assertAlive(signal); valid = { ok: false, data: {} }; }
   assertAlive(signal);
   if (valid.ok) hydrateMentions = true;
   else { publish('confirming'); await ask(confirm, { kind: 'mentions', message: formatMentions(valid.data), primaryLabel: 'Submit anyway' }, signal); }
  }
  if (intent.mode === 'image-to-video') {
   publish('confirming');
   await ask(confirm, { kind: 'video', message: 'You are submitting from Image to Video. Video jobs typically require more processing time than image-only mutations, and credits will be charged as shown on this page.\n\nDo you want to continue?' }, signal);
  }
  assertAlive(signal);
  publish('submitting');
  const imageUrls = Object.entries(args).filter(([key]) => ['image_url', 'input_images', 'image'].includes(key) || ['image_url', 'image_url_array'].includes(intent.fields?.[key]?.type)).flatMap(([, value]) => Array.isArray(value) ? value : [value]).filter(value => typeof value === 'string' && value);
  const result = await send({ ...(snapshot.recipeLineage ? {} : lineage(imageUrls, snapshot)), ...deriveCreateLineage(snapshot, imageUrls), ...intent, serverId, methodKey, args, creditCost, hydrateMentions,
   styleKey: intent.mode === 'basic' ? (intent.styleKey ?? snapshot.styleKey) === 'none' ? undefined : intent.styleKey ?? snapshot.styleKey : intent.styleKey,
   signal, clearPrompt: false, isCurrent: () => !destroyed, confirmOccupancy: (occupancy, options) => {
    publish('confirming'); return ask(confirm, { kind: 'occupancy', occupancy, options: { ...options, signal } }, signal).then(bid => { publish('submitting'); return bid; });
   } });
  if (!destroyed && result?.id && submittedEditingRevision === editingRevision) endEditing();
  clearSubmittedPrompt(snapshot, args.prompt, result);
  return result;
 }
 function clearSubmittedPrompt(snapshot, prompt, result) {
  const current = draft.read();
  if (!destroyed && result?.id && prompt === snapshot.fieldValues.prompt && current.fieldRevisions.prompt === snapshot.fieldRevisions.prompt && current.imagesRevision === snapshot.imagesRevision && current.mode === snapshot.mode && current.serverId === snapshot.serverId && current.methodKey === snapshot.methodKey) {
   edit({ fieldValues: { prompt: '' }, advancedOptions: { ...current.advancedOptions, prompt: '' } });
  }
 }

 function submit(intent = {}, context = {}) {
   if (activeSubmission) return Promise.reject(Object.assign(new Error('A creation is already being submitted'), { code: 'submission_busy' }));
   const abort = new AbortController();
   const signals = [context.signal, lifetime.signal].filter(Boolean);
   const cancel = () => abort.abort();
   for (const signal of signals) { if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true }); }
   activeSubmission = true;
   const promise = run(intent, { ...context, signal: abort.signal }).then(result => { publish('idle'); return result; }, error => { publish(error.name === 'AbortError' ? 'idle' : 'error', error); throw error; }).finally(() => {
    for (const signal of signals) signal.removeEventListener('abort', cancel);
    if (activeSubmission === promise) activeSubmission = null;
   });
   activeSubmission = promise; return promise;
  }

 // Workflow context is transient. Saved form values and input lineage survive closing.
 function endEditing() { editingCreation = null; editorTransition = null; editingRevision++; }
 function beginEditing({ creationId, href }) {
  if (!Number.isFinite(Number(creationId)) || Number(creationId) <= 0) throw new TypeError('A creation ID is required');
  if (editingCreation?.href !== href) {
   editingCreation = { creationId: Number(creationId), href };
   editingRevision++;
  }
  return { ...editingCreation };
 }

 return {
  edit,
  beginEditing,
  beginCreate() {
   endEditing();
   return edit({ imageChange: { type: 'clear' } });
  },
  selectTextToImage(options = {}) {
   endEditing();
   return edit({ ...createModeChange({ ...options, mode: 'basic' }), imageChange: { type: 'clear' } });
  },
  endEditing,
  getEditingCreation: () => editingCreation ? { ...editingCreation } : null,
  recreate(recipe) {
   assertAlive();
   if (!restoreRecipe) throw new Error('Recipe restoration is unavailable');
   const restored = restoreRecipe(recipe);
   if (!restored) throw new Error('Cannot recreate this creation because server or method information is missing.');
   endEditing();
   editorTransition = '/create';
   return { ...restored, href: editorTransition };
  },
  prepareEditorTransition(mode) {
   const href = mode === 'basic' && editingCreation ? editingCreation.href : '/create';
   editorTransition = href;
   return href;
  },
  consumeEditorTransition(href) {
   const matches = editorTransition === href;
   editorTransition = null;
   return matches;
  },
  enterMode(options) {
   return edit(createModeChange(options));
  },
  openSource(options) {
   const result = edit(createSourceChange(options));
   if (editingCreation) editingCreation = { ...editingCreation, sourceId: Number(options.sourceId), sourceResolved: true };
   return result;
  },
  project: options => projectCreateMode(draft.read(), options),
  selectImages(values, options) {
   const promise = resolveImages(values, options); pendingImages = promise;
   const finish = () => { if (pendingImages === promise) pendingImages = null; };
   promise.then(finish, finish); return promise;
  },
  flushImages: () => pendingImages || Promise.resolve(draft.read()),
  uploadFile,
  submit,
  importMedia: (intent, context) => submit({ ...intent, type: 'import' }, context),
  subscribe(listener) { listeners.add(listener); listener({ ...status }); return () => listeners.delete(listener); },
  getSnapshot: () => ({ ...status }),
  destroy() { endEditing(); destroyed = true; lifetime.abort(); imagesGeneration++; listeners.clear(); },
 };
}
