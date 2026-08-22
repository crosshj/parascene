/**
 * Document-level click bind for [data-import-media] (create footer in native overlay).
 */

export async function bindImportSunoEntry(qs = '') {
	if (document.documentElement.dataset.prsnImportMediaBound === '1') return;
	document.documentElement.dataset.prsnImportMediaBound = '1';
	const { openImportMediaModal } = await import(`./importSunoModal.js${qs}`);
	const { showToast } = await import(`./toast.js${qs}`);
	const { importCreationWithPending } = await import(`./createSubmit.js${qs}`);
	const { importMediaFromUrl } = await import(`./importMedia.js${qs}`);

	async function runImport({ provider, url }) {
		const isOverlay = Boolean(document.querySelector('.create-workflow-root'));
		const result = await importCreationWithPending({
			runImport: ({ creationToken }) =>
				importMediaFromUrl(provider, url, { creationToken }),
			navigate: isOverlay ? 'none' : 'full',
		});
		if (result?.warning?.code === 'duplicate_import') {
			showToast(result.warning.message || 'You already imported this media', {
				durationMs: 4000,
			});
		}
		if (isOverlay) {
			const runtimeMod = await import(`./createPageRuntime.js${qs}`);
			runtimeMod.refreshAfterSubmit({ creationId: result.id });
		}
		return result;
	}

	document.addEventListener(
		'click',
		(e) => {
			const btn = e.target?.closest?.('[data-import-media], [data-import-suno]');
			if (!btn) return;
			e.preventDefault();
			e.stopPropagation();
			openImportMediaModal({
				onConfirm: runImport,
				onError: (message) => {
					if (message) alert(message);
				},
			});
		},
		true
	);
}
