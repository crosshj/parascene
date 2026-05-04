import { getSupabaseServiceClient } from "../utils/supabaseService.js";
import {
	findChallengesChannelThreadId,
	fetchThreadMessagesChronological,
	pickLatestChallengeConfigPayload,
	tryParseChallengeJsonBody
} from "../utils/challengeSubmitShared.js";
import { deriveChallengePhase } from "../../src/chat/challenges/model/phases.js";
import {
	pickChallengeConfigTimestamp,
	pickChallengeHeroImageUrl,
	sanitizeChallengeHeroImageUrl
} from "../../src/chat/challenges/challengeAdmin.js";
import { CHALLENGE_SCORE_REACTION_KEYS } from "../../src/chat/challenges/constants.js";
import { appendCreationIdToMediaUrl, getThumbnailUrl } from "../utils/url.js";
import { verifyShareToken } from "../utils/shareLink.js";

/**
 * Next closing milestone we surface as “Ends in …” (submission end or voting end).
 * Omits `between` where voting has not opened yet — deadline copy would read wrong.
 */
function computeHighlightDeadlineMs(cfg, phase, nowMs) {
	if (!cfg || typeof cfg !== "object") return null;
	if (phase === "between") return null;

	const subEndStr = pickChallengeConfigTimestamp(cfg, "submission_end_at");
	const voteEndStr = pickChallengeConfigTimestamp(cfg, "voting_end_at");
	const subEnd = subEndStr ? Date.parse(subEndStr) : NaN;
	const voteEnd = voteEndStr ? Date.parse(voteEndStr) : NaN;
	const subOk = Number.isFinite(subEnd);
	const voteOk = Number.isFinite(voteEnd);

	if (phase === "pre_submit" || phase === "submitting") {
		if (subOk && subEnd > nowMs) return subEnd;
		return null;
	}
	if (phase === "submit_and_vote") {
		const candidates = [];
		if (subOk && subEnd > nowMs) candidates.push(subEnd);
		if (voteOk && voteEnd > nowMs) candidates.push(voteEnd);
		return candidates.length ? Math.min(...candidates) : null;
	}
	if (phase === "voting") {
		if (voteOk && voteEnd > nowMs) return voteEnd;
		return null;
	}
	return null;
}

function viewerHasChallengeScoreReaction(reactions, viewerUserId) {
	if (!reactions || typeof reactions !== "object" || Array.isArray(reactions)) return false;
	for (const key of CHALLENGE_SCORE_REACTION_KEYS) {
		const arr = Array.isArray(reactions[key]) ? reactions[key] : [];
		if (arr.some((x) => Number(x) === viewerUserId)) return true;
	}
	return false;
}

