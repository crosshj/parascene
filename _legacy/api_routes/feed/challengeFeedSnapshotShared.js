import { getSupabaseServiceClient } from '../utils/supabaseService.js';
import {
	findChallengesChannelThreadId,
	fetchThreadMessagesChronological,
	tryParseChallengeJsonBody
} from '../utils/challengeSubmitShared.js';
import { deriveChallengePhase } from '../../src/chat/challenges/model/phases.js';
import {
	listActiveParticipantConfigs,
	pickParticipantFocusConfig,
	ACTIVE_PARTICIPANT_PHASES
} from '../../src/chat/challenges/model/participantSlice.js';
import {
	mergeFullChallengeConfigForChallenge,
	pickChallengeConfigTimestamp,
	pickChallengeHeroImageUrl,
	sanitizeChallengeHeroImageUrl,
	isChallengeListedForUpcoming
} from '../../src/chat/challenges/challengeAdmin.js';
import { summarizeLatestChallengeConfigs } from '../../src/chat/challenges/model/organizerSummaries.js';
import {
	challengeConfigHasPrizesBlock,
	formatCreditsLabel,
	resolveChallengePrizes,
	totalPrizeCredits
} from '../../src/chat/challenges/model/prizes.js';
import { pickChallengeTrack, challengeTrackListRank } from '../../src/chat/challenges/model/tracks.js';
import { CHALLENGE_SCORE_REACTION_KEYS } from '../../src/chat/challenges/constants.js';
import { appendCreationIdToMediaUrl, getThumbnailUrl } from '../utils/url.js';
import { verifyShareToken } from '../utils/shareLink.js';

/** Phases where we still promote the challenge on the home/chat feed */
const INACTIVE_FEED_PHASES = new Set(['empty', 'unknown']);

function computeHighlightDeadlineMs(cfg, phase, nowMs) {
	if (!cfg || typeof cfg !== 'object') return null;
	if (phase === 'between') return null;

	const subEndStr = pickChallengeConfigTimestamp(cfg, 'submission_end_at');
	const voteEndStr = pickChallengeConfigTimestamp(cfg, 'voting_end_at');
	const subEnd = subEndStr ? Date.parse(subEndStr) : NaN;
	const voteEnd = voteEndStr ? Date.parse(voteEndStr) : NaN;
	const subOk = Number.isFinite(subEnd);
	const voteOk = Number.isFinite(voteEnd);

	if (phase === 'pre_submit' || phase === 'submitting') {
		if (subOk && subEnd > nowMs) return subEnd;
		return null;
	}
	if (phase === 'submit_and_vote') {
		const candidates = [];
		if (subOk && subEnd > nowMs) candidates.push(subEnd);
		if (voteOk && voteEnd > nowMs) candidates.push(voteEnd);
		return candidates.length ? Math.min(...candidates) : null;
	}
	if (phase === 'voting') {
		if (voteOk && voteEnd > nowMs) return voteEnd;
		return null;
	}
	return null;
}

export function viewerHasChallengeScoreReaction(reactions, viewerUserId) {
	if (!reactions || typeof reactions !== 'object' || Array.isArray(reactions)) return false;
	for (const key of CHALLENGE_SCORE_REACTION_KEYS) {
		const arr = Array.isArray(reactions[key]) ? reactions[key] : [];
		if (arr.some((x) => Number(x) === viewerUserId)) return true;
	}
	return false;
}

