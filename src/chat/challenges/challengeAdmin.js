/**
 * Who may post challenge_config / run organizer UI in #challenges.
 * Replace with server-driven roles (e.g. thread moderators) when ready.
 *
 * @type {readonly string[]}
 */
export const CHALLENGE_ADMIN_USER_NAMES_HARDCODED = Object.freeze(['oceanman']);

const ADMIN_LOWER = new Set(
	CHALLENGE_ADMIN_USER_NAMES_HARDCODED.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)
);

/**
 * @param {string | null | undefined} viewerUserName profile.user_name / handle
 */
export function isChallengeChannelAdmin(viewerUserName) {
	const u = typeof viewerUserName === 'string' ? viewerUserName.trim().toLowerCase() : '';
	if (!u) return false;
	return ADMIN_LOWER.has(u);
}

/**
 * @param {unknown} value from `<input type="datetime-local">`
 * @returns {string} ISO string or '' if empty / invalid
 */
export function parseDatetimeLocalToIso(value) {
	const s = typeof value === 'string' ? value.trim() : '';
	if (!s) return '';
	const d = new Date(s);
	return Number.isFinite(d.getTime()) ? d.toISOString() : '';
}

/** Keys aligned with {@link ./model/phases.js} deriveChallengePhase. */
const TIMESTAMP_FIELD_ALIASES = {
	submission_start_at: ['submission_start_at', 'start_at', 'submissionStartAt', 'startAt'],
	submission_end_at: ['submission_end_at', 'submissionEndAt'],
	voting_start_at: ['voting_start_at', 'votingStartAt'],
	voting_end_at: ['voting_end_at', 'votingEndAt', 'end_at', 'endAt']
};

/**
 * @param {object | null | undefined} cfg challenge_config payload
 * @param {'submission_start_at'|'submission_end_at'|'voting_start_at'|'voting_end_at'} field
 */
export function pickChallengeConfigTimestamp(cfg, field) {
	const keys = TIMESTAMP_FIELD_ALIASES[field];
	if (!keys || !cfg || typeof cfg !== 'object') return '';
	for (const k of keys) {
		const v = cfg[k];
		if (v != null && String(v).trim()) return String(v).trim();
	}
	return '';
}

/**
 * @param {string} iso ISO or timestring understood by Date
 * @returns {string} value for `<input type="datetime-local">` in local tz, or ''
 */
export function isoToDatetimeLocalInput(iso) {
	const s = typeof iso === 'string' ? iso.trim() : '';
	if (!s) return '';
	const d = new Date(s);
	if (!Number.isFinite(d.getTime())) return '';
	const pad = (n) => String(n).padStart(2, '0');
	const y = d.getFullYear();
	const mo = pad(d.getMonth() + 1);
	const day = pad(d.getDate());
	const h = pad(d.getHours());
	const mi = pad(d.getMinutes());
	return `${y}-${mo}-${day}T${h}:${mi}`;
}

/**
 * Strict http(s) URL only (e.g. callers that require a direct image src without creation resolve).
 * @param {unknown} raw
 * @returns {string} normalized URL or ''
 */
export function sanitizeChallengeHeroImageUrl(raw) {
	const s = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
	if (!s || s.length > 2000) return '';
	try {
		const u = new URL(s);
		if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
		return u.href;
	} catch {
		return '';
	}
}

const HERO_MEDIA_REF_MAX = 2000;

/**
 * Stored hero/reference string from challenge_config (creation link, share link, or image URL).
 * @param {object | null | undefined} cfg challenge_config payload
 */
export function pickChallengeHeroImageUrl(cfg) {
	if (!cfg || typeof cfg !== 'object') return '';
	const v = cfg.hero_image_url ?? cfg.cover_image_url ?? cfg.image_url;
	let s = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
	if (s.length > HERO_MEDIA_REF_MAX) s = s.slice(0, HERO_MEDIA_REF_MAX);
	return s;
}

/** @param {unknown} raw organizer form value before save */
export function normalizeChallengeHeroRefForSave(raw) {
	let s = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
	if (s.length > HERO_MEDIA_REF_MAX) s = s.slice(0, HERO_MEDIA_REF_MAX);
	return s;
}

const REWARD_FIELD_KEYS = /** @type {const} */ ([
	'reward_first',
	'reward_second',
	'reward_third',
	'reward_participation',
	'reward_custom'
]);

/**
 * Organizer form prefills: maps legacy single `reward` into `reward_custom` when no structured fields exist.
 * @param {object | null | undefined} cfg challenge_config
 */
export function challengeRewardPrefillsForOrganizerForm(cfg) {
	const o = cfg && typeof cfg === 'object' ? cfg : {};
	const pick = (k) => {
		const v = o[k];
		return v == null ? '' : String(v).trim();
	};
	let reward_first = pick('reward_first');
	let reward_second = pick('reward_second');
	let reward_third = pick('reward_third');
	let reward_participation = pick('reward_participation');
	let reward_custom = pick('reward_custom');
	const legacy = pick('reward');
	const anyStructured =
		reward_first ||
		reward_second ||
		reward_third ||
		reward_participation ||
		reward_custom;
	if (!anyStructured && legacy) {
		reward_custom = legacy;
	}
	return {
		reward_first,
		reward_second,
		reward_third,
		reward_participation,
		reward_custom
	};
}

/**
 * @param {object | null | undefined} cfg challenge_config
 */
export function challengeConfigHasStructuredRewardFields(cfg) {
	if (!cfg || typeof cfg !== 'object') return false;
	for (const k of REWARD_FIELD_KEYS) {
		const v = cfg[k];
		if (v != null && String(v).trim()) return true;
	}
	return false;
}

export { REWARD_FIELD_KEYS };
