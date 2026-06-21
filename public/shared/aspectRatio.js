/** Known aspect ratio keys (provider / create UI). */
import {
	MUTATE_DEFAULT_SERVER_ID,
} from './generationDefaults.js';

/** Parascene server uploadImage — local constant avoids stale generationDefaults.js cache on deploy. */
const UPLOAD_IMAGE_METHOD_KEY = 'uploadImage';

export const ASPECT_RATIO_PRESETS = {
	'1:1': [1, 1],
	'4:5': [4, 5],
	'9:16': [9, 16],
	'16:9': [16, 9],
};

/** MVP aspect keys used in create composer and Parascene Blue video. */
export const MVP_ASPECT_RATIO_KEYS = ['1:1', '9:16', '4:5', '16:9'];

const ASPECT_MATCH_TOLERANCE = 0.04;

function isUploadImageMethod(context) {
	return (
		Number(context?.serverId) === MUTATE_DEFAULT_SERVER_ID &&
		String(context?.methodKey || '') === UPLOAD_IMAGE_METHOD_KEY
	);
}

/** Synthetic aspect_ratio field for methods that support ratio but omit it from server config. */
export function getVirtualAspectRatioField() {
	return {
		type: 'select',
		label: 'Aspect Ratio',
		hidden: false,
		default: '1:1',
		options: MVP_ASPECT_RATIO_KEYS.map((key) => ({ label: key, value: key })),
		required: false,
	};
}

/** Short labels for grok-imagine aspect ratio selector (matches competitor UI). */
export const ASPECT_RATIO_SELECTOR_LABELS = {
	'16:9': 'cinema',
	'3:2': 'landscape',
	'5:4': 'computer',
	'1:1': 'square',
	'4:5': 'portrait',
	'2:3': 'tablet',
	'9:16': 'phone',
};

/** True when method config exposes an aspect_ratio field object. */
export function methodHasAspectRatioField(fields) {
	const aspectField = fields?.aspect_ratio;
	return Boolean(aspectField && typeof aspectField === 'object');
}

/**
 * Whether the active method supports aspect_ratio (provider field config or uploadImage resize flow).
 * @param {{ serverId?: unknown, methodKey?: unknown, fields?: Record<string, unknown> | null } | null | undefined} context
 * @returns {boolean}
 */
export function modelSupportsAspectRatio(context) {
	if (!context || typeof context !== 'object') return false;
	if (isUploadImageMethod(context)) return true;
	return methodHasAspectRatioField(context.fields);
}

/**
 * Visual aspect ratio picker when the active method exposes aspect_ratio in provider config.
 * Callers should pass `fields` from the method config when available.
 * @param {{ serverId?: unknown, methodKey?: unknown, modelValue?: unknown, fields?: Record<string, unknown> | null } | null | undefined} context
 * @returns {boolean}
 */
export function shouldUseAspectRatioSelector(context) {
	if (!context || typeof context !== 'object') return false;
	if (isUploadImageMethod(context)) return true;
	return methodHasAspectRatioField(context.fields);
}

/** Non-square ratios that use the extended detail-hero layout (1:1 keeps legacy square box). */
export const EXTENDED_HERO_ASPECT_RATIOS = new Set(['4:5', '9:16', '16:9']);

/**
 * @param {unknown} raw
 * @returns {[number, number] | null}
 */
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

/**
 * Pick the closest MVP preset for pixel dimensions.
 * @param {number} width
 * @param {number} height
 * @param {readonly string[]} [keys]
 * @returns {string}
 */
export function closestAspectRatioPreset(width, height, keys = MVP_ASPECT_RATIO_KEYS) {
	const w = Number(width);
	const h = Number(height);
	if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
		return '1:1';
	}
	const actual = w / h;
	let bestKey = '1:1';
	let bestDelta = Infinity;
	for (const key of keys) {
		const preset = parseAspectRatioString(key);
		if (!preset) continue;
		const expected = preset[0] / preset[1];
		const delta = Math.abs(Math.log(actual / expected));
		if (delta < bestDelta) {
			bestDelta = delta;
			bestKey = key;
		}
	}
	return bestKey;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {unknown} aspectKey
 * @param {number} [tolerance]
 * @returns {boolean | null} null when dimensions or key invalid
 */