async function resolveChallengeHeroImageUrl({ queries, cfg, latestSubmissionImageId }) {
	const heroRef = pickChallengeHeroImageUrl(cfg);
	const heroRefTrimmed = typeof heroRef === 'string' ? heroRef.trim() : '';

	const parseCreationIdFromRef = (raw) => {
		const s = typeof raw === 'string' ? raw.trim() : '';
		if (!s) return NaN;

		const fromPlainPath = (text) => {
			const m1 = text.match(/\/creations\/(\d+)(?:\D|$)/i);
			if (m1) return Number(m1[1]);
			const m2 = text.match(/\/(?:api\/)?create\/images\/(\d+)(?:\D|$)/i);
			if (m2) return Number(m2[1]);
			return NaN;
		};

		const plain = fromPlainPath(s);
		if (Number.isFinite(plain) && plain > 0) return plain;

		try {
			const u = new URL(s, 'https://www.parascene.com');
			const path = `${u.pathname || ''}${u.search || ''}`;
			const fromUrlPath = fromPlainPath(path);
			if (Number.isFinite(fromUrlPath) && fromUrlPath > 0) return fromUrlPath;

			const sm = (u.pathname || '').match(/^\/s\/([^/]+)\/([^/]+)\/[^/]+\/?$/i);
			if (!sm) return NaN;
			const verified = verifyShareToken({ version: sm[1], token: sm[2] });
			if (!verified || !verified.ok) return NaN;
			const id = Number(verified.imageId);
			return Number.isFinite(id) && id > 0 ? id : NaN;
		} catch {
			return NaN;
		}
	};

	const candidates = [];
	const fromRef = parseCreationIdFromRef(heroRef);
	if (Number.isFinite(fromRef) && fromRef > 0) candidates.push(fromRef);
	if (Number.isFinite(latestSubmissionImageId) && latestSubmissionImageId > 0) {
		candidates.push(latestSubmissionImageId);
	}

	const getAny = queries?.selectCreatedImageByIdAnyUser?.get;
	if (typeof getAny !== 'function') return '';

	const isLikelyDirectMediaUrl = (raw) => {
		const s = typeof raw === 'string' ? raw.trim() : '';
		if (!s) return false;
		if (s.startsWith('/api/images/')) return true;
		if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(s)) return true;
		if (s.startsWith('http://') || s.startsWith('https://')) {
			try {
				const u = new URL(s);
				const path = `${u.pathname || ''}${u.search || ''}`;
				if (/\/creations\/\d+/i.test(path)) return false;
				return /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(path) || path.startsWith('/api/images/');
			} catch {
				return false;
			}
		}
		return false;
	};

	for (const id of candidates) {
		try {
			const row = await getAny(id);
			if (!row) continue;
			const rawFilePath = typeof row.file_path === 'string' ? row.file_path.trim() : '';
			const rawFilename = typeof row.filename === 'string' ? row.filename.trim() : '';
			const imageUrlFromRow = rawFilePath || (rawFilename ? `/api/images/created/${rawFilename}` : '');
			const normalizedImageUrl = appendCreationIdToMediaUrl(imageUrlFromRow, id);
			const fromDerivedThumb = normalizedImageUrl ? getThumbnailUrl(normalizedImageUrl) : '';
			const fromThumb = typeof row.thumbnail_url === 'string' ? row.thumbnail_url.trim() : '';
			const fromUrl = typeof row.url === 'string' ? row.url.trim() : '';
			const fromVideoThumb =
				typeof row.video_thumbnail_url === 'string' ? row.video_thumbnail_url.trim() : '';
			const picked =
				fromThumb ||
				fromDerivedThumb ||
				fromVideoThumb ||
				(isLikelyDirectMediaUrl(fromUrl) ? fromUrl : '') ||
				normalizedImageUrl;
			if (picked) return picked;
		} catch {
			// ignore
		}
	}

	const direct = sanitizeChallengeHeroImageUrl(heroRefTrimmed);
	if (direct) return direct;
	return '';
}

/**
 * Top prize copy + total credit pool from the structured `prizes` block.
 * Legacy free-text reward_* was migrated (db/maintenance/migrate-challenge-prizes.js).
 */
function prizeSummaryFromCfg(cfg) {
	if (!challengeConfigHasPrizesBlock(cfg)) {
		return { topPrize: null, totalRewardCredits: null };
	}
	const prizes = resolveChallengePrizes(cfg);
	return {
		topPrize: prizes.main.first > 0 ? formatCreditsLabel(prizes.main.first) : null,
		totalRewardCredits: totalPrizeCredits(prizes)
	};
}

function phaseSubtitle(phase) {
	switch (phase) {
		case 'pre_submit':
			return 'Starts soon';
		case 'submitting':
			return 'Submissions open';
		case 'submit_and_vote':
			return 'Submit and vote';
		case 'voting':
			return 'Voting open';
		case 'between':
			return 'Between rounds';
		case 'finalizing':
			return 'Finalizing';
		case 'results':
			return 'Winners announced';
		default:
			return 'Community challenge';
	}
}

