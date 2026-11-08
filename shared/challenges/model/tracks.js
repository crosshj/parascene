import { pickChallengeConfigTimestamp, isChallengeConfigSoftDeleted, isChallengeConfigPurged } from '../challengeAdmin.js';
import {
	addDaysYmd,
	compareYmd,
	dateToLocalYmd,
	daysInclusive,
	isoToLocalYmd,
	ymdRangesOverlap
} from './dayBounds.js';

/** @typedef {'monthly' | 'weekly' | 'suno'} ChallengeTrack */

export const CHALLENGE_TRACKS = /** @type {const} */ (['monthly', 'weekly', 'suno']);

export const CHALLENGE_TRACK_LABELS = {
	monthly: 'Monthly',
	weekly: 'Weekly',
	suno: 'Music'
};

/** Display order for multi-track lists (feed board, /challenges summary). Lower = first. */
export const CHALLENGE_TRACK_LIST_ORDER = { monthly: 0, weekly: 1, suno: 2 };

/**
 * @param {unknown} track
 * @returns {number}
 */
export function challengeTrackListRank(track) {
	const key = String(track || '').trim().toLowerCase();
	return CHALLENGE_TRACK_LIST_ORDER[key] ?? 9;
}

/** @typedef {'image' | 'video' | 'audio'} ChallengeAcceptedMedia */

/**
 * @typedef {object} ChallengeTrackTemplate
 * @property {ChallengeTrack} track
 * @property {string} label
 * @property {number} defaultLengthDays
 * @property {ChallengeAcceptedMedia[]} defaultAcceptedMedia
 * @property {{ reward_first: string, reward_second: string, reward_third: string }} defaultPrizes
 * @property {{
 *   main: { first: number, second: number, third: number },
 *   top_submitters: { enabled: boolean, amounts: [number, number, number] },
 *   top_voters: { enabled: boolean, amounts: [number, number, number] }
 * }} defaultPrizeStructure
 * @property {(anchorYmd: string) => string} suggestTitle
 * @property {(anchorYmd: string, title?: string) => string} suggestId
 */

/** Shared starter participation prizes (credits); editable per challenge. */
const DEFAULT_PARTICIPATION = /** @type {const} */ ({
	enabled: true,
	amounts: /** @type {[number, number, number]} */ ([50, 30, 20])
});

/**
 * @param {unknown} raw
 * @returns {ChallengeTrack}
 */
export function normalizeChallengeTrack(raw) {
	const s = String(raw || '')
		.trim()
		.toLowerCase();
	if (s === 'weekly' || s === 'suno' || s === 'monthly') return s;
	return 'monthly';
}

/**
 * @param {object | null | undefined} cfg
 * @returns {ChallengeTrack}
 */
export function pickChallengeTrack(cfg) {
	if (!cfg || typeof cfg !== 'object') return 'monthly';
	if (cfg.track != null) return normalizeChallengeTrack(cfg.track);
	if (cfg.challenge_track != null) return normalizeChallengeTrack(cfg.challenge_track);
	return 'monthly';
}

/** Short opaque suffix for challenge ids (not a full UUID — keeps ids readable). */
function shortChallengeIdToken() {
	try {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
		}
	} catch {
		// ignore
	}
	return Math.random().toString(16).slice(2, 10);
}

/**
 * Background challenge id: `{startDate}-{track}-{token}`
 * @param {ChallengeTrack} track
 * @param {string} anchorYmd
 */
function suggestChallengeId(track, anchorYmd) {
	const ymd = String(anchorYmd || dateToLocalYmd()).trim() || dateToLocalYmd();
	const type = normalizeChallengeTrack(track);
	return `${ymd}-${type}-${shortChallengeIdToken()}`.slice(0, 120);
}

/** Image/video tracks (monthly + weekly). */
export const ACCEPTED_MEDIA_IMAGE_VIDEO = /** @type {ChallengeAcceptedMedia[]} */ (['image', 'video']);
/** Music (suno) track. */
export const ACCEPTED_MEDIA_AUDIO = /** @type {ChallengeAcceptedMedia[]} */ (['audio']);

