/**
 * Feed composition: virtual engagement row(s) from live challenge data + newbie tip interleaving.
 * Not stored in `feed_items`.
 *
 * Merge order (see `assembleFeedItems.js`):
 *   … → blog merge → challenge engagement (offset 0) → newbie tip interleave
 *
 * Future: rotate variants (traction entry, “X entered…”, “Your entry has N votes”) so the card
 * feels woven into feed life instead of a single static promo shape.
 */

import { CHALLENGE_TRACK_LABELS, challengeTrackListRank } from '../../src/chat/challenges/model/tracks.js';

/** Within this window before highlight deadline, eligible viewers see the card in slot 1. */
const CHALLENGE_FEED_URGENT_BEFORE_MS = 72 * 60 * 60 * 1000;
/** Just-opened window for headline priority. */
const CHALLENGE_FEED_JUST_OPENED_MS = 48 * 60 * 60 * 1000;

function formatEndsInSummary(deadlineMs, nowMs) {
	if (!Number.isFinite(deadlineMs) || deadlineMs <= nowMs) return "";
	const sec = Math.floor((deadlineMs - nowMs) / 1000);
	const days = Math.floor(sec / 86400);
	const hours = Math.floor((sec % 86400) / 3600);
	if (days >= 7) {
		const w = Math.ceil(days / 7);
		return w === 1 ? "Ends in 1 week" : `Ends in ${w} weeks`;
	}
	if (days >= 1) return days === 1 ? "Ends in 1 day" : `Ends in ${days} days`;
	if (hours >= 1) return hours === 1 ? "Ends in 1 hour" : `Ends in ${hours} hours`;
	return "Ending soon";
}

function formatStartsInSummary(startMs, nowMs) {
	if (!Number.isFinite(startMs) || startMs <= nowMs) return "Starts soon";
	const sec = Math.floor((startMs - nowMs) / 1000);
	const days = Math.floor(sec / 86400);
	const hours = Math.floor((sec % 86400) / 3600);
	if (days >= 1) return days === 1 ? "Starts in 1 day" : `Starts in ${days} days`;
	if (hours >= 1) return hours === 1 ? "Starts in 1 hour" : `Starts in ${hours} hours`;
	return "Starts soon";
}

function trackLabel(track) {
	const key = String(track || "").trim().toLowerCase();
	return CHALLENGE_TRACK_LABELS[key] || "Challenge";
}

function phaseIsActive(phase) {
	return phase === "submitting" || phase === "voting" || phase === "submit_and_vote";
}

function phaseIsVote(phase) {
	return phase === "voting" || phase === "submit_and_vote";
}

/**
 * Dual CTAs for the single-challenge legacy feed card.
 */
function pickChallengeDualCtaPayload(snapshot) {
	const phase = typeof snapshot?.phase === "string" ? snapshot.phase : "";
	const isVotePhase = phase === "voting" || phase === "submit_and_vote";
	const hasUnvoted = Boolean(snapshot?.hasUnvotedEntries);
	const entered = Boolean(snapshot?.viewerHasEntered);

	const voteLabel = hasUnvoted ? "Vote" : "View Entries";
	const voteAction = isVotePhase ? "challenge_vote_modal" : "";

	let voteOutlined;
	let enterOutlined;

	if (hasUnvoted) {
		voteOutlined = false;
		enterOutlined = entered;
		if (!voteOutlined && !enterOutlined) {
			enterOutlined = true;
		}
	} else {
		voteOutlined = true;
		enterOutlined = false;
	}

	return {
		challengeVoteLabel: voteLabel,
		challengeVoteOutlined: voteOutlined,
		challengeVoteAction: voteAction,
		challengeEnterLabel: "Create",
		challengeEnterOutlined: enterOutlined
	};
}