function parseChallengeStartMs(cfg) {
	const start = pickChallengeConfigTimestamp(cfg, 'submission_start_at');
	const ms = Date.parse(String(start || '').trim());
	return Number.isFinite(ms) ? ms : null;
}

function parseChallengeVotingEndMs(cfg) {
	const end = pickChallengeConfigTimestamp(cfg, 'voting_end_at');
	const ms = Date.parse(String(end || '').trim());
	return Number.isFinite(ms) ? ms : null;
}

function collectChallengeConfigEntries(messages) {
	const configs = [];
	for (const m of messages) {
		const payload = tryParseChallengeJsonBody(m?.body);
		if (!payload || String(payload.kind || '').trim() !== 'challenge_config') continue;
		configs.push({ msg: m, payload });
	}
	return configs;
}

function mergedChallengePayload(configEntries, challengeId) {
	return mergeFullChallengeConfigForChallenge(configEntries, challengeId);
}

/**
 * Feed focus: listed upcoming (pre_submit) first, else active participant challenge,
 * else latest non-draft public challenge. Unlisted drafts never become feed focus.
 *
 * @param {{ msg: object, payload: object }[]} configEntries
 * @param {number} nowMs
 */
export function pickFeedFocusChallengeSummary(configEntries, nowMs) {
	const summaries = summarizeLatestChallengeConfigs(configEntries).map((row) => {
		const cid = String(row?.challenge_id || '').trim();
		return {
			...row,
			effectivePayload: mergedChallengePayload(configEntries, cid)
		};
	});

	const upcoming = summaries.filter((row) => {
		const phase = deriveChallengePhase(row.effectivePayload, nowMs);
		return phase === 'pre_submit' && isChallengeListedForUpcoming(row.effectivePayload);
	});
	if (upcoming.length) {
		upcoming.sort((a, b) => {
			const aStart = parseChallengeStartMs(a.effectivePayload);
			const bStart = parseChallengeStartMs(b.effectivePayload);
			if (aStart == null && bStart == null) return b.sortKey - a.sortKey;
			if (aStart == null) return 1;
			if (bStart == null) return -1;
			return aStart - bStart;
		});
		return upcoming[0];
	}

	const { latestConfig } = pickParticipantFocusConfig(configEntries, nowMs);
	const focusId =
		latestConfig?.challenge_id != null ? String(latestConfig.challenge_id).trim() : '';
	if (focusId) {
		const match = summaries.find((row) => String(row.challenge_id || '').trim() === focusId);
		if (match) {
			return { ...match, effectivePayload: latestConfig };
		}
		return {
			challenge_id: focusId,
			title: typeof latestConfig.title === 'string' ? latestConfig.title : '',
			effectivePayload: latestConfig,
			sortKey: 0
		};
	}

	const publicFallback = summaries.filter((row) => {
		const phase = deriveChallengePhase(row.effectivePayload, nowMs);
		if (phase === 'deleted' || phase === 'purged') return false;
		if (phase === 'pre_submit') return isChallengeListedForUpcoming(row.effectivePayload);
		return true;
	});
	return publicFallback.sort((a, b) => b.sortKey - a.sortKey)[0] || null;
}

/**
 * Multi-track feed board: all active challenges + soonest listed upcoming per track
 * that does not already have an active row. Cap 6.
 *
 * @param {{ msg: object, payload: object }[]} configEntries
 * @param {number} nowMs
 * @returns {{
 *   challengeId: string,
 *   title: string,
 *   track: string,
 *   phase: string,
 *   sortKey: number,
 *   endMs: number,
 *   startMs: number | null,
 *   effectivePayload: object
 * }[]}
 */
