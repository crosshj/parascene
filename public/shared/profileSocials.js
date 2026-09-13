/** Profile social links stored in `prsn_user_profiles.socials` JSON. */

export const PROFILE_SOCIAL_NETWORKS = [
	{
		key: 'website',
		label: 'Website',
		placeholder: 'https://example.com',
		hosts: null
	},
	{
		key: 'spotify',
		label: 'Spotify',
		placeholder: 'https://open.spotify.com/your-profile',
		hosts: ['open.spotify.com', 'spotify.com', 'www.spotify.com', 'play.spotify.com']
	},
	{
		key: 'instagram',
		label: 'Instagram',
		placeholder: 'https://www.instagram.com/your-profile',
		hosts: ['instagram.com', 'www.instagram.com']
	},
	{
		key: 'tiktok',
		label: 'TikTok',
		placeholder: 'https://www.tiktok.com/@your-profile',
		hosts: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com']
	},
	{
		key: 'soundcloud',
		label: 'SoundCloud',
		placeholder: 'https://soundcloud.com/your-profile',
		hosts: ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com', 'on.soundcloud.com']
	},
	{
		key: 'youtube',
		label: 'YouTube',
		placeholder: 'https://www.youtube.com/@your-profile',
		hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']
	},
	{
		key: 'x',
		label: 'X',
		placeholder: 'https://x.com/your-profile',
		hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']
	},
	{
		key: 'suno',
		label: 'Suno',
		placeholder: 'https://suno.com/@your-profile',
		hosts: ['suno.com', 'www.suno.com']
	},
	{
		key: 'nightcafe',
		label: 'NightCafe',
		placeholder: 'https://creator.nightcafe.studio/u/your-profile',
		hosts: ['nightcafe.studio', 'www.nightcafe.studio', 'creator.nightcafe.studio']
	}
];

const SOCIAL_BY_KEY = new Map(PROFILE_SOCIAL_NETWORKS.map((network) => [network.key, network]));
const MAX_SOCIAL_URL_LENGTH = 2048;

export function socialFieldName(key) {
	return `social_${key}`;
}

function cloneSocials(socials) {
	if (!socials || typeof socials !== 'object' || Array.isArray(socials)) return {};
	return { ...socials };
}

function hostAllowed(hostname, allowedHosts) {
	if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) return true;
	const host = String(hostname || '').trim().toLowerCase();
	return allowedHosts.includes(host);
}

function invalidMessage(network) {
	if (!network || network.key === 'website' || !Array.isArray(network.hosts) || !network.hosts.length) {
		return 'Website must be a valid URL.';
	}
	const exampleHost = network.hosts.find((host) => !host.startsWith('www.') && !host.startsWith('m.') && !host.startsWith('vm.'))
		|| network.hosts[0];
	return `${network.label} link must be a ${exampleHost} URL.`;
}

/**
 * @param {string} key
 * @param {unknown} raw
 * @returns {{ ok: true, href: string | null } | { ok: false, error: string, key: string }}
 */
export function validateSocialUrl(key, raw) {
	const network = SOCIAL_BY_KEY.get(key);
	if (!network) {
		return { ok: false, error: 'Unknown social network.', key: String(key || '') };
	}

	const value = typeof raw === 'string' ? raw.trim() : (raw == null ? '' : String(raw).trim());
	if (!value) return { ok: true, href: null };

	let href = value;
	if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) href = `https://${href}`;

	let parsed;
	try {
		parsed = new URL(href);
	} catch {
		return { ok: false, error: invalidMessage(network), key: network.key };
	}

	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		return { ok: false, error: invalidMessage(network), key: network.key };
	}
	if (parsed.username || parsed.password) {
		return { ok: false, error: invalidMessage(network), key: network.key };
	}
	if (!parsed.hostname) {
		return { ok: false, error: invalidMessage(network), key: network.key };
	}
	if (!hostAllowed(parsed.hostname, network.hosts)) {
		return { ok: false, error: invalidMessage(network), key: network.key };
	}

	const nextHref = parsed.href;
	if (nextHref.length > MAX_SOCIAL_URL_LENGTH) {
		return { ok: false, error: invalidMessage(network), key: network.key };
	}

	return { ok: true, href: nextHref };
}

/**
 * Apply `social_*` multipart/form fields onto existing socials JSON.
 * Missing fields are left unchanged. Empty strings remove that network.
 * @param {object} existingSocials
 * @param {object} fields
 */
export function applySocialFieldUpdates(existingSocials, fields) {
	const next = cloneSocials(existingSocials);
	for (const network of PROFILE_SOCIAL_NETWORKS) {
		const field = socialFieldName(network.key);
		if (typeof fields?.[field] !== 'string') continue;
		const result = validateSocialUrl(network.key, fields[field]);
		if (!result.ok) return result;
		if (result.href) next[network.key] = result.href;
		else delete next[network.key];
	}
	return { ok: true, socials: next };
}

/**
 * Apply a JSON `socials` object. Only known keys present on `incoming` are updated.
 * @param {object} existingSocials
 * @param {unknown} incoming
 */
export function applySocialObjectUpdates(existingSocials, incoming) {
	if (incoming == null) return { ok: true, socials: cloneSocials(existingSocials) };
	if (typeof incoming !== 'object' || Array.isArray(incoming)) {
		return { ok: false, error: 'Social links must be an object.', key: '' };
	}
	const fields = {};
	for (const network of PROFILE_SOCIAL_NETWORKS) {
		if (!Object.prototype.hasOwnProperty.call(incoming, network.key)) continue;
		const value = incoming[network.key];
		fields[socialFieldName(network.key)] = value == null ? '' : String(value);
	}
	return applySocialFieldUpdates(existingSocials, fields);
}

export function listVisibleSocials(socials) {
	const source = cloneSocials(socials);
	const items = [];
	for (const network of PROFILE_SOCIAL_NETWORKS) {
		const result = validateSocialUrl(network.key, source[network.key]);
		if (!result.ok || !result.href) continue;
		items.push({
			key: network.key,
			label: network.label,
			href: result.href
		});
	}
	return items;
}