function pickChallengeHook(snapshot, nowMs) {
	const phase = typeof snapshot?.phase === "string" ? snapshot.phase : "";
	const recent = Number(snapshot?.recentSubmissionCount24h) || 0;
	const canSubmit = phase === "pre_submit" || phase === "submitting" || phase === "submit_and_vote";
	const isVotePhase = phase === "voting" || phase === "submit_and_vote";
	if (recent > 0) {
		return recent === 1 ? "1 new entry since yesterday" : `${recent} new entries since yesterday`;
	}
	if (isVotePhase && snapshot?.hasUnvotedEntries) {
		return "Voting is open now";
	}
	if (!snapshot?.viewerHasEntered && canSubmit) {
		return "You have not entered yet";
	}
	const ends = formatEndsInSummary(snapshot?.highlightDeadlineMs, nowMs);
	if (ends) return ends;
	return "Challenge activity is live";
}

function pickChallengeStatusChip(snapshot, nowMs) {
	const ends = formatEndsInSummary(snapshot?.highlightDeadlineMs, nowMs);
	if (ends) return ends.toUpperCase();
	return "LIVE";
}

function pickChallengeFeedSlot(snapshot, nowMs) {
	const deadlineMs = snapshot.highlightDeadlineMs;
	const nearDeadline =
		Number.isFinite(deadlineMs) &&
		deadlineMs > nowMs &&
		deadlineMs - nowMs <= CHALLENGE_FEED_URGENT_BEFORE_MS;
	const entered = Boolean(snapshot.viewerHasEntered);
	const hasUnvotedEntries = Boolean(snapshot.hasUnvotedEntries);
	const recentMotion = Number(snapshot?.recentSubmissionCount24h) > 0;
	const phase = typeof snapshot?.phase === "string" ? snapshot.phase : "";
	const votingOpen = phase === "voting" || phase === "submit_and_vote";

	const shouldBoostTop =
		(!entered && (nearDeadline || recentMotion || votingOpen)) ||
		(nearDeadline && hasUnvotedEntries) ||
		(votingOpen && hasUnvotedEntries && recentMotion);
	if (shouldBoostTop) return "top";

	const staleForViewer = entered && !hasUnvotedEntries && !recentMotion && !nearDeadline;
	if (staleForViewer) return "after_fifth";

	return entered ? "after_second" : "after_first";
}

/**
 * Headline priority (lower = better): ends-soon+can-act → just-opened → unvoted → not-entered → soonest.
 * @param {object} row
 * @param {number} nowMs
 * @returns {{ priority: number, chip: string, headline: string, deadlineMs: number|null }}
 */
export function scoreChallengeBoardHeadline(row, nowMs) {
	const phase = typeof row?.phase === "string" ? row.phase : "";
	const title =
		typeof row?.title === "string" && row.title.trim() ? row.title.trim() : "Challenge";
	const track = trackLabel(row?.track);
	const deadlineMs = Number.isFinite(row?.highlightDeadlineMs)
		? Number(row.highlightDeadlineMs)
		: null;
	const startMs = row?.submissionStartAt ? Date.parse(String(row.submissionStartAt)) : NaN;
	const canSubmit =
		phase === "submitting" || phase === "submit_and_vote";
	const canVote = phaseIsVote(phase);
	const canAct =
		(canSubmit && !row?.viewerHasEntered) || (canVote && row?.hasUnvotedEntries);
	const endsSoon =
		deadlineMs != null &&
		deadlineMs > nowMs &&
		deadlineMs - nowMs <= CHALLENGE_FEED_URGENT_BEFORE_MS;
	const justOpened =
		phaseIsActive(phase) &&
		Number.isFinite(startMs) &&
		nowMs >= startMs &&
		nowMs - startMs <= CHALLENGE_FEED_JUST_OPENED_MS;

	const endsChip = deadlineMs != null ? formatEndsInSummary(deadlineMs, nowMs) : "";
	const startsChip = Number.isFinite(startMs) ? formatStartsInSummary(startMs, nowMs) : "";

	if (endsSoon && canAct) {
		return {
			priority: 1,
			chip: (endsChip || "Ending soon").toUpperCase(),
			headline: `${track}: ${title} — act before it ends`,
			deadlineMs
		};
	}
	if (justOpened) {
		return {
			priority: 2,
			chip: "JUST OPENED",
			headline: `${track}: ${title} just opened`,
			deadlineMs
		};
	}
	if (canVote && row?.hasUnvotedEntries) {
		return {
			priority: 3,
			chip: (endsChip || "Voting open").toUpperCase(),
			headline: `${track}: ${title} — voting open`,
			deadlineMs
		};
	}
	if (canSubmit && !row?.viewerHasEntered) {
		return {
			priority: 4,
			chip: (endsChip || "Open").toUpperCase(),
			headline: `${track}: ${title} — you haven’t entered`,
			deadlineMs
		};
	}
	if (phase === "pre_submit") {
		return {
			priority: 6,
			chip: (startsChip || "Starts soon").toUpperCase(),
			headline: `${track}: ${title} ${startsChip ? startsChip.toLowerCase() : "starts soon"}`,
			deadlineMs: Number.isFinite(startMs) ? startMs : deadlineMs
		};
	}
	return {
		priority: 5,
		chip: (endsChip || (phaseIsActive(phase) ? "Live" : "Challenge")).toUpperCase(),
		headline: `${track}: ${title}`,
		deadlineMs
	};
}

