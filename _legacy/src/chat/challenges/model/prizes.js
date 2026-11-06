import { pickChallengeConfigTimestamp, isChallengeConfigSoftDeleted, isChallengeConfigPurged } from '../challengeAdmin.js';
import {
	normalizeChallengeTrack,
	pickChallengeTrack,
	getChallengeTrackTemplate,
	resolveChallengeAcceptedMedia
} from './tracks.js';

/** @typedef {{ first: number, second: number, third: number }} PrizeMainAmounts */
/** @typedef {{ enabled: boolean, amounts: [number, number, number] }} PrizeParticipationCategory */
/**
 * @typedef {object} ChallengePrizes
 * @property {PrizeMainAmounts} main
 * @property {PrizeParticipationCategory} top_submitters
 * @property {PrizeParticipationCategory} top_voters
 */

/** Default participation amounts when a track has no prior challenge (credits). */
export const DEFAULT_PARTICIPATION_AMOUNTS = /** @type {[number, number, number]} */ ([50, 30, 20]);

/**
 * Parse a credit amount from free-text reward copy or a numeric field.
 * @param {unknown} raw
 * @returns {number | null}
 */
export function parseCreditsAmount(raw) {
	if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
		return Math.floor(raw);
	}
	const s = String(raw ?? '').trim();
	if (!s) return null;
	if (/^\d+$/.test(s)) return Math.floor(Number(s));
	const m = s.match(/(\d[\d,]*)/);
	if (!m) return null;
	const n = Number(String(m[1]).replace(/,/g, ''));
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.floor(n);
}

/**
 * @param {unknown} raw
 * @param {number} [fallback]
 */
function clampCredit(raw, fallback = 0) {
	const n = parseCreditsAmount(raw);
	if (n == null) return Math.max(0, Math.floor(Number(fallback) || 0));
	return Math.max(0, n);
}

/**
 * @param {unknown} raw
 * @param {[number, number, number]} fallback
 * @returns {[number, number, number]}
 */
function normalizeAmounts3(raw, fallback) {
	const fb = /** @type {[number, number, number]} */ ([
		clampCredit(fallback?.[0], 0),
		clampCredit(fallback?.[1], 0),
		clampCredit(fallback?.[2], 0)
	]);
	if (!Array.isArray(raw)) return fb;
	return [
		clampCredit(raw[0], fb[0]),
		clampCredit(raw[1], fb[1]),
		clampCredit(raw[2], fb[2])
	];
}

/**
 * @param {unknown} raw
 * @param {PrizeParticipationCategory} fallback
 * @returns {PrizeParticipationCategory}
 */
function normalizeParticipationCategory(raw, fallback) {
	const base = fallback && typeof fallback === 'object' ? fallback : { enabled: true, amounts: DEFAULT_PARTICIPATION_AMOUNTS };
	const o = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : null;
	const enabled = o ? o.enabled !== false : base.enabled !== false;
	return {
		enabled,
		amounts: normalizeAmounts3(o?.amounts, base.amounts || DEFAULT_PARTICIPATION_AMOUNTS)
	};
}

/**
 * Track preset prize structure (numeric). Free-text display copy stays on `defaultPrizes`.
 * @param {import('./tracks.js').ChallengeTrack | string} track
 * @returns {ChallengePrizes}
 */
export function defaultPrizeStructureForTrack(track) {
	const tpl = getChallengeTrackTemplate(track);
	const main = {
		first: clampCredit(tpl.defaultPrizes?.reward_first, 0),
		second: clampCredit(tpl.defaultPrizes?.reward_second, 0),
		third: clampCredit(tpl.defaultPrizes?.reward_third, 0)
	};
	const fromTpl = tpl.defaultPrizeStructure;
	if (fromTpl && typeof fromTpl === 'object') {
		return normalizePrizesBlock(fromTpl, { fallbackMain: main });
	}
	return {
		main,
		top_submitters: { enabled: true, amounts: [...DEFAULT_PARTICIPATION_AMOUNTS] },
		top_voters: { enabled: true, amounts: [...DEFAULT_PARTICIPATION_AMOUNTS] }
	};
}

/**
 * Normalize a prizes block; fills missing pieces from fallbackMain / participation defaults.
 * @param {unknown} raw
 * @param {{ fallbackMain?: Partial<PrizeMainAmounts> }} [opts]
 * @returns {ChallengePrizes}
 */
export function normalizePrizesBlock(raw, opts = {}) {
	const o = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
	const fb = opts.fallbackMain && typeof opts.fallbackMain === 'object' ? opts.fallbackMain : {};
	const mainRaw = o.main && typeof o.main === 'object' ? /** @type {Record<string, unknown>} */ (o.main) : {};
	const main = {
		first: clampCredit(mainRaw.first, fb.first ?? 0),
		second: clampCredit(mainRaw.second, fb.second ?? 0),
		third: clampCredit(mainRaw.third, fb.third ?? 0)
	};
	return {
		main,
		top_submitters: normalizeParticipationCategory(o.top_submitters, {
			enabled: true,
			amounts: DEFAULT_PARTICIPATION_AMOUNTS
		}),
		top_voters: normalizeParticipationCategory(o.top_voters, {
			enabled: true,
			amounts: DEFAULT_PARTICIPATION_AMOUNTS
		})
	};
}

/**
 * Resolve prizes from config: the `prizes` block is the only source of truth
 * (legacy reward_* was migrated by db/maintenance/migrate-challenge-prizes.js).
 * Missing block → track presets (fresh create form).
 * @param {object | null | undefined} cfg
 * @param {{ track?: string }} [opts]
 * @returns {ChallengePrizes}
 */
