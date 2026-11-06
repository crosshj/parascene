/**
 * Challenge payout planning + execution.
 *
 * Consumers: publish-results route and "Retry unpaid" (api_routes/challenges.js).
 *
 * Payout source today is the tip system: credits transfer from the platform
 * admin account's balance (`transferCredits`, resolved by role in the route),
 * logged in tip_activity, with a tip notification to each recipient. The
 * executor takes a `source` argument so a future system-mint / sponsor-wallet
 * source slots in without touching the publish flow.
 */

import { resolveChallengePrizes } from "../../src/chat/challenges/model/prizes.js";

/** Absolute per-payout ceiling — never trust client amounts. */
export const HARD_MAX_PER_PAYOUT = 10000;
export const MAX_PARTICIPATION_ROWS = 10;

export const CHALLENGE_RESULTS_VERSION = 1;

const PLACE_LABELS = { 1: "1st place", 2: "2nd place", 3: "3rd place" };

/**
 * Tip note stored on tip_activity (visible in tip history).
 * @param {{ title: string, reason: string, amount: number }} args
 */
export function challengePrizeTipNote({ title, reason, amount }) {
	const t = String(title || "challenge").trim() || "challenge";
	const r = String(reason || "prize").trim() || "prize";
	const credits = Number(amount) || 0;
	return `Congratulations! You earned ${credits.toLocaleString()} credits for ${r} in ${t}.`;
}

/**
 * In-app notification for a challenge prize tip.
 * @param {{ title: string, reason: string, amount: number }} args
 * @returns {{ title: string, message: string }}
 */
export function challengePrizeNotificationCopy({ title, reason, amount }) {
	const t = String(title || "challenge").trim() || "challenge";
	const r = String(reason || "prize").trim() || "prize";
	const credits = Number(amount) || 0;
	return {
		title: "Congratulations on your challenge prize",
		message: `You received ${credits.toLocaleString()} credits for ${r} in ${t}. Thanks for taking part!`
	};
}

/**
 * Validate the organizer-confirmed results and produce the `results` block
 * (v1) with every payout row pending. Pure — throws no I/O.
 *
 * Winner rows are validated against real challenge submissions: user id and
 * creation id come from the submission message, never from the client.
 * Amounts are clamped to the challenge's configured prizes.
 *
 * @param {{
 *   merged: object,                       // merged challenge_config
 *   body: {
 *     winners?: { place?: unknown, message_id?: unknown, amount?: unknown }[],
 *     top_submitters?: { user_id?: unknown, amount?: unknown }[],
 *     top_voters?: { user_id?: unknown, amount?: unknown }[],
 *   },
 *   stats: ReturnType<import('../../src/chat/challenges/model/ranking.js').collectChallengeVoteStats>,
 *   confirmedByUserId: number,
 *   nowIso?: string,
 * }} args
 * @returns {{ ok: true, results: object, totalAmount: number } | { ok: false, error: string }}
 */