export function listChallengeFeedBoardSummaries(configEntries, nowMs) {
	const active = listActiveParticipantConfigs(configEntries, nowMs).map((row) => ({
		challengeId: row.challengeId,
		title:
			typeof row.payload?.title === 'string' && row.payload.title.trim()
				? row.payload.title.trim()
				: 'Challenge',
		track: pickChallengeTrack(row.payload),
		phase: row.phase,
		sortKey: row.sortKey,
		endMs: row.endMs,
		startMs: parseChallengeStartMs(row.payload),
		effectivePayload: row.payload
	}));

	const activeIds = new Set(active.map((r) => r.challengeId));
	const tracksWithActive = new Set(active.map((r) => r.track));

	const summaries = summarizeLatestChallengeConfigs(configEntries).map((row) => {
		const cid = String(row?.challenge_id || '').trim();
		return {
			...row,
			effectivePayload: mergedChallengePayload(configEntries, cid)
		};
	});

	/** @type {typeof active} */
	const upcoming = [];
	for (const row of summaries) {
		const cid = String(row?.challenge_id || '').trim();
		if (!cid || activeIds.has(cid)) continue;
		const phase = deriveChallengePhase(row.effectivePayload, nowMs);
		if (phase !== 'pre_submit') continue;
		if (!isChallengeListedForUpcoming(row.effectivePayload)) continue;
		const track = pickChallengeTrack(row.effectivePayload);
		if (tracksWithActive.has(track)) continue;
		const startMs = parseChallengeStartMs(row.effectivePayload);
		upcoming.push({
			challengeId: cid,
			title:
				typeof row.effectivePayload?.title === 'string' && row.effectivePayload.title.trim()
					? row.effectivePayload.title.trim()
					: typeof row.title === 'string' && row.title.trim()
						? row.title.trim()
						: 'Upcoming challenge',
			track,
			phase,
			sortKey: row.sortKey,
			endMs:
				parseChallengeVotingEndMs(row.effectivePayload) ??
				parseChallengeStartMs(row.effectivePayload) ??
				Number.POSITIVE_INFINITY,
			startMs,
			effectivePayload: row.effectivePayload
		});
	}

	upcoming.sort((a, b) => {
		if (a.startMs == null && b.startMs == null) return b.sortKey - a.sortKey;
		if (a.startMs == null) return 1;
		if (b.startMs == null) return -1;
		if (a.startMs !== b.startMs) return a.startMs - b.startMs;
		return b.sortKey - a.sortKey;
	});

	/** One upcoming per track without an active challenge. */
	const upcomingByTrack = new Map();
	for (const row of upcoming) {
		if (upcomingByTrack.has(row.track)) continue;
		upcomingByTrack.set(row.track, row);
	}

	const board = [...active, ...upcomingByTrack.values()]
		.sort((a, b) => {
			const ta = challengeTrackListRank(a.track);
			const tb = challengeTrackListRank(b.track);
			if (ta !== tb) return ta - tb;
			const aActive = ACTIVE_PARTICIPANT_PHASES.has(a.phase);
			const bActive = ACTIVE_PARTICIPANT_PHASES.has(b.phase);
			if (aActive !== bActive) return aActive ? -1 : 1;
			if (a.endMs !== b.endMs) return a.endMs - b.endMs;
			return b.sortKey - a.sortKey;
		})
		.slice(0, 6);
	return board;
}

/**
 * Pick the round immediately before the feed focus challenge (sync; testable).
 *
 * @param {{ msg: object, payload: object }[]} configEntries
 * @param {number} nowMs
 * @param {string} [focusChallengeId]
 */
export function pickChallengeFeedPreviousSummary(configEntries, nowMs, focusChallengeId = '') {
	const excludeId = String(focusChallengeId || '').trim();
	const summaries = summarizeLatestChallengeConfigs(configEntries)
		.map((row) => {
			const cid = String(row?.challenge_id || '').trim();
			return {
				...row,
				effectivePayload: mergedChallengePayload(configEntries, cid)
			};
		})
		.filter((row) => {
			const cid = String(row?.challenge_id || '').trim();
			if (!cid || cid === excludeId) return false;
			const phase = deriveChallengePhase(row.effectivePayload, nowMs);
			return phase !== 'pre_submit';
		})
		.sort((a, b) => {
			const aEnd = parseChallengeVotingEndMs(a.effectivePayload);
			const bEnd = parseChallengeVotingEndMs(b.effectivePayload);
			if (aEnd == null && bEnd == null) return b.sortKey - a.sortKey;
			if (aEnd == null) return 1;
			if (bEnd == null) return -1;
			return bEnd - aEnd;
		});
	return summaries[0] || null;
}