export function resolveChallengePrizes(cfg, opts = {}) {
	const track = opts.track != null ? opts.track : pickChallengeTrack(cfg);
	const preset = defaultPrizeStructureForTrack(track);
	if (challengeConfigHasPrizesBlock(cfg)) {
		return normalizePrizesBlock(cfg.prizes, { fallbackMain: preset.main });
	}
	return {
		main: { ...preset.main },
		top_submitters: { ...preset.top_submitters, amounts: [...preset.top_submitters.amounts] },
		top_voters: { ...preset.top_voters, amounts: [...preset.top_voters.amounts] }
	};
}

/**
 * @param {ChallengePrizes | null | undefined} prizes
 */
export function challengePrizesParticipationEnabled(prizes) {
	if (!prizes || typeof prizes !== 'object') return false;
	return Boolean(prizes.top_submitters?.enabled || prizes.top_voters?.enabled);
}

/**
 * Whether config carries the structured prizes block (v2 model).
 * @param {object | null | undefined} cfg
 */
export function challengeConfigHasPrizesBlock(cfg) {
	return Boolean(cfg && typeof cfg === 'object' && cfg.prizes && typeof cfg.prizes === 'object');
}

/**
 * Display copy for a credit amount, e.g. `400 credits`.
 * @param {number} amount
 */
export function formatCreditsLabel(amount) {
	const n = Math.max(0, Math.floor(Number(amount) || 0));
	return `${n} credits`;
}

/**
 * Advertised credit pool: main placements only. Participation amounts stay
 * hidden until results, so they are excluded from public totals (feed card).
 * @param {ChallengePrizes | null | undefined} prizes
 * @returns {number | null} null when the pool is empty
 */
export function totalPrizeCredits(prizes) {
	if (!prizes || typeof prizes !== 'object') return null;
	let sum = 0;
	const main = prizes.main || {};
	sum += Math.max(0, Math.floor(Number(main.first) || 0));
	sum += Math.max(0, Math.floor(Number(main.second) || 0));
	sum += Math.max(0, Math.floor(Number(main.third) || 0));
	return sum > 0 ? sum : null;
}

/**
 * Most recent non-deleted same-track config by submission start date.
 * @param {{ challenge_id: string, merged?: object, latest?: object }[]} summaries
 * @param {string} track
 * @param {string} [excludeChallengeId]
 * @returns {object | null} merged config
 */
export function findLatestSameTrackConfigByStart(summaries, track, excludeChallengeId = '') {
	const want = normalizeChallengeTrack(track);
	const exclude = String(excludeChallengeId || '').trim();
	/** @type {{ cfg: object, startMs: number }[]} */
	const rows = [];
	for (const row of summaries || []) {
		const cid = String(row?.challenge_id || '').trim();
		if (!cid || cid === exclude) continue;
		const cfg = row.merged || row.latest || null;
		if (!cfg || typeof cfg !== 'object') continue;
		if (isChallengeConfigPurged(cfg) || isChallengeConfigSoftDeleted(cfg)) continue;
		if (pickChallengeTrack(cfg) !== want) continue;
		const startIso = pickChallengeConfigTimestamp(cfg, 'submission_start_at');
		const startMs = startIso ? Date.parse(startIso) : NaN;
		if (!Number.isFinite(startMs)) continue;
		rows.push({ cfg, startMs });
	}
	if (!rows.length) return null;
	rows.sort((a, b) => b.startMs - a.startMs || 0);
	return rows[0].cfg;
}

/**
 * Prefills for create: inherit from latest same-track by start date, else track presets.
 * Free text is deprecated except `reward_custom` (sponsor perks etc.).
 * @param {string} track
 * @param {{ challenge_id: string, merged?: object, latest?: object }[]} summaries
 * @returns {{ rewardFields: Record<string, string>, prizeStructure: ChallengePrizes }}
 */
export function resolveCreatePrizePrefills(track, summaries) {
	const inherited = findLatestSameTrackConfigByStart(summaries, track);
	if (inherited) {
		return {
			rewardFields: {
				reward_custom:
					inherited.reward_custom != null ? String(inherited.reward_custom).trim() : ''
			},
			prizeStructure: resolveChallengePrizes(inherited, { track })
		};
	}
	return {
		rewardFields: { reward_custom: '' },
		prizeStructure: defaultPrizeStructureForTrack(track)
	};
}

/**
 * Prefill `accepted_media` for create: inherit from latest same-track by start date, else template.
 * @param {string} track
 * @param {{ challenge_id: string, merged?: object, latest?: object }[]} summaries
 * @returns {import('./tracks.js').ChallengeAcceptedMedia[]}
 */
export function resolveCreateAcceptedMedia(track, summaries) {
	const inherited = findLatestSameTrackConfigByStart(summaries, track);
	return resolveChallengeAcceptedMedia(inherited || { track }, { track });
}

/**
 * Read structured prizes from organizer form FormData.
 * @param {FormData} fd
 * @returns {ChallengePrizes}
 */
export function readPrizesFromFormData(fd) {
	const getNum = (name, fallback = 0) => clampCredit(fd.get(name), fallback);
	const enabled = (name) => {
		const v = fd.get(name);
		return v === '1' || v === 'on' || v === 'true';
	};
	return normalizePrizesBlock({
		main: {
			first: getNum('prize_main_first'),
			second: getNum('prize_main_second'),
			third: getNum('prize_main_third')
		},
		top_submitters: {
			enabled: enabled('prize_top_submitters_enabled'),
			amounts: [
				getNum('prize_top_submitters_0'),
				getNum('prize_top_submitters_1'),
				getNum('prize_top_submitters_2')
			]
		},
		top_voters: {
			enabled: enabled('prize_top_voters_enabled'),
			amounts: [
				getNum('prize_top_voters_0'),
				getNum('prize_top_voters_1'),
				getNum('prize_top_voters_2')
			]
		}
	});
}
