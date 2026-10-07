/**
 * One NSFW policy for every surface.
 * Collections omit NSFW rows while the setting is off.
 * Media loads the server blur unless the setting is unobscured, or Creation Detail
 * has confirmed that one open creation.
 */
import {
	applyNsfwPreference,
	getNsfwContentEnabled,
	getNsfwObscure,
} from './nsfwView.js';

export function itemIsNsfw(item) {
	if (!item || typeof item !== 'object') return false;
	if (item.nsfw === true || item.nsfw === 1 || item.nsfw === '1' || item.nsfw === 'true') return true;
	const meta = item.meta;
	if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
		return meta.nsfw === true || meta.nsfw === 1 || meta.nsfw === '1' || meta.nsfw === 'true';
	}
	if (typeof meta === 'string' && meta) {
		try {
			const parsed = JSON.parse(meta);
			return parsed?.nsfw === true;
		} catch {
			return false;
		}
	}
	return false;
}

export function readNsfwPolicy() {
	const enabled = getNsfwContentEnabled();
	const obscure = enabled ? getNsfwObscure() : true;
	return {
		enabled,
		showInCollections: enabled,
		presentation: enabled && !obscure ? 'clear' : 'blur',
	};
}

export function includeInCollection(item) {
	return !itemIsNsfw(item) || readNsfwPolicy().showInCollections;
}

/** Server blur, unless this item may show the clear file. */
export function nsfwShouldBlur(item, { revealed = false } = {}) {
	if (!itemIsNsfw(item) || revealed) return false;
	return readNsfwPolicy().presentation !== 'clear';
}

function asMediaUrl(url) {
	return String(url || '')
		.trim()
		.replace('/api/images/created/', '/api/creations/media/')
		.replace('/api/videos/created/', '/api/creations/media/');
}

export function nsfwMediaUrl(url, item, { revealed = false, sourceVariant = 'thumbnail' } = {}) {
	const raw = asMediaUrl(url);
	if (!raw) return '';
	const blur = nsfwShouldBlur(item, { revealed });
	if (!raw.includes('/api/creations/media/')) return raw;
	let parsed;
	try {
		parsed = new URL(raw, 'http://localhost');
	} catch {
		return raw;
	}
	if (blur) {
		parsed.searchParams.set('variant', 'blur');
		parsed.searchParams.set('source_variant', sourceVariant === 'original' ? 'original' : 'thumbnail');
	} else if (parsed.searchParams.get('variant') === 'blur') {
		parsed.searchParams.delete('variant');
		parsed.searchParams.delete('source_variant');
	}
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Settings are the only writer. `previous` is the policy from before this change.
 */
export function publishNsfwPreference(previous = null) {
	applyNsfwPreference();
	const next = readNsfwPolicy();
	const prior = previous || next;
	const membershipChanged = prior.showInCollections !== next.showInCollections;
	document.dispatchEvent(new CustomEvent('nsfw-preference-changed', {
		detail: { membershipChanged, presentation: next.presentation },
	}));
}
