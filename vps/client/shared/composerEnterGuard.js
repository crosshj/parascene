/**
 * Desktop Enter-to-send for chat composers, skipping when a suggest popup owns Enter.
 * @param {KeyboardEvent} event
 * @param {{
 *   field?: EventTarget | null,
 *   isSuggestOpen?: (field: EventTarget | null) => boolean,
 *   finePointerMatches?: boolean,
 * }} [opts]
 * @returns {boolean}
 */
export function composerEnterShouldSend(event, opts = {}) {
	if (!event || event.key !== 'Enter' || event.shiftKey || event.isComposing) return false;
	if (opts.finePointerMatches === false) return false;
	if (typeof opts.isSuggestOpen === 'function' && opts.isSuggestOpen(opts.field ?? null)) return false;
	return true;
}
