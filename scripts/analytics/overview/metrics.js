/**
 * Overview report — shared metric + chart math.
 *
 * Native ES module, ZERO dependencies. Imported two ways from ONE file:
 *  - Browser: `import * as M from "./metrics.js"` (served over http://localhost).
 *  - Node: `import { ... } from "./overview/metrics.js"` (used by the ETL).
 *
 * All day keys are US-East partition dates (fixed UTC-5, no DST) — the same
 * convention as api_routes/utils/visitPulseCore.js and the pulse/engagement
 * reports. Weeks are Sunday-start US-East; months are calendar US-East.
 *
 * ---------------------------------------------------------------------------
 * STORE SCHEMA (v1) — pinned here as the single source of truth.
 * The refresh ETL emits exactly this shape as `store.json`.
 * ---------------------------------------------------------------------------
 *
 * @typedef {Object} StoreMeta
 * @property {number} schemaVersion            Always 1 for this shape.
 * @property {string} tz                       Human label, e.g. "US East (UTC-5, no DST)".
 * @property {string} launchDay                Earliest day with signup or activity (YYYY-MM-DD).
 * @property {string} lastCompleteDay          Last complete US-East day at refresh (yesterday).
 * @property {string} lastRefresh              ISO timestamp of the refresh run.
 * @property {string[]} coreActionTypes        Action types counted as "core".
 *
 * @typedef {Object} StoreUser
 * @property {number} id
 * @property {string} signupDay                US-East day key of signup.
 * @property {boolean} paid                    Paid snapshot (founder or active stripe sub).
 * @property {string|null} label               Display label (local-only; may be null).
 * @property {string|null} userName            Handle (local-only; may be null).
 *
 * @typedef {Object} StoreUserHandle
 *   Handle lookup for logged-in visitors excluded from `users` (e.g. admin).
 *   Lets the Daily visitor table show @handles without counting them in action metrics.
 * @property {number} id
 * @property {string|null} userName
 *
 * @typedef {Object} StoreUserDay
 *   Per-user, per-day core-action + presence counts (one row per active user/day).
 * @property {number} u                        User id.
 * @property {string} d                        US-East day key.
 * @property {Object} c                        Counts by type (creation, publish, comment,
 *                                             like, reaction, tip_sent, mutations, session,
 *                                             follows, chat).
 *
 * @typedef {Object} StoreVisitDay
 *   Per-day visit-pulse rollup. Hourly arrays are partition-hour indexed (0..23).
 *   visitorKeys carry "u:<id>" / "v:<cid>" for range-recomputable distinct metrics.
 * @property {string} day
 * @property {number} hits
 * @property {number} blocks
 * @property {number} uniqueVisitors
 * @property {number} authedVisitors
 * @property {number} anonVisitors
 * @property {number[]} hourlyAuthed           len 24.
 * @property {number[]} hourlyAnon             len 24.
 * @property {string[]} visitorKeys
 * @property {{id:number,hits:number,hours:number[]}[]} authed
 *   Per-logged-in-user breakdown: hits + partition-hours (0..23) active. Authed only.
 * @property {Object|null} feedImpressions
 * @property {Object|null} landingFunnel
 *
 * @typedef {Object} StoreFunnelDay
 * @property {string} day
 * @property {number} shareViews
 * @property {number} shareCids
 * @property {number} tryRequests
 * @property {number} tryCids
 * @property {number} transitionedUsers
 *
 * @typedef {Object} StoreTransitionDay
 *   Related-grid ("click-next") activity proxy. `paths` = distinct from→to pairs
 *   whose MOST RECENT click landed on this US-East day (source stores lifetime
 *   counts + last_updated only). Logged-in only; NOT ignore-user filterable.
 * @property {string} day
 * @property {number} paths
 *
 * @typedef {Object} StoreTransitionTop
 *   All-time strongest related-grid paths (top N by lifetime count).
 * @property {number} from                     Source creation id.
 * @property {number} to                       Destination creation id.
 * @property {number} count                    Lifetime click count for the pair.
 * @property {string} lastDay                  US-East day of most recent click.
 * @property {string} fromLabel
 * @property {string} toLabel
 *
 * @typedef {Object} StoreChallenge
 *   Per-challenge metadata (schedule + phase). Counts are recomputed client-side
 *   from challengeSubs/challengeVotes so ignore-users applies.
 * @property {string} id
 * @property {string} title
 * @property {string} phase
 * @property {string|null} subStartDay         US-East day submissions open.
 * @property {string|null} subEndDay
 * @property {string|null} voteStartDay
 * @property {string|null} voteEndDay
 * @property {number|null} memberCount         #challenges channel members.
 *
 * @typedef {Object} StoreChallengeSub
 *   One challenge submission. @property {string} d US-East day. @property {number} u submitter.
 *   @property {string} c challenge id.
 *
 * @typedef {Object} StoreChallengeVote
 *   One challenge vote (dateless — DB stores who voted, not when).
 *   @property {number} u voter. @property {string} c challenge id. @property {number} to submitter who received it.
 *
 * @typedef {Object} Store
 * @property {StoreMeta} meta
 * @property {StoreUser[]} users
 * @property {StoreUserHandle[]} [userHandles]
 * @property {StoreUserDay[]} userDay
 * @property {StoreVisitDay[]} visitDaily
 * @property {StoreFunnelDay[]} [funnelDaily]
 * @property {StoreTransitionDay[]} [transitionsDaily]
 * @property {StoreTransitionTop[]} [transitionsTop]
 * @property {StoreChallenge[]} [challenges]
 * @property {StoreChallengeSub[]} [challengeSubs]
 * @property {StoreChallengeVote[]} [challengeVotes]
 */