async function resolveChallengeHeroImageUrl({ queries, cfg, latestSubmissionImageId }) {
	const heroRef = pickChallengeHeroImageUrl(cfg);
	const heroRefTrimmed = typeof heroRef === "string" ? heroRef.trim() : "";

	const parseCreationIdFromRef = (raw) => {
		const s = typeof raw === "string" ? raw.trim() : "";
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
			const u = new URL(s, "https://www.parascene.com");
			const path = `${u.pathname || ""}${u.search || ""}`;
			const fromUrlPath = fromPlainPath(path);
			if (Number.isFinite(fromUrlPath) && fromUrlPath > 0) return fromUrlPath;

			const sm = (u.pathname || "").match(/^\/s\/([^/]+)\/([^/]+)\/[^/]+\/?$/i);
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
	if (typeof getAny !== "function") return "";

	for (const id of candidates) {
		try {
			const row = await getAny(id);
			if (!row) continue;
			const rawFilePath = typeof row.file_path === "string" ? row.file_path.trim() : "";
			const rawFilename = typeof row.filename === "string" ? row.filename.trim() : "";
			const imageUrlFromRow = rawFilePath || (rawFilename ? `/api/images/created/${rawFilename}` : "");
			const normalizedImageUrl = appendCreationIdToMediaUrl(imageUrlFromRow, id);
			const fromDerivedThumb = normalizedImageUrl ? getThumbnailUrl(normalizedImageUrl) : "";
			const fromThumb = typeof row.thumbnail_url === "string" ? row.thumbnail_url.trim() : "";
			const fromUrl = typeof row.url === "string" ? row.url.trim() : "";
			const fromVideoThumb =
				typeof row.video_thumbnail_url === "string" ? row.video_thumbnail_url.trim() : "";
			const picked = fromThumb || fromDerivedThumb || fromVideoThumb || fromUrl || normalizedImageUrl;
			if (picked) return picked;
		} catch {
			// ignore resolver failures and keep fallback behavior
		}
	}

	// Match chat/challenges ordering: only treat raw hero ref as direct media
	// after creation/share resolution has had a chance.
	const direct = sanitizeChallengeHeroImageUrl(heroRefTrimmed);
	if (direct) return direct;
	return "";
}

/** Phases where we still promote the challenge on the home/chat feed */
const INACTIVE_FEED_PHASES = new Set(["results", "empty", "unknown"]);

/**
 * Sums credit amounts from 1st / 2nd / 3rd / participation reward lines (e.g. "2000 credits", "1,500 credit").
 * @param {object} cfg — challenge config payload
 * @returns {number | null} total credits, or null if nothing parseable
 */
function sumCreditsAcrossTierRewards(cfg) {
	if (!cfg || typeof cfg !== "object") return null;
	const keys = ["reward_first", "reward_second", "reward_third", "reward_participation"];
	let sum = 0;
	let found = false;
	for (const key of keys) {
		const s = cfg[key];
		if (typeof s !== "string" || !s.trim()) continue;
		const re = /(\d[\d,]*)\s*credits?\b/gi;
		let m;
		while ((m = re.exec(s)) !== null) {
			const n = Number.parseInt(String(m[1]).replace(/,/g, ""), 10);
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
		case "pre_submit":
			return "Starts soon";
		case "submitting":
			return "Submissions open";
		case "submit_and_vote":
			return "Submit and vote";
		case "voting":
			return "Voting open";
		case "between":
			return "Between rounds";
		default:
			return "Community challenge";
	}
}

/**
 * Live data from #challenges thread (latest `challenge_config` + matching `challenge_submission` messages).
 * SQLite-only dev setups return `{ ok: false }` without throwing.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   active?: boolean,
 *   phase?: string,
 *   challengeId?: string,
 *   title?: string,
 *   submissionCount?: number,
 *   uniqueSubmitters?: number,
 *   topPrize?: string | null,
 *   viewerHasEntered?: boolean,
 *   highlightDeadlineMs?: number | null,
 *   latestSubmissionMs?: number | null,
 *   hasUnvotedEntries?: boolean,
 *   recentSubmissionCount24h?: number,
 *   heroImageUrl?: string,
 *   totalRewardCredits?: number | null
 * }>}
 */
export async function pullChallengeFeedSnapshot(opts = {}) {
	const viewerUserId =
		opts.viewerUserId != null ? Number(opts.viewerUserId) : NaN;
	const viewerIdOk = Number.isFinite(viewerUserId) && viewerUserId > 0;
	const queries = opts?.queries;
	const sb = getSupabaseServiceClient();
	if (!sb) {
		return { ok: false, reason: "no_supabase" };
	}
	try {
		const tid = await findChallengesChannelThreadId(sb);
		if (!tid) {
			return { ok: false, reason: "no_challenges_thread" };
		}
		const messages = await fetchThreadMessagesChronological(sb, tid);
		const cfg = pickLatestChallengeConfigPayload(messages);
		const challengeId =
			cfg?.challenge_id != null ? String(cfg.challenge_id).trim() : "";
		if (!challengeId || !cfg) {
			return { ok: true, active: false };
		}

		const nowMs = Date.now();
		const phase = deriveChallengePhase(cfg, nowMs);
		const active = !INACTIVE_FEED_PHASES.has(phase);

		let submissionCount = 0;
		let viewerHasEntered = false;
		let latestSubmissionMs = null;
		let unvotedEntries = 0;
		let recentSubmissionCount24h = 0;
		let latestSubmissionImageId = NaN;
		const submitters = new Set();
		for (const m of messages) {
			const p = tryParseChallengeJsonBody(m?.body);
			if (!p || String(p.kind || "").trim() !== "challenge_submission") continue;
			const pc = p.challenge_id != null ? String(p.challenge_id).trim() : "";
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
			if (Number.isFinite(sid) && sid > 0) {
				submitters.add(sid);
				if (viewerIdOk && sid === viewerUserId) viewerHasEntered = true;
			}
			if (viewerIdOk) {
				const isOwnEntry = Number.isFinite(sid) && sid === viewerUserId;
				if (!isOwnEntry && !viewerHasChallengeScoreReaction(m?.reactions, viewerUserId)) {
					unvotedEntries += 1;
				}
			}
		}

		const topPrize =
			typeof cfg.reward_first === "string" && cfg.reward_first.trim()
				? cfg.reward_first.trim()
				: null;
		const totalRewardCredits = sumCreditsAcrossTierRewards(cfg);
		const title =
			typeof cfg.title === "string" && cfg.title.trim()
				? cfg.title.trim()
				: "Challenge";

		const highlightDeadlineMs = computeHighlightDeadlineMs(cfg, phase, nowMs);
		const heroImageUrl = await resolveChallengeHeroImageUrl({
			queries,
			cfg,
			latestSubmissionImageId
		});

		return {
			ok: true,
			active,
			phase,
			challengeId,
			title,
			submissionCount,
			uniqueSubmitters: submitters.size,
			topPrize,
			phaseSubtitle: phaseSubtitle(phase),
			viewerHasEntered,
			highlightDeadlineMs,
			latestSubmissionMs,
			hasUnvotedEntries: viewerIdOk ? unvotedEntries > 0 : submissionCount > 0,
			recentSubmissionCount24h,
			heroImageUrl,
			totalRewardCredits
		};
	} catch (err) {
		console.warn("[feed] pullChallengeFeedSnapshot", err?.message || err);
		return { ok: false, reason: "error" };
	}
}
