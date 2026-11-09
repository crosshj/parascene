/** Aspect-ratio primitives shared by the browser and server. */

export const ASPECT_RATIO_PRESETS = {
	'1:1': [1, 1],
	'4:5': [4, 5],
	'9:16': [9, 16],
	'16:9': [16, 9],
};

/** MVP aspect keys used by create flows and provider normalization. */
export const MVP_ASPECT_RATIO_KEYS = ['1:1', '9:16', '4:5', '16:9'];

const ASPECT_MATCH_TOLERANCE = 0.04;

/** @param {unknown} raw @returns {[number, number] | null} */
export function parseAspectRatioString(raw) {
	if (raw == null) return null;
	const key = String(raw).trim();
	if (!key) return null;
	const preset = ASPECT_RATIO_PRESETS[key];
	if (preset) return preset;
	const match = key.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
	if (!match) return null;
	const w = Number(match[1]);
	const h = Number(match[2]);
	if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
	return [w, h];
}

/** Pick the closest MVP preset for pixel dimensions. */
export function closestAspectRatioPreset(width, height, keys = MVP_ASPECT_RATIO_KEYS) {
	const w = Number(width);
	const h = Number(height);
	if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return '1:1';
	const actual = w / h;
	let bestKey = '1:1';
	let bestDelta = Infinity;
	for (const key of keys) {
		const preset = parseAspectRatioString(key);
		if (!preset) continue;
		const delta = Math.abs(Math.log(actual / (preset[0] / preset[1])));
		if (delta < bestDelta) {
			bestDelta = delta;
			bestKey = key;
		}
	}
	return bestKey;
}

/** @returns {boolean | null} null when dimensions or key are invalid. */
export function dimensionsMatchAspectRatio(width, height, aspectKey, tolerance = ASPECT_MATCH_TOLERANCE) {
	const w = Number(width);
	const h = Number(height);
	const parsed = parseAspectRatioString(aspectKey);
	if (!parsed || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
	return Math.abs(w / h - parsed[0] / parsed[1]) <= tolerance * (parsed[0] / parsed[1]);
}

/** Scale a ratio so its longest edge has the requested size. */
export function dimensionsForAspectRatioLongEdge(raw, longEdge = 1024) {
	const edge = Number(longEdge);
	const fallback = Number.isFinite(edge) && edge > 0 ? Math.round(edge) : 1024;
	const parsed = parseAspectRatioString(raw);
	if (!parsed) return { width: fallback, height: fallback };
	const [rw, rh] = parsed;
	if (rw >= rh) return { width: fallback, height: Math.max(1, Math.round((fallback * rh) / rw)) };
	return { width: Math.max(1, Math.round((fallback * rw) / rh)), height: fallback };
}

/** Reference-to-video submissions are character/style references, not start frames. */
export function isReferenceToVideoMethod(method, model) {
	const methodKey = String(method || '').trim().toLowerCase().replace(/[_-]+/g, '');
	if (methodKey === 'reference2video' || methodKey === 'ref2video' || methodKey === 'r2v') return true;
	const modelKey = String(model || '').trim().toLowerCase();
	if (!modelKey) return false;
	if (/(^|[^a-z0-9])r2v([^a-z0-9]|$)/i.test(modelKey)) return true;
	const compact = modelKey.replace(/[_-]+/g, '');
	return compact.includes('ref2video') || compact.includes('reference2video');
}