/** @type {ChallengeTrackTemplate[]} */
export const CHALLENGE_TRACK_TEMPLATES = [
	{
		track: 'monthly',
		label: 'Monthly',
		defaultLengthDays: 28,
		defaultAcceptedMedia: [...ACCEPTED_MEDIA_IMAGE_VIDEO],
		defaultPrizes: {
			reward_first: '1200 credits',
			reward_second: '700 credits',
			reward_third: '500 credits'
		},
		defaultPrizeStructure: {
			main: { first: 1200, second: 700, third: 500 },
			top_submitters: { ...DEFAULT_PARTICIPATION, amounts: [...DEFAULT_PARTICIPATION.amounts] },
			top_voters: { ...DEFAULT_PARTICIPATION, amounts: [...DEFAULT_PARTICIPATION.amounts] }
		},
		suggestTitle: (anchorYmd) => {
			const d = new Date(`${anchorYmd || dateToLocalYmd()}T12:00:00`);
			if (!Number.isFinite(d.getTime())) return 'Monthly challenge';
			return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
		},
		suggestId: (anchorYmd) => suggestChallengeId('monthly', anchorYmd)
	},
	{
		track: 'weekly',
		label: 'Weekly',
		defaultLengthDays: 7,
		defaultAcceptedMedia: [...ACCEPTED_MEDIA_IMAGE_VIDEO],
		defaultPrizes: {
			reward_first: '400 credits',
			reward_second: '200 credits',
			reward_third: '100 credits'
		},
		defaultPrizeStructure: {
			main: { first: 400, second: 200, third: 100 },
			top_submitters: { ...DEFAULT_PARTICIPATION, amounts: [...DEFAULT_PARTICIPATION.amounts] },
			top_voters: { ...DEFAULT_PARTICIPATION, amounts: [...DEFAULT_PARTICIPATION.amounts] }
		},
		suggestTitle: (anchorYmd) => `Week of ${anchorYmd || dateToLocalYmd()}`,
		suggestId: (anchorYmd) => suggestChallengeId('weekly', anchorYmd)
	},
	{
		track: 'suno',
		label: 'Music',
		defaultLengthDays: 7,
		defaultAcceptedMedia: [...ACCEPTED_MEDIA_AUDIO],
		defaultPrizes: {
			reward_first: '400 credits',
			reward_second: '200 credits',
			reward_third: '100 credits'
		},
		defaultPrizeStructure: {
			main: { first: 400, second: 200, third: 100 },
			top_submitters: { ...DEFAULT_PARTICIPATION, amounts: [...DEFAULT_PARTICIPATION.amounts] },
			top_voters: { ...DEFAULT_PARTICIPATION, amounts: [...DEFAULT_PARTICIPATION.amounts] }
		},
		suggestTitle: () => 'Suno challenge',
		suggestId: (anchorYmd) => suggestChallengeId('suno', anchorYmd)
	}
];

/**
 * @param {ChallengeTrack} track
 */
export function getChallengeTrackTemplate(track) {
	const t = normalizeChallengeTrack(track);
	return CHALLENGE_TRACK_TEMPLATES.find((x) => x.track === t) || CHALLENGE_TRACK_TEMPLATES[0];
}

/**
 * @param {unknown} raw
 * @returns {ChallengeAcceptedMedia | ''}
 */
export function normalizeChallengeMediaType(raw) {
	const s = String(raw || '')
		.trim()
		.toLowerCase();
	if (s === 'video' || s === 'audio' || s === 'image') return s;
	return '';
}

/**
 * Creation media type for challenge eligibility (defaults to image).
 * @param {object | null | undefined} meta
 * @returns {ChallengeAcceptedMedia}
 */
export function creationMediaTypeFromMeta(meta) {
	const fromMeta = normalizeChallengeMediaType(meta?.media_type);
	return fromMeta || 'image';
}

/**
 * @param {ChallengeTrack | string} track
 * @returns {ChallengeAcceptedMedia[]}
 */
export function defaultAcceptedMediaForTrack(track) {
	const tpl = getChallengeTrackTemplate(track);
	return Array.isArray(tpl.defaultAcceptedMedia) && tpl.defaultAcceptedMedia.length
		? [...tpl.defaultAcceptedMedia]
		: [...ACCEPTED_MEDIA_IMAGE_VIDEO];
}

/**
 * @param {unknown} raw
 * @returns {ChallengeAcceptedMedia[]}
 */
export function normalizeAcceptedMedia(raw) {
	if (!Array.isArray(raw)) return [];
	/** @type {ChallengeAcceptedMedia[]} */
	const out = [];
	const seen = new Set();
	for (const item of raw) {
		const m = normalizeChallengeMediaType(item);
		if (!m || seen.has(m)) continue;
		seen.add(m);
		out.push(m);
	}
	return out;
}

/**
 * Resolve accepted media for a challenge config (explicit list, else track template default).
 * @param {object | null | undefined} cfg
 * @param {{ track?: ChallengeTrack | string }} [opts]
 * @returns {ChallengeAcceptedMedia[]}
 */
export function resolveChallengeAcceptedMedia(cfg, opts = {}) {
	const explicit = normalizeAcceptedMedia(cfg?.accepted_media);
	if (explicit.length) return explicit;
	const track =
		opts.track != null ? normalizeChallengeTrack(opts.track) : pickChallengeTrack(cfg);
	return defaultAcceptedMediaForTrack(track);
}

