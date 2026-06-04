export const FEED_EDITORIAL_PINS_POLICY_KEY = 'feed.editorial_pins';

export const EDITORIAL_INJECT_SLOTS = [
	'min_index',
	'top',
	'after_first',
	'after_second',
	'after_third',
	'after_fourth',
	'after_fifth',
	'fixed_index'
];

export const EDITORIAL_PIN_SURFACES = ['all', 'chat', 'home'];

/** @type {import('./editorialPinPolicy.js').EditorialPinPolicyDefaults} */
export const EDITORIAL_PIN_POLICY_DEFAULTS = {
	min_index_flat: 3,
	min_index_slot_pack: 7,
	after_challenge_offset: 2,
	respect_challenge: true,
	show_metadata: true,
	extra_spacing: true
};

/**
 * @typedef {object} EditorialPinPolicyDefaults
 * @property {number} min_index_flat
 * @property {number} min_index_slot_pack
 * @property {number} after_challenge_offset
 * @property {boolean} respect_challenge
 * @property {boolean} show_metadata
 * @property {boolean} extra_spacing
 */

/**
 * @typedef {object} EditorialPinInjectConfig
 * @property {string} [slot]
 * @property {number|null} [fixed_index]
 * @property {number} [min_index_flat]
 * @property {number} [min_index_slot_pack]
 * @property {number} [after_challenge_offset]
 * @property {boolean} [respect_challenge]
 */

/**
 * @typedef {object} EditorialPinConfig
 * @property {string} [id]
 * @property {number} created_image_id
 * @property {boolean} [enabled]
 * @property {string|null} [starts_at]
 * @property {string|null} [until]
 * @property {boolean} [show_metadata]
 * @property {boolean} [extra_spacing]
 * @property {string[]} [surfaces]
 * @property {EditorialPinInjectConfig} [inject]
 */

/**
 * @typedef {object} EditorialPinPolicyDocument
 * @property {EditorialPinPolicyDefaults} [defaults]
 * @property {EditorialPinConfig[]} [pins]
 */

/**
 * @param {unknown} raw
 * @returns {EditorialPinPolicyDocument}
 */
export function parseEditorialPinPolicyDocument(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { defaults: { ...EDITORIAL_PIN_POLICY_DEFAULTS }, pins: [] };
	}
	const doc = /** @type {Record<string, unknown>} */ (raw);
	const defaultsIn = doc.defaults;
	const defaults =
		defaultsIn && typeof defaultsIn === 'object' && !Array.isArray(defaultsIn)
			? normalizeEditorialPinDefaults(defaultsIn)
			: { ...EDITORIAL_PIN_POLICY_DEFAULTS };
	const pinsRaw = Array.isArray(doc.pins) ? doc.pins : [];
	const pins = pinsRaw
		.map((p) => normalizeEditorialPinConfig(p, defaults))
		.filter(Boolean);
	return { defaults, pins };
}

/**
 * @param {object} queries
 * @returns {Promise<EditorialPinPolicyDocument>}
 */
export async function loadEditorialPinPolicyDocument(queries) {
	const fn = queries?.selectPolicyByKey?.get;
	if (typeof fn !== 'function') {
		return { defaults: { ...EDITORIAL_PIN_POLICY_DEFAULTS }, pins: [] };
	}
	try {
		const row = await fn(FEED_EDITORIAL_PINS_POLICY_KEY);
		const raw = row?.value;
		if (typeof raw !== 'string' || !raw.trim()) {
			return { defaults: { ...EDITORIAL_PIN_POLICY_DEFAULTS }, pins: [] };
		}
		return parseEditorialPinPolicyDocument(JSON.parse(raw));
	} catch {
		return { defaults: { ...EDITORIAL_PIN_POLICY_DEFAULTS }, pins: [] };
	}
}

/**
 * @param {unknown} partial
 * @returns {EditorialPinPolicyDefaults}
 */
export function normalizeEditorialPinDefaults(partial) {
	const d = /** @type {Record<string, unknown>} */ (
		partial && typeof partial === 'object' ? partial : {}
	);
	return {
		min_index_flat: clampInt(d.min_index_flat, 0, 50, EDITORIAL_PIN_POLICY_DEFAULTS.min_index_flat),
		min_index_slot_pack: clampInt(
			d.min_index_slot_pack,
			0,
			50,
			EDITORIAL_PIN_POLICY_DEFAULTS.min_index_slot_pack
		),
		after_challenge_offset: clampInt(
			d.after_challenge_offset,
			0,
			20,
			EDITORIAL_PIN_POLICY_DEFAULTS.after_challenge_offset
		),
		respect_challenge: d.respect_challenge === false ? false : true,
		show_metadata: d.show_metadata === false ? false : true,
		extra_spacing: d.extra_spacing === false ? false : true
	};
}

/**
 * @param {unknown} raw
 * @param {EditorialPinPolicyDefaults} defaults
 * @returns {EditorialPinConfig|null}
 */