export function prepareChallengeResultsPublish({ merged, body, stats, confirmedByUserId, nowIso }) {
	if (!merged || typeof merged !== "object") {
		return { ok: false, error: "Challenge config not found." };
	}
	const publishedAt =
		merged.results_published_at != null ? String(merged.results_published_at).trim() : "";
	if (publishedAt) {
		return { ok: false, error: "Results are already published for this challenge." };
	}
	const now = typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString();
	const prizes = resolveChallengePrizes(merged, { track: merged.track });

	const entryByMessageId = new Map();
	for (const entry of stats?.entries || []) {
		if (entry.messageId > 0) entryByMessageId.set(entry.messageId, entry);
	}

	const winnersIn = Array.isArray(body?.winners) ? body.winners : [];
	if (winnersIn.length === 0) {
		return { ok: false, error: "At least one winner is required." };
	}
	if (winnersIn.length > 3) {
		return { ok: false, error: "At most three placed winners are supported." };
	}
	const winners = [];
	const payouts = [];
	const seenPlaces = new Set();
	const seenMessages = new Set();
	for (const raw of winnersIn) {
		const place = Number(raw?.place);
		const messageId = Number(raw?.message_id);
		if (!Number.isFinite(place) || place < 1 || place > 3 || seenPlaces.has(place)) {
			return { ok: false, error: "Winner places must be unique values 1-3." };
		}
		if (!Number.isFinite(messageId) || messageId <= 0 || seenMessages.has(messageId)) {
			return { ok: false, error: "Winner entries must be unique challenge submissions." };
		}
		const entry = entryByMessageId.get(messageId);
		if (!entry) {
			return {
				ok: false,
				error: `Winner message ${messageId} is not a submission of this challenge.`
			};
		}
		if (!entry.senderId) {
			return { ok: false, error: `Winner message ${messageId} has no sender.` };
		}
		seenPlaces.add(place);
		seenMessages.add(messageId);
		const configured =
			place === 1 ? prizes.main.first : place === 2 ? prizes.main.second : prizes.main.third;
		// Always pay the configured place prize (ignore client amount).
		const amount = Math.min(Math.max(0, Number(configured) || 0), HARD_MAX_PER_PAYOUT);
		winners.push({
			place,
			message_id: messageId,
			created_image_id: entry.creationId,
			user_id: entry.senderId,
			score: entry.voteValue
		});
		if (amount > 0) {
			payouts.push({
				user_id: entry.senderId,
				amount,
				reason: PLACE_LABELS[place],
				source: "tip",
				paid_at: null
			});
		}
	}
	winners.sort((a, b) => a.place - b.place);

	const participation = (rowsIn, counts, amounts, labelPrefix) => {
		const rows = Array.isArray(rowsIn) ? rowsIn : [];
		const configuredAmounts = Array.isArray(amounts) ? amounts : [];
		if (rows.length > MAX_PARTICIPATION_ROWS) {
			return { error: `Too many ${labelPrefix} rows (max ${MAX_PARTICIPATION_ROWS}).` };
		}
		const out = [];
		const seen = new Set();
		let rank = 0;
		for (const raw of rows) {
			const userId = Number(raw?.user_id);
			if (!Number.isFinite(userId) || userId <= 0 || seen.has(userId)) {
				return { error: `Invalid or duplicate user in ${labelPrefix}.` };
			}
			const count = counts.get(userId) || 0;
			if (count <= 0) {
				return { error: `User ${userId} has no ${labelPrefix} activity in this challenge.` };
			}
			seen.add(userId);
			rank += 1;
			const configured = Math.max(0, Number(configuredAmounts[rank - 1]) || 0);
			const amount = Math.min(configured, HARD_MAX_PER_PAYOUT);
			out.push({ user_id: userId, count, prize: amount });
			if (amount > 0) {
				payouts.push({
					user_id: userId,
					amount,
					reason: `Top ${rank} ${labelPrefix}`,
					source: "tip",
					paid_at: null
				});
			}
		}
		return { rows: out };
	};

	const submitters = participation(
		body?.top_submitters,
		stats?.submissionsPerSenderId || new Map(),
		prizes.top_submitters.amounts,
		"submitter"
	);
	if (submitters.error) return { ok: false, error: submitters.error };
	const voters = participation(
		body?.top_voters,
		stats?.votesPerUserId || new Map(),
		prizes.top_voters.amounts,
		"voter"
	);
	if (voters.error) return { ok: false, error: voters.error };

	const totalAmount = payouts.reduce((sum, p) => sum + p.amount, 0);
	return {
		ok: true,
		totalAmount,
		results: {
			version: CHALLENGE_RESULTS_VERSION,
			confirmed_by_user_id: Number(confirmedByUserId) || null,
			confirmed_at: now,
			winners,
			top_submitters: submitters.rows,
			top_voters: voters.rows,
			payouts
		}
	};
}

/**
 * Rows still owed money.
 * @param {object | null | undefined} results
 */
export function pendingPayoutRows(results) {
	const rows = Array.isArray(results?.payouts) ? results.payouts : [];
	return rows.filter(
		(row) =>
			row &&
			Number(row.amount) > 0 &&
			(row.paid_at == null || String(row.paid_at).trim() === "")
	);
}

function isPaidRow(row) {
	return row && row.paid_at != null && String(row.paid_at).trim() !== "";
}

/**
 * Apply a newly prepared draft on top of an existing one, keeping already-paid
 * payout rows (and their recipients) intact. Unpaid rows may change recipients.
 *
 * @param {object | null | undefined} existing
 * @param {object} next
 * @returns {{ ok: true, results: object } | { ok: false, error: string }}
 */
export function mergeResultsPreservingPaid(existing, next) {
	if (!next || typeof next !== "object" || !Array.isArray(next.payouts)) {
		return { ok: false, error: "Invalid results draft." };
	}
	const oldPayouts = Array.isArray(existing?.payouts) ? existing.payouts : [];
	const paidByReason = new Map();
	for (const row of oldPayouts) {
		if (!isPaidRow(row)) continue;
		const reason = String(row.reason || "").trim();
		if (reason) paidByReason.set(reason, row);
	}

	const payouts = [];
	for (let i = 0; i < next.payouts.length; i += 1) {
		const row = next.payouts[i];
		const reason = String(row?.reason || "").trim();
		const paid = (reason && paidByReason.get(reason)) || (isPaidRow(oldPayouts[i]) ? oldPayouts[i] : null);
		if (paid) {
			if (Number(paid.user_id) !== Number(row.user_id)) {
				return {
					ok: false,
					error: `Cannot change recipient for already-paid “${paid.reason || reason || "prize"}”.`
				};
			}
			payouts.push({
				...row,
				user_id: paid.user_id,
				amount: paid.amount,
				source: paid.source || row.source || "tip",
				paid_at: paid.paid_at
			});
			if (reason) paidByReason.delete(reason);
		} else {
			payouts.push({ ...row, paid_at: null });
		}
	}
	if (paidByReason.size > 0) {
		const leftover = [...paidByReason.keys()].join(", ");
		return {
			ok: false,
			error: `Saved draft is missing already-paid prize(s): ${leftover}.`
		};
	}

	const paidUserByPlace = new Map();
	for (const row of oldPayouts) {
		if (!isPaidRow(row)) continue;
		const m = String(row.reason || "").match(/^(\d)(?:st|nd|rd|th) place$/i);
		if (m) paidUserByPlace.set(Number(m[1]), Number(row.user_id));
	}
	const winnersIn = Array.isArray(next.winners) ? next.winners : [];
	const oldWinners = Array.isArray(existing?.winners) ? existing.winners : [];
	const winners = winnersIn.map((w) => {
		const place = Number(w.place);
		const paidUid = paidUserByPlace.get(place);
		if (paidUid == null) return w;
		const prev = oldWinners.find((x) => Number(x.place) === place);
		return prev && Number(prev.user_id) === paidUid ? prev : w;
	});

	return {
		ok: true,
		results: {
			...next,
			winners,
			payouts
		}
	};
}

