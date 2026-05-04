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

/** Within this window before highlight deadline, eligible viewers see the card in slot 1. */
const CHALLENGE_FEED_URGENT_BEFORE_MS = 72 * 60 * 60 * 1000;
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

/**
 * Dual CTAs: Vote or View → /challenges, Create → /create.
 * Filled vs outline (text): client uses `feed-card-engagement-cta` (filled) vs
 * `feed-card-engagement-cta--outline` when the matching `*Outlined` field is true.
 *
 * Snapshot: `hasUnvotedEntries` = viewer still has others’ entries they have not scored yet.
 * `viewerHasEntered` = viewer submitted to this challenge.
 *
 * Matrix:
 * - Has unvoted → primary **Vote** (filled). Secondary **Create**: outline if already entered,
 *   else filled; if both would be filled (not entered yet), **Create** becomes outline so Vote wins.
 * - No unvoted left (caught up, or only own/no peers’ entries to score) → primary **Create**
 *   (filled), secondary **View Entries** (text). Vote / View Entries still opens the in-feed modal
 *   whenever the challenge is in a voting phase (same as “Vote”).
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

	/*
	 * Rule:
	 * - High (slot 1) when urgent/personal/newly active.
	 * - Moderate (slot 2/3) when live but non-urgent.
	 * - Lower (slot 5-8) when stale after recent engagement.
	 *
	 * Not yet wired here: friend-entered, own-entry-votes, and "since last visit" diffs.
	 */
	const shouldBoostTop =
		(!entered && (nearDeadline || recentMotion || votingOpen)) ||
		(nearDeadline && hasUnvotedEntries) ||
		(votingOpen && hasUnvotedEntries && recentMotion);
	if (shouldBoostTop) return "top";

	const staleForViewer = entered && !hasUnvotedEntries && !recentMotion && !nearDeadline;
	if (staleForViewer) return "after_fifth";

	// Teaching/discovery baseline: slot 2 or 3.
	return entered ? "after_second" : "after_first";
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

/**
 * One virtual row built from `pullChallengeFeedSnapshot()` when `active` is true.
 * @param {{
 *   active: boolean,
 *   challengeId: string,
 *   title?: string,
 *   submissionCount?: number,
 *   uniqueSubmitters?: number,
 *   topPrize?: string | null,
 *   totalRewardCredits?: number | null,
 *   phaseSubtitle?: string,
 *   phase?: string,
 *   viewerHasEntered?: boolean,
 *   highlightDeadlineMs?: number | null,
 *   latestSubmissionMs?: number | null,
 *   hasUnvotedEntries?: boolean,
 *   recentSubmissionCount24h?: number,
 *   heroImageUrl?: string
 * }} snapshot
 * Payload CTAs (dual): challengeVoteLabel, challengeVoteOutlined, challengeVoteAction, challengeEnterLabel, challengeEnterOutlined (routes default client-side to /challenges and /create).
 * @returns {object[]}
 */
export function buildChallengeEngagementVirtualRows(snapshot) {
	if (!snapshot?.active || typeof snapshot.challengeId !== "string" || !snapshot.challengeId.trim()) {
		return [];
	}
	const nowMs = Date.now();
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

	const phase = typeof snapshot.phase === "string" ? snapshot.phase : "";
	const slot = pickChallengeFeedSlot(snapshot, nowMs);
	const statusChip = pickChallengeStatusChip(snapshot, nowMs);
	const hook = pickChallengeHook(snapshot, nowMs);
	const dualCta = pickChallengeDualCtaPayload(snapshot);
	const heroImageUrl =
		typeof snapshot.heroImageUrl === "string" && snapshot.heroImageUrl.trim()
			? snapshot.heroImageUrl.trim()
			: "";

	return [
		{
			type: "engagement",
			variant: "challenge_stats",
			id: `engagement:challenge:${snapshot.challengeId.trim()}`,
			slot,
			created_at: new Date().toISOString(),
			payload: {
				kicker: "Challenge",
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
 * @param {object[]} baseItems
 * @param {object[]} engagementItems
 * @param {{ limit: number }} opts
 */
export function mergeEngagementIntoPage(baseItems, engagementItems, opts) {
	const limit = Math.min(Math.max(1, Number(opts?.limit) || 20), 100);
	const list = [...(Array.isArray(baseItems) ? baseItems : [])];
	const inserts = [...(Array.isArray(engagementItems) ? engagementItems : [])];

	if (inserts.length === 0) {
		return list.slice(0, limit);
	}

	const withSlot = inserts.map((item) => ({
		item,
		slot:
			item.slot === "top" ||
				item.slot === "after_first" ||
				item.slot === "after_second" ||
				item.slot === "after_fifth"
				? item.slot
				: "after_first"
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
