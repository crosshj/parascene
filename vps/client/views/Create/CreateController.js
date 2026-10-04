import { disposeProviderFormFields } from '../../components/ProviderFields/ProviderFields.js';
import { createMutateWorkflow } from './MutateCreate.js';
import { disposeTriggeredSuggestFields } from '../../shared/triggeredSuggest.js';
import { disposeAutoGrowTextareas } from '../../shared/autogrow.js';
import { createWorkflowLifetime } from './lifetime.js';
import { mountBasicCreateWorkflow } from './BasicCreate.js';
import './AdvancedCreate.js';
import { releaseCreatePageBindings } from '../../shared/createPageRuntime.js';
import { setCreateWorkflowHost, getCreateWorkflowHost, clearCreateWorkflowHost } from '../../shared/createWorkflowHost.js';

export function createCreateController({ root, creationId, markup, providers, actions, renderError }) {
 let alive = true;
 const workflow = providers.create.workflow;
 let handingOff = false;
 const workflowHref = () => location.pathname + location.search;
 const continuing = workflow.consumeEditorTransition(workflowHref());
 if (creationId) workflow.beginEditing({ creationId, href: workflowHref() });
 else if (!continuing) workflow.beginCreate();
 const lifetime = createWorkflowLifetime();
 lifetime.listen(document, "credits-updated", event => {
  const query = providers.credits.query;
  if (!query) return;
  const balance = event.detail?.count;
  if (Number.isFinite(balance)) query.setData({ ...query.data, balance });
  else void query.refresh().catch(() => {});
 });
 let unmount = () => {};
 let modeLifetime;
 let currentMode;
 const readMutateSourceKey = () => { const params = new URLSearchParams(location.search); return JSON.stringify([params.get("source_id"), params.get("group_of")]); };
 let mutateSourceKey = readMutateSourceKey();
 let generation = 0;
 const host = {
  pendingCreations: providers.creations.pending,
  root,
  onSwitchEditor: mode => {
   if (!alive) return;
   const href = workflow.prepareEditorTransition(mode);
   handingOff = true;
   void actions.navigate(href).catch(error => {
    handingOff = false;
    workflow.consumeEditorTransition(href);
    if (alive) renderError(error);
   });
  },
  onNavigate: (href, options) => alive && actions.navigate(href, options),
  onShellOut: href => alive && actions.navigate(href),
  onClose: () => alive && actions.dismissOverlay(),
  onDismiss: () => alive && actions.dismissOverlay(),
  onShellSync: () => {
   if (!alive) return;
   document.dispatchEvent(new CustomEvent('credits-updated'));
   void providers.creations.query?.refresh({ force: true }).catch(() => {});
  },
 };
 setCreateWorkflowHost(host);
 function disposeDomWork() {
  disposeProviderFormFields(root);
  disposeAutoGrowTextareas(root);
  disposeTriggeredSuggestFields(root);
  root.querySelectorAll('[data-image-picker-modal], [data-audio-clip-picker-modal], [data-import-suno-modal]').forEach(modal => modal.__disposeCreate?.());
 }
 function shouldUseBasicEditor() {
  const prefersBasic = /(?:^|;\s*)create_editor=simple(?:;|$)/i.test(document.cookie);
  const outputMode = providers.create.draft.read().outputMode || 'image';
  return prefersBasic && outputMode === 'image';
 }
 function mountMode() {
  const mountGeneration = ++generation;
  disposeDomWork();
  modeLifetime?.destroy();
  modeLifetime = createWorkflowLifetime();
  releaseCreatePageBindings(root);
  unmount();
  root.replaceChildren();
  if (creationId) {
   root.classList.add('creation-edit-page', 'create-page');
   const mutate = createMutateWorkflow({ root, creationId, providers });
   unmount = mutate.destroy;
   return mutate.ready;
  }
  const basic = shouldUseBasicEditor();
  currentMode = basic;
  root.classList.toggle('create-page', basic);
  root.classList.toggle('create-page-advanced', !basic);
  if (basic) {
   return mountBasicCreateWorkflow(root, { markup, lifetime: modeLifetime, createProvider: providers.create }).then(cleanup => {
    if (alive && mountGeneration === generation) unmount = cleanup;
    else cleanup();
   });
  }
  const element = document.createElement('app-route-create');
  element.createProvider = providers.create;
  element.creditsProvider = providers.credits;
  root.append(element);
  unmount = () => element.remove();
  return element.ready || Promise.resolve();
 }
 const readyGeneration = generation + 1;
 const ready = mountMode().catch(error => { if (alive && generation === readyGeneration) renderError(error); });
 return {
  ready,
  update() {
   if (!alive) return;
   if (workflow.consumeEditorTransition(workflowHref())) handingOff = false;
   const basic = shouldUseBasicEditor();
   const nextSourceKey = readMutateSourceKey();
   if (creationId ? nextSourceKey === mutateSourceKey : basic === currentMode) return;
   mutateSourceKey = nextSourceKey;
   const expectedGeneration = generation + 1;
   void mountMode().catch(error => { if (alive && generation === expectedGeneration) renderError(error); });
  },
  destroy() {
   if (!alive) return;
   alive = false;
   if (!handingOff) workflow.endEditing();
   lifetime.destroy();
   generation++;
   disposeDomWork();
   modeLifetime?.destroy();
   releaseCreatePageBindings(root);
   unmount();
   if (getCreateWorkflowHost() === host) clearCreateWorkflowHost();
   root.remove();
  },
 };
}