export function dimensionsMatchAspectRatio(width, height, aspectKey, tolerance = ASPECT_MATCH_TOLERANCE) {
	const w = Number(width);
	const h = Number(height);
	const parsed = parseAspectRatioString(aspectKey);
	if (!parsed || w <= 0 || h <= 0) return null;
	const actual = w / h;
	const expected = parsed[0] / parsed[1];
	return Math.abs(actual - expected) <= tolerance * expected;
}

/**
 * Client warning copy when output/upload aspect may not match the image.
 * @param {{ targetAspect: string, detectedAspect?: string | null, uploadAspect?: string | null, context?: string }} opts
 * @returns {string} empty when no warning needed
 */
export function buildAspectRatioMismatchMessage({
	targetAspect,
	detectedAspect,
	uploadAspect,
	context = 'this job',
}) {
	const target = String(targetAspect || '').trim();
	if (!target) return '';

	const parts = [];
	const upload = String(uploadAspect || '').trim();
	const detected = String(detectedAspect || '').trim();

	if (upload && upload !== target) {
		parts.push(`The image was prepared for ${upload}, but ${context} is set to ${target}.`);
	} else if (detected && detected !== target) {
		parts.push(`The image looks like ${detected}, but ${context} is set to ${target}.`);
	}

	return parts.join(' ');
}

export function dimensionsForAspectRatioLongEdge(raw, longEdge = 1024) {
	const edge = Number(longEdge);
	const fallback = Number.isFinite(edge) && edge > 0 ? Math.round(edge) : 1024;
	const parsed = parseAspectRatioString(raw);
	if (!parsed) return { width: fallback, height: fallback };
	const [rw, rh] = parsed;
	if (rw >= rh) {
		return { width: fallback, height: Math.max(1, Math.round((fallback * rh) / rw)) };
	}
	return { width: Math.max(1, Math.round((fallback * rw) / rh)), height: fallback };
}

/**
 * @param {unknown} meta
 * @returns {Record<string, unknown> | null}
 */