/**
 * @param {object | null | undefined} cfg
 * @param {unknown} mediaType
 * @param {{ track?: ChallengeTrack | string }} [opts]
 */
export function challengeAcceptsMediaType(cfg, mediaType, opts = {}) {
	const want = normalizeChallengeMediaType(mediaType) || 'image';
	return resolveChallengeAcceptedMedia(cfg, opts).includes(want);
}

/**
 * Day range for a challenge from merged config.
 * @param {object | null | undefined} cfg
 * @returns {{ start: string, end: string } | null}
 */
export function challengeConfigDayRange(cfg) {
	const startIso = pickChallengeConfigTimestamp(cfg, 'submission_start_at');
	const endIso =
		pickChallengeConfigTimestamp(cfg, 'voting_end_at') ||
		pickChallengeConfigTimestamp(cfg, 'submission_end_at');
	const start = isoToLocalYmd(startIso);
	const end = isoToLocalYmd(endIso);
	if (!start || !end) return null;
	if (compareYmd(start, end) > 0) return { start: end, end: start };
	return { start, end };
}

/**
 * Occupied day ranges for one track (exclude a challenge id when editing).
 * @param {{ challenge_id: string, latest?: object, merged?: object }[]} summaries
 * @param {ChallengeTrack} track
 * @param {string} [excludeChallengeId]
 * @returns {{ challenge_id: string, title: string, start: string, end: string }[]}
 */
export function occupiedRangesForTrack(summaries, track, excludeChallengeId = '') {
	const want = normalizeChallengeTrack(track);
	const exclude = String(excludeChallengeId || '').trim();
	const out = [];
	for (const row of summaries || []) {
		const cid = String(row?.challenge_id || '').trim();
		if (!cid || cid === exclude) continue;
		const cfg = row.merged || row.latest || {};
		if (isChallengeConfigPurged(cfg) || isChallengeConfigSoftDeleted(cfg)) continue;
		if (pickChallengeTrack(cfg) !== want) continue;
		const range = challengeConfigDayRange(cfg);
		if (!range) continue;
		out.push({
			challenge_id: cid,
			title: typeof cfg.title === 'string' ? cfg.title : cid,
			start: range.start,
			end: range.end
		});
	}
	return out;
}

/**
 * @param {{ start: string, end: string }} candidate
 * @param {{ start: string, end: string }[]} occupied
 */
export function rangeConflictsWithOccupied(candidate, occupied) {
	for (const row of occupied || []) {
		if (ymdRangesOverlap(candidate, row)) return row;
	}
	return null;
}

/**
 * Next free start day for a track given preferred start and length.
 * @param {string} preferredStartYmd
 * @param {number} lengthDays
 * @param {{ start: string, end: string }[]} occupied
 * @param {number} [maxScan]
 */
export function findNextFreeRange(preferredStartYmd, lengthDays, occupied, maxScan = 366) {
	const len = Math.max(1, Math.floor(Number(lengthDays) || 1));
	let start = preferredStartYmd || dateToLocalYmd();
	for (let i = 0; i < maxScan; i += 1) {
		const end = addDaysYmd(start, len - 1);
		const conflict = rangeConflictsWithOccupied({ start, end }, occupied);
		if (!conflict) return { start, end };
		start = addDaysYmd(conflict.end, 1);
	}
	const end = addDaysYmd(start, len - 1);
	return { start, end };
}

/**
 * Clamp / snap a user-picked range so it does not overlap occupied same-track days.
 * If the start day is blocked, jump to next free slot of the same length.
 * @param {string} startYmd
 * @param {string} endYmd
 * @param {{ start: string, end: string }[]} occupied
 */
export function snapRangeAwayFromOccupied(startYmd, endYmd, occupied) {
	let start = startYmd;
	let end = endYmd;
	if (!start) return null;
	if (!end || compareYmd(end, start) < 0) end = start;
	const len = daysInclusive(start, end);
	const conflict = rangeConflictsWithOccupied({ start, end }, occupied);
	if (!conflict) return { start, end };
	return findNextFreeRange(addDaysYmd(conflict.end, 1), len, occupied);
}

/**
 * Build submission/voting ISO fields from a day range (voting = same days).
 * @param {string} startYmd
 * @param {string} endYmd
 * @param {(ymd: string) => string} startOfDay
 * @param {(ymd: string) => string} endOfDay
 */
export function timelineIsoFromDayRange(startYmd, endYmd, startOfDay, endOfDay) {
	const subStart = startOfDay(startYmd);
	const subEnd = endOfDay(endYmd);
	return {
		submission_start_at: subStart,
		submission_end_at: subEnd,
		voting_start_at: subStart,
		voting_end_at: subEnd
	};
}