/**
 * @param {object[]} boardRows
 * @param {number} nowMs
 */
export function pickChallengeBoardHeadline(boardRows, nowMs) {
	const rows = Array.isArray(boardRows) ? boardRows : [];
	if (!rows.length) return null;
	let best = null;
	for (const row of rows) {
		const scored = scoreChallengeBoardHeadline(row, nowMs);
		const trackRank = challengeTrackListRank(row?.track);
		const deadline = Number.isFinite(scored.deadlineMs)
			? scored.deadlineMs
			: Number.POSITIVE_INFINITY;
		const candidate = { row, scored, trackRank, deadline };
		if (!best) {
			best = candidate;
			continue;
		}
		if (candidate.scored.priority !== best.scored.priority) {
			if (candidate.scored.priority < best.scored.priority) best = candidate;
			continue;
		}
		if (candidate.deadline !== best.deadline) {
			if (candidate.deadline < best.deadline) best = candidate;
			continue;
		}
		if (candidate.trackRank < best.trackRank) best = candidate;
	}
	return best;
}

function pickChallengeBoardSlot(headline, nowMs) {
	if (!headline) return "after_first";
	const priority = headline.scored?.priority;
	if (priority === 1 || priority === 2 || priority === 3) return "top";
	const deadlineMs = headline.scored?.deadlineMs;
	const near =
		Number.isFinite(deadlineMs) &&
		deadlineMs > nowMs &&
		deadlineMs - nowMs <= CHALLENGE_FEED_URGENT_BEFORE_MS;
	if (near) return "top";
	return "after_first";
}

/**
 * Count board rows that are currently open for submit/vote (not upcoming/ended).
 * @param {object[]} boardRows
 */
export function countActiveChallengeBoardRows(boardRows) {
	return (Array.isArray(boardRows) ? boardRows : []).filter((row) => {
		const phase = typeof row?.phase === "string" ? row.phase : "";
		return phase === "submitting" || phase === "voting" || phase === "submit_and_vote";
	}).length;
}

/**
 * Legacy single-challenge engagement card (challenge_stats / challenge_stats_inactive).
 * @param {object} snapshot
 * @returns {object[]}
 */