/**
 * Pick the next upcoming challenge for feed "Next" (sync; testable).
 * Only listed (public) pre_submit challenges — drafts stay Organize-only.
 *
 * @param {{ msg: object, payload: object }[]} configEntries
 * @param {number} nowMs
 * @param {string} [currentChallengeId]
 */
export function pickChallengeFeedNextSummary(configEntries, nowMs, currentChallengeId = '') {
	const excludeId = String(currentChallengeId || '').trim();
	const summaries = summarizeLatestChallengeConfigs(configEntries)
		.map((row) => {
			const cid = String(row?.challenge_id || '').trim();
			return {
				...row,
				effectivePayload: mergedChallengePayload(configEntries, cid)
			};
		})
		.filter((row) => {
			const cid = String(row?.challenge_id || '').trim();
			if (!cid || cid === excludeId) return false;
			const phase = deriveChallengePhase(row.effectivePayload, nowMs);
			return phase === 'pre_submit' && isChallengeListedForUpcoming(row.effectivePayload);
		})
		.sort((a, b) => {
			const aStart = parseChallengeStartMs(a.effectivePayload);
			const bStart = parseChallengeStartMs(b.effectivePayload);
			if (aStart == null && bStart == null) return b.sortKey - a.sortKey;
			if (aStart == null) return 1;
			if (bStart == null) return -1;
			return aStart - bStart;
		});
	return summaries[0] || null;
}

async function resolveNextChallengeSnapshot(messages, nowMs, queries, currentChallengeId = '') {
	const configs = collectChallengeConfigEntries(messages);
	const next = pickChallengeFeedNextSummary(configs, nowMs, currentChallengeId);
	if (!next) return null;

	const effectivePayload = next.effectivePayload;
	const nextTitle =
		typeof effectivePayload?.title === 'string' && effectivePayload.title.trim()
			? effectivePayload.title.trim()
			: 'Upcoming challenge';
	const nextStartMs = parseChallengeStartMs(effectivePayload);
	const nextEnd = pickChallengeConfigTimestamp(effectivePayload, 'voting_end_at');
	const nextHeroImageUrl = await resolveChallengeHeroImageUrl({
		queries,
		cfg: effectivePayload,
		latestSubmissionImageId: NaN
	});

	return {
		challengeId: String(next.challenge_id || '').trim(),
		title: nextTitle,
		phase: 'pre_submit',
		phaseSubtitle: phaseSubtitle('pre_submit'),
		submissionStartAt: nextStartMs != null ? new Date(nextStartMs).toISOString() : '',
		votingEndAt: typeof nextEnd === 'string' ? nextEnd : '',
		heroImageUrl: nextHeroImageUrl || '',
		heroImageRef: pickChallengeHeroImageUrl(effectivePayload) || ''
	};
}

async function resolvePreviousChallengeSnapshot(messages, nowMs, queries, currentChallengeId = '') {
	const configs = collectChallengeConfigEntries(messages);
	const prev = pickChallengeFeedPreviousSummary(configs, nowMs, currentChallengeId);
	if (!prev) return null;

	const effectivePayload = prev.effectivePayload;
	const prevPhase = deriveChallengePhase(effectivePayload, nowMs);
	const prevTitle =
		typeof effectivePayload?.title === 'string' && effectivePayload.title.trim()
			? effectivePayload.title.trim()
			: 'Previous challenge';
	const prevStart = pickChallengeConfigTimestamp(effectivePayload, 'submission_start_at');
	const prevEnd = pickChallengeConfigTimestamp(effectivePayload, 'voting_end_at');
	const prevHeroImageUrl = await resolveChallengeHeroImageUrl({
		queries,
		cfg: effectivePayload,
		latestSubmissionImageId: NaN
	});

	return {
		challengeId: String(prev.challenge_id || '').trim(),
		title: prevTitle,
		phase: prevPhase,
		phaseSubtitle: phaseSubtitle(prevPhase),
		submissionStartAt: typeof prevStart === 'string' ? prevStart : '',
		votingEndAt: typeof prevEnd === 'string' ? prevEnd : '',
		heroImageUrl: prevHeroImageUrl || '',
		heroImageRef: pickChallengeHeroImageUrl(effectivePayload) || ''
	};
}

