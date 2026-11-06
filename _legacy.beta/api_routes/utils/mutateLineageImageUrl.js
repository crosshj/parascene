/**
 * Mutate lineage image URL rules — keep provider inputs when user submitted a frame/generic
 * upload that differs from the parent creation's default image.
 */

/**
 * @param {string} raw
 * @returns {boolean}
 */
export function isGenericUploadImageUrl(raw) {
	if (typeof raw !== 'string') return false;
	const value = raw.trim();
	if (!value) return false;
	try {
		const parsed = new URL(value, 'https://example.invalid');
		const path = parsed.pathname || '';
		return path.startsWith('/api/images/generic/') || path.startsWith('/images/generic/');
	} catch {
		return value.startsWith('/api/images/generic/') || value.startsWith('/images/generic/');
	}
}

/**
 * @param {string} raw
 * @param {string} [baseOrigin]
 * @returns {string}
 */
export function normalizeImageUrlForMatch(raw, baseOrigin = 'https://example.invalid') {
	if (typeof raw !== 'string') return '';
	const value = raw.trim();
	if (!value) return '';
	try {
		const parsed = new URL(value, baseOrigin);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
		return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return '';
	}
}

/**
 * @param {string} raw
 * @param {string} [baseOrigin]
 * @returns {string | null}
 */
export function toParasceneImageUrlForMatch(raw, baseOrigin = 'https://example.invalid') {
	const normalized = normalizeImageUrlForMatch(raw, baseOrigin);
	return normalized || null;
}

/**
 * Build canonical created-image URL from a DB row filename (path only, no origin).
 * @param {string | null | undefined} filename
 * @returns {string | null}
 */
export function createdImagePathFromFilename(filename) {
	const name = typeof filename === 'string' ? filename.trim() : '';
	if (!name) return null;
	return `/api/images/created/${name}`;
}

/**
 * Whether mutate lineage logic should replace the submitted input with the parent's share URL.
 * @param {{
 *   submittedUrl?: string | null,
 *   sourceFilename?: string | null,
 *   baseOrigin?: string,
 * }} params
 * @returns {boolean}
 */
export function shouldReplaceMutateInputWithSourceShareUrl({
	submittedUrl,
	sourceFilename,
	baseOrigin = 'https://example.invalid',
}) {
	const submitted = typeof submittedUrl === 'string' ? submittedUrl.trim() : '';
	if (!submitted) return false;
	if (isGenericUploadImageUrl(submitted)) return false;

	const sourcePath = createdImagePathFromFilename(sourceFilename);
	if (!sourcePath) return false;

	const submittedNorm = normalizeImageUrlForMatch(submitted, baseOrigin);
	if (!submittedNorm) return false;

	const sourceNorm = normalizeImageUrlForMatch(sourcePath, baseOrigin);
	if (!sourceNorm) return false;

	// Legacy storage may omit /api prefix.
	const legacySourceNorm = normalizeImageUrlForMatch(
		sourcePath.replace('/api/images/created/', '/images/created/'),
		baseOrigin
	);

	return submittedNorm === sourceNorm || (legacySourceNorm && submittedNorm === legacySourceNorm);
}

/**
 * Apply share URL to string and array image arg keys when replacement is allowed.
 * @param {{
 *   safeArgs: Record<string, unknown>,
 *   metaArgs: Record<string, unknown>,
 *   shareUrl: string,
 *   imageUrlKeys: string[],
 *   imageUrlArrayKeys: string[],
 *   sourceFilename?: string | null,
 *   baseOrigin?: string,
 * }} params
 */
export function applySourceShareUrlToMutateArgsWhenMatching({
	safeArgs,
	metaArgs,
	shareUrl,
	imageUrlKeys,
	imageUrlArrayKeys,
	sourceFilename,
	baseOrigin,
}) {
	if (typeof shareUrl !== 'string' || !shareUrl.trim()) return;

	const stringKey =
		imageUrlKeys.includes('image_url')
			? 'image_url'
			: imageUrlKeys.length === 1
				? imageUrlKeys[0]
				: null;

	if (stringKey && typeof safeArgs[stringKey] === 'string') {
		if (
			shouldReplaceMutateInputWithSourceShareUrl({
				submittedUrl: safeArgs[stringKey],
				sourceFilename,
				baseOrigin,
			})
		) {
			safeArgs[stringKey] = shareUrl;
			metaArgs[stringKey] = shareUrl;
		}
	}

	for (const arrKey of imageUrlArrayKeys) {
		if (!Array.isArray(safeArgs[arrKey]) || safeArgs[arrKey].length === 0) continue;
		if (typeof safeArgs[arrKey][0] !== 'string') continue;
		if (
			!shouldReplaceMutateInputWithSourceShareUrl({
				submittedUrl: safeArgs[arrKey][0],
				sourceFilename,
				baseOrigin,
			})
		) {
			continue;
		}
		const next = [...safeArgs[arrKey]];
		next[0] = shareUrl;
		safeArgs[arrKey] = next;
		metaArgs[arrKey] = next;
	}
}
