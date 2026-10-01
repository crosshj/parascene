/**
 * Always an organizer; never required in editable lists.
 */
export const IMPLIED_CHALLENGE_ORGANIZER = 'oceanman';

/**
 * @param {unknown} raw
 */
export function normalizeChallengeOrganizerUserNames(raw) {
	const list = Array.isArray(raw) ? raw : [];
	const out = [];
	const seen = new Set();
	for (const entry of list) {
		const u = String(entry || '').trim().replace(/^@+/, '').toLowerCase();
		if (!u || seen.has(u)) continue;
		seen.add(u);
		out.push(u);
	}
	return out;
}

/**
 * Drop the implied organizer so forms don't show / re-save them.
 * @param {unknown} raw
 */
export function organizersWithoutImplied(raw) {
	const implied = IMPLIED_CHALLENGE_ORGANIZER.toLowerCase();
	return normalizeChallengeOrganizerUserNames(raw).filter((u) => u !== implied);
}

/**
 * Ensure oceanman is present.
 * @param {unknown} raw
 */
export function withImpliedChallengeOrganizer(raw) {
	return normalizeChallengeOrganizerUserNames([IMPLIED_CHALLENGE_ORGANIZER, ...(Array.isArray(raw) ? raw : [])]);
}

/**
 * Per-track editable lists (oceanman excluded). Falls back to legacy flat list.
 * @param {object | null | undefined} globalPayload
 * @returns {{ monthly: string[], weekly: string[], suno: string[] }}
 */
export function resolveOrganizersByTrackFromGlobalPayload(globalPayload) {
	const payload = globalPayload && typeof globalPayload === 'object' ? globalPayload : {};
	const legacy = organizersWithoutImplied(payload.organizer_user_names);
	const byTrack =
		payload.organizers_by_track && typeof payload.organizers_by_track === 'object'
			? payload.organizers_by_track
			: null;
	/** @type {('monthly'|'weekly'|'suno')[]} */
	const tracks = ['monthly', 'weekly', 'suno'];
	/** @type {{ monthly: string[], weekly: string[], suno: string[] }} */
	const out = { monthly: [], weekly: [], suno: [] };
	for (const t of tracks) {
		const raw = byTrack
			? Array.isArray(byTrack[t])
				? byTrack[t]
				: []
			: legacy;
		out[t] = organizersWithoutImplied(raw);
	}
	return out;
}

/**
 * @param {unknown} body
 * @returns {object | null}
 */