/**
 * Expensive shared snapshot (no viewer-specific fields). Cached in Redis.
 *
 * @param {{ queries?: object }} opts
 */
export async function buildChallengeFeedSnapshotShared(opts = {}) {
	const queries = opts?.queries;
	const sb = getSupabaseServiceClient();
	if (!sb) {
		return { version: 1, ok: false, reason: 'no_supabase' };
	}

	try {
		const tid = await findChallengesChannelThreadId(sb);
		if (!tid) {
			return { version: 1, ok: false, reason: 'no_challenges_thread' };
		}

		const messages = await fetchThreadMessagesChronological(sb, tid);
		const configEntries = collectChallengeConfigEntries(messages);
		const nowMs = Date.now();
		let boardSummaries = listChallengeFeedBoardSummaries(configEntries, nowMs);
		const focus = pickFeedFocusChallengeSummary(configEntries, nowMs);
		if (
			!boardSummaries.length &&
			focus?.challenge_id &&
			focus?.effectivePayload
		) {
			const cid = String(focus.challenge_id).trim();
			const payload = focus.effectivePayload;
			const phase = deriveChallengePhase(payload, nowMs);
			boardSummaries = [
				{
					challengeId: cid,
					title:
						typeof payload?.title === 'string' && payload.title.trim()
							? payload.title.trim()
							: 'Challenge',
					track: pickChallengeTrack(payload),
					phase,
					sortKey: 0,
					endMs:
						parseChallengeVotingEndMs(payload) ??
						parseChallengeStartMs(payload) ??
						Number.POSITIVE_INFINITY,
					startMs: parseChallengeStartMs(payload),
					effectivePayload: payload
				}
			];
		}
		const challengeId = boardSummaries[0]?.challengeId || '';
		const focusPayload = boardSummaries[0]?.effectivePayload || null;

		if (!challengeId || !focusPayload) {
			return {
				version: 2,
				ok: true,
				active: false,
				boardRows: [],
				boardSubmissions: {},
				built_at: new Date().toISOString()
			};
		}

		const boardIds = new Set(boardSummaries.map((r) => r.challengeId));
		/** @type {Record<string, { sender_id: number|null, created_at: string|null, created_image_id: number|null, reactions: object|null }[]>} */
		const boardSubmissions = {};
		for (const id of boardIds) boardSubmissions[id] = [];

		for (const m of messages) {
			const p = tryParseChallengeJsonBody(m?.body);
			if (!p || String(p.kind || '').trim() !== 'challenge_submission') continue;
			const pc = p.challenge_id != null ? String(p.challenge_id).trim() : '';
			if (!pc || !boardIds.has(pc)) continue;

			const sid = m.sender_id != null ? Number(m.sender_id) : NaN;
			boardSubmissions[pc].push({
				sender_id: Number.isFinite(sid) && sid > 0 ? sid : null,
				created_at: m?.created_at != null ? String(m.created_at) : null,
				created_image_id:
					p.created_image_id != null && Number.isFinite(Number(p.created_image_id))
						? Number(p.created_image_id)
						: null,
				reactions: m?.reactions && typeof m.reactions === 'object' ? m.reactions : null
			});
		}

		/** @type {object[]} */
		const boardRows = [];
		for (const row of boardSummaries) {
			const cid = row.challengeId;
			const cfg = row.effectivePayload;
			const subs = boardSubmissions[cid] || [];
			const submitters = new Set();
			let latestSubmissionMs = null;
			let recentSubmissionCount24h = 0;
			let latestSubmissionImageId = NaN;
			for (const sub of subs) {
				const sid = sub.sender_id != null ? Number(sub.sender_id) : NaN;
				if (Number.isFinite(sid) && sid > 0) submitters.add(sid);
				const createdMs = sub.created_at ? Date.parse(String(sub.created_at)) : NaN;
				if (!Number.isFinite(createdMs)) continue;
				if (latestSubmissionMs == null || createdMs > latestSubmissionMs) {
					latestSubmissionMs = createdMs;
					const imageId =
						sub.created_image_id != null ? Number(sub.created_image_id) : NaN;
					latestSubmissionImageId =
						Number.isFinite(imageId) && imageId > 0 ? imageId : NaN;
				}
				if (nowMs - createdMs >= 0 && nowMs - createdMs <= 24 * 60 * 60 * 1000) {
					recentSubmissionCount24h += 1;
				}
			}
			const { topPrize, totalRewardCredits } = prizeSummaryFromCfg(cfg);
			const submissionStartAt = pickChallengeConfigTimestamp(cfg, 'submission_start_at');
			const submissionEndAt = pickChallengeConfigTimestamp(cfg, 'submission_end_at');
			const votingEndAt = pickChallengeConfigTimestamp(cfg, 'voting_end_at');
			const heroImageUrl = await resolveChallengeHeroImageUrl({
				queries,
				cfg,
				latestSubmissionImageId
			});
			boardRows.push({
				challengeId: cid,
				title: row.title,
				track: row.track,
				phase: row.phase,
				phaseSubtitle: phaseSubtitle(row.phase),
				submissionCount: subs.length,
				uniqueSubmitters: submitters.size,
				topPrize,
				totalRewardCredits,
				submissionStartAt: typeof submissionStartAt === 'string' ? submissionStartAt : '',
				submissionEndAt: typeof submissionEndAt === 'string' ? submissionEndAt : '',
				votingEndAt: typeof votingEndAt === 'string' ? votingEndAt : '',
				latestSubmissionMs,
				recentSubmissionCount24h,
				heroImageUrl: heroImageUrl || '',
				heroImageRef: pickChallengeHeroImageUrl(cfg) || ''
			});
		}

		const primary = boardRows[0];
		const effectiveCfg = boardSummaries[0].effectivePayload;
		const phase = primary?.phase || deriveChallengePhase(effectiveCfg, nowMs);
		const active =
			boardRows.some((r) => ACTIVE_PARTICIPANT_PHASES.has(r.phase)) ||
			!INACTIVE_FEED_PHASES.has(phase);

		const nextChallenge = await resolveNextChallengeSnapshot(
			messages,
			nowMs,
			queries,
			challengeId
		);
		const previousChallenge = await resolvePreviousChallengeSnapshot(
			messages,
			nowMs,
			queries,
			challengeId
		);

		return {
			version: 2,
			ok: true,
			built_at: new Date().toISOString(),
			active,
			phase,
			challengeId,
			title: primary?.title || 'Challenge',
			cfg: effectiveCfg,
			submissionCount: primary?.submissionCount ?? 0,
			uniqueSubmitters: primary?.uniqueSubmitters ?? 0,
			topPrize: primary?.topPrize ?? null,
			submissionStartAt: primary?.submissionStartAt || '',
			latestSubmissionMs: primary?.latestSubmissionMs ?? null,
			recentSubmissionCount24h: primary?.recentSubmissionCount24h ?? 0,
			heroImageUrl: primary?.heroImageUrl || '',
			heroImageRef: primary?.heroImageRef || '',
			totalRewardCredits: primary?.totalRewardCredits ?? null,
			nextChallenge,
			previousChallenge,
			submissions: boardSubmissions[challengeId] || [],
			boardRows,
			boardSubmissions
		};
	} catch (err) {
		console.warn('[feed] buildChallengeFeedSnapshotShared', err?.message || err);
		return { version: 1, ok: false, reason: 'error' };
	}
}