function buildLegacyChallengeEngagementVirtualRows(snapshot) {
	if (!snapshot?.active || typeof snapshot.challengeId !== "string" || !snapshot.challengeId.trim()) {
		return [];
	}
	const nowMs = Date.now();
	const phase = typeof snapshot.phase === "string" ? snapshot.phase : "";
	const isInactiveState = phase === "finalizing" || phase === "results" || phase === "pre_submit";

	if (isInactiveState) {
		const nextFromCurrent = {
			title:
				typeof snapshot.title === "string" && snapshot.title.trim()
					? snapshot.title.trim()
					: "",
			submissionStartAt:
				typeof snapshot?.submissionStartAt === "string" ? snapshot.submissionStartAt.trim() : "",
			heroImageUrl:
				typeof snapshot.heroImageUrl === "string" && snapshot.heroImageUrl.trim()
					? snapshot.heroImageUrl.trim()
					: "",
			heroImageRef:
				typeof snapshot.heroImageRef === "string" && snapshot.heroImageRef.trim()
					? snapshot.heroImageRef.trim()
					: "",
			challengeId:
				typeof snapshot.challengeId === "string" && snapshot.challengeId.trim()
					? snapshot.challengeId.trim()
					: ""
		};
		const next = phase === "pre_submit"
			? nextFromCurrent
			: snapshot?.nextChallenge && typeof snapshot.nextChallenge === "object"
				? snapshot.nextChallenge
				: null;
		const previous = snapshot?.previousChallenge && typeof snapshot.previousChallenge === "object"
			? snapshot.previousChallenge
			: null;
		const nextChallengeTitle =
			typeof next?.title === "string" && next.title.trim() ? next.title.trim() : "";
		const nextStartMs =
			typeof next?.submissionStartAt === "string"
				? Date.parse(next.submissionStartAt)
				: NaN;
		const nextChallengeSubtitle =
			Number.isFinite(nextStartMs)
				? formatStartsInSummary(nextStartMs, nowMs)
				: phase === "pre_submit"
					? "Starts soon"
				: "";
		const nextChallengeImageUrl =
			typeof next?.heroImageUrl === "string" && next.heroImageUrl.trim()
				? next.heroImageUrl.trim()
				: "";
		const nextChallengeHeroRef =
			typeof next?.heroImageRef === "string" && next.heroImageRef.trim()
				? next.heroImageRef.trim()
				: "";
		const nextChallengeId =
			typeof next?.challengeId === "string" && next.challengeId.trim()
				? next.challengeId.trim()
				: "";
		const nextChallengeImageUrlForCard = nextChallengeHeroRef ? "" : nextChallengeImageUrl;
		const inactiveStatusChip =
			phase === "pre_submit"
				? previous?.phase === "finalizing"
					? "FINALIZING"
					: previous?.phase === "results"
						? "ENDED"
						: previous?.phase === "submitting" ||
							  previous?.phase === "voting" ||
							  previous?.phase === "submit_and_vote"
							? "OPEN"
						: "ENDED"
				: phase === "finalizing"
					? "FINALIZING"
					: "ENDED";
		const inactiveTone =
			phase === "pre_submit"
				? previous?.phase === "finalizing"
					? "finalizing"
					: "ended"
				: phase === "finalizing"
					? "finalizing"
					: "ended";
		const inactiveHook =
			phase === "pre_submit"
				? "Next challenge starting soon. Previous round is finalizing."
				: phase === "finalizing"
				? "Next challenge starting soon. Previous round is finalizing."
				: "Next challenge starting soon. Previous round has ended.";
		const inactiveTitle =
			phase === "pre_submit"
				? typeof previous?.title === "string" && previous.title.trim()
					? previous.title.trim()
					: "Previous challenge"
				: typeof snapshot.title === "string" && snapshot.title.trim()
					? snapshot.title.trim()
					: "Community challenge";
		const inactiveSubtitle =
			phase === "pre_submit"
				? typeof previous?.phaseSubtitle === "string" && previous.phaseSubtitle.trim()
					? previous.phaseSubtitle.trim()
					: "No active challenge"
				: typeof snapshot.phaseSubtitle === "string" && snapshot.phaseSubtitle.trim()
					? snapshot.phaseSubtitle.trim()
					: "";
		const inactiveHero =
			phase === "pre_submit"
				? typeof previous?.heroImageUrl === "string" && previous.heroImageUrl.trim()
					? previous.heroImageUrl.trim()
					: ""
				: typeof snapshot.heroImageUrl === "string" && snapshot.heroImageUrl.trim()
					? snapshot.heroImageUrl.trim()
					: "";
		const inactiveHeroRef =
			phase === "pre_submit"
				? typeof previous?.heroImageRef === "string" && previous.heroImageRef.trim()
					? previous.heroImageRef.trim()
					: ""
				: typeof snapshot.heroImageRef === "string" && snapshot.heroImageRef.trim()
					? snapshot.heroImageRef.trim()
					: "";
		const previousChallengeId =
			phase === "pre_submit" &&
			typeof previous?.challengeId === "string" &&
			previous.challengeId.trim()
				? previous.challengeId.trim()
				: "";
		const inactiveHeroForCard = inactiveHeroRef ? "" : inactiveHero;

		return [
			{
				type: "engagement",
				variant: "challenge_stats_inactive",
				id: `engagement:challenge_inactive:${snapshot.challengeId.trim()}`,
				slot: "after_first",
				created_at: new Date().toISOString(),
				payload: {
					kicker: "Challenge",
					title: inactiveTitle || "Community challenge",
					subtitle: inactiveSubtitle,
					statusChip: inactiveStatusChip,
					hook: inactiveHook,
					heroImageUrl: inactiveHeroForCard,
					heroImageRef: inactiveHeroRef,
					previousChallengeId,
					nextChallengeTitle,
					nextChallengeSubtitle,
					nextChallengeImageUrl: nextChallengeImageUrlForCard,
					nextChallengeHeroRef,
					nextChallengeId,
					inactiveTone,
					ctaLabel: "View challenges",
					ctaRoute: "/challenges",
					challengeTitleRoute: "/challenges"
				}
			}
		];
	}

	const rawPrize =
		typeof snapshot.topPrize === "string" && snapshot.topPrize.trim()
			? snapshot.topPrize.trim()
			: null;
	const totalCreditsRaw = snapshot.totalRewardCredits;
	const totalCredits =
		typeof totalCreditsRaw === "number" &&
			Number.isFinite(totalCreditsRaw) &&
			totalCreditsRaw > 0
			? Math.round(totalCreditsRaw)
			: null;
	const prizeDisplay =
		totalCredits != null
			? `${totalCredits.toLocaleString("en-US")} credits`
			: rawPrize && rawPrize.length > 140
				? `${rawPrize.slice(0, 137)}…`
				: rawPrize || "—";
	const prizeStatLabel = totalCredits != null ? "credits" : "Top prize";
	const prizeStatValue =
		totalCredits != null ? totalCredits.toLocaleString("en-US") : prizeDisplay;

	const phaseLine =
		typeof snapshot.phaseSubtitle === "string" && snapshot.phaseSubtitle.trim()
			? snapshot.phaseSubtitle.trim()
			: "";
	const subtitle = phaseLine;

	const entries = snapshot.submissionCount ?? 0;
	const creators = snapshot.uniqueSubmitters ?? 0;
	const entriesLabel = entries === 1 ? "entry" : "entries";
	const creatorsLabel = creators === 1 ? "creator" : "creators";
	const prizePart =
		totalCredits != null
			? `${totalCredits.toLocaleString("en-US")} credits`
			: prizeDisplay && prizeDisplay !== "—"
				? prizeDisplay
				: null;
	const socialProofParts = [
		`${entries} ${entriesLabel}`,
		`${creators} ${creatorsLabel}`,
		prizePart
	].filter(Boolean);
	const socialProofLine = socialProofParts.join(" • ");

	const slot = pickChallengeFeedSlot(snapshot, nowMs);
	const statusChip = pickChallengeStatusChip(snapshot, nowMs);
	const hook = pickChallengeHook(snapshot, nowMs);
	const dualCta = pickChallengeDualCtaPayload(snapshot);
	const heroImageUrl =
		typeof snapshot.heroImageUrl === "string" && snapshot.heroImageUrl.trim()
			? snapshot.heroImageUrl.trim()
			: "";
	const trackFromBoard = (() => {
		const rows = Array.isArray(snapshot?.boardRows) ? snapshot.boardRows : [];
		const cid =
			typeof snapshot?.challengeId === "string" ? snapshot.challengeId.trim() : "";
		const match = cid
			? rows.find((r) => String(r?.challengeId || "").trim() === cid)
			: null;
		const raw = match?.track ?? rows[0]?.track;
		return typeof raw === "string" ? raw.trim().toLowerCase() : "";
	})();
	const track =
		typeof snapshot.track === "string" && snapshot.track.trim()
			? snapshot.track.trim().toLowerCase()
			: trackFromBoard;

	return [
		{
			type: "engagement",
			variant: "challenge_stats",
			id: `engagement:challenge:${snapshot.challengeId.trim()}`,
			slot,
			created_at: new Date().toISOString(),
			payload: {
				kicker: "Challenge",
				track,
				title:
					typeof snapshot.title === "string" && snapshot.title.trim()
						? snapshot.title.trim()
						: "Community challenge",
				subtitle,
				statusChip,
				socialProofLine,
				hook,
				heroImageUrl,
				stats: [
					{ label: entriesLabel, value: String(entries) },
					{ label: creatorsLabel, value: String(creators) },
					{ label: prizeStatLabel, value: prizeStatValue }
				],
				...dualCta,
				challengeTitleRoute: "/challenges"
			}
		}
	];
}