/**
 * Execute pending payout rows. Source `{ type: 'tip', fromUserId }` transfers
 * credits from the funding account (the platform admin) via the tip system.
 *
 * Rows are mutated in place: `paid_at` is stamped as each grant succeeds, and
 * `afterRowPaid` (if provided) persists the updated results block so a crash
 * mid-loop leaves at most one paid-but-pending row. Never marks a row paid
 * before its transfer succeeded.
 *
 * @param {{
 *   queries: object,
 *   results: { payouts?: object[] },
 *   source: { type: 'tip', fromUserId: number },
 *   challengeId: string,
 *   challengeTitle?: string,
 *   afterRowPaid?: (results: object) => Promise<void>,
 *   onlyIndex?: number | null, // when set, pay only that payouts[] index (if pending)
 * }} args
 * @returns {Promise<{ paid: number, failed: { user_id: number, amount: number, reason: string, error: string }[] }>}
 */
export async function executeChallengePayouts({
	queries,
	results,
	source,
	challengeId,
	challengeTitle,
	afterRowPaid,
	onlyIndex = null
}) {
	const failed = [];
	let paid = 0;
	if (!source || source.type !== "tip") {
		throw new Error(`Unsupported payout source: ${source?.type || "none"}`);
	}
	const fromUserId = Number(source.fromUserId);
	if (!Number.isFinite(fromUserId) || fromUserId <= 0) {
		throw new Error("Payout source user required.");
	}
	if (!queries?.transferCredits?.run) {
		throw new Error("Credits transfer not available.");
	}
	const title = String(challengeTitle || challengeId || "challenge").trim();

	const allPayouts = Array.isArray(results?.payouts) ? results.payouts : [];
	const only =
		onlyIndex != null && Number.isFinite(Number(onlyIndex)) ? Number(onlyIndex) : null;
	const rowsToPay =
		only != null
			? (() => {
					const row = allPayouts[only];
					if (
						!row ||
						!(Number(row.amount) > 0) ||
						(row.paid_at != null && String(row.paid_at).trim() !== "")
					) {
						return [];
					}
					return [row];
				})()
			: pendingPayoutRows(results);

	for (const row of rowsToPay) {
		const toUserId = Number(row.user_id);
		const amount = Number(row.amount);
		if (toUserId === fromUserId) {
			failed.push({
				user_id: toUserId,
				amount,
				reason: row.reason,
				error: "Payouts cannot tip the funding account itself."
			});
			continue;
		}
		try {
			await queries.transferCredits.run(fromUserId, toUserId, amount);
		} catch (err) {
			failed.push({
				user_id: toUserId,
				amount,
				reason: row.reason,
				error: err?.message || "Transfer failed"
			});
			continue;
		}
		row.paid_at = new Date().toISOString();
		paid += 1;

		// Best-effort tip log + notification; the transfer is already done.
		const tipNote = challengePrizeTipNote({ title, reason: row.reason, amount });
		const notif = challengePrizeNotificationCopy({ title, reason: row.reason, amount });
		try {
			if (queries.insertTipActivity?.run) {
				await queries.insertTipActivity.run(
					fromUserId,
					toUserId,
					null,
					amount,
					tipNote,
					"challenge",
					{ challenge_id: challengeId, reason: row.reason }
				);
			}
		} catch {
			// ignore tip_activity failures
		}
		try {
			if (queries.insertNotification?.run) {
				await queries.insertNotification.run(
					toUserId,
					null,
					notif.title,
					notif.message,
					"/challenges",
					fromUserId,
					"tip",
					{},
					{ amount, challenge_id: challengeId, reason: row.reason, tip_note: tipNote }
				);
			}
		} catch {
			// ignore notification failures
		}
		if (typeof afterRowPaid === "function") {
			try {
				await afterRowPaid(results);
			} catch {
				// Persistence retried on the final write; do not fail the loop.
			}
		}
	}
	return { paid, failed };
}