export function normalizeEditorialPinConfig(raw, defaults = EDITORIAL_PIN_POLICY_DEFAULTS) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const p = /** @type {Record<string, unknown>} */ (raw);
	const createdImageId = Number(p.created_image_id);
	if (!Number.isFinite(createdImageId) || createdImageId <= 0) return null;

	const injectRaw =
		p.inject && typeof p.inject === 'object' && !Array.isArray(p.inject) ? p.inject : {};
	const slotRaw = typeof injectRaw.slot === 'string' ? injectRaw.slot.trim() : 'min_index';
	const slot = EDITORIAL_INJECT_SLOTS.includes(slotRaw) ? slotRaw : 'min_index';

	const surfaces = normalizeEditorialPinSurfaces(p.surfaces);

	return {
		id:
			typeof p.id === 'string' && p.id.trim()
				? p.id.trim().slice(0, 80)
				: `pin-${createdImageId}`,
		created_image_id: createdImageId,
		enabled: p.enabled === false ? false : true,
		starts_at: parseOptionalIso(p.starts_at),
		until: parseOptionalIso(p.until),
		show_metadata:
			typeof p.show_metadata === 'boolean' ? p.show_metadata : defaults.show_metadata,
		extra_spacing:
			typeof p.extra_spacing === 'boolean' ? p.extra_spacing : defaults.extra_spacing,
		surfaces,
		inject: {
			slot,
			fixed_index:
				slot === 'fixed_index' ? clampInt(injectRaw.fixed_index, 0, 50, defaults.min_index_flat) : null,
			min_index_flat: clampInt(
				injectRaw.min_index_flat,
				0,
				50,
				defaults.min_index_flat
			),
			min_index_slot_pack: clampInt(
				injectRaw.min_index_slot_pack,
				0,
				50,
				defaults.min_index_slot_pack
			),
			after_challenge_offset: clampInt(
				injectRaw.after_challenge_offset,
				0,
				20,
				defaults.after_challenge_offset
			),
			respect_challenge:
				typeof injectRaw.respect_challenge === 'boolean'
					? injectRaw.respect_challenge
					: defaults.respect_challenge
		}
	};
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeEditorialPinSurfaces(raw) {
	if (!Array.isArray(raw) || raw.length === 0) return ['all'];
	const out = [];
	for (const entry of raw) {
		const s = typeof entry === 'string' ? entry.trim().toLowerCase() : '';
		if (EDITORIAL_PIN_SURFACES.includes(s) && !out.includes(s)) out.push(s);
	}
	return out.length ? out : ['all'];
}

/**
 * @param {EditorialPinPolicyDocument} doc
 * @returns {{ ok: true, document: EditorialPinPolicyDocument } | { ok: false, error: string }}
 */
export function validateEditorialPinPolicyDocument(doc) {
	const pins = Array.isArray(doc?.pins) ? doc.pins : [];
	const seenIds = new Set();
	for (const pin of pins) {
		const cid = Number(pin?.created_image_id);
		if (!Number.isFinite(cid) || cid <= 0) {
			return { ok: false, error: 'Each pin needs a positive created_image_id.' };
		}
		if (seenIds.has(cid)) {
			return { ok: false, error: `Duplicate pin for creation ${cid}.` };
		}
		seenIds.add(cid);
		const startMs = pin.starts_at ? Date.parse(pin.starts_at) : NaN;
		const endMs = pin.until ? Date.parse(pin.until) : NaN;
		if (pin.starts_at && !Number.isFinite(startMs)) {
			return { ok: false, error: `Invalid starts_at for creation ${cid}.` };
		}
		if (pin.until && !Number.isFinite(endMs)) {
			return { ok: false, error: `Invalid until for creation ${cid}.` };
		}
		if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs > endMs) {
			return { ok: false, error: `starts_at must be before until for creation ${cid}.` };
		}
	}
	return {
		ok: true,
		document: {
			defaults: normalizeEditorialPinDefaults(doc.defaults ?? {}),
			pins: pins.map((p) => normalizeEditorialPinConfig(p, normalizeEditorialPinDefaults(doc.defaults ?? {}))).filter(Boolean)
		}
	};
}

/**
 * @param {EditorialPinConfig} pin
 * @param {number} [nowMs]
 * @param {string} [feedSurface]
 * @returns {boolean}
 */
export function isEditorialPinActive(pin, nowMs = Date.now(), feedSurface = '') {
	if (!pin || pin.enabled === false) return false;
	const startMs = pin.starts_at ? Date.parse(pin.starts_at) : NaN;
	if (Number.isFinite(startMs) && nowMs < startMs) return false;
	const endMs = pin.until ? Date.parse(pin.until) : NaN;
	if (Number.isFinite(endMs) && nowMs > endMs) return false;
	return editorialPinMatchesSurface(pin.surfaces, feedSurface);
}

/**
 * @param {string[]|undefined} surfaces
 * @param {string} feedSurface
 * @returns {boolean}
 */
export function editorialPinMatchesSurface(surfaces, feedSurface) {
	const normalized = normalizeEditorialPinSurfaces(surfaces);
	if (normalized.includes('all')) return true;
	const surface = typeof feedSurface === 'string' ? feedSurface.trim().toLowerCase() : '';
	const bucket = surface === 'chat' ? 'chat' : 'home';
	return normalized.includes(bucket);
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function parseOptionalIso(value) {
	if (value == null || value === '') return null;
	const ms = Date.parse(String(value));
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * @param {EditorialPinPolicyDocument} doc
 * @returns {string}
 */
export function serializeEditorialPinPolicyDocument(doc) {
	const validated = validateEditorialPinPolicyDocument(doc);
	const payload = validated.ok ? validated.document : { defaults: EDITORIAL_PIN_POLICY_DEFAULTS, pins: [] };
	return JSON.stringify(payload);
}
