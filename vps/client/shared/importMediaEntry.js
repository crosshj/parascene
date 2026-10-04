/** Import Media binding owned by the mounted Create form. */
import { openImportMediaModal } from './importSunoModal.js';
import { showToast } from './toast.js';
import { refreshAfterSubmit } from './createPageRuntime.js';

const bindings = new WeakMap();

export async function bindImportSunoEntry(root, createProvider) {
 if (!(root instanceof HTMLElement)) throw new TypeError('Import Media requires a mounted form root');
 const existing = bindings.get(root);
 if (existing) return existing;
 const controller = new AbortController();
 let modal;
 const dispose = () => {
  controller.abort();
  modal?.close();
  bindings.delete(root);
 };
 bindings.set(root, dispose);

	async function runImport(payload, helpers = {}) {
		const setStatus = typeof helpers.setStatus === 'function' ? helpers.setStatus : null;
		const result = await createProvider.workflow.importMedia({ ...payload, onStatus: text => { if (!controller.signal.aborted) setStatus?.(text); }, navigate: 'none' }, { signal: controller.signal });
		if (controller.signal.aborted) return result;
		if (result?.warning?.code === 'duplicate_import') {
			showToast(result.warning.message || 'You already imported this media', {
				durationMs: 4000,
			});
		}
		refreshAfterSubmit({ creationId: result.id });
		return result;
	}

	root.addEventListener(
		'click',
		(e) => {
			const btn = e.target?.closest?.('[data-import-media], [data-import-suno]');
			if (!btn) return;
			e.preventDefault();
			e.stopPropagation();
			modal?.close();
   modal = openImportMediaModal({
				onConfirm: runImport,
			});
		},
		{ capture: true, signal: controller.signal }
	);
 return dispose;
}