export const SCHEMA_VERSION = 1;
export const CORE_ACTION_TYPES = ["creation", "publish", "comment", "like", "reaction", "tip_sent"];

/** Product milestone targets ("stable small room"). Shared by ETL and app. */
export const STABLE_ROOM = {
	id: "stable_small_room",
	title: "Stable small room",
	targets: {
		action_wau: 20,
		visit_wau: 25,
		avg_action_dau: 12,
		high_action_days: 3,
		commenters: 5,
		publishers: 3,
		returning_visit_rate: 0.5,
		top2_action_share_max: 0.5,
		action_wau_streak_weeks: 4
	}
};

/* -------------------------------------------------------------- */
/* Date helpers — US-East partition (fixed UTC-5, no DST).        */
/* -------------------------------------------------------------- */

const US_EAST_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function usEastDayKey(date = new Date()) {
	const ms = date instanceof Date ? date.getTime() : Number(date);
	const shifted = new Date(ms - US_EAST_OFFSET_MS);
	const y = shifted.getUTCFullYear();
	const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
	const d = String(shifted.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export function usEastDayStartMs(dayKey) {
	const [y, m, d] = String(dayKey || "").trim().split("-").map(Number);
	if (!y || !m || !d) throw new Error(`usEastDayStartMs: invalid dayKey ${dayKey}`);
	return Date.UTC(y, m - 1, d, 5, 0, 0, 0);
}

export function shiftDayKey(dayKey, deltaDays) {
	return usEastDayKey(usEastDayStartMs(dayKey) + deltaDays * DAY_MS);
}

export function enumerateDays(fromDay, toDay) {
	const out = [];
	if (!fromDay || !toDay || fromDay > toDay) return out;
	for (let d = fromDay; d <= toDay; d = shiftDayKey(d, 1)) out.push(d);
	return out;
}

export function usEastWeekStartKey(dayKey) {
	const noonMs = usEastDayStartMs(dayKey) + 12 * 60 * 60 * 1000;
	const dow = new Date(noonMs).getUTCDay(); // 0 = Sunday
	return shiftDayKey(dayKey, -dow);
}

export function usEastDayOfWeek(dayKey) {
	const noonMs = usEastDayStartMs(dayKey) + 12 * 60 * 60 * 1000;
	return new Date(noonMs).getUTCDay(); // 0 = Sunday … 6 = Saturday
}

export function usEastMonthKey(dayKey) {
	return String(dayKey).slice(0, 7);
}

export function usEastMonthStartKey(dayKey) {
	return `${usEastMonthKey(dayKey)}-01`;
}

export function weekLabel(weekStart) {
	return `${weekStart} → ${shiftDayKey(weekStart, 6)}`;
}

/* -------------------------------------------------------------- */
/* Small numeric helpers.                                         */
/* -------------------------------------------------------------- */

export function sum(nums) {
	let s = 0;
	for (const n of nums) if (Number.isFinite(n)) s += n;
	return s;
}

export function avg(nums) {
	const list = nums.filter((n) => Number.isFinite(n));
	return list.length ? sum(list) / list.length : 0;
}

export function pctRatio(a, b) {
	return b ? a / b : 0;
}

export function linearRegression(values) {
	const n = values.length;
	if (!n) return { slope: 0, intercept: 0 };
	if (n === 1) return { slope: 0, intercept: Number(values[0]) || 0 };
	let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
	for (let i = 0; i < n; i++) {
		const y = Number(values[i]) || 0;
		sumX += i;
		sumY += y;
		sumXY += i * y;
		sumXX += i * i;
	}
	const denom = n * sumXX - sumX * sumX;
	if (!denom) return { slope: 0, intercept: sumY / n };
	const slope = (n * sumXY - sumX * sumY) / denom;
	return { slope, intercept: (sumY - slope * sumX) / n };
}

/* -------------------------------------------------------------- */
/* Range slicing over the store.                                  */
/* -------------------------------------------------------------- */

const inRange = (day, from, to) => day >= from && day <= to;

export function userDaysInRange(store, from, to) {
	return (store.userDay || []).filter((r) => inRange(r.d, from, to));
}

export function visitDaysInRange(store, from, to) {
	return (store.visitDaily || []).filter((r) => inRange(r.day, from, to));
}

export function funnelDaysInRange(store, from, to) {
	return (store.funnelDaily || []).filter((r) => inRange(r.day, from, to));
}

const hasCoreAction = (counts, types) => {
	for (const t of types) if (Number(counts?.[t]) > 0) return true;
	return false;
};

/* -------------------------------------------------------------- */
/* Active-user metrics (action / visit / traffic).                */
/* -------------------------------------------------------------- */

export function actionActiveUsers(store, from, to, types = CORE_ACTION_TYPES) {
	const set = new Set();
	for (const r of userDaysInRange(store, from, to)) if (hasCoreAction(r.c, types)) set.add(r.u);
	return set;
}

export function visitActiveUsers(store, from, to) {
	const set = new Set();
	for (const r of visitDaysInRange(store, from, to)) {
		for (const key of r.visitorKeys || []) if (key.startsWith("u:")) set.add(Number(key.slice(2)));
	}
	return set;
}

export function trafficVisitorKeys(store, from, to) {
	const set = new Set();
	for (const r of visitDaysInRange(store, from, to)) for (const key of r.visitorKeys || []) set.add(key);
	return set;
}

export function actionDauSeries(store, from, to, types = CORE_ACTION_TYPES) {
	const byDay = new Map();
	for (const r of userDaysInRange(store, from, to)) {
		if (!hasCoreAction(r.c, types)) continue;
		if (!byDay.has(r.d)) byDay.set(r.d, new Set());
		byDay.get(r.d).add(r.u);
	}
	return enumerateDays(from, to).map((day) => ({ day, dau: byDay.get(day)?.size || 0 }));
}

export function trafficDauSeries(store, from, to) {
	const byDay = new Map(visitDaysInRange(store, from, to).map((r) => [r.day, r]));
	return enumerateDays(from, to).map((day) => {
		const r = byDay.get(day);
		return {
			day,
			traffic_dau: Number(r?.uniqueVisitors) || 0,
			visit_dau: Number(r?.authedVisitors) || 0,
			anon_dau: Number(r?.anonVisitors) || 0,
			hits: Number(r?.hits) || 0,
			blocks: Number(r?.blocks) || 0
		};
	});
}

export function weeklyActiveSeries(store, from, to, types = CORE_ACTION_TYPES) {
	const byWeek = new Map();
	for (const r of userDaysInRange(store, from, to)) {
		if (!hasCoreAction(r.c, types)) continue;
		const wk = usEastWeekStartKey(r.d);
		if (!byWeek.has(wk)) byWeek.set(wk, new Set());
		byWeek.get(wk).add(r.u);
	}
	return [...byWeek.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([week, set]) => ({ week, week_label: weekLabel(week), wau: set.size }));
}

export function monthlyActiveSeries(store, from, to, types = CORE_ACTION_TYPES) {
	const byMonth = new Map();
	for (const r of userDaysInRange(store, from, to)) {
		if (!hasCoreAction(r.c, types)) continue;
		const mk = usEastMonthKey(r.d);
		if (!byMonth.has(mk)) byMonth.set(mk, new Set());
		byMonth.get(mk).add(r.u);
	}
	return [...byMonth.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([month, set]) => ({ month, mau: set.size }));
}

/* -------------------------------------------------------------- */
/* Signups, cohorts, churn, activation.                           */
/* -------------------------------------------------------------- */

export function newUsersInRange(store, from, to) {
	return (store.users || []).filter((u) => inRange(u.signupDay, from, to)).length;
}

export function newUsersByDay(store, from, to) {
	const byDay = new Map();
	for (const u of store.users || []) {
		if (inRange(u.signupDay, from, to)) byDay.set(u.signupDay, (byDay.get(u.signupDay) || 0) + 1);
	}
	return enumerateDays(from, to).map((day) => ({ day, new_users: byDay.get(day) || 0 }));
}

function actionDaysByUserIndex(store, types) {
	const idx = new Map();
	for (const r of store.userDay || []) {
		if (!hasCoreAction(r.c, types)) continue;
		if (!idx.has(r.u)) idx.set(r.u, new Set());
		idx.get(r.u).add(r.d);
	}
	return idx;
}

export function cohortRetention(store, from, to, types = CORE_ACTION_TYPES) {
	const cohorts = new Map();
	for (const u of store.users || []) {
		if (!inRange(u.signupDay, from, to)) continue;
		const wk = usEastWeekStartKey(u.signupDay);
		if (!cohorts.has(wk)) cohorts.set(wk, []);
		cohorts.get(wk).push(u.id);
	}
	const actionDays = actionDaysByUserIndex(store, types);
	const activeBetween = (uid, startDay, endDayExclusive) => {
		const days = actionDays.get(uid);
		if (!days) return false;
		for (const d of days) if (d >= startDay && d < endDayExclusive) return true;
		return false;
	};
	return [...cohorts.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([cohort, ids]) => {
			const size = ids.length;
			const w1Start = shiftDayKey(cohort, 7);
			const w1End = shiftDayKey(cohort, 14);
			const w4Start = shiftDayKey(cohort, 28);
			const w4End = shiftDayKey(cohort, 35);
			let w1 = 0, w4 = 0;
			for (const uid of ids) {
				if (activeBetween(uid, w1Start, w1End)) w1++;
				if (activeBetween(uid, w4Start, w4End)) w4++;
			}
			return {
				cohort,
				cohort_label: weekLabel(cohort),
				signups: size,
				w1_retained: w1,
				w1_rate: pctRatio(w1, size),
				w4_retained: w4,
				w4_rate: pctRatio(w4, size)
			};
		});
}

export function churnSplit(store, from, to, types = CORE_ACTION_TYPES) {
	const days = enumerateDays(from, to);
	if (days.length < 2) return { churned: 0, prevActive: 0, currActive: 0 };
	const mid = Math.floor(days.length / 2);
	const firstDays = new Set(days.slice(0, mid));
	const secondDays = new Set(days.slice(mid));
	const prev = new Set();
	const curr = new Set();
	for (const r of store.userDay || []) {
		if (!hasCoreAction(r.c, types)) continue;
		if (firstDays.has(r.d)) prev.add(r.u);
		if (secondDays.has(r.d)) curr.add(r.u);
	}
	let churned = 0;
	for (const uid of prev) if (!curr.has(uid)) churned++;
	return { churned, prevActive: prev.size, currActive: curr.size };
}

export function signupFunnel(store, from, to, types = CORE_ACTION_TYPES) {
	const signups = (store.users || []).filter((u) => inRange(u.signupDay, from, to));
	const actionDays = actionDaysByUserIndex(store, types);
	let activated = 0, retained = 0, paid = 0;
	for (const u of signups) {
		const days = actionDays.get(u.id);
		if (days) {
			const actEnd = shiftDayKey(u.signupDay, 7);
			const retStart = shiftDayKey(u.signupDay, 7);
			const retEnd = shiftDayKey(u.signupDay, 30);
			let hasAct = false, hasRet = false;
			for (const d of days) {
				if (d >= u.signupDay && d < actEnd) hasAct = true;
				if (d >= retStart && d < retEnd) hasRet = true;
			}
			if (hasAct) activated++;
			if (hasRet) retained++;
		}
		if (u.paid) paid++;
	}
	return { signups: signups.length, activated, retained, paid };
}

/* -------------------------------------------------------------- */
/* Action mix, leaders, top-2 share, actions-per-active.          */
/* -------------------------------------------------------------- */

export function actionMix(store, from, to, types = CORE_ACTION_TYPES) {
	const mix = {};
	for (const t of types) mix[t] = 0;
	for (const r of userDaysInRange(store, from, to)) for (const t of types) mix[t] += Number(r.c?.[t]) || 0;
	return mix;
}

export function engagementLeaders(store, from, to, types = CORE_ACTION_TYPES) {
	const byUser = new Map();
	for (const r of userDaysInRange(store, from, to)) {
		let core = 0;
		for (const t of types) core += Number(r.c?.[t]) || 0;
		if (!byUser.has(r.u)) byUser.set(r.u, { user_id: r.u, core_actions: 0, active_days: 0, mix: {} });
		const rec = byUser.get(r.u);
		rec.core_actions += core;
		if (core > 0) rec.active_days += 1;
		for (const t of Object.keys(r.c || {})) rec.mix[t] = (rec.mix[t] || 0) + (Number(r.c[t]) || 0);
	}
	const users = new Map((store.users || []).map((u) => [u.id, u]));
	return [...byUser.values()]
		.map((rec) => {
			const u = users.get(rec.user_id);
			return {
				...rec,
				label: u?.label || `user ${rec.user_id}`,
				user_name: u?.userName || null,
				actions_per_active_day: pctRatio(rec.core_actions, rec.active_days)
			};
		})
		.sort((a, b) => b.core_actions - a.core_actions);
}

export function top2ActionShare(store, from, to, types = CORE_ACTION_TYPES) {
	const leaders = engagementLeaders(store, from, to, types);
	const total = leaders.reduce((s, l) => s + l.core_actions, 0);
	const top2 = (leaders[0]?.core_actions || 0) + (leaders[1]?.core_actions || 0);
	return { top2, total, share: pctRatio(top2, total) };
}

export function actionsPerActiveUser(store, from, to, types = CORE_ACTION_TYPES) {
	const active = actionActiveUsers(store, from, to, types);
	let volume = 0;
	for (const r of userDaysInRange(store, from, to)) for (const t of types) volume += Number(r.c?.[t]) || 0;
	return { volume, activeUsers: active.size, perActive: pctRatio(volume, active.size) };
}

/* -------------------------------------------------------------- */
/* Weekday × hour traffic heatmap.                                */
/* -------------------------------------------------------------- */

/**
 * Weekday × hour presence grid over a range.
 * @param {"all"|"authed"|"anon"} [opts.series] Which visitors to count. Default "all".
 *   (Legacy: `authedOnly:true` still works and maps to "authed".)
 */
export function weekdayHourHeatmap(store, from, to, opts = {}) {
	const series = opts.series || (opts.authedOnly ? "authed" : "all");
	const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
	let max = 0;
	for (const r of visitDaysInRange(store, from, to)) {
		const dow = usEastDayOfWeek(r.day);
		for (let h = 0; h < 24; h++) {
			const authed = Number(r.hourlyAuthed?.[h]) || 0;
			const anon = Number(r.hourlyAnon?.[h]) || 0;
			const val = series === "authed" ? authed : series === "anon" ? anon : authed + anon;
			grid[dow][h] += val;
			if (grid[dow][h] > max) max = grid[dow][h];
		}
	}
	return { grid, max };
}

/* -------------------------------------------------------------- */
/* Funnel (share -> try) volume over a range.                     */
/* -------------------------------------------------------------- */

export function funnelTotals(store, from, to) {
	const rows = funnelDaysInRange(store, from, to);
	return rows.reduce(
		(acc, r) => ({
			shareViews: acc.shareViews + (Number(r.shareViews) || 0),
			tryRequests: acc.tryRequests + (Number(r.tryRequests) || 0),
			transitionedUsers: acc.transitionedUsers + (Number(r.transitionedUsers) || 0)
		}),
		{ shareViews: 0, tryRequests: 0, transitionedUsers: 0 }
	);
}

/* -------------------------------------------------------------- */
/* Feed engagement (feed-beta impressions: dwell + click).        */
/* -------------------------------------------------------------- */

/** Zero-filled per-day feed-impression series over the range. */
export function feedImpressionSeries(store, from, to) {
	const byDay = new Map();
	for (const r of visitDaysInRange(store, from, to)) {
		const fi = r.feedImpressions;
		if (fi) byDay.set(r.day, fi);
	}
	return enumerateDays(from, to).map((day) => {
		const fi = byDay.get(day) || null;
		return {
			day,
			total: Number(fi?.total_impressions) || 0,
			dwell: Number(fi?.dwell_impressions) || 0,
			click: Number(fi?.click_impressions) || 0,
			impressors: Number(fi?.unique_impressors) || 0,
			creations: Number(fi?.unique_creations) || 0
		};
	});
}

/**
 * Range totals for feed impressions. Impressions sum over days; unique impressors
 * and creations are per-day dedup'd only (no cross-day identity in the store), so
 * they're reported as peak-day maxima, not true range-distinct counts.
 */
export function feedImpressionTotals(store, from, to) {
	let total = 0, dwell = 0, click = 0, maxImpressors = 0, maxCreations = 0, daysWithData = 0;
	for (const r of visitDaysInRange(store, from, to)) {
		const fi = r.feedImpressions;
		if (!fi) continue;
		daysWithData++;
		total += Number(fi.total_impressions) || 0;
		dwell += Number(fi.dwell_impressions) || 0;
		click += Number(fi.click_impressions) || 0;
		maxImpressors = Math.max(maxImpressors, Number(fi.unique_impressors) || 0);
		maxCreations = Math.max(maxCreations, Number(fi.unique_creations) || 0);
	}
	return {
		total,
		dwell,
		click,
		clickRate: pctRatio(click, total),
		peakImpressors: maxImpressors,
		peakCreations: maxCreations,
		daysWithData
	};
}

/* -------------------------------------------------------------- */
/* Related-grid ("click-next") browsing.                          */
/* -------------------------------------------------------------- */

/** Zero-filled per-day series of related-grid "paths touched" over the range. */
export function transitionPathsSeries(store, from, to) {
	const byDay = new Map((store.transitionsDaily || []).map((r) => [r.day, Number(r.paths) || 0]));
	return enumerateDays(from, to).map((day) => ({ day, paths: byDay.get(day) || 0 }));
}

/** Total related-grid paths touched in the range (sum of the daily proxy). */
export function transitionPathsTotal(store, from, to) {
	let n = 0;
	for (const r of store.transitionsDaily || []) if (inRange(r.day, from, to)) n += Number(r.paths) || 0;
	return n;
}

/** Top all-time related paths whose most recent click falls within the range. */
export function transitionTopInRange(store, from, to, limit = 15) {
	return (store.transitionsTop || [])
		.filter((r) => inRange(r.lastDay, from, to))
		.slice(0, limit);
}

/* -------------------------------------------------------------- */
/* Challenge participation.                                       */
/* -------------------------------------------------------------- */

/** Zero-filled per-day series of challenge submissions over the range. */
export function challengeSubmissionsSeries(store, from, to) {
	const byDay = new Map();
	for (const r of store.challengeSubs || []) if (inRange(r.d, from, to)) byDay.set(r.d, (byDay.get(r.d) || 0) + 1);
	return enumerateDays(from, to).map((day) => ({ day, submissions: byDay.get(day) || 0 }));
}

/**
 * Per-challenge participation for challenges active in the range (submission
 * window intersects [from,to]). Counts recomputed from per-user rows, so ignore
 * filtering already applied upstream via the filtered store. Votes are dateless,
 * so a challenge's vote totals are lifetime (not range-clipped).
 */
export function challengesInRange(store, from, to) {
	const subsByChallenge = new Map();
	for (const s of store.challengeSubs || []) {
		if (!subsByChallenge.has(s.c)) subsByChallenge.set(s.c, []);
		subsByChallenge.get(s.c).push(s);
	}
	const votesByChallenge = new Map();
	for (const v of store.challengeVotes || []) {
		if (!votesByChallenge.has(v.c)) votesByChallenge.set(v.c, []);
		votesByChallenge.get(v.c).push(v);
	}
	const out = [];
	for (const ch of store.challenges || []) {
		const start = ch.subStartDay || null;
		const end = ch.voteEndDay || ch.subEndDay || ch.subStartDay || null;
		// Keep if the challenge window intersects the range, or (no schedule) if it
		// has any submission in range.
		const subs = subsByChallenge.get(ch.id) || [];
		const inWindow = start && end ? start <= to && end >= from : subs.some((s) => inRange(s.d, from, to));
		if (!inWindow) continue;
		const votes = votesByChallenge.get(ch.id) || [];
		const uniqueSubmitters = new Set(subs.map((s) => s.u)).size;
		const uniqueVoters = new Set(votes.map((v) => v.u)).size;
		out.push({
			...ch,
			submissions: subs.length,
			uniqueSubmitters,
			totalVotes: votes.length,
			uniqueVoters,
			submitterRate: ch.memberCount ? pctRatio(uniqueSubmitters, ch.memberCount) : null,
			voterRate: ch.memberCount ? pctRatio(uniqueVoters, ch.memberCount) : null
		});
	}
	return out.sort((a, b) => String(b.subStartDay || "").localeCompare(String(a.subStartDay || "")));
}

/* -------------------------------------------------------------- */
/* Chart builders — return SVG strings.                           */
/* -------------------------------------------------------------- */

const escSvg = (s) =>
	String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Chart viewBox geometry. Aspect (~1.73:1) is tuned to the half-width grid-2
// container so the SVG fills CHART_RENDER_H with no letterbox on desktop.
const CHART_W = 1040;
const CHART_H = 600;
const CHART_PAD = 44;
const CHART_FONT = 16;
const CHART_RENDER_H = 320;

export function sparkline(rows, valueKey, labelKey, color = "#0f766e", opts = {}) {
	const { showTrend = false, trendColor = "#ef4444" } = opts;
	const w = CHART_W, h = CHART_H, p = CHART_PAD;
	if (!rows || !rows.length) return '<p class="small">No data.</p>';
	const values = rows.map((r) => Number(r[valueKey]) || 0);
	const minY = Math.min(...values, 0);
	const maxY = Math.max(...values, 1);
	const range = Math.max(maxY - minY, 1);
	const x = (i) => p + ((w - p * 2) * i) / Math.max(rows.length - 1, 1);
	const y = (v) => h - p - ((h - p * 2) * (v - minY)) / range;
	const points = rows.map((r, i) => `${x(i).toFixed(1)},${y(Number(r[valueKey]) || 0).toFixed(1)}`).join(" ");
	const circles = rows
		.map((r, i) => {
			const cy = y(Number(r[valueKey]) || 0).toFixed(1);
			return `<circle cx="${x(i).toFixed(1)}" cy="${cy}" r="${i === rows.length - 1 ? 4 : 2.5}" fill="${color}"><title>${escSvg(r[labelKey])}: ${Number(r[valueKey]) || 0}</title></circle>`;
		})
		.join("");
	let trendHtml = "";
	if (showTrend) {
		const lr = linearRegression(values);
		const y0 = lr.intercept;
		const yN = lr.intercept + lr.slope * Math.max(rows.length - 1, 0);
		const slopeText = lr.slope > 0 ? `+${lr.slope.toFixed(3)}` : lr.slope.toFixed(3);
		trendHtml = `<line x1="${x(0).toFixed(1)}" y1="${y(y0).toFixed(1)}" x2="${x(rows.length - 1).toFixed(1)}" y2="${y(yN).toFixed(1)}" stroke="${trendColor}" stroke-width="2" stroke-dasharray="6 5"><title>slope ${slopeText}/period</title></line>`;
	}
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${CHART_RENDER_H}" preserveAspectRatio="xMidYMid meet" aria-label="${escSvg(valueKey)} trend">
		<line x1="${p}" y1="${h - p}" x2="${w - p}" y2="${h - p}" stroke="#e2e8f0"/>
		<line x1="${p}" y1="${p}" x2="${p}" y2="${h - p}" stroke="#e2e8f0"/>
		${trendHtml}
		<polyline fill="none" stroke="${color}" stroke-width="3" points="${points}"/>
		${circles}
		<text x="${p}" y="${h - 12}" font-size="${CHART_FONT}" fill="#64748b">${escSvg(rows[0][labelKey])}</text>
		<text x="${w - p}" y="${h - 12}" text-anchor="end" font-size="${CHART_FONT}" fill="#64748b">${escSvg(rows[rows.length - 1][labelKey])}</text>
		<text x="${p}" y="${p - 10}" font-size="${CHART_FONT}" fill="#64748b">max ${maxY}</text>
	</svg>`;
}

export function barChart(rows, valueKey, labelKey, color = "#2563eb") {
	const w = CHART_W, h = CHART_H, p = CHART_PAD;
	if (!rows || !rows.length) return '<p class="small">No data.</p>';
	const values = rows.map((r) => Number(r[valueKey]) || 0);
	const maxY = Math.max(...values, 1);
	const colW = (w - p * 2) / rows.length;
	const bw = Math.max(2, colW * 0.8);
	const bars = rows
		.map((r, i) => {
			const v = Number(r[valueKey]) || 0;
			const bh = (h - p * 2) * (v / maxY);
			const bx = p + i * colW + (colW - bw) / 2;
			const by = h - p - bh;
			return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}"><title>${escSvg(r[labelKey])}: ${v}</title></rect>`;
		})
		.join("");
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${CHART_RENDER_H}" preserveAspectRatio="xMidYMid meet" aria-label="${escSvg(valueKey)} bars">
		<line x1="${p}" y1="${h - p}" x2="${w - p}" y2="${h - p}" stroke="#e2e8f0"/>
		<line x1="${p}" y1="${p}" x2="${p}" y2="${h - p}" stroke="#e2e8f0"/>
		${bars}
		<text x="${p}" y="${h - 12}" font-size="${CHART_FONT}" fill="#64748b">${escSvg(rows[0][labelKey])}</text>
		<text x="${w - p}" y="${h - 12}" text-anchor="end" font-size="${CHART_FONT}" fill="#64748b">${escSvg(rows[rows.length - 1][labelKey])}</text>
		<text x="${p}" y="${p - 10}" font-size="${CHART_FONT}" fill="#64748b">max ${maxY}</text>
	</svg>`;
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function heatmapSvg(data, opts = {}) {
	const { grid, max } = data || {};
	const { label = "Weekday × hour", rgb = "15,118,110" } = opts;
	if (!grid || !max) return '<p class="small">No data.</p>';
	const cell = 34, rowH = 26, padL = 44, padT = 20;
	const w = padL + 24 * cell + 8;
	const h = padT + 7 * rowH + 24;
	const cells = [];
	for (let d = 0; d < 7; d++) {
		for (let hr = 0; hr < 24; hr++) {
			const v = grid[d][hr];
			const t = max ? v / max : 0;
			const fill = v ? `rgba(${rgb},${(0.12 + 0.88 * t).toFixed(3)})` : "#f1f5f9";
			cells.push(
				`<rect x="${padL + hr * cell}" y="${padT + d * rowH}" width="${cell - 2}" height="${rowH - 2}" fill="${fill}"><title>${DOW_LABELS[d]} ${hr}:00 — ${v}</title></rect>`
			);
		}
	}
	const dowLabels = DOW_LABELS.map(
		(l, d) => `<text x="${padL - 6}" y="${padT + d * rowH + rowH / 2 + 3}" text-anchor="end" font-size="10" fill="#64748b">${l}</text>`
	).join("");
	const hourLabels = Array.from({ length: 24 }, (_, hr) =>
		hr % 3 === 0 ? `<text x="${padL + hr * cell + cell / 2}" y="${padT + 7 * rowH + 14}" text-anchor="middle" font-size="9" fill="#64748b">${hr}</text>` : ""
	).join("");
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" aria-label="${escSvg(label)}">
		${cells.join("")}
		${dowLabels}
		${hourLabels}
	</svg>`;
}

/** Simple 24-slot hour bar chart from a length-24 count array. */
export function hourBars(counts, color = "#0f766e", label = "By hour") {
	const rows = (counts || []).map((v, hr) => ({ hr, label: `${hr}:00`, v: Number(v) || 0 }));
	return barChart(rows, "v", "label", color);
}
