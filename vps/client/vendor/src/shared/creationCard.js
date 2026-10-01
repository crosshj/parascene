/** @param {string|null|undefined} title */
export function creationTitleTrimmed(title) {
	return typeof title === 'string' ? title.trim() : '';
}

/** @param {{ published?: boolean|number|null, created_image_id?: number|string|null }} item */
export function isCreationPublished(item) {
	if (item?.published === true || item?.published === 1) return true;
	if (item?.published === false || item?.published === 0) return false;
	if (item?.created_image_id != null && item?.created_image_id !== '') return true;
	return false;
}

/**
 * Display label for a creation title (published-without-title → "Untitled").
 * @param {{ title?: string|null, published?: boolean|number|null, created_image_id?: number|string|null }} item
 * @param {{ untitledPlaceholder?: string, draftFallback?: string }} [opts]
 */
export function creationTitleDisplay(item, opts = {}) {
	const raw = creationTitleTrimmed(item?.title);
	if (raw) return { text: raw, untitled: false };
	const placeholder = opts.untitledPlaceholder ?? 'Untitled';
	if (isCreationPublished(item)) return { text: placeholder, untitled: true };
	const draftFallback = opts.draftFallback ?? '';
	return { text: draftFallback, untitled: false };
}