/**
 * Social-proof line from a board row (same shape as legacy challenge_stats).
 * @param {object} row
 * @returns {string}
 */
function socialProofLineFromBoardRow(row) {
	const entries = Number(row?.submissionCount) || 0;
	const creators = Number(row?.uniqueSubmitters) || 0;
	const entriesLabel = entries === 1 ? "entry" : "entries";
	const creatorsLabel = creators === 1 ? "creator" : "creators";
	const totalCreditsRaw = row?.totalRewardCredits;
	const totalCredits =
		typeof totalCreditsRaw === "number" &&
		Number.isFinite(totalCreditsRaw) &&
		totalCreditsRaw > 0
			? Math.round(totalCreditsRaw)
			: null;
	const rawPrize =
		typeof row?.topPrize === "string" && row.topPrize.trim() ? row.topPrize.trim() : null;
	const prizePart =
		totalCredits != null
			? `${totalCredits.toLocaleString("en-US")} credits`
			: rawPrize && rawPrize.length > 140
				? `${rawPrize.slice(0, 137)}…`
				: rawPrize || null;
	return [`${entries} ${entriesLabel}`, `${creators} ${creatorsLabel}`, prizePart]
		.filter(Boolean)
		.join(" • ");
}

/**
 * One stacked section = same fields as a single-track challenge_stats card (no CTAs).
 * @param {object} row
 * @param {number} nowMs
 * @param {{ statusChip?: string }} [opts]
 */
