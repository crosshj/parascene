import { getSupabaseServiceClient } from '../utils/supabaseService.js';
import {
	findChallengesChannelThreadId,
	fetchThreadMessagesChronological,
	pickLatestChallengeConfigPayload,
	tryParseChallengeJsonBody
} from '../utils/challengeSubmitShared.js';
import { deriveChallengePhase } from '../../src/chat/challenges/model/phases.js';
import {
	pickChallengeConfigTimestamp,
	pickChallengeHeroImageUrl,
	sanitizeChallengeHeroImageUrl
} from '../../src/chat/challenges/challengeAdmin.js';
import { summarizeLatestChallengeConfigs } from '../../src/chat/challenges/model/organizerSummaries.js';
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
			const picked = fromThumb || fromDerivedThumb || fromVideoThumb || fromUrl || normalizedImageUrl;
			if (picked) return picked;
		} catch {
			// ignore
		}
	}

	const direct = sanitizeChallengeHeroImageUrl(heroRefTrimmed);
	if (direct) return direct;
	return '';
}

function sumCreditsAcrossTierRewards(cfg) {
	if (!cfg || typeof cfg !== 'object') return null;
	const keys = ['reward_first', 'reward_second', 'reward_third', 'reward_participation'];
	let sum = 0;
	let found = false;
	for (const key of keys) {
		const s = cfg[key];
		if (typeof s !== 'string' || !s.trim()) continue;
		const re = /(\d[\d,]*)\s*credits?\b/gi;
		let m;
		while ((m = re.exec(s)) !== null) {
			const n = Number.parseInt(String(m[1]).replace(/,/g, ''), 10);
			if (Number.isFinite(n) && n >= 0) {
				sum += n;
				found = true;
			}
		}
	}
	return found ? sum : null;
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

async function resolveNextChallengeSnapshot(messages, nowMs, queries, currentChallengeId = '') {
	const configs = [];
	for (const m of messages) {
		const payload = tryParseChallengeJsonBody(m?.body);
		if (!payload || String(payload.kind || '').trim() !== 'challenge_config') continue;
		configs.push({ msg: m, payload });
	}

	const summaries = summarizeLatestChallengeConfigs(configs)
		.filter((row) => {
			const cid = String(row?.challenge_id || '').trim();
			if (!cid || cid === String(currentChallengeId || '').trim()) return false;
			const phase = deriveChallengePhase(row?.payload || null, nowMs);
			return phase === 'pre_submit';
		})
		.sort((a, b) => {
			const aStart = parseChallengeStartMs(a?.payload);
			const bStart = parseChallengeStartMs(b?.payload);
			if (aStart == null && bStart == null) return b.sortKey - a.sortKey;
			if (aStart == null) return 1;
			if (bStart == null) return -1;
			return aStart - bStart;
		});

	const next = summaries[0];
	if (!next) return null;

	const nextTitle =
		typeof next.payload?.title === 'string' && next.payload.title.trim()
			? next.payload.title.trim()
			: 'Upcoming challenge';
	const nextStartMs = parseChallengeStartMs(next.payload);
	const nextEnd = pickChallengeConfigTimestamp(next.payload, 'voting_end_at');
	const nextHeroImageUrl = await resolveChallengeHeroImageUrl({
		queries,
		cfg: next.payload,
		latestSubmissionImageId: NaN
	});

	return {
		challengeId: String(next.challenge_id || '').trim(),
		title: nextTitle,
		phase: 'pre_submit',
		phaseSubtitle: phaseSubtitle('pre_submit'),
		submissionStartAt: nextStartMs != null ? new Date(nextStartMs).toISOString() : '',
		votingEndAt: typeof nextEnd === 'string' ? nextEnd : '',
		heroImageUrl: nextHeroImageUrl || ''
	};
}

async function resolvePreviousChallengeSnapshot(messages, nowMs, queries, currentChallengeId = '') {
	const configs = [];
	for (const m of messages) {
		const payload = tryParseChallengeJsonBody(m?.body);
		if (!payload || String(payload.kind || '').trim() !== 'challenge_config') continue;
		configs.push({ msg: m, payload });
	}

	const summaries = summarizeLatestChallengeConfigs(configs)
		.filter((row) => {
			const cid = String(row?.challenge_id || '').trim();
			if (!cid || cid === String(currentChallengeId || '').trim()) return false;
			const phase = deriveChallengePhase(row?.payload || null, nowMs);
			return phase === 'finalizing' || phase === 'results';
		})
		.sort((a, b) => b.sortKey - a.sortKey);

	const prev = summaries[0];
	if (!prev) return null;
	const prevPhase = deriveChallengePhase(prev.payload, nowMs);
	const prevTitle =
		typeof prev.payload?.title === 'string' && prev.payload.title.trim()
			? prev.payload.title.trim()
			: 'Previous challenge';
	const prevStart = pickChallengeConfigTimestamp(prev.payload, 'submission_start_at');
	const prevEnd = pickChallengeConfigTimestamp(prev.payload, 'voting_end_at');
	const prevHeroImageUrl = await resolveChallengeHeroImageUrl({
		queries,
		cfg: prev.payload,
		latestSubmissionImageId: NaN
	});

	return {
		challengeId: String(prev.challenge_id || '').trim(),
		title: prevTitle,
		phase: prevPhase,
		phaseSubtitle: phaseSubtitle(prevPhase),
		submissionStartAt: typeof prevStart === 'string' ? prevStart : '',
		votingEndAt: typeof prevEnd === 'string' ? prevEnd : '',
		heroImageUrl: prevHeroImageUrl || ''
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
		const cfg = pickLatestChallengeConfigPayload(messages);
		const challengeId = cfg?.challenge_id != null ? String(cfg.challenge_id).trim() : '';
		if (!challengeId || !cfg) {
			return {
				version: 1,
				ok: true,
				active: false,
				built_at: new Date().toISOString()
			};
		}

		const nowMs = Date.now();
		const phase = deriveChallengePhase(cfg, nowMs);
		const active = !INACTIVE_FEED_PHASES.has(phase);

		let submissionCount = 0;
		let latestSubmissionMs = null;
		let recentSubmissionCount24h = 0;
		let latestSubmissionImageId = NaN;
		const submitters = new Set();
		/** @type {{ sender_id: number|null, created_at: string|null, created_image_id: number|null, reactions: object|null }[]} */
		const submissions = [];

		for (const m of messages) {
			const p = tryParseChallengeJsonBody(m?.body);
			if (!p || String(p.kind || '').trim() !== 'challenge_submission') continue;
			const pc = p.challenge_id != null ? String(p.challenge_id).trim() : '';
			if (pc !== challengeId) continue;

			submissionCount += 1;
			const createdMs = m?.created_at ? Date.parse(String(m.created_at)) : NaN;
			if (Number.isFinite(createdMs)) {
				latestSubmissionMs =
					latestSubmissionMs == null || createdMs > latestSubmissionMs
						? createdMs
						: latestSubmissionMs;
				if (latestSubmissionMs === createdMs) {
					const imageId = p.created_image_id != null ? Number(p.created_image_id) : NaN;
					latestSubmissionImageId = Number.isFinite(imageId) && imageId > 0 ? imageId : NaN;
				}
				if (nowMs - createdMs >= 0 && nowMs - createdMs <= 24 * 60 * 60 * 1000) {
					recentSubmissionCount24h += 1;
				}
			}

			const sid = m.sender_id != null ? Number(m.sender_id) : NaN;
			if (Number.isFinite(sid) && sid > 0) submitters.add(sid);

			submissions.push({
				sender_id: Number.isFinite(sid) && sid > 0 ? sid : null,
				created_at: m?.created_at != null ? String(m.created_at) : null,
				created_image_id:
					p.created_image_id != null && Number.isFinite(Number(p.created_image_id))
						? Number(p.created_image_id)
						: null,
				reactions: m?.reactions && typeof m.reactions === 'object' ? m.reactions : null
			});
		}

		const topPrize =
			typeof cfg.reward_first === 'string' && cfg.reward_first.trim()
				? cfg.reward_first.trim()
				: null;
		const totalRewardCredits = sumCreditsAcrossTierRewards(cfg);
		const title =
			typeof cfg.title === 'string' && cfg.title.trim() ? cfg.title.trim() : 'Challenge';
		const submissionStartAt = pickChallengeConfigTimestamp(cfg, 'submission_start_at');
		const heroImageUrl = await resolveChallengeHeroImageUrl({
			queries,
			cfg,
			latestSubmissionImageId
		});
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
			version: 1,
			ok: true,
			built_at: new Date().toISOString(),
			active,
			phase,
			challengeId,
			title,
			cfg,
			submissionCount,
			uniqueSubmitters: submitters.size,
			topPrize,
			submissionStartAt: typeof submissionStartAt === 'string' ? submissionStartAt : '',
			latestSubmissionMs,
			recentSubmissionCount24h,
			heroImageUrl,
			totalRewardCredits,
			nextChallenge,
			previousChallenge,
			submissions
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

	if (shared.active === false && !shared.challengeId) {
		return { ok: true, active: false };
	}

	const viewerIdOk = Number.isFinite(Number(viewerUserId)) && Number(viewerUserId) > 0;
	const uid = viewerIdOk ? Number(viewerUserId) : NaN;
	const nowMs = Date.now();
	const cfg = shared.cfg;
	const phase = cfg ? deriveChallengePhase(cfg, nowMs) : shared.phase;
	const active = cfg ? !INACTIVE_FEED_PHASES.has(phase) : shared.active === true;

	let viewerHasEntered = false;
	let unvotedEntries = 0;
	for (const row of Array.isArray(shared.submissions) ? shared.submissions : []) {
		const sid = row?.sender_id != null ? Number(row.sender_id) : NaN;
		if (viewerIdOk && sid === uid) viewerHasEntered = true;
		if (viewerIdOk && sid !== uid && !viewerHasChallengeScoreReaction(row?.reactions, uid)) {
			unvotedEntries += 1;
		}
	}

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
		totalRewardCredits: shared.totalRewardCredits,
		nextChallenge: shared.nextChallenge,
		previousChallenge: shared.previousChallenge
	};
}