export function normalizeCreationMeta(meta) {
	if (!meta) return null;
	if (typeof meta === 'object') return meta;
	if (typeof meta === 'string') {
		try {
			const parsed = JSON.parse(meta);
			return parsed && typeof parsed === 'object' ? parsed : null;
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Prefer meta.args.aspect_ratio (available early); fall back to stored width/height.
 * @param {{ width?: unknown, height?: unknown, meta?: unknown } | null | undefined} creation
 * @returns {{ w: number, h: number, source: 'args' | 'dimensions' | 'default' }}
 */
/**
 * Pixel dimensions for video hero playback when aspect_ratio is in job args.
 * @param {{ width?: unknown, height?: unknown, meta?: unknown } | null | undefined} creation
 * @param {number} [longEdge]
 * @returns {{ width: number, height: number }}
 */
export function videoHeroDimensionsFromCreation(creation, longEdge = 1024) {
	const meta = normalizeCreationMeta(creation?.meta);
	const aspectRaw = meta?.args?.aspect_ratio;
	if (parseAspectRatioString(aspectRaw)) {
		return dimensionsForAspectRatioLongEdge(aspectRaw, longEdge);
	}
	const w = Number(creation?.width);
	const h = Number(creation?.height);
	if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
		return { width: w, height: h };
	}
	return { width: longEdge, height: longEdge };
}

export function aspectRatioFromCreation(creation) {
	const meta = normalizeCreationMeta(creation?.meta);
	if (meta?.video_placeholder_manual === true) {
		const manualW = Number(creation?.width);
		const manualH = Number(creation?.height);
		if (Number.isFinite(manualW) && manualW > 0 && Number.isFinite(manualH) && manualH > 0) {
			return { w: manualW, h: manualH, source: 'dimensions' };
		}
	}
	const fromArg = parseAspectRatioString(meta?.args?.aspect_ratio);
	if (fromArg) {
		return { w: fromArg[0], h: fromArg[1], source: 'args' };
	}
	const w = Number(creation?.width);
	const h = Number(creation?.height);
	if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
		return { w, h, source: 'dimensions' };
	}
	return { w: 1, h: 1, source: 'default' };
}

/**
 * @param {number} w
 * @param {number} h
 * @returns {'landscape' | 'portrait' | 'square'}
 */
export function heroLayoutMode(w, h) {
	if (w > h) return 'landscape';
	if (h > w) return 'portrait';
	return 'square';
}

/** 9:16 portrait hero (tall); 4:5 and other portraits use width-first layout. */
const PORTRAIT_916_RATIO = 16 / 9;
const PORTRAIT_916_RATIO_TOLERANCE = 0.02;

/**
 * @param {number} w
 * @param {number} h
 * @returns {boolean}
 */
export function isPortrait916Aspect(w, h) {
	if (w <= 0 || h <= 0) return false;
	if (w === 9 && h === 16) return true;
	return Math.abs(h / w - PORTRAIT_916_RATIO) < PORTRAIT_916_RATIO_TOLERANCE;
}

/**
 * All portrait heroes use width-first layout (img drives height).
 * @param {number} w
 * @param {number} h
 * @returns {'width'}
 */
export function portraitHeroSizing(w, h) {
	return 'width';
}

/**
 * True when a creation row represents video media (detail hero stays 1:1 square).
 * @param {{ video_url?: unknown, media_type?: unknown, meta?: unknown } | null | undefined} creation
 * @returns {boolean}
 */
export function creationHasVideo(creation) {
	if (!creation || typeof creation !== 'object') return false;
	if (typeof creation.video_url === 'string' && creation.video_url.trim()) return true;
	const topMediaType = typeof creation.media_type === 'string' ? creation.media_type.trim() : '';
	if (topMediaType === 'video') return true;
	const meta = normalizeCreationMeta(creation.meta);
	if (!meta) return false;
	if (meta.video && typeof meta.video === 'object') return true;
	const fp = typeof meta.file_path === 'string' ? meta.file_path.trim() : '';
	if (fp.startsWith('/api/videos/created/')) return true;
	const vf = typeof meta.video_filename === 'string' ? meta.video_filename : '';
	if (vf.startsWith('video/')) return true;
	return typeof meta.media_type === 'string' && meta.media_type === 'video';
}

/**
 * Extended hero layout applies to supported non-square ratios (4:5, 9:16, 16:9)
 * or non-square stored dimensions. 1:1 keeps the legacy square container.
 * @param {{ width?: unknown, height?: unknown, meta?: unknown, media_type?: unknown, video_url?: unknown } | null | undefined} creation
 * @returns {boolean}
 */
export function shouldUseExtendedHeroLayout(creation) {
	const meta = normalizeCreationMeta(creation?.meta);
	if (meta?.video_placeholder_manual === true) {
		const w = Number(creation?.width);
		const h = Number(creation?.height);
		if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
			return w !== h;
		}
	}
	const argRaw = meta?.args?.aspect_ratio;
	if (argRaw != null && String(argRaw).trim()) {
		const key = String(argRaw).trim();
		if (key === '1:1') return false;
		if (EXTENDED_HERO_ASPECT_RATIOS.has(key)) return true;
		const parsed = parseAspectRatioString(key);
		if (!parsed) return false;
		return parsed[0] !== parsed[1];
	}
	const w = Number(creation?.width);
	const h = Number(creation?.height);
	if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return false;
	return w !== h;
}

/**
 * @param {{ width?: unknown, height?: unknown, meta?: unknown } | null | undefined} creation
 * @returns {{ w: number, h: number, mode: 'landscape' | 'portrait' } | null}
 */
export function resolveExtendedHeroLayout(creation) {
	if (!shouldUseExtendedHeroLayout(creation)) return null;
	const { w, h } = aspectRatioFromCreation(creation);
	const mode = heroLayoutMode(w, h);
	if (mode === 'square') return null;
	return { w, h, mode };
}

const HERO_LAYOUT_CLASSES = [
	'hero-layout-landscape',
	'hero-layout-portrait',
	'hero-layout-legacy',
	'hero-portrait-by-width',
];