function boardTrackPayloadFromRow(row, nowMs, opts = {}) {
	const heroImageRef =
		typeof row?.heroImageRef === "string" && row.heroImageRef.trim()
			? row.heroImageRef.trim()
			: "";
	const heroImageUrl =
		typeof row?.heroImageUrl === "string" && row.heroImageUrl.trim()
			? row.heroImageUrl.trim()
			: "";
	return {
		challengeId: String(row?.challengeId || "").trim(),
		track:
			typeof row?.track === "string" && row.track.trim()
				? row.track.trim().toLowerCase()
				: "monthly",
		title:
			typeof row?.title === "string" && row.title.trim()
				? row.title.trim()
				: "Community challenge",
		subtitle:
			typeof row?.phaseSubtitle === "string" && row.phaseSubtitle.trim()
				? row.phaseSubtitle.trim()
				: "",
		statusChip:
			(typeof opts.statusChip === "string" && opts.statusChip.trim()) ||
			pickChallengeStatusChip(row, nowMs),
		socialProofLine: socialProofLineFromBoardRow(row),
		hook: pickChallengeHook(row, nowMs),
		heroImageUrl,
		heroImageRef
	};
}

/**
 * Multi-track card: stacked single-track sections (monthly first), no per-track CTAs.
 * @param {object[]} boardRows
 * @param {object} snapshot
 * @returns {object[]}
 */
