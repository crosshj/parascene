/** Known aspect ratio keys (provider / create UI). */
import {
	MUTATE_DEFAULT_METHOD_KEY,
	MUTATE_DEFAULT_MODEL,
	MUTATE_DEFAULT_SERVER_ID,
} from './generationDefaults.js';

export const ASPECT_RATIO_PRESETS = {
	'1:1': [1, 1],
	'4:5': [4, 5],
	'9:16': [9, 16],
	'16:9': [16, 9],
};

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

/**
 * Visual aspect ratio picker on createAdvanced for grok-imagine + replicate on server 1.
 * @param {{ serverId?: unknown, methodKey?: unknown, modelValue?: unknown } | null | undefined} context
 * @returns {boolean}
 */
export function shouldUseAspectRatioSelector(context, {
	serverId = MUTATE_DEFAULT_SERVER_ID,
	methodKey = MUTATE_DEFAULT_METHOD_KEY,
	modelValue = MUTATE_DEFAULT_MODEL,
} = {}) {
	if (!context || typeof context !== 'object') return false;
	if (Number(context.serverId) !== Number(serverId)) return false;
	if (String(context.methodKey || '') !== String(methodKey)) return false;
	return String(context.modelValue || '') === String(modelValue);
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
export function aspectRatioFromCreation(creation) {
	const meta = normalizeCreationMeta(creation?.meta);
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
 * Extended hero layout applies only to supported non-square ratios (4:5, 9:16, 16:9)
 * or non-square stored dimensions. 1:1 keeps the legacy square container.
 * Video creations always use legacy 1:1 (do not infer ratio from dimensions/args).
 * @param {{ width?: unknown, height?: unknown, meta?: unknown, media_type?: unknown, video_url?: unknown } | null | undefined} creation
 * @returns {boolean}
 */
export function shouldUseExtendedHeroLayout(creation) {
	if (creationHasVideo(creation)) return false;
	const meta = normalizeCreationMeta(creation?.meta);
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