function tryParseChallengeJsonBody(body) {
	if (body == null) return null;
	const s = String(body).trim();
	if (!s || (!s.startsWith('{') && !s.startsWith('['))) return null;
	try {
		const parsed = JSON.parse(s);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * @param {object[]} messagesAsc chronological thread messages
 * @returns {{ payload: object, messageId: number } | null}
 */
export function pickLatestChallengesGlobalConfig(messagesAsc) {
	let latest = null;
	let latestSortId = -1;
	for (const msg of messagesAsc || []) {
		const payload = tryParseChallengeJsonBody(msg?.body);
		if (!payload || String(payload.kind || '').trim() !== 'challenges_global_config') continue;
		const mid = Number(msg?.id);
		const sortId = Number.isFinite(mid) && mid > 0 ? Math.floor(mid) : 0;
		if (sortId >= latestSortId) {
			latestSortId = sortId;
			latest = { payload, messageId: sortId };
		}
	}
	return latest;
}

/**
 * Union of all track organizers + implied oceanman (page access allowlist).
 * @param {object[]} messagesAsc chronological thread messages
 */
export function resolveChallengeOrganizerAllowlistFromMessages(messagesAsc) {
	const globalCfg = pickLatestChallengesGlobalConfig(messagesAsc);
	if (!globalCfg) return withImpliedChallengeOrganizer([]);
	const byTrack = resolveOrganizersByTrackFromGlobalPayload(globalCfg.payload);
	return withImpliedChallengeOrganizer([
		...byTrack.monthly,
		...byTrack.weekly,
		...byTrack.suno
	]);
}

/**
 * @param {string | null | undefined} viewerUserName profile.user_name / handle
 * @param {string[] | null | undefined} organizerUserNames normalized (or raw) usernames
 */
export function isChallengeChannelAdmin(viewerUserName, organizerUserNames) {
	const u = typeof viewerUserName === 'string' ? viewerUserName.trim().toLowerCase() : '';
	if (!u) return false;
	const names = withImpliedChallengeOrganizer(
		Array.isArray(organizerUserNames) ? organizerUserNames : []
	);
	return new Set(names).has(u);
}

/**
 * @param {unknown} raw
 * @returns {'monthly'|'weekly'|'suno'}
 */
function normalizeOrganizerTrackKey(raw) {
	const s = String(raw || '')
		.trim()
		.toLowerCase();
	if (s === 'weekly' || s === 'suno' || s === 'monthly') return s;
	return 'monthly';
}

/**
 * Whether the viewer may create/manage challenges of this track
 * (oceanman implied on every track).
 * @param {string | null | undefined} viewerUserName
 * @param {{ monthly?: string[], weekly?: string[], suno?: string[] } | null | undefined} organizersByTrack
 * @param {unknown} track
 */
export function viewerOrganizesTrack(viewerUserName, organizersByTrack, track) {
	const u = typeof viewerUserName === 'string' ? viewerUserName.trim().toLowerCase() : '';
	if (!u) return false;
	const t = normalizeOrganizerTrackKey(track);
	const by = organizersByTrack && typeof organizersByTrack === 'object' ? organizersByTrack : {};
	const list = withImpliedChallengeOrganizer(Array.isArray(by[t]) ? by[t] : []);
	return list.includes(u);
}

/**
 * Tracks the viewer can set when creating or changing challenge type.
 * @param {string | null | undefined} viewerUserName
 * @param {{ monthly?: string[], weekly?: string[], suno?: string[] } | null | undefined} organizersByTrack
 * @returns {('monthly'|'weekly'|'suno')[]}
 */
export function tracksViewerCanOrganize(viewerUserName, organizersByTrack) {
	/** @type {('monthly'|'weekly'|'suno')[]} */
	const tracks = ['monthly', 'weekly', 'suno'];
	return tracks.filter((t) => viewerOrganizesTrack(viewerUserName, organizersByTrack, t));
}

/**
 * Soft-deleted challenge (hidden from schedule; recoverable).
 * @param {object | null | undefined} cfg
 */
export function isChallengeConfigSoftDeleted(cfg) {
	if (!cfg || typeof cfg !== 'object') return false;
	if (isChallengeConfigPurged(cfg)) return false;
	if (cfg.deleted === true || cfg.deleted === 1) return true;
	const v = cfg.deleted_at ?? cfg.deletedAt;
	if (v == null) return false;
	if (typeof v === 'string') return Boolean(v.trim());
	return Boolean(v);
}

/**
 * Permanently removed from organizer board (not shown in Deleted).
 * @param {object | null | undefined} cfg
 */
export function isChallengeConfigPurged(cfg) {
	if (!cfg || typeof cfg !== 'object') return false;
	if (cfg.purged === true || cfg.purged === 1) return true;
	const v = cfg.purged_at ?? cfg.purgedAt;
	if (v == null) return false;
	if (typeof v === 'string') return Boolean(v.trim());
	return Boolean(v);
}

/**
 * @param {string | null | undefined} viewerUserName
 */
export function isImpliedChallengeOrganizer(viewerUserName) {
	const u = typeof viewerUserName === 'string' ? viewerUserName.trim().toLowerCase() : '';
	return u === IMPLIED_CHALLENGE_ORGANIZER;
}

/**
 * Payout / finalize actions — oceanman and the platform admin account only (for now).
 * @param {string | null | undefined} viewerUserName
 */
export function viewerCanManageChallengePayouts(viewerUserName) {
	const u = typeof viewerUserName === 'string' ? viewerUserName.trim().toLowerCase() : '';
	return u === IMPLIED_CHALLENGE_ORGANIZER || u === 'admin';
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
	const candidates = [
		cfg.hero_image_url,
		cfg.cover_image_url,
		cfg.image_url,
		cfg.hero_image,
		cfg.hero_media_url,
		cfg.hero_media,
		cfg.hero_ref,
		cfg.hero_url,
		cfg.cover,
		cfg.cover_url,
		cfg.cover_image,
		cfg.image,
		cfg.image_ref,
		cfg.image_path,
		cfg.thumbnail_url,
		cfg.creation_url
	];
	for (const raw of candidates) {
		let s = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
		if (!s) continue;
		if (s.length > HERO_MEDIA_REF_MAX) s = s.slice(0, HERO_MEDIA_REF_MAX);
		return s;
	}
	return '';
}

/**
 * Dedicated 16:9 WebP generated when a creation is attached as challenge hero.
 * @param {object | null | undefined} cfg challenge_config payload
 */
export function pickChallengeHeroPreviewUrl(cfg) {
	if (!cfg || typeof cfg !== 'object') return '';
	const s = typeof cfg.hero_preview_url === 'string' ? cfg.hero_preview_url.trim() : '';
	return s.length > HERO_MEDIA_REF_MAX ? s.slice(0, HERO_MEDIA_REF_MAX) : s;
}

/** @param {unknown} raw organizer form value before save */
export function normalizeChallengeHeroRefForSave(raw) {
	let s = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
	if (s.length > HERO_MEDIA_REF_MAX) s = s.slice(0, HERO_MEDIA_REF_MAX);
	return s;
}

/**
 * Stored results/highlights creation link (`results_creation_url` on challenge_config).
 * @param {object | null | undefined} cfg challenge_config payload
 */
export function pickChallengeResultsCreationUrl(cfg) {
	if (!cfg || typeof cfg !== 'object') return '';
	const v = cfg.results_creation_url ?? cfg.results_url ?? cfg.results_highlights_url;
	let s = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
	if (s.length > HERO_MEDIA_REF_MAX) s = s.slice(0, HERO_MEDIA_REF_MAX);
	return s;
}

/**
 * Creation used when voting on the next challenge theme (`topic_vote_creation_url`).
 * @param {object | null | undefined} cfg challenge_config payload
 */
export function pickChallengeTopicVoteCreationUrl(cfg) {
	if (!cfg || typeof cfg !== 'object') return '';
	const v =
		cfg.topic_vote_creation_url ??
		cfg.theme_vote_creation_url ??
		cfg.topic_vote_url ??
		cfg.next_theme_creation_url;
	let s = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
	if (s.length > HERO_MEDIA_REF_MAX) s = s.slice(0, HERO_MEDIA_REF_MAX);
	return s;
}

/**
 * @param {object | null | undefined} cfg challenge_config payload
 * @returns {string}
 */
export function pickChallengeResultsPublishedAt(cfg) {
	if (!cfg || typeof cfg !== 'object') return '';
	const v = cfg.results_published_at ?? cfg.resultsPublishedAt;
	if (v === true || v === 1) return new Date().toISOString();
	return typeof v === 'string' ? v.trim() : String(v ?? '').trim();
}

/**
 * Merge sparse challenge_config patches for one challenge (chronological entries; last set wins per field).
 * @param {{ msg?: object, payload?: object }[]} configEntries
 * @param {unknown} challengeId
 * @returns {{ results_creation_url?: string, results_published_at?: string }}
 */
export function mergeChallengeConfigFieldsForChallenge(configEntries, challengeId) {
	const cid = String(challengeId || '').trim();
	/** @type {{ results_creation_url?: string, results_published_at?: string, topic_vote_creation_url?: string }} */
	const out = {};
	if (!cid) return out;
	for (const row of configEntries || []) {
		const p = row?.payload;
		if (!p || typeof p !== 'object' || String(p.kind || '').trim() !== 'challenge_config') continue;
		if (String(p.challenge_id || '').trim() !== cid) continue;
		const resultsUrl = pickChallengeResultsCreationUrl(p);
		if (resultsUrl) out.results_creation_url = resultsUrl;
		const publishedAt = pickChallengeResultsPublishedAt(p);
		if (publishedAt) out.results_published_at = publishedAt;
		const topicVote = pickChallengeTopicVoteCreationUrl(p);
		if (topicVote) out.topic_vote_creation_url = topicVote;
	}
	return out;
}

/**
 * Full merged challenge_config for one challenge (chronological patches; last set wins per field).
 * @param {{ msg?: object, payload?: object }[]} configEntries
 * @param {unknown} challengeId
 * @returns {object}
 */
export function mergeFullChallengeConfigForChallenge(configEntries, challengeId) {
	const cid = String(challengeId || '').trim();
	if (!cid) return {};
	let out = {};
	for (const row of configEntries || []) {
		const p = row?.payload;
		if (!p || typeof p !== 'object' || String(p.kind || '').trim() !== 'challenge_config') continue;
		if (String(p.challenge_id || '').trim() !== cid) continue;
		out = { ...out, ...p };
	}
	return out;
}

/**
 * Whether a pre_submit challenge should appear on the public Challenges page.
 * Explicit `listed: false` / null `listed_at` → draft (Organize only).
 * Explicit `listed_at` timestamp → listed.
 * Neither field present → legacy configs stay listed.
 * @param {object | null | undefined} cfg
 */
export function isChallengeListedForUpcoming(cfg) {
	if (!cfg || typeof cfg !== 'object') return false;
	if (cfg.listed === false) return false;
	if (Object.prototype.hasOwnProperty.call(cfg, 'listed_at')) {
		const raw = cfg.listed_at;
		if (raw == null || String(raw).trim() === '') return false;
		return true;
	}
	if (cfg.listed === true) return true;
	return true;
}

/**
 * Mark config as unlisted draft (Organize only).
 * @param {object} payload
 */
export function applyChallengeUnlisted(payload) {
	if (!payload || typeof payload !== 'object') return payload;
	payload.listed = false;
	payload.listed_at = null;
	return payload;
}

/**
 * Mark config as listed upcoming (public Next challenge).
 * @param {object} payload
 * @param {string} [iso]
 */
export function applyChallengeListed(payload, iso) {
	if (!payload || typeof payload !== 'object') return payload;
	payload.listed = true;
	payload.listed_at = iso || new Date().toISOString();
	return payload;
}