function buildMultiTrackChallengeBoardRows(boardRows, snapshot) {
	const nowMs = Date.now();
	const headlinePick = pickChallengeBoardHeadline(boardRows, nowMs);
	const primary = headlinePick?.row || boardRows[0] || null;
	const slot = pickChallengeBoardSlot(headlinePick, nowMs);
	const primaryId =
		(typeof primary?.challengeId === "string" && primary.challengeId.trim()) ||
		(typeof snapshot?.challengeId === "string" ? snapshot.challengeId.trim() : "") ||
		"board";
	const headlineId =
		typeof headlinePick?.row?.challengeId === "string"
			? headlinePick.row.challengeId.trim()
			: "";

	const ordered = [...(Array.isArray(boardRows) ? boardRows : [])].sort((a, b) => {
		const ta = challengeTrackListRank(a?.track);
		const tb = challengeTrackListRank(b?.track);
		if (ta !== tb) return ta - tb;
		const da = Number.isFinite(a?.highlightDeadlineMs)
			? Number(a.highlightDeadlineMs)
			: Number.POSITIVE_INFINITY;
		const db = Number.isFinite(b?.highlightDeadlineMs)
			? Number(b.highlightDeadlineMs)
			: Number.POSITIVE_INFINITY;
		if (da !== db) return da - db;
		return String(a?.challengeId || "").localeCompare(String(b?.challengeId || ""));
	});

	const tracks = ordered.map((row) => {
		const cid = String(row?.challengeId || "").trim();
		return boardTrackPayloadFromRow(row, nowMs, {
			statusChip:
				headlineId && cid === headlineId && headlinePick?.scored?.chip
					? headlinePick.scored.chip
					: undefined
		});
	});

	return [
		{
			type: "engagement",
			variant: "challenge_board",
			id: `engagement:challenge_board:${primaryId}`,
			slot,
			created_at: new Date().toISOString(),
			payload: {
				kicker: "Challenges",
				tracks,
				ctaLabel: "Open challenges",
				ctaRoute: "/challenges",
				challengeTitleRoute: "/challenges"
			}
		}
	];
}

/**
 * Feed engagement: legacy single-challenge card unless 2+ tracks are actively open.
 * @param {object} snapshot
 * @returns {object[]}
 */
export function buildChallengeEngagementVirtualRows(snapshot) {
	const boardRows = Array.isArray(snapshot?.boardRows) ? snapshot.boardRows : [];
	const activeCount = countActiveChallengeBoardRows(boardRows);
	if (activeCount >= 2) {
		return buildMultiTrackChallengeBoardRows(boardRows, snapshot);
	}
	return buildLegacyChallengeEngagementVirtualRows(snapshot);
}

/** Tip items shown in the newbie feed to explain following and other features */
export const NEWBIE_FEED_TIPS = [
	{
		id: "tip-create",
		title: "Create new images",
		message: "Use the create flow to generate new images. Pick a method, add your ideas, and publish to your profile.",
		cta: "Create",
		ctaRoute: "/create"
	},
	{
		id: "tip-share",
		title: "Share your creations",
		message: "Your published work lives in Creations. Open any creation to get a shareable link, copy it, or share to social.",
		cta: "My creations",
		ctaRoute: "/creations"
	},
	{
		id: "tip-explore",
		title: "Explore other creators",
		message: "Discover what others are making. Follow creators you like and their new posts will show up in your feed.",
		cta: "Explore",
		ctaRoute: "/explore"
	},
	{
		id: "tip-connect-chat",
		title: "Chat with others",
		message: "Open hashtag channels and DMs in the app under Connect. It’s the home for text chat here.",
		cta: "Chat",
		ctaRoute: "/chat"
	},
	// {
	// 	id: "tip-discord",
	// 	title: "Join our Discord",
	// 	message: "For voice, events, and the wider community outside the app, join our Discord server.",
	// 	cta: "Join Discord",
	// 	ctaRoute: "https://discord.gg/pqzWstTb8f",
	// 	ctaTarget: "_blank"
	// },
	{
		id: "tip-help",
		title: "Help & docs",
		message: "Learn how everything works—creating, sharing, following, and more. Check the help section when you need it.",
		cta: "Help",
		ctaRoute: "/help"
	}
];

/** Insert tip items every N non-tip rows in the newbie feed (unchanged behavior). */
export const NEWBIE_FEED_TIP_INTERVAL = 10;

/** Chat slot-pack page one: middle of first between-spotlight strip (after 4v + 1st non-video). */
export const SLOT_PACK_FIRST_ENGAGEMENT_INSERT_INDEX = 5;

