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
	const { importAudioFile } = await import(`./importAudioFile.js${qs}`);

	async function runImport(payload, helpers = {}) {
		const setStatus = typeof helpers.setStatus === 'function' ? helpers.setStatus : null;
		const result = await importCreationWithPending({
			runImport: ({ creationToken }) => {
				if (payload?.provider === 'audio_file') {
					return importAudioFile(payload.file, {
						creationToken,
						onStatus: setStatus || undefined,
					});
				}
				setStatus?.('Importing…');
				return importMediaFromUrl(payload.provider, payload.url, { creationToken });
			},
			navigate: 'none',
		});
		if (result?.warning?.code === 'duplicate_import') {
			showToast(result.warning.message || 'You already imported this media', {
				durationMs: 4000,
			});
		}
		const runtimeMod = await import(`./createPageRuntime.js${qs}`);
		runtimeMod.refreshAfterSubmit({ creationId: result.id });
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
			});
		},
		true
	);
}