/**
 * Apply detail-hero sizing strategy to the image wrapper.
 * 1:1 / legacy: clears extended classes so base square CSS applies.
 * @param {HTMLElement | null | undefined} wrapper
 * @param {{ width?: unknown, height?: unknown, meta?: unknown } | null | undefined} creation
 */
export function applyHeroAspectLayoutToElement(wrapper, creation) {
	if (!wrapper) return;
	wrapper.classList.remove(...HERO_LAYOUT_CLASSES);
	wrapper.style.removeProperty('--hero-aspect-w');
	wrapper.style.removeProperty('--hero-aspect-h');
	wrapper.style.removeProperty('--hero-aspect-ratio');

	const layout = resolveExtendedHeroLayout(creation);
	if (!layout) {
		wrapper.classList.add('hero-layout-legacy');
		return;
	}

	wrapper.style.setProperty('--hero-aspect-w', String(layout.w));
	wrapper.style.setProperty('--hero-aspect-h', String(layout.h));
	wrapper.style.setProperty('--hero-aspect-ratio', `${layout.w} / ${layout.h}`);
	wrapper.classList.add(`hero-layout-${layout.mode}`);
	if (layout.mode === 'portrait') {
		wrapper.classList.add('hero-portrait-by-width');
	}
}

const LANDSCAPE_OUTPAINT_SQUARE_TOLERANCE = 0.06;
const LANDSCAPE_169_RATIO = 16 / 9;
const LANDSCAPE_169_TOLERANCE = 0.04;

/**
 * @param {number} w
 * @param {number} h
 * @param {number} [tolerance]
 * @returns {boolean | null} null when dimensions unknown
 */
export function isSquareAspectRatio(w, h, tolerance = LANDSCAPE_OUTPAINT_SQUARE_TOLERANCE) {
	if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return null;
	return Math.abs(w / h - 1) <= tolerance;
}

/**
 * @param {number} w
 * @param {number} h
 * @param {number} [tolerance]
 * @returns {boolean}
 */
export function isLandscape169AspectRatio(w, h, tolerance = LANDSCAPE_169_TOLERANCE) {
	if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return false;
	return Math.abs(w / h - LANDSCAPE_169_RATIO) <= tolerance;
}

/**
 * Dimensions used for landscape (outpaint) eligibility — group rows use cover source.
 * @param {{ width?: unknown, height?: unknown, meta?: unknown } | null | undefined} creation
 * @returns {{ w: number, h: number }}
 */
export function resolveLandscapeOutpaintDimensions(creation) {
	const meta = normalizeCreationMeta(creation?.meta);
	const group = meta?.group && typeof meta.group === 'object' ? meta.group : null;
	if (group?.kind === 'group_creations') {
		const sources = Array.isArray(group.source_creations) ? group.source_creations : [];
		const coverId = Number(group.cover_source_id);
		const cover = sources.find((s) => s && typeof s === 'object' && Number(s.id) === coverId) || sources.find((s) => s && typeof s === 'object') || null;
		if (cover) {
			const w = Number(cover.width);
			const h = Number(cover.height);
			if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
				return { w, h };
			}
		}
	}
	const { w, h } = aspectRatioFromCreation(creation);
	return { w, h };
}

/**
 * Landscape modal outpaint: square sources only; skip video and already-16:9.
 * @param {{ width?: unknown, height?: unknown, meta?: unknown, video_url?: unknown, media_type?: unknown } | null | undefined} creation
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function getLandscapeOutpaintEligibility(creation) {
	if (creationHasVideo(creation)) {
		return { eligible: false, reason: 'Landscape is only available for images.' };
	}
	const { w, h } = resolveLandscapeOutpaintDimensions(creation);
	if (isLandscape169AspectRatio(w, h)) {
		return {
			eligible: false,
			reason: 'This creation is already 16:9. The main image is used for wide layouts.',
		};
	}
	const square = isSquareAspectRatio(w, h);
	if (square === false) {
		return {
			eligible: false,
			reason: 'Landscape generation works from square (1:1) images. Portrait or wide originals are not supported yet.',
		};
	}
	return { eligible: true };
}

/**
 * @param {Record<string, unknown> | null | undefined} args
 * @returns {boolean}
 */
