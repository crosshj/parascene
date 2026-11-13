import { PARASCENE_BLUE_SERVER_ID } from '../../../shared/generationDefaults.js';

/**
 * Parascene Blue image models for the composer, in display order.
 * One row per model. Submit picks text2image or image2image from whether an image is attached.
 * A side is used only when the live method still offers that value.
 * Krea 2 Turbo is the int8 checkpoint; the fp8 twin stays in advanced.
 */
export const BLUE_IMAGE_GROUP_LABEL = 'Parascene Blue';
export const BLUE_IMAGE_GROUP_ID = 'parascene-blue-image';
export const BLUE_COMPOSER_IMAGE_MODELS = [
	{
		label: 'Flux 3 Klein',
		text2image: 'diffusion_models/flux3-image-klein-base-int8-convrot.safetensors',
		image2image: 'flux3_klein_i2i',
	},
	{
		label: 'Krea 2 Turbo',
		text2image: 'diffusion_models/krea2/krea2_turbo_int8_convrot.safetensors',
	},
	{
		label: 'MOSS Image SFT',
		text2image: 'diffusion_models/moss_image_sft_int8_convrot.safetensors',
		image2image: 'moss_image_i2i',
	},
	{
		label: 'Qwen Image 2.1',
		text2image: 'diffusion_models/qwen_image_2.1_int8_convrot.safetensors',
		image2image: 'qwen_image_2_1_i2i',
	},
	{
		label: 'Z-Image Turbo',
		text2image: 'diffusion_models/z-image/z_image_turbo_bf16.safetensors',
	},
];

function encodeRouteKey(serverId, methodKey, model) {
	return `${serverId}\x1e${methodKey}\x1e${model}`;
}

function parseRouteKey(key) {
	const parts = String(key).split('\x1e');
	if (parts.length < 3) return null;
	const serverId = Number(parts[0]);
	const methodKey = parts[1];
	const model = parts.slice(2).join('\x1e');
	if (!Number.isFinite(serverId) || serverId < 1 || !methodKey || !model) return null;
	return { serverId, methodKey, model };
}

function parseServerConfig(server) {
	if (!server || typeof server !== 'object') return null;
	let cfg = /** @type {{ server_config?: unknown }} */ (server).server_config;
	if (typeof cfg === 'string') {
		try {
			cfg = JSON.parse(cfg);
		} catch {
			return null;
		}
	}
	return cfg && typeof cfg === 'object' ? /** @type {Record<string, unknown>} */ (cfg) : null;
}

function modelOptionValues(raw) {
	if (raw == null) return [];
	/** @type {unknown[]} */
	const list = Array.isArray(raw)
		? raw
		: typeof raw === 'object'
			? Object.entries(/** @type {Record<string, unknown>} */ (raw)).map(([key, val]) => {
					if (val && typeof val === 'object' && !Array.isArray(val)) {
						const rec = /** @type {{ value?: unknown, id?: unknown }} */ (val);
						return rec.value ?? rec.id ?? key;
					}
					return key;
				})
			: [];
	return list
		.map((item) => {
			if (typeof item === 'string') return item.trim();
			if (Array.isArray(item) && item.length > 0) return String(item[0] ?? '').trim();
			if (item && typeof item === 'object') {
				const rec = /** @type {{ value?: unknown, id?: unknown, name?: unknown, label?: unknown }} */ (item);
				return String(rec.value ?? rec.id ?? rec.name ?? rec.label ?? '').trim();
			}
			return '';
		})
		.filter(Boolean);
}

function methodOffersModelValue(methods, methodKey, value) {
	const wanted = String(value || '').trim();
	if (!wanted || !methods || typeof methods !== 'object') return false;
	const methodDef = /** @type {Record<string, { fields?: { model?: { options?: unknown, choices?: unknown, enum?: unknown } } }>} */ (
		methods
	)[methodKey];
	const field = methodDef?.fields?.model;
	return modelOptionValues(field?.options ?? field?.choices ?? field?.enum).includes(wanted);
}

export function isBlueImageFamily(option) {
	return Boolean(option && (option.text2imageValue || option.image2imageValue));
}

/**
 * Pick the text or image method for a Blue model. Other models pass through.
 * Returns null when the needed Blue side is not available.
 * @param {{ serverId?: number, methodKey?: string, value?: string, label?: string, selectValue?: string, methodLabel?: string, groupId?: string, text2imageValue?: string, image2imageValue?: string } | null | undefined} option
 * @param {boolean} hasImage
 */
export function resolveBlueImageVariant(option, hasImage) {
	if (!option) return null;
	if (!isBlueImageFamily(option)) return option;
	const value = hasImage ? option.image2imageValue : option.text2imageValue;
	if (!value) return null;
	const methodKey = hasImage ? 'image2image' : 'text2image';
	return {
		...option,
		value,
		methodKey,
		selectValue: encodeRouteKey(option.serverId, methodKey, value),
	};
}

/**
 * Match a stored text or image route back to the single picker row.
 * @param {Array<{ serverId?: number, selectValue?: string, text2imageValue?: string, image2imageValue?: string }>} options
 * @param {string} storedKey
 */
export function findImageFamilyOption(options, storedKey) {
	const key = String(storedKey || '').trim();
	if (!key) return null;
	const parsed = parseRouteKey(key);
	if (parsed) {
		const family = options.find(
			(option) =>
				option.serverId === parsed.serverId &&
				(option.text2imageValue === parsed.model || option.image2imageValue === parsed.model)
		);
		if (family) return family;
	}
	return options.find((option) => option.text2imageValue === key || option.image2imageValue === key) || null;
}

/**
 * @param {unknown} server
 */
export function collectCuratedBlueImageOptions(server) {
	if (!server || Number(/** @type {{ id?: unknown }} */ (server).id) !== Number(PARASCENE_BLUE_SERVER_ID)) {
		return [];
	}
	const cfg = parseServerConfig(server);
	const methods = cfg?.methods && typeof cfg.methods === 'object' ? cfg.methods : null;
	if (!methods) return [];
	const out = [];
	for (const entry of BLUE_COMPOSER_IMAGE_MODELS) {
		const textValue = methodOffersModelValue(methods, 'text2image', entry.text2image)
			? entry.text2image
			: '';
		const imageValue = methodOffersModelValue(methods, 'image2image', entry.image2image)
			? entry.image2image
			: '';
		if (!textValue && !imageValue) continue;
		const methodKey = textValue ? 'text2image' : 'image2image';
		const value = textValue || imageValue;
		out.push({
			selectValue: encodeRouteKey(PARASCENE_BLUE_SERVER_ID, methodKey, value),
			value,
			label: entry.label,
			serverId: Number(PARASCENE_BLUE_SERVER_ID),
			methodKey,
			methodLabel: BLUE_IMAGE_GROUP_LABEL,
			groupId: BLUE_IMAGE_GROUP_ID,
			text2imageValue: textValue,
			image2imageValue: imageValue,
		});
	}
	return out;
}