/**
 * Apply viewer-specific fields from cached shared snapshot (in-memory, no DB).
 *
 * @param {object|null|undefined} shared
 * @param {number|null|undefined} viewerUserId
 */
export function applyChallengeViewerOverlay(shared, viewerUserId) {
	if (!shared || shared.ok !== true) {
		return shared?.ok === false
			? { ok: false, reason: shared.reason || 'error' }
			: { ok: false, reason: 'cache_miss' };
	}

	if (shared.active === false && !shared.challengeId && !Array.isArray(shared.boardRows)) {
		return { ok: true, active: false, boardRows: [] };
	}

	const viewerIdOk = Number.isFinite(Number(viewerUserId)) && Number(viewerUserId) > 0;
	const uid = viewerIdOk ? Number(viewerUserId) : NaN;
	const nowMs = Date.now();
	const cfg = shared.cfg;
	const phase = cfg ? deriveChallengePhase(cfg, nowMs) : shared.phase;
	const active = Array.isArray(shared.boardRows)
		? shared.boardRows.length > 0
		: cfg
			? !INACTIVE_FEED_PHASES.has(phase)
			: shared.active === true;

	let viewerHasEntered = false;
	let unvotedEntries = 0;
	for (const row of Array.isArray(shared.submissions) ? shared.submissions : []) {
		const sid = row?.sender_id != null ? Number(row.sender_id) : NaN;
		if (viewerIdOk && sid === uid) viewerHasEntered = true;
		if (viewerIdOk && sid !== uid && !viewerHasChallengeScoreReaction(row?.reactions, uid)) {
			unvotedEntries += 1;
		}
	}

	const boardSubs =
		shared.boardSubmissions && typeof shared.boardSubmissions === 'object'
			? shared.boardSubmissions
			: {};
	const boardRowsRaw = Array.isArray(shared.boardRows) ? shared.boardRows : [];
	const boardRows = boardRowsRaw.map((row) => {
		const cid = String(row?.challengeId || '').trim();
		const subs = Array.isArray(boardSubs[cid]) ? boardSubs[cid] : [];
		let entered = false;
		let unvoted = 0;
		for (const sub of subs) {
			const sid = sub?.sender_id != null ? Number(sub.sender_id) : NaN;
			if (viewerIdOk && sid === uid) entered = true;
			if (
				viewerIdOk &&
				sid !== uid &&
				!viewerHasChallengeScoreReaction(sub?.reactions, uid)
			) {
				unvoted += 1;
			}
		}
		const rowPhase = typeof row?.phase === 'string' ? row.phase : '';
		const rowCfg = {
			submission_start_at: row?.submissionStartAt,
			submission_end_at: row?.submissionEndAt,
			voting_end_at: row?.votingEndAt
		};
		return {
			challengeId: cid,
			title: typeof row?.title === 'string' ? row.title : 'Challenge',
			track: typeof row?.track === 'string' ? row.track : 'monthly',
			phase: rowPhase,
			phaseSubtitle:
				typeof row?.phaseSubtitle === 'string' && row.phaseSubtitle.trim()
					? row.phaseSubtitle
					: phaseSubtitle(rowPhase),
			submissionCount: Number(row?.submissionCount) || 0,
			uniqueSubmitters: Number(row?.uniqueSubmitters) || 0,
			topPrize: row?.topPrize ?? null,
			totalRewardCredits: row?.totalRewardCredits ?? null,
			submissionStartAt: typeof row?.submissionStartAt === 'string' ? row.submissionStartAt : '',
			highlightDeadlineMs: computeHighlightDeadlineMs(rowCfg, rowPhase, nowMs),
			viewerHasEntered: entered,
			hasUnvotedEntries: viewerIdOk ? unvoted > 0 : (Number(row?.submissionCount) || 0) > 0,
			recentSubmissionCount24h: Number(row?.recentSubmissionCount24h) || 0,
			heroImageUrl: typeof row?.heroImageUrl === 'string' ? row.heroImageUrl : '',
			heroImageRef: typeof row?.heroImageRef === 'string' ? row.heroImageRef : ''
		};
	});

	return {
		ok: true,
		active,
		phase,
		challengeId: shared.challengeId,
		title: shared.title,
		submissionCount: shared.submissionCount,
		uniqueSubmitters: shared.uniqueSubmitters,
		topPrize: shared.topPrize,
		phaseSubtitle: phaseSubtitle(phase),
		viewerHasEntered,
		submissionStartAt: shared.submissionStartAt,
		highlightDeadlineMs: cfg ? computeHighlightDeadlineMs(cfg, phase, nowMs) : null,
		latestSubmissionMs: shared.latestSubmissionMs,
		hasUnvotedEntries: viewerIdOk ? unvotedEntries > 0 : (shared.submissionCount ?? 0) > 0,
		recentSubmissionCount24h: shared.recentSubmissionCount24h,
		heroImageUrl: shared.heroImageUrl,
		heroImageRef: shared.heroImageRef,
		totalRewardCredits: shared.totalRewardCredits,
		nextChallenge: shared.nextChallenge,
		previousChallenge: shared.previousChallenge,
		boardRows
	};
}