/**
 * @param {object[]} baseItems
 * @param {object[]} engagementItems
 * @returns {object[]}
 */
export function injectEngagementIntoSlotPackHead(baseItems, engagementItems) {
	const inserts = Array.isArray(engagementItems) ? engagementItems : [];
	if (inserts.length === 0) {
		return Array.isArray(baseItems) ? baseItems : [];
	}
	const { slot: _drop, ...rest } = inserts[0];
	const row = { ...rest };
	const out = [...(Array.isArray(baseItems) ? baseItems : [])];
	const idx = Math.min(SLOT_PACK_FIRST_ENGAGEMENT_INSERT_INDEX, out.length);
	out.splice(idx, 0, row);
	return out;
}

function effectiveEngagementSlotForSurface(slot, feedSurface) {
	const normalized =
		slot === "top" ||
			slot === "after_first" ||
			slot === "after_second" ||
			slot === "after_fifth"
			? slot
			: "after_first";
	if (feedSurface !== "chat") return normalized;
	/* Chat `#feed` (desktop flat + mobile partition): avoid burying at slot 5 on first page. */
	if (normalized === "after_fifth") return "after_second";
	return normalized;
}

/**
 * @param {object[]} baseItems
 * @param {object[]} engagementItems
 * @param {{ limit: number, feedSurface?: string }} opts
 */
export function mergeEngagementIntoPage(baseItems, engagementItems, opts) {
	const limit = Math.min(Math.max(1, Number(opts?.limit) || 20), 100);
	const feedSurface =
		typeof opts?.feedSurface === "string" ? opts.feedSurface.trim().toLowerCase() : "";
	const list = [...(Array.isArray(baseItems) ? baseItems : [])];
	const inserts = [...(Array.isArray(engagementItems) ? engagementItems : [])];

	if (inserts.length === 0) {
		return list.slice(0, limit);
	}

	const withSlot = inserts.map((item) => ({
		item,
		slot: effectiveEngagementSlotForSurface(item.slot, feedSurface)
	}));

	withSlot.sort((a, b) => slotToIndex(b.slot) - slotToIndex(a.slot));

	for (const { item, slot } of withSlot) {
		const { slot: _drop, ...rest } = item;
		const row = { ...rest };
		const idx = resolveInsertIndex(list, slot);
		list.splice(idx, 0, row);
	}

	return list.slice(0, limit);
}

function resolveInsertIndex(list, slot) {
	const n = list.length;
	if (slot === "top") return 0;
	if (slot === "after_first") return Math.min(1, n);
	if (slot === "after_second") return Math.min(2, n);
	if (slot === "after_fifth") return Math.min(5, n);
	return Math.min(1, n);
}

function slotToIndex(slot) {
	if (slot === "top") return 0;
	if (slot === "after_first") return 1;
	if (slot === "after_second") return 2;
	if (slot === "after_fifth") return 5;
	return 1;
}

/**
 * When `isNewbieFeed`, interleave `NEWBIE_FEED_TIPS` every `NEWBIE_FEED_TIP_INTERVAL` rows.
 * @param {object[]} pageAfterEngagement
 * @param {boolean} isNewbieFeed
 */
export function applyNewbieFeedTips(pageAfterEngagement, isNewbieFeed) {
	if (!isNewbieFeed || !Array.isArray(pageAfterEngagement) || pageAfterEngagement.length === 0) {
		return pageAfterEngagement;
	}
	const items = [];
	let tipIndex = 0;
	for (let i = 0; i < pageAfterEngagement.length; i++) {
		if (i > 0 && i % NEWBIE_FEED_TIP_INTERVAL === 0 && tipIndex < NEWBIE_FEED_TIPS.length) {
			const tip = NEWBIE_FEED_TIPS[tipIndex];
			items.push({
				type: "tip",
				id: tip.id,
				title: tip.title,
				message: tip.message,
				cta: tip.cta,
				ctaRoute: tip.ctaRoute
			});
			tipIndex += 1;
		}
		items.push(pageAfterEngagement[i]);
	}
	return items;
}