export function creationArgsHasSourceImage(args) {
	if (!args || typeof args !== 'object') return false;
	const urls = [args.image_url, args.image, args.source_image_url];
	for (const u of urls) {
		if (typeof u === 'string' && u.trim()) return true;
	}
	if (Array.isArray(args.input_images) && args.input_images.length > 0) {
		return args.input_images.some((x) => typeof x === 'string' && x.trim());
	}
	return false;
}

/**
 * Text-to-video jobs (no source image). Parascene Blue uses method `image2video` for both flows.
 * @param {{ width?: unknown, height?: unknown, meta?: unknown, media_type?: unknown, video_url?: unknown, source_image_url?: unknown } | null | undefined} creation
 * @returns {boolean}
 */
export function isText2VideoCreation(creation) {
	if (!creationHasVideo(creation)) return false;
	const meta = normalizeCreationMeta(creation?.meta);
	if (creationArgsHasSourceImage(meta?.args)) return false;
	const topSource =
		typeof creation?.source_image_url === 'string' ? creation.source_image_url.trim() : '';
	if (topSource) return false;
	const metaSource =
		typeof meta?.source_image_url === 'string' ? meta.source_image_url.trim() : '';
	if (metaSource) return false;
	return true;
}

/**
 * Stored poster dimensions match the job aspect_ratio (or no ratio was requested).
 * @param {{ width?: unknown, height?: unknown, meta?: unknown } | null | undefined} creation
 * @returns {boolean}
 */
export function hasProperVideoPlaceholderDimensions(creation) {
	const meta = normalizeCreationMeta(creation?.meta);
	if (meta?.video_placeholder_manual === true) return true;

	const w = Number(creation?.width);
	const h = Number(creation?.height);
	if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return false;

	const aspectRaw = meta?.args?.aspect_ratio;
	if (aspectRaw == null || !String(aspectRaw).trim()) return true;

	const parsed = parseAspectRatioString(aspectRaw);
	if (!parsed) return true;
	if (parsed[0] === parsed[1]) return w === h;

	const ratioW = w / h;
	const ratioE = parsed[0] / parsed[1];
	return Math.abs(ratioW - ratioE) <= 0.02;
}

/** Temporary: show "Use first frame as poster" even after a manual capture. Set false before release. */
export const TEMP_ALLOW_REPEAT_VIDEO_POSTER = true;

/**
 * Completed text-to-video rows that still use an auto-generated placeholder (not a saved frame).
 * @param {{ status?: unknown, width?: unknown, height?: unknown, meta?: unknown, media_type?: unknown, video_url?: unknown } | null | undefined} creation
 * @returns {boolean}
 */
export function canSetVideoPosterFromFirstFrame(creation) {
	if (!creation || typeof creation !== 'object') return false;
	if (String(creation.status || '').toLowerCase() !== 'completed') return false;
	if (!isText2VideoCreation(creation)) return false;
	const meta = normalizeCreationMeta(creation?.meta);
	if (!TEMP_ALLOW_REPEAT_VIDEO_POSTER && meta?.video_placeholder_manual === true) return false;
	return true;
}

/**
 * Text-to-video publish flow: capture first frame when still on auto placeholder.
 * @param {{ status?: unknown, width?: unknown, height?: unknown, meta?: unknown, media_type?: unknown, video_url?: unknown } | null | undefined} creation
 * @returns {boolean}
 */
export function shouldAutoSetVideoPosterOnPublish(creation) {
	if (!canSetVideoPosterFromFirstFrame(creation)) return false;
	const meta = normalizeCreationMeta(creation?.meta);
	return meta?.video_placeholder_manual !== true;
}

/** @deprecated Use canSetVideoPosterFromFirstFrame */
export function needsManualVideoPlaceholder(creation) {
	return canSetVideoPosterFromFirstFrame(creation) && !hasProperVideoPlaceholderDimensions(creation);
}
