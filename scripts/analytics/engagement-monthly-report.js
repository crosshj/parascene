#!/usr/bin/env node
/**
 * Monthly engagement report: visit pulse (traffic) + growth story events (core actions).
 *
 * Usage:
 *   node scripts/analytics/engagement-monthly-report.js
 *   node scripts/analytics/engagement-monthly-report.js --month 2026-06
 *   node scripts/analytics/engagement-monthly-report.js --days 30
 *   node scripts/analytics/engagement-monthly-report.js --from 2026-05-20 --to 2026-05-28
 *
 * Default: current US East calendar month through yesterday (incomplete today excluded).
 * `--to` today is clamped to yesterday. `--days` = trailing N days instead of calendar month.
 * HTML: engagement-monthly-report.html · CSS: report.css
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { REPO_ROOT, loadEnv } from "../repo-root.cjs";
import { loadReportStyleBlock } from "./report-styles.js";
import {
	usEastDayKey,
	usEastDayStartMs,
	yesterdayUsEastDayKey
} from "../../api_routes/utils/visitPulseCore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();

const TEMPLATE_PATH = path.join(__dirname, "engagement-monthly-report.html");
const DEFAULT_DAYS = Number(process.env.ENGAGEMENT_WINDOW_DAYS || 30);
const PULSE_DAY_MS = 24 * 60 * 60 * 1000;
const CORE_ACTION_TYPES = new Set(["creation", "publish", "comment", "like", "reaction", "tip_sent"]);

/** Product milestone: “stable small room” — logged-in engagement, not traffic. */
const MILESTONE_STABLE_SMALL_ROOM = {
	id: "stable_small_room",
	title: "Stable small room",
	subtitle:
		"Feels inhabited to a new logged-in visitor. Measured on the latest week in this window (US East Mon–Sun); sustain = 4 consecutive weeks with action WAU ≥ 20.",
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

const esc = (s) =>
	String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let templateCache = null;

function fillHtmlTemplate(template, values) {
	return template.replace(/\{\{(!?)([a-zA-Z0-9_]+)\}\}/g, (_, raw, key) => {
		if (!(key in values)) return "";
		const v = values[key];
		return raw === "!" ? String(v ?? "") : esc(v);
	});
}

async function loadTemplate() {
	if (!templateCache) templateCache = await fs.readFile(TEMPLATE_PATH, "utf8");
	return templateCache;
}

function getArg(name) {
	const argv = process.argv.slice(2);
	const long = `--${name}`;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === long && argv[i + 1] != null && !argv[i + 1].startsWith("--")) {
			return String(argv[i + 1]).trim();
		}
		if (argv[i].startsWith(`${long}=`)) return argv[i].slice(long.length + 1).trim();
	}
	return "";
}

function shiftDayKey(dayKey, deltaDays) {
	return usEastDayKey(new Date(usEastDayStartMs(dayKey) + deltaDays * PULSE_DAY_MS));
}

function dayCountInclusive(fromDay, toDay) {
	let n = 0;
	for (let d = fromDay; d <= toDay; d = shiftDayKey(d, 1)) n++;
	return n;
}

/** @param {string} dayKey YYYY-MM-DD */
function usEastMonthStartKey(dayKey) {
	const [y, m] = String(dayKey || "")
		.trim()
		.split("-")
		.map((x) => Number(x));
	if (!y || !m) throw new Error(`usEastMonthStartKey: invalid dayKey ${dayKey}`);
	return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** @param {string} dayKey YYYY-MM-DD */
function usEastMonthEndKey(dayKey) {
	const start = usEastMonthStartKey(dayKey);
	const [y, m] = start.split("-").map((x) => Number(x));
	const nextMonthStart =
		m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
	return shiftDayKey(nextMonthStart, -1);
}

function resolveWindow() {
	const fromArg = getArg("from");
	const toArg = getArg("to");
	if (/^\d{4}-\d{2}-\d{2}$/.test(fromArg) && /^\d{4}-\d{2}-\d{2}$/.test(toArg)) {
		const today = usEastDayKey();
		let toDay = toArg;
		if (toArg >= today) {
			toDay = yesterdayUsEastDayKey();
			if (toArg === today) {
				console.warn(
					`[engagement-monthly] --to ${toArg} is today (incomplete); using yesterday ${toDay}`
				);
			}
		}
		return { fromDay: fromArg, toDay: fromArg <= toDay ? toDay : fromArg };
	}

	const monthArg = getArg("month");
	if (/^\d{4}-\d{2}$/.test(monthArg)) {
		const fromDay = `${monthArg}-01`;
		const monthEnd = usEastMonthEndKey(fromDay);
		const yesterday = yesterdayUsEastDayKey();
		const toDay = monthEnd <= yesterday ? monthEnd : yesterday;
		return { fromDay, toDay };
	}

	const daysArg = getArg("days");
	if (daysArg) {
		const days = Math.max(1, Number(daysArg) || DEFAULT_DAYS);
		const toDay = yesterdayUsEastDayKey();
		const fromDay = shiftDayKey(toDay, -(days - 1));
		return { fromDay, toDay };
	}

	const toDay = yesterdayUsEastDayKey();
	const fromDay = usEastMonthStartKey(toDay);
	return { fromDay, toDay };
}

function safeDate(value) {
	if (!value) return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

function parseUserMeta(value) {
	if (value == null) return {};
	if (typeof value === "object") return value;
	try {
		return JSON.parse(String(value));
	} catch {
		return {};
	}
}

function parseEventMeta(value) {
	if (value == null) return {};
	if (typeof value === "object") return value;
	try {
		return JSON.parse(String(value));
	} catch {
		return {};
	}
}

function isPaidUser(user) {
	const meta = parseUserMeta(user?.meta);
	return Boolean(
		meta?.plan === "founder" || (meta?.stripeSubscriptionId && String(meta.stripeSubscriptionId).trim())
	);
}

function pct(a, b) {
	return !b ? "0.0%" : `${((100 * a) / b).toFixed(1)}%`;
}

function signedPct(curr, prev) {
	if (!prev && !curr) return "0.0%";
	if (!prev && curr) return "+100.0%";
	const delta = ((curr - prev) / prev) * 100;
	return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
}

function avg(nums) {
	const list = nums.filter((n) => Number.isFinite(n));
	return list.length ? list.reduce((s, n) => s + n, 0) / list.length : 0;
}

function fmt1(n) {
	return Number.isFinite(n) ? n.toFixed(1) : "0.0";
}

function fmt2(n) {
	return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

/** Monday-start week key (US East partition day). */
function usEastWeekStartKey(dayKey) {
	const noonMs = usEastDayStartMs(dayKey) + 12 * 60 * 60 * 1000;
	const dow = new Date(noonMs).getUTCDay();
	const mondayShift = (dow + 6) % 7;
	return shiftDayKey(dayKey, -mondayShift);
}

function weekLabel(weekStart) {
	return `${weekStart} → ${shiftDayKey(weekStart, 6)}`;
}

function table(rows, cols) {
	if (!rows.length) return '<p class="small">None.</p>';
	return `<table><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows
		.map(
			(r) =>
				`<tr>${cols
					.map((c) => `<td>${c.html ? c.html(r) : esc(r[c.key])}</td>`)
					.join("")}</tr>`
		)
		.join("")}</tbody></table>`;
}

function tableWithWeekHeaders(rows, cols, { weekKey = "week_start", weekLabelKey = "week_label" } = {}) {
	if (!rows.length) return '<p class="small">None.</p>';
	const head = `<thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead>`;
	const body = [];
	let lastWeek = null;
	for (const r of rows) {
		if (r[weekKey] !== lastWeek) {
			lastWeek = r[weekKey];
			body.push(
				`<tr class="week-head"><td colspan="${cols.length}">Week ${esc(r[weekLabelKey])}</td></tr>`
			);
		}
		body.push(
			`<tr>${cols.map((c) => `<td>${c.html ? c.html(r) : esc(r[c.key])}</td>`).join("")}</tr>`
		);
	}
	return `<table>${head}<tbody>${body.join("")}</tbody></table>`;
}

/** Logged-in pulse visitors only (excludes anonymous cookie traffic). */
function summarizeLoggedInPulseVisitors(pulse) {
	const authed = (pulse?.details?.visitors || []).filter((v) => Number(v.user_id) > 0);
	if (!authed.length) {
		return {
			hits_per_visit_dau: 0,
			blocks_per_visit_dau: 0,
			deep_visit_dau: 0,
			deep_visit_rate: 0
		};
	}
	let totalHits = 0;
	let totalBlocks = 0;
	let deep = 0;
	for (const v of authed) {
		const hits = Number(v.hits) || 0;
		const blocks = Array.isArray(v.ranges) ? v.ranges.length : 0;
		totalHits += hits;
		totalBlocks += blocks;
		if (hits >= 2 || blocks >= 1) deep++;
	}
	const n = authed.length;
	return {
		hits_per_visit_dau: totalHits / n,
		blocks_per_visit_dau: totalBlocks / n,
		deep_visit_dau: deep,
		deep_visit_rate: deep / n
	};
}

function weekBoundaryIndices(rows, weekKey = "week_start") {
	const indices = new Set();
	for (let i = 0; i < rows.length; i++) {
		if (i === 0 || rows[i][weekKey] !== rows[i - 1][weekKey]) indices.add(i);
	}
	return indices;
}

function linearRegression(values) {
	const n = values.length;
	if (!n) return { slope: 0, intercept: 0 };
	if (n === 1) return { slope: 0, intercept: values[0] || 0 };
	let sumX = 0;
	let sumY = 0;
	let sumXY = 0;
	let sumXX = 0;
	for (let i = 0; i < n; i++) {
		const x = i;
		const y = Number(values[i] || 0);
		sumX += x;
		sumY += y;
		sumXY += x * y;
		sumXX += x * x;
	}
	const denom = n * sumXX - sumX * sumX;
	if (!denom) return { slope: 0, intercept: sumY / n };
	const slope = (n * sumXY - sumX * sumY) / denom;
	const intercept = (sumY - slope * sumX) / n;
	return { slope, intercept };
}

function formatTrendSlope(slope) {
	return slope > 0 ? `+${slope.toFixed(3)}` : slope.toFixed(3);
}

function sparkline(
	rows,
	valueKey,
	labelKey,
	color,
	{ weekBoundaryKey = "week_start", showTrend = false, trendColor = "#ef4444" } = {}
) {
	const w = 980;
	const h = 220;
	const p = 28;
	if (!rows.length) return '<p class="small">No data.</p>';
	const values = rows.map((r) => Number(r[valueKey] || 0));
	const minY = Math.min(...values, 0);
	const maxY = Math.max(...values, 1);
	const range = Math.max(maxY - minY, 1);
	const x = (i) => p + ((w - p * 2) * i) / Math.max(rows.length - 1, 1);
	const y = (v) => h - p - ((h - p * 2) * (v - minY)) / range;
	const points = rows.map((r, i) => `${x(i).toFixed(1)},${y(Number(r[valueKey] || 0)).toFixed(1)}`).join(" ");
	const circles = rows
		.map((r, i) => {
			const cx = x(i).toFixed(1);
			const cy = y(Number(r[valueKey] || 0)).toFixed(1);
			return `<circle cx="${cx}" cy="${cy}" r="${i === rows.length - 1 ? 4 : 2.5}" fill="${color}"><title>${esc(r[labelKey])}: ${Number(r[valueKey] || 0)}</title></circle>`;
		})
		.join("");
	const weekLines = [...weekBoundaryIndices(rows, weekBoundaryKey)]
		.map((i) => {
			const xi = x(i).toFixed(1);
			return `<line x1="${xi}" y1="${p}" x2="${xi}" y2="${h - p}" stroke="#e2e8f0" stroke-dasharray="4 3"/>`;
		})
		.join("");
	let trendHtml = "";
	let trendLabelHtml = "";
	if (showTrend) {
		const lr = linearRegression(values);
		const y0 = lr.intercept;
		const yN = lr.intercept + lr.slope * Math.max(rows.length - 1, 0);
		const trendSlopeText = formatTrendSlope(lr.slope);
		trendHtml = `<line x1="${x(0).toFixed(1)}" y1="${y(y0).toFixed(1)}" x2="${x(rows.length - 1).toFixed(1)}" y2="${y(yN).toFixed(1)}" stroke="${trendColor}" stroke-width="2" stroke-dasharray="6 5"><title>Linear trend slope: ${trendSlopeText} per day</title></line>`;
		trendLabelHtml = `<text x="${w - p}" y="${p - 8}" text-anchor="end" font-size="11" fill="${trendColor}">trend slope ${trendSlopeText}/day</text>`;
	}
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="220" aria-label="${esc(valueKey)} trend">
		<rect width="${w}" height="${h}" fill="#fff"/>
		<line x1="${p}" y1="${h - p}" x2="${w - p}" y2="${h - p}" stroke="#cbd5e1"/>
		<line x1="${p}" y1="${p}" x2="${p}" y2="${h - p}" stroke="#cbd5e1"/>
		${weekLines}
		${trendHtml}
		<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${points}"/>
		${circles}
		<text x="${p}" y="${h - 8}" font-size="11" fill="#64748b">${esc(rows[0][labelKey])}</text>
		<text x="${w - p}" y="${h - 8}" text-anchor="end" font-size="11" fill="#64748b">${esc(rows[rows.length - 1][labelKey])}</text>
		${showTrend ? `<text x="${p}" y="${p - 8}" font-size="11" fill="#64748b">max ${maxY}</text>` : ""}
		${trendLabelHtml}
	</svg>`;
}

function multiSparkline(
	seriesList,
	labelKey,
	{ title = "Daily comparison", weekBoundaryKey = "week_start", showTrend = false } = {}
) {
	const w = 980;
	const h = 240;
	const p = 32;
	const rows = seriesList[0]?.rows || [];
	if (!rows.length) return '<p class="small">No data.</p>';
	const allValues = seriesList.flatMap((s) => s.rows.map((r) => Number(r[s.valueKey] || 0)));
	const minY = Math.min(...allValues, 0);
	const maxY = Math.max(...allValues, 1);
	const range = Math.max(maxY - minY, 1);
	const x = (i) => p + ((w - p * 2) * i) / Math.max(rows.length - 1, 1);
	const y = (v) => h - p - ((h - p * 2) * (v - minY)) / range;
	const weekLines = [...weekBoundaryIndices(rows, weekBoundaryKey)]
		.map((i) => {
			const xi = x(i).toFixed(1);
			return `<line x1="${xi}" y1="${p + 8}" x2="${xi}" y2="${h - p}" stroke="#e2e8f0" stroke-dasharray="4 3"/>`;
		})
		.join("");
	const trendLines = showTrend
		? seriesList
				.map((s) => {
					const values = s.rows.map((r) => Number(r[s.valueKey] || 0));
					const lr = linearRegression(values);
					const y0 = lr.intercept;
					const yN = lr.intercept + lr.slope * Math.max(s.rows.length - 1, 0);
					const trendSlopeText = formatTrendSlope(lr.slope);
					return `<line x1="${x(0).toFixed(1)}" y1="${y(y0).toFixed(1)}" x2="${x(s.rows.length - 1).toFixed(1)}" y2="${y(yN).toFixed(1)}" stroke="${s.color}" stroke-width="2" stroke-dasharray="6 5" opacity="0.85"><title>${esc(s.label)} trend slope: ${trendSlopeText} per day</title></line>`;
				})
				.join("")
		: "";
	const polylines = seriesList
		.map((s) => {
			const points = s.rows.map((r, i) => `${x(i).toFixed(1)},${y(Number(r[s.valueKey] || 0)).toFixed(1)}`).join(" ");
			const circles = s.rows
				.map((r, i) => {
					const cx = x(i).toFixed(1);
					const cy = y(Number(r[s.valueKey] || 0)).toFixed(1);
					return `<circle cx="${cx}" cy="${cy}" r="3" fill="${s.color}"><title>${esc(s.label)} · ${esc(r[labelKey])}: ${Number(r[s.valueKey] || 0)}</title></circle>`;
				})
				.join("");
			return `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" points="${points}"></polyline>${circles}`;
		})
		.join("");
	const legend = seriesList
		.map((s, i) => {
			if (!showTrend) {
				return `<text x="${p + i * 180}" y="${p - 2}" font-size="11" fill="${s.color}">${esc(s.label)}</text>`;
			}
			const values = s.rows.map((r) => Number(r[s.valueKey] || 0));
			const slope = formatTrendSlope(linearRegression(values).slope);
			return `<text x="${p + i * 280}" y="${p - 2}" font-size="11" fill="${s.color}">${esc(s.label)} · trend ${slope}/day</text>`;
		})
		.join("");
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="240" aria-label="${esc(title)}">
		<rect width="${w}" height="${h}" fill="#fff"/>
		<line x1="${p}" y1="${h - p}" x2="${w - p}" y2="${h - p}" stroke="#cbd5e1"/>
		<line x1="${p}" y1="${p + 8}" x2="${p}" y2="${h - p}" stroke="#cbd5e1"/>
		<text x="${p - 4}" y="${p + 8}" text-anchor="end" font-size="10" fill="#64748b">${maxY}</text>
		<text x="${p - 4}" y="${h - p}" text-anchor="end" font-size="10" fill="#64748b">${minY}</text>
		${legend}
		${weekLines}
		${trendLines}
		${polylines}
		<text x="${p}" y="${h - 8}" font-size="11" fill="#64748b">${esc(rows[0][labelKey])}</text>
		<text x="${w - p}" y="${h - 8}" text-anchor="end" font-size="11" fill="#64748b">${esc(rows[rows.length - 1][labelKey])}</text>
	</svg>`;
}

function longestWeeklyStreak(weeklyRows, predicate) {
	let best = 0;
	let cur = 0;
	for (const w of weeklyRows) {
		if (predicate(w)) {
			cur++;
			if (cur > best) best = cur;
		} else {
			cur = 0;
		}
	}
	return best;
}

function milestoneCriterion({ label, value, target, compare, hint = "" }) {
	const num = Number(value);
	const tgt = Number(target);
	let met = false;
	let pct = 0;
	if (compare === "gte") {
		met = num >= tgt;
		pct = tgt > 0 ? Math.min(100, Math.round((num / tgt) * 100)) : met ? 100 : 0;
	} else if (compare === "lte") {
		met = num <= tgt;
		if (met) pct = 100;
		else if (tgt > 0) pct = Math.max(0, Math.round(100 - ((num - tgt) / tgt) * 100));
	}
	const currentLabel = compare === "lte" ? `${fmt2(num * 100)}%` : String(Number.isInteger(num) ? num : fmt1(num));
	const targetLabel = compare === "lte" ? `≤ ${fmt2(tgt * 100)}%` : `≥ ${tgt}`;
	return { label, hint, currentLabel, targetLabel, met, pct: Math.max(0, Math.min(100, pct)) };
}

function buildStableSmallRoomMilestone(report, events, actionCountsByUser, coreActions) {
	const targets = MILESTONE_STABLE_SMALL_ROOM.targets;
	const weeklyRows = report.weeklyRows || [];
	const latestWeek = weeklyRows[weeklyRows.length - 1];
	const latestWeekStart = latestWeek?.week_start;
	const latestWeekDays = (report.dailyRows || []).filter((d) => d.week_start === latestWeekStart);
	const latestWeekDaySet = new Set(latestWeekDays.map((d) => d.day));

	const actionWau = Number(latestWeek?.action_wau) || 0;
	const visitWau = Number(latestWeek?.visit_wau) || 0;
	const avgActionDau = latestWeekDays.length ? avg(latestWeekDays.map((d) => d.action_dau)) : 0;
	const highActionDays = latestWeekDays.filter((d) => d.action_dau >= targets.avg_action_dau).length;
	const highActionTarget = Math.min(targets.high_action_days, latestWeekDays.length || targets.high_action_days);

	const weekEvents = events.filter((e) => latestWeekDaySet.has(e.day));
	const commenters = new Set(weekEvents.filter((e) => e.type === "comment").map((e) => e.user_id)).size;
	const publishers = new Set(weekEvents.filter((e) => e.type === "publish").map((e) => e.user_id)).size;

	const visitMau = Number(report.visitMau) || 0;
	const returningUsers = Number(report.returningVisitUsers) || 0;
	const returningRate = visitMau ? returningUsers / visitMau : 0;

	const sortedActions = [...actionCountsByUser.entries()].sort((a, b) => b[1] - a[1]);
	const top2Actions = (sortedActions[0]?.[1] || 0) + (sortedActions[1]?.[1] || 0);
	const top2Share = coreActions > 0 ? top2Actions / coreActions : 0;

	const actionWauStreak = longestWeeklyStreak(weeklyRows, (w) => Number(w.action_wau) >= targets.action_wau);
	const weeksHitActionWau = weeklyRows.filter((w) => Number(w.action_wau) >= targets.action_wau).length;

	const criteria = [
		milestoneCriterion({
			label: "Action WAU (latest week)",
			value: actionWau,
			target: targets.action_wau,
			compare: "gte",
			hint: latestWeek?.week_label
		}),
		milestoneCriterion({
			label: "Visit WAU (latest week)",
			value: visitWau,
			target: targets.visit_wau,
			compare: "gte",
			hint: latestWeek?.week_label
		}),
		milestoneCriterion({
			label: "Avg action DAU (latest week)",
			value: avgActionDau,
			target: targets.avg_action_dau,
			compare: "gte"
		}),
		milestoneCriterion({
			label: `Days with action DAU ≥ ${targets.avg_action_dau} (latest week)`,
			value: highActionDays,
			target: highActionTarget,
			compare: "gte",
			hint: `${latestWeekDays.length} day(s) in window for this week`
		}),
		milestoneCriterion({
			label: "Distinct commenters (latest week)",
			value: commenters,
			target: targets.commenters,
			compare: "gte"
		}),
		milestoneCriterion({
			label: "Distinct publishers (latest week)",
			value: publishers,
			target: targets.publishers,
			compare: "gte"
		}),
		milestoneCriterion({
			label: "Returning logged-in (2+ visit days ÷ visit MAU)",
			value: returningRate,
			target: targets.returning_visit_rate,
			compare: "gte",
			hint: `window ${report.fromDay} → ${report.toDay}`
		}),
		milestoneCriterion({
			label: "Top 2 users’ share of core actions",
			value: top2Share,
			target: targets.top2_action_share_max,
			compare: "lte",
			hint: `window ${report.fromDay} → ${report.toDay}`
		}),
		milestoneCriterion({
			label: "Consecutive weeks with action WAU ≥ 20",
			value: actionWauStreak,
			target: targets.action_wau_streak_weeks,
			compare: "gte",
			hint: `${weeksHitActionWau} of ${weeklyRows.length} week(s) in this report hit ≥ 20`
		})
	];

	const metCount = criteria.filter((c) => c.met).length;
	const totalCount = criteria.length;

	return {
		...MILESTONE_STABLE_SMALL_ROOM,
		latestWeekLabel: latestWeek?.week_label || "—",
		metCount,
		totalCount,
		summaryLine: `${metCount} of ${totalCount} criteria met`,
		progressPct: totalCount ? Math.round((metCount / totalCount) * 100) : 0,
		criteria
	};
}

function renderMilestoneHtml(milestone) {
	if (!milestone?.criteria?.length) {
		return '<section><h2>Milestone</h2><p class="small">Not enough data in this window.</p></section>';
	}
	const rows = milestone.criteria
		.map((c) => {
			const hint = c.hint ? `<div class="small">${esc(c.hint)}</div>` : "";
			return `<tr class="${c.met ? "milestone-met" : ""}">
			<td>${esc(c.label)}${hint}</td>
			<td>${esc(c.currentLabel)}</td>
			<td>${esc(c.targetLabel)}</td>
			<td><div class="milestone-bar${c.met ? " is-met" : ""}" title="${c.pct}% toward target"><span style="width:${c.pct}%"></span></div></td>
			<td>${c.met ? "Met" : "Not yet"}</td>
		</tr>`;
		})
		.join("");
	return `<section class="milestone-section">
	<h2>Milestone: ${esc(milestone.title)}</h2>
	<p class="small">${esc(milestone.subtitle)}</p>
	<p class="milestone-summary"><strong>${esc(milestone.summaryLine)}</strong> · Latest week: ${esc(milestone.latestWeekLabel)}</p>
	<table class="milestone-table">
		<thead><tr><th>Criterion</th><th>Current</th><th>Target</th><th>Progress</th><th>Status</th></tr></thead>
		<tbody>${rows}</tbody>
	</table>
</section>`;
}

function buildShareTryFunnel(shareRows, tryRows, windowStartMs, windowEndMs) {
	const clientIdFromMeta = (m) => {
		const a = typeof m?.prsn_cid === "string" ? m.prsn_cid.trim() : "";
		const b = typeof m?.client_id === "string" ? m.client_id.trim() : "";
		return a || b;
	};
	const inWindow = (ts) => {
		const d = safeDate(ts);
		return d && d >= new Date(windowStartMs) && d < new Date(windowEndMs);
	};
	const safeShare = Array.isArray(shareRows) ? shareRows : [];
	const safeTry = Array.isArray(tryRows) ? tryRows : [];
	const shareCids = new Set();
	const tryCids = new Set();
	const tryFromShareCids = new Set();
	const transitionedCids = new Set();
	const transitionedUsers = new Set();
	let shareViews = 0;
	let tryRequests = 0;

	for (const row of safeShare) {
		if (!inWindow(row?.viewed_at)) continue;
		shareViews++;
		const cid = String(row?.anon_cid || "").trim();
		if (cid) shareCids.add(cid);
	}

	const allShareCids = new Set(safeShare.map((r) => String(r?.anon_cid || "").trim()).filter(Boolean));

	for (const row of safeTry) {
		if (!inWindow(row?.created_at)) continue;
		const cid = String(row?.anon_cid || "").trim();
		if (!cid || cid === "__pool__") continue;
		tryRequests++;
		tryCids.add(cid);
		if (allShareCids.has(cid)) tryFromShareCids.add(cid);
		const meta = parseEventMeta(row?.meta);
		const transitionedUserId = Number(meta?.transitioned?.user_id);
		if (Number.isFinite(transitionedUserId) && transitionedUserId > 0) {
			transitionedCids.add(cid);
			transitionedUsers.add(transitionedUserId);
		}
	}

	const safeRate = (a, b) => (b ? a / b : 0);
	return {
		share_page_views: shareViews,
		share_unique_anon_cids: shareCids.size,
		try_requests: tryRequests,
		try_unique_anon_cids: tryCids.size,
		try_from_share_cids: tryFromShareCids.size,
		transitioned_unique_anon_cids: transitionedCids.size,
		transitioned_unique_users: transitionedUsers.size,
		try_to_transition_rate: safeRate(transitionedCids.size, tryCids.size),
		share_to_transition_rate: safeRate(transitionedCids.size, shareCids.size)
	};
}

function buildEngagementSummaryExport(report) {
	const leaders = [...(report.leaders || [])].sort((a, b) => b.core_actions - a.core_actions);
	const aliasByUserId = new Map();
	leaders.forEach((row, idx) => {
		const userId = Number(row.user_id);
		if (Number.isFinite(userId)) aliasByUserId.set(userId, `user_${String(idx + 1).padStart(3, "0")}`);
	});
	const anonymizedLeaders = leaders.map((row) => ({
		user_alias: aliasByUserId.get(Number(row.user_id)) || "user_unknown",
		core_actions: Number(row.core_actions || 0),
		active_days: Number(row.active_days || 0),
		visit_days: Number(row.visit_days || 0),
		actions_per_active_day: Number(Number(row.actions_per_active_day || 0).toFixed(2)),
		likes: Number(row.like || 0),
		comments: Number(row.comment || 0),
		creations: Number(row.creation || 0),
		mutations: Number(row.mutations || 0),
		follows: Number(row.follows || 0),
		chat: Number(row.chat || 0)
	}));

	return {
		export_version: 1,
		exported_at: new Date().toISOString(),
		scope: "parascene_engagement_monthly",
		pii_policy: "Summary export: no emails, no raw user IDs, no display names or handles.",
		period: {
			from: report.fromDay,
			to: report.toDay,
			days: report.windowDays,
			week_timezone: "US East partition (Mon–Sun weeks)"
		},
		metrics: {
			avg_traffic_dau: Number(report.avgTrafficDau),
			avg_visit_dau: Number(report.avgVisitDau),
			avg_action_dau: Number(report.avgActionDau),
			visit_mau: Number(report.visitMau),
			action_mau: Number(report.actionMau),
			stickiness_visit_pct: report.stickinessVisit,
			activation_rate: report.activationRate,
			actions_per_action_mau: Number(report.actionsPerMau),
			paid_users_snapshot: Number(report.paidUsers),
			latest_action_wau: Number(report.latestActionWau),
			latest_week: report.latestWeekLabel,
			returning_visit_users: Number(report.returningVisitUsers),
			returning_visit_rate: report.returningVisitRate,
			avg_day_activation: report.avgActivationRate,
			avg_hits_per_visit_dau: Number(report.avgHitsPerVisitDau),
			avg_blocks_per_visit_dau: Number(report.avgBlocksPerVisitDau),
			avg_actions_per_action_dau: Number(report.avgActionsPerActionDau)
		},
		prior_period_notes: {
			traffic_dau: report.priorTrafficDauNote,
			visit_dau: report.priorVisitDauNote,
			action_dau: report.priorActionDauNote
		},
		series: {
			daily: (report.dailyRows || []).map((r) => ({
				day: r.day,
				week_start: r.week_start,
				traffic_dau: r.traffic_dau,
				visit_dau: r.visit_dau,
				action_dau: r.action_dau,
				new_users: r.new_users,
				activation_rate: Number(r.activation_rate.toFixed(4)),
				hits_per_visit_dau: Number(fmt2(r.hits_per_visit_dau)),
				blocks_per_visit_dau: Number(fmt2(r.blocks_per_visit_dau)),
				actions_per_action_dau: Number(fmt2(r.actions_per_action_dau))
			})),
			weekly: report.weeklyRows || []
		},
		retention_by_cohort: (report.cohortRows || []).map((r) => ({
			cohort_week: r.cohort_label,
			signups: r.signups,
			w1_retained: r.w1_retained,
			w1_rate: Number(r.w1_rate.toFixed(4)),
			w4_retained: r.w4_retained,
			w4_rate: Number(r.w4_rate.toFixed(4))
		})),
		churn_snapshot: report.churn,
		funnel: report.funnel,
		share_try_funnel: report.shareTryFunnel,
		action_mix: report.actionCounts,
		story_bullets: report.observations,
		engagement_leaders_anonymized: anonymizedLeaders,
		milestone: report.milestone
			? {
					id: report.milestone.id,
					title: report.milestone.title,
					met_count: report.milestone.metCount,
					total_count: report.milestone.totalCount,
					progress_pct: report.milestone.progressPct,
					criteria: report.milestone.criteria.map((c) => ({
						label: c.label,
						current: c.currentLabel,
						target: c.targetLabel,
						met: c.met,
						progress_pct: c.pct
					}))
				}
			: null
	};
}

function buildEngagementRawExport(report) {
	return {
		export_version: 1,
		exported_at: new Date().toISOString(),
		scope: "parascene_engagement_monthly_raw",
		pii_policy: "Raw export: includes user IDs, display names, and handles.",
		period: { from: report.fromDay, to: report.toDay, days: report.windowDays },
		summary: {
			avg_traffic_dau: Number(report.avgTrafficDau),
			avg_visit_dau: Number(report.avgVisitDau),
			avg_action_dau: Number(report.avgActionDau),
			visit_mau: Number(report.visitMau),
			action_mau: Number(report.actionMau),
			stickiness_visit: report.stickinessVisit,
			activation_rate: report.activationRate,
			actions_per_action_mau: Number(report.actionsPerMau),
			paid_users: Number(report.paidUsers)
		},
		daily: report.dailyRows,
		weekly: report.weeklyRows,
		cohorts: report.cohortRows,
		churn: report.churn,
		funnel: report.funnel,
		share_try: report.shareTryFunnel,
		action_mix: report.actionCounts,
		leaders: (report.leaders || []).map((row) => ({
			user_id: row.user_id,
			label: row.label,
			user_name: row.user_name,
			core_actions: row.core_actions,
			like: row.like,
			comment: row.comment,
			creation: row.creation,
			publish: row.publish,
			reaction: row.reaction,
			tip_sent: row.tip_sent,
			mutations: row.mutations,
			sessions: row.sessions,
			follows: row.follows,
			chat: row.chat,
			active_days: row.active_days,
			visit_days: row.visit_days,
			actions_per_active_day: row.actions_per_active_day
		})),
		observations: report.observations
	};
}

function buildEngagementCopyScriptHtml(summaryPayload, rawPayload) {
	const summaryJson = JSON.stringify(summaryPayload);
	const rawJson = JSON.stringify(rawPayload);
	return `<script>
(() => {
	const summaryPayload = ${summaryJson};
	const rawPayload = ${rawJson};
	const status = document.getElementById('copy-engagement-status');
	const setStatus = (msg) => { if (status) status.textContent = msg || ''; };
	async function copyText(text) {
		if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
			await navigator.clipboard.writeText(text);
			return;
		}
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', 'true');
		ta.style.position = 'fixed';
		ta.style.top = '-1000px';
		ta.style.left = '-1000px';
		document.body.appendChild(ta);
		ta.select();
		ta.setSelectionRange(0, ta.value.length);
		const ok = document.execCommand('copy');
		document.body.removeChild(ta);
		if (!ok) throw new Error('Copy failed');
	}
	async function onCopy(btn, text, label) {
		if (!btn) return;
		btn.addEventListener('click', async () => {
			try {
				setStatus('Copying…');
				await copyText(text);
				setStatus('Copied ' + label + ' to clipboard.');
			} catch (_err) {
				setStatus('Copy failed.');
			}
		});
	}
	onCopy(
		document.getElementById('copy-engagement-summary'),
		'PARASCENE_ENGAGEMENT_REPORT\\n' + JSON.stringify(summaryPayload, null, 2),
		'summary JSON'
	);
	onCopy(
		document.getElementById('copy-engagement-raw'),
		JSON.stringify(rawPayload, null, 2),
		'raw JSON'
	);
})();
</script>`;
}

async function resolveUserLabels(userIds) {
	const ids = [...new Set(userIds.filter((id) => Number.isFinite(Number(id))).map(Number))];
	if (!ids.length) return new Map();
	const { openDb } = await import("../../db/index.js");
	const { getNotificationDisplayName } = await import("../../api_routes/utils/displayName.js");
	const { queries } = await openDb({ quiet: true });
	const profiles =
		typeof queries.selectUserProfilesByUserIds === "function"
			? await queries.selectUserProfilesByUserIds(ids)
			: new Map();
	const users =
		typeof queries.selectUsersByIds === "function" ? await queries.selectUsersByIds(ids) : new Map();
	const out = new Map();
	for (const id of ids) {
		const profile = profiles.get(id);
		const user = users.get(id);
		out.set(id, {
			user_id: id,
			user_name: profile?.user_name ?? null,
			label: getNotificationDisplayName(
				{ email: user?.email, display_name: profile?.display_name, user_name: profile?.user_name },
				profile
			)
		});
	}
	return out;
}

async function enrichLeaders(leaders) {
	const labels = await resolveUserLabels(leaders.map((l) => l.user_id));
	return leaders.map((l) => {
		const info = labels.get(Number(l.user_id));
		return {
			...l,
			label: info?.label || `user ${l.user_id}`,
			user_name: info?.user_name ?? null
		};
	});
}

async function fetchSupabaseRows(client, table, columns, minIso) {
	const pageSize = 1000;
	const out = [];
	let from = 0;
	while (true) {
		const to = from + pageSize - 1;
		let q = client.from(table).select(columns).range(from, to);
		if (minIso && /viewed_at|created_at/.test(columns)) {
			const col = columns.includes("viewed_at") ? "viewed_at" : "created_at";
			q = q.gte(col, minIso);
		}
		const { data, error } = await q;
		if (error) throw new Error(`Supabase ${table}: ${error.message}`);
		const rows = Array.isArray(data) ? data : [];
		out.push(...rows);
		if (rows.length < pageSize) break;
		from += rows.length;
	}
	return out;
}

async function loadPulseDays(fromDay, toDay) {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
	const client = createClient(url, key, { auth: { persistSession: false } });
	const { data, error } = await client
		.from("prsn_visit_pulse_days")
		.select(
			"day, unique_visitors, authed_visitors, anon_visitors, total_hits, total_active_blocks, flushed_at, details"
		)
		.gte("day", fromDay)
		.lte("day", toDay)
		.order("day");
	if (error) throw error;
	return Array.isArray(data) ? data : [];
}

function emptyUserDetail() {
	return {
		creation: 0,
		publish: 0,
		comment: 0,
		like: 0,
		reaction: 0,
		tip_sent: 0,
		mutations: 0,
		sessions: 0,
		follows: 0,
		chat: 0
	};
}

async function loadEngagementData(fromDay, toDay) {
	const { openDb } = await import("../../db/index.js");
	const dbInstance = await openDb({ quiet: true });
	const usersRaw = await dbInstance?.queries?.selectUsers?.all?.();
	const users = (Array.isArray(usersRaw) ? usersRaw : [])
		.map((row) => ({
			id: Number(row.id),
			created_at: row.created_at,
			meta: parseUserMeta(row.meta),
			suspended: parseUserMeta(row.meta)?.suspended === true,
			role: row.role
		}))
		.filter((u) => u.role === "consumer" && !u.suspended && Number.isFinite(u.id));
	const allowed = new Set(users.map((u) => u.id));
	const minIso = new Date(usEastDayStartMs(fromDay)).toISOString();
	const maxIso = new Date(usEastDayStartMs(toDay) + PULSE_DAY_MS).toISOString();
	const windowStartMs = usEastDayStartMs(fromDay);
	const windowEndMs = usEastDayStartMs(toDay) + PULSE_DAY_MS;

	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	const client = createClient(url, key, { auth: { persistSession: false } });
	const [createdImages, comments, likes, reactions, tips, sessions, shareRows, tryRows, followRows, chatRows] =
		await Promise.all([
			fetchSupabaseRows(client, "prsn_created_images", "user_id,created_at,published_at,meta", minIso),
			fetchSupabaseRows(client, "prsn_comments_created_image", "user_id,created_at", minIso),
			fetchSupabaseRows(client, "prsn_likes_created_image", "user_id,created_at", minIso),
			fetchSupabaseRows(client, "prsn_comment_reactions", "user_id,created_at", minIso),
			fetchSupabaseRows(client, "prsn_tip_activity", "from_user_id,to_user_id,created_at", minIso),
			fetchSupabaseRows(client, "prsn_sessions", "user_id,created_at", minIso),
			fetchSupabaseRows(client, "prsn_share_page_views", "viewed_at,anon_cid,meta", minIso),
			fetchSupabaseRows(client, "prsn_try_requests", "anon_cid,created_at,meta", minIso),
			fetchSupabaseRows(client, "prsn_user_follows", "follower_id,created_at", minIso),
			fetchSupabaseRows(client, "prsn_chat_messages", "sender_id,created_at", minIso)
		]);

	const events = [];
	const detailByUser = new Map();
	const bumpDetail = (userId, field, n = 1) => {
		if (!allowed.has(userId)) return;
		if (!detailByUser.has(userId)) detailByUser.set(userId, emptyUserDetail());
		detailByUser.get(userId)[field] += n;
	};

	const add = (userIdRaw, tsRaw, type, extra = {}) => {
		const userId = Number(userIdRaw);
		const ts = safeDate(tsRaw);
		if (!Number.isFinite(userId) || userId <= 0 || !ts || !allowed.has(userId)) return;
		if (ts < new Date(minIso) || ts >= new Date(maxIso)) return;
		const day = usEastDayKey(ts);
		events.push({ user_id: userId, ts, type, day, ...extra });
		if (CORE_ACTION_TYPES.has(type)) bumpDetail(userId, type);
		if (type === "session") bumpDetail(userId, "sessions");
	};

	for (const row of createdImages) {
		let isMutation = false;
		try {
			const meta = parseEventMeta(row?.meta);
			const mid = Number(meta?.mutate_of_id);
			isMutation = Number.isFinite(mid) && mid > 0;
		} catch {
			isMutation = false;
		}
		add(row.user_id, row.created_at, "creation", { isMutation });
		if (isMutation) bumpDetail(Number(row.user_id), "mutations");
		add(row.user_id, row.published_at, "publish");
	}
	for (const row of comments) add(row.user_id, row.created_at, "comment");
	for (const row of likes) add(row.user_id, row.created_at, "like");
	for (const row of reactions) add(row.user_id, row.created_at, "reaction");
	for (const row of tips) add(row.from_user_id, row.created_at, "tip_sent");
	for (const row of sessions) add(row.user_id, row.created_at, "session");
	for (const row of followRows) {
		const ts = safeDate(row.created_at);
		if (!ts || ts < new Date(minIso) || ts >= new Date(maxIso)) continue;
		bumpDetail(Number(row.follower_id), "follows");
	}
	for (const row of chatRows) {
		const ts = safeDate(row.created_at);
		if (!ts || ts < new Date(minIso) || ts >= new Date(maxIso)) continue;
		bumpDetail(Number(row.sender_id), "chat");
	}

	const shareTryFunnel = buildShareTryFunnel(shareRows, tryRows, windowStartMs, windowEndMs);
	return { users, events, shareTryFunnel, detailByUser };
}

function buildWeeklyRows(dailyRows, pulseByDay, events, users) {
	const weekStarts = [...new Set(dailyRows.map((d) => d.week_start))].sort();
	return weekStarts.map((ws, idx) => {
		const daysInWeek = dailyRows.filter((d) => d.week_start === ws);
		const daySet = new Set(daysInWeek.map((d) => d.day));
		const trafficKeys = new Set();
		const visitUsers = new Set();
		for (const day of daySet) {
			const pulse = pulseByDay.get(day);
			for (const v of pulse?.details?.visitors || []) {
				if (v.user_id) visitUsers.add(Number(v.user_id));
				trafficKeys.add(v.visitor_key || (v.user_id ? `u:${v.user_id}` : `v:${v.client_id}`));
			}
		}
		const actionUsers = new Set(
			events.filter((e) => daySet.has(e.day) && CORE_ACTION_TYPES.has(e.type)).map((e) => e.user_id)
		);
		const newUsers = users.filter((u) => daySet.has(usEastDayKey(safeDate(u.created_at)))).length;
		const row = {
			week_start: ws,
			week_label: weekLabel(ws),
			days_in_window: daysInWeek.length,
			traffic_wau: trafficKeys.size,
			visit_wau: visitUsers.size,
			action_wau: actionUsers.size,
			avg_traffic_dau: avg(daysInWeek.map((d) => d.traffic_dau)),
			avg_visit_dau: avg(daysInWeek.map((d) => d.visit_dau)),
			avg_action_dau: avg(daysInWeek.map((d) => d.action_dau)),
			new_users: newUsers
		};
		if (idx > 0) {
			const prevWeekStart = weekStarts[idx - 1];
			const prevDays = dailyRows.filter((d) => d.week_start === prevWeekStart);
			const prevTrafficKeys = new Set();
			for (const day of new Set(prevDays.map((d) => d.day))) {
				const pulse = pulseByDay.get(day);
				for (const v of pulse?.details?.visitors || []) {
					prevTrafficKeys.add(v.visitor_key || (v.user_id ? `u:${v.user_id}` : `v:${v.client_id}`));
				}
			}
			const prevTrafficWau = prevTrafficKeys.size;
			const prevActionWau = new Set(
				events
					.filter((e) => prevDays.some((d) => d.day === e.day) && CORE_ACTION_TYPES.has(e.type))
					.map((e) => e.user_id)
			).size;
			row.action_wau_wow = signedPct(row.action_wau, prevActionWau);
			row.traffic_wau_wow = signedPct(row.traffic_wau, prevTrafficWau);
		} else {
			row.action_wau_wow = "—";
			row.traffic_wau_wow = "—";
		}
		return row;
	});
}

function buildCohortRows(users, events, fromDay, toDay) {
	const cohorts = new Map();
	for (const u of users) {
		const created = safeDate(u.created_at);
		if (!created) continue;
		const signupDay = usEastDayKey(created);
		if (signupDay < fromDay || signupDay > toDay) continue;
		const ws = usEastWeekStartKey(signupDay);
		if (!cohorts.has(ws)) cohorts.set(ws, []);
		cohorts.get(ws).push(u.id);
	}
	return [...cohorts.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([cohort, ids]) => {
			const size = ids.length;
			let w1 = 0;
			let w4 = 0;
			const w1Start = shiftDayKey(cohort, 7);
			const w1End = shiftDayKey(cohort, 14);
			const w4Start = shiftDayKey(cohort, 28);
			const w4End = shiftDayKey(cohort, 35);
			for (const uid of ids) {
				const hasW1 = events.some(
					(e) =>
						e.user_id === uid &&
						CORE_ACTION_TYPES.has(e.type) &&
						e.day >= w1Start &&
						e.day < w1End
				);
				const hasW4 = events.some(
					(e) =>
						e.user_id === uid &&
						CORE_ACTION_TYPES.has(e.type) &&
						e.day >= w4Start &&
						e.day < w4End
				);
				if (hasW1) w1++;
				if (hasW4) w4++;
			}
			return {
				cohort,
				cohort_label: weekLabel(cohort),
				signups: size,
				w1_retained: w1,
				w1_rate: size ? w1 / size : 0,
				w4_retained: w4,
				w4_rate: size ? w4 / size : 0
			};
		});
}

function buildChurn(events, dailyRows) {
	if (dailyRows.length < 2) {
		return { churned: 0, prevActive: 0, currActive: 0, paragraph: "Not enough days for churn split." };
	}
	const mid = Math.floor(dailyRows.length / 2);
	const firstDays = new Set(dailyRows.slice(0, mid).map((r) => r.day));
	const secondDays = new Set(dailyRows.slice(mid).map((r) => r.day));
	const prevActive = new Set(
		events.filter((e) => firstDays.has(e.day) && CORE_ACTION_TYPES.has(e.type)).map((e) => e.user_id)
	);
	const currActive = new Set(
		events.filter((e) => secondDays.has(e.day) && CORE_ACTION_TYPES.has(e.type)).map((e) => e.user_id)
	);
	let churned = 0;
	for (const uid of prevActive) if (!currActive.has(uid)) churned++;
	const firstLabel = dailyRows[0].day;
	const midLabel = dailyRows[mid].day;
	const lastLabel = dailyRows[dailyRows.length - 1].day;
	return {
		churned,
		prevActive: prevActive.size,
		currActive: currActive.size,
		paragraph: `${churned} of ${prevActive.size} action-active users in the first half (${firstLabel} → ${shiftDayKey(midLabel, -1)}) did not return in the second half (${midLabel} → ${lastLabel}) — ${pct(churned, prevActive.size)} churn.`
	};
}

function buildReport(fromDay, toDay, pulseRows, users, events, shareTryFunnel, detailByUser, priorSummary) {
	const pulseByDay = new Map(pulseRows.map((r) => [String(r.day), r]));
	const dayKeys = [];
	for (let d = fromDay; d <= toDay; d = shiftDayKey(d, 1)) dayKeys.push(d);

	const actionByDay = new Map();
	const actionUsers = new Set();
	const actionCounts = {
		creation: 0,
		publish: 0,
		comment: 0,
		like: 0,
		reaction: 0,
		tip_sent: 0
	};
	const actionCountsByUser = new Map();
	const actionDaysByUser = new Map();
	const actionVolumeByDay = new Map();

	for (const e of events) {
		if (e.day < fromDay || e.day > toDay) continue;
		if (!CORE_ACTION_TYPES.has(e.type)) continue;
		if (!actionByDay.has(e.day)) actionByDay.set(e.day, new Set());
		actionByDay.get(e.day).add(e.user_id);
		actionVolumeByDay.set(e.day, (actionVolumeByDay.get(e.day) || 0) + 1);
		actionUsers.add(e.user_id);
		actionCounts[e.type] = (actionCounts[e.type] || 0) + 1;
		actionCountsByUser.set(e.user_id, (actionCountsByUser.get(e.user_id) || 0) + 1);
		if (!actionDaysByUser.has(e.user_id)) actionDaysByUser.set(e.user_id, new Set());
		actionDaysByUser.get(e.user_id).add(e.day);
	}

	const visitDaysByUser = new Map();
	for (const row of pulseRows) {
		const day = String(row.day);
		for (const v of row.details?.visitors || []) {
			const uid = Number(v.user_id);
			if (!Number.isFinite(uid) || uid <= 0) continue;
			if (!visitDaysByUser.has(uid)) visitDaysByUser.set(uid, new Set());
			visitDaysByUser.get(uid).add(day);
		}
	}

	const visitMau = visitDaysByUser.size;
	const returningVisitUsers = [...visitDaysByUser.values()].filter((days) => days.size >= 2).length;
	const avgVisitDaysPerMau = visitMau
		? [...visitDaysByUser.values()].reduce((s, days) => s + days.size, 0) / visitMau
		: 0;

	const dailyRows = dayKeys
		.map((day) => {
			const pulse = pulseByDay.get(day);
			const traffic = Number(pulse?.unique_visitors) || 0;
			const visitDau = Number(pulse?.authed_visitors) || 0;
			const actionDau = actionByDay.get(day)?.size || 0;
			const loggedInPulse = summarizeLoggedInPulseVisitors(pulse);
			const actionVolume = actionVolumeByDay.get(day) || 0;
			const newUsers = users.filter((u) => usEastDayKey(safeDate(u.created_at)) === day).length;
			const week_start = usEastWeekStartKey(day);
			const activationRate = visitDau ? actionDau / visitDau : 0;
			return {
				day,
				week_start,
				week_label: weekLabel(week_start),
				traffic_dau: traffic,
				visit_dau: visitDau,
				action_dau: actionDau,
				anon_dau: Number(pulse?.anon_visitors) || 0,
				activation_rate: activationRate,
				activation_pct: Math.round(activationRate * 1000) / 10,
				actions_per_action_dau: actionDau ? actionVolume / actionDau : 0,
				...loggedInPulse,
				new_users: newUsers,
				has_pulse: Boolean(pulse && traffic > 0)
			};
		})
		.filter((r) => r.has_pulse);

	const loggedInDailyRows = dailyRows.filter((r) => r.visit_dau > 0);

	const avgTrafficDau = avg(dailyRows.map((r) => r.traffic_dau));
	const avgVisitDau = avg(dailyRows.map((r) => r.visit_dau));
	const avgActionDau = avg(dailyRows.map((r) => r.action_dau));
	const actionMau = actionUsers.size;
	const stickinessVisit = visitMau ? avgVisitDau / visitMau : 0;
	const coreActions = Object.values(actionCounts).reduce((s, n) => s + n, 0);
	const actionsPerMau = actionMau ? coreActions / actionMau : 0;
	const paidUsers = users.filter(isPaidUser).length;

	const windowStartMs = usEastDayStartMs(fromDay);
	const windowEndMs = usEastDayStartMs(toDay) + PULSE_DAY_MS;
	const signupsWindow = users.filter((u) => {
		const d = safeDate(u.created_at);
		return d && d >= new Date(windowStartMs) && d < new Date(windowEndMs);
	});

	let activatedSignup = 0;
	let retainedSignup = 0;
	let paidFromSignup = 0;
	for (const u of signupsWindow) {
		const created = safeDate(u.created_at);
		if (!created) continue;
		const hasActivation = events.some(
			(e) =>
				e.user_id === u.id &&
				CORE_ACTION_TYPES.has(e.type) &&
				e.ts >= created &&
				e.ts < new Date(created.getTime() + 7 * PULSE_DAY_MS)
		);
		const hasRetention = events.some(
			(e) =>
				e.user_id === u.id &&
				CORE_ACTION_TYPES.has(e.type) &&
				e.ts >= new Date(created.getTime() + 7 * PULSE_DAY_MS) &&
				e.ts < new Date(created.getTime() + 30 * PULSE_DAY_MS)
		);
		if (hasActivation) activatedSignup++;
		if (hasRetention) retainedSignup++;
		if (isPaidUser(u)) paidFromSignup++;
	}

	const weeklyRows = buildWeeklyRows(dailyRows, pulseByDay, events, users);
	const cohortRows = buildCohortRows(users, events, fromDay, toDay);
	const churn = buildChurn(events, dailyRows);
	const latestWeek = weeklyRows[weeklyRows.length - 1];

	const leaders = [...actionCountsByUser.entries()]
		.map(([user_id, core_actions]) => {
			const d = detailByUser.get(user_id) || emptyUserDetail();
			return {
				user_id,
				core_actions,
				active_days: actionDaysByUser.get(user_id)?.size || 0,
				visit_days: visitDaysByUser.get(user_id)?.size || 0,
				...d,
				actions_per_active_day: actionDaysByUser.get(user_id)?.size
					? core_actions / actionDaysByUser.get(user_id).size
					: 0
			};
		})
		.sort((a, b) => b.core_actions - a.core_actions)
		.slice(0, 15);

	const priorNote = (curr, prior, label) =>
		prior != null ? `${label} vs prior period: ${signedPct(curr, prior)}` : "No prior-period pulse data";

	const observations = [];
	if (dailyRows.length) {
		const first = dailyRows[0];
		const last = dailyRows[dailyRows.length - 1];
		observations.push(
			`Traffic averaged ${fmt1(avgTrafficDau)} unique visitors/day (${first.day} → ${last.day}: ${first.traffic_dau} → ${last.traffic_dau}). Logged-in visit DAU ${fmt1(avgVisitDau)}; action DAU ${fmt1(avgActionDau)}.`
		);
		if (latestWeek) {
			observations.push(
				`Latest full week in window (${latestWeek.week_label}): action WAU ${latestWeek.action_wau}, visit WAU ${latestWeek.visit_wau}, traffic WAU ${latestWeek.traffic_wau} (${latestWeek.days_in_window} days in window).`
			);
		}
		observations.push(
			`Visit MAU ${visitMau}; action MAU ${actionMau}. Stickiness ${fmt2(stickinessVisit * 100)}%. Activation ${pct(actionMau, visitMau)} of logged-in visitors took a core action.`
		);
		observations.push(churn.paragraph);
		observations.push(
			`${signupsWindow.length} signups; activation ≤7d ${pct(activatedSignup, signupsWindow.length)}; retained days 8–30 ${pct(retainedSignup, signupsWindow.length)}; paid ${pct(paidFromSignup, signupsWindow.length)}.`
		);
		if (shareTryFunnel?.try_requests) {
			observations.push(
				`Anonymous funnel: ${shareTryFunnel.share_page_views} share views → ${shareTryFunnel.try_requests} try requests → ${shareTryFunnel.transitioned_unique_users} transitioned users (${pct(shareTryFunnel.transitioned_unique_users, shareTryFunnel.try_requests)} try→user).`
			);
		}
	} else {
		observations.push("No flushed visit pulse days in this window — run flush for completed days first.");
	}

	const milestone = buildStableSmallRoomMilestone(
		{
			fromDay,
			toDay,
			weeklyRows,
			dailyRows,
			visitMau: String(visitMau),
			returningVisitUsers: String(returningVisitUsers)
		},
		events,
		actionCountsByUser,
		coreActions
	);

	return {
		fromDay,
		toDay,
		windowDays: dailyRows.length,
		periodLabel: `${fromDay} → ${toDay}`,
		avgTrafficDau: fmt1(avgTrafficDau),
		avgVisitDau: fmt1(avgVisitDau),
		avgActionDau: fmt1(avgActionDau),
		priorTrafficDauNote: priorNote(avgTrafficDau, priorSummary?.avgTrafficDau, "Traffic DAU"),
		priorVisitDauNote: priorNote(avgVisitDau, priorSummary?.avgVisitDau, "Visit DAU"),
		priorActionDauNote: priorNote(avgActionDau, priorSummary?.avgActionDau, "Action DAU"),
		visitMau: String(visitMau),
		actionMau: String(actionMau),
		stickinessVisit: `${fmt2(stickinessVisit * 100)}%`,
		activationRate: pct(actionMau, visitMau),
		actionsPerMau: fmt2(actionsPerMau),
		paidUsers: String(paidUsers),
		latestActionWau: latestWeek ? String(latestWeek.action_wau) : "0",
		latestWeekLabel: latestWeek?.week_label || "—",
		loggedInDailyRows,
		avgActivationRate: `${fmt2(avg(loggedInDailyRows.map((r) => r.activation_rate)) * 100)}%`,
		avgHitsPerVisitDau: fmt2(avg(loggedInDailyRows.map((r) => r.hits_per_visit_dau))),
		avgBlocksPerVisitDau: fmt2(avg(loggedInDailyRows.map((r) => r.blocks_per_visit_dau))),
		avgActionsPerActionDau: fmt2(avg(loggedInDailyRows.filter((r) => r.action_dau > 0).map((r) => r.actions_per_action_dau))),
		returningVisitUsers: String(returningVisitUsers),
		returningVisitRate: pct(returningVisitUsers, visitMau),
		avgVisitDaysPerMau: fmt2(avgVisitDaysPerMau),
		dailyRows,
		weeklyRows,
		cohortRows,
		churn,
		actionCounts,
		leaders,
		shareTryFunnel,
		funnel: {
			signups: signupsWindow.length,
			activated: activatedSignup,
			retained: retainedSignup,
			paid: paidFromSignup,
			visitMau,
			actionMau
		},
		observations,
		milestone
	};
}

async function renderHtml(report) {
	const template = await loadTemplate();
	const styleBlock = await loadReportStyleBlock();
	const generatedAt = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/New_York",
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
		timeZoneName: "short"
	}).format(new Date());

	const dailyRows = report.dailyRows;
	const trafficDauChartHtml = sparkline(dailyRows, "traffic_dau", "day", "#64748b", { showTrend: true });
	const engagedDauChartHtml = multiSparkline(
		[
			{ label: "Logged-in visit DAU", valueKey: "visit_dau", color: "#b45309", rows: dailyRows },
			{ label: "Action DAU", valueKey: "action_dau", color: "#0f766e", rows: dailyRows }
		],
		"day",
		{ title: "Logged-in visit DAU vs action DAU", showTrend: true }
	);

	return fillHtmlTemplate(template, {
		styleBlock,
		periodLabel: report.periodLabel,
		generatedAt,
		windowDays: String(report.windowDays),
		fromDay: report.fromDay,
		toDay: report.toDay,
		avgTrafficDau: report.avgTrafficDau,
		avgVisitDau: report.avgVisitDau,
		avgActionDau: report.avgActionDau,
		priorTrafficDauNote: report.priorTrafficDauNote,
		priorVisitDauNote: report.priorVisitDauNote,
		priorActionDauNote: report.priorActionDauNote,
		visitMau: report.visitMau,
		actionMau: report.actionMau,
		stickinessVisit: report.stickinessVisit,
		paidUsers: report.paidUsers,
		latestActionWau: report.latestActionWau,
		latestWeekLabel: report.latestWeekLabel,
		avgActivationRate: report.avgActivationRate,
		avgHitsPerVisitDau: report.avgHitsPerVisitDau,
		avgBlocksPerVisitDau: report.avgBlocksPerVisitDau,
		avgActionsPerActionDau: report.avgActionsPerActionDau,
		returningVisitUsers: report.returningVisitUsers,
		returningVisitRate: report.returningVisitRate,
		avgVisitDaysPerMau: report.avgVisitDaysPerMau,
		churnParagraph: report.churn.paragraph,
		milestoneHtml: renderMilestoneHtml(report.milestone),
		observationsHtml: report.observations.map((o) => `<li>${esc(o)}</li>`).join(""),
		trafficDauChartHtml,
		engagedDauChartHtml,
		weeklyTableHtml: table(report.weeklyRows, [
			{ label: "Week (Mon–Sun US East)", key: "week_label" },
			{ label: "Days in window", key: "days_in_window" },
			{ label: "Traffic WAU", key: "traffic_wau" },
			{ label: "Visit WAU", key: "visit_wau" },
			{ label: "Action WAU", key: "action_wau" },
			{ label: "Action WAU WoW", key: "action_wau_wow" },
			{ label: "Avg traffic DAU", html: (r) => fmt1(r.avg_traffic_dau) },
			{ label: "New signups", key: "new_users" }
		]),
		dailyTableHtml: tableWithWeekHeaders(dailyRows, [
			{ label: "Day", key: "day" },
			{ label: "Traffic DAU", key: "traffic_dau" },
			{ label: "Visit DAU", key: "visit_dau" },
			{ label: "Action DAU", key: "action_dau" },
			{ label: "New signups", key: "new_users" },
			{ label: "Activation", html: (r) => pct(r.action_dau, r.visit_dau) },
			{ label: "Actions / action DAU", html: (r) => fmt2(r.actions_per_action_dau) },
			{ label: "Blocks / visit DAU", html: (r) => fmt2(r.blocks_per_visit_dau) }
		]),
		activationChartHtml: sparkline(
			report.loggedInDailyRows,
			"activation_pct",
			"day",
			"#0f766e",
			{ showTrend: true }
		),
		sessionDepthChartHtml: sparkline(report.loggedInDailyRows, "blocks_per_visit_dau", "day", "#b45309", {
			showTrend: true
		}),
		actionMixTableHtml: table(
			Object.entries(report.actionCounts).map(([type, count]) => ({ type, count })),
			[
				{ label: "Action", key: "type" },
				{ label: "Count", key: "count" },
				{
					label: "Share",
					html: (r) =>
						pct(r.count, Object.values(report.actionCounts).reduce((s, n) => s + n, 0))
				}
			]
		),
		cohortTableHtml: table(report.cohortRows, [
			{ label: "Signup week", key: "cohort_label" },
			{ label: "Signups", key: "signups" },
			{ label: "W+1 retained", key: "w1_retained" },
			{ label: "W+1 rate", html: (r) => pct(r.w1_retained, r.signups) },
			{ label: "W+4 retained", key: "w4_retained" },
			{ label: "W+4 rate", html: (r) => pct(r.w4_retained, r.signups) }
		]),
		shareTryTableHtml: report.shareTryFunnel
			? table([report.shareTryFunnel], [
					{ label: "Share views", key: "share_page_views" },
					{ label: "Share anon cids", key: "share_unique_anon_cids" },
					{ label: "Try requests", key: "try_requests" },
					{ label: "Try anon cids", key: "try_unique_anon_cids" },
					{ label: "Try from share", key: "try_from_share_cids" },
					{ label: "Transitioned users", key: "transitioned_unique_users" },
					{ label: "Try→transition", html: (r) => pct(r.transitioned_unique_anon_cids, r.try_unique_anon_cids) },
					{ label: "Share→transition", html: (r) => pct(r.transitioned_unique_anon_cids, r.share_unique_anon_cids) }
				])
			: '<p class="small">None.</p>',
		funnelTableHtml: table(
			[
				{ stage: "New signups", count: report.funnel.signups, rate: "100%" },
				{
					stage: "Activated ≤7d",
					count: report.funnel.activated,
					rate: pct(report.funnel.activated, report.funnel.signups)
				},
				{
					stage: "Retained days 8–30",
					count: report.funnel.retained,
					rate: pct(report.funnel.retained, report.funnel.signups)
				},
				{
					stage: "Paid (snapshot)",
					count: report.funnel.paid,
					rate: pct(report.funnel.paid, report.funnel.signups)
				},
				{
					stage: "Visit MAU (logged-in)",
					count: report.funnel.visitMau,
					rate: pct(report.funnel.visitMau, report.funnel.signups)
				},
				{
					stage: "Action MAU",
					count: report.funnel.actionMau,
					rate: pct(report.funnel.actionMau, report.funnel.signups)
				}
			],
			[
				{ label: "Stage", key: "stage" },
				{ label: "Users", key: "count" },
				{ label: "Vs signups", key: "rate" }
			]
		),
		leaderTableHtml: table(report.leaders, [
			{
				label: "User",
				html: (r) => {
					const handle = r.user_name ? `@${r.user_name}` : null;
					const extra = handle && handle !== r.label ? ` <span class="small">${esc(handle)}</span>` : "";
					return `<strong>${esc(r.label)}</strong>${extra}`;
				}
			},
			{ label: "Core", key: "core_actions" },
			{ label: "Likes", key: "like" },
			{ label: "Comments", key: "comment" },
			{ label: "Creates", key: "creation" },
			{ label: "Mutations", key: "mutations" },
			{ label: "Follows", key: "follows" },
			{ label: "Chat", key: "chat" },
			{ label: "Action days", key: "active_days" },
			{ label: "Visit days", key: "visit_days" },
			{ label: "Actions/day", html: (r) => fmt2(r.actions_per_active_day) }
		]),
		copyScriptHtml: buildEngagementCopyScriptHtml(
			buildEngagementSummaryExport(report),
			buildEngagementRawExport(report)
		)
	});
}

async function summarizePriorPeriod(fromDay, toDay) {
	const days = dayCountInclusive(fromDay, toDay);
	const priorTo = shiftDayKey(fromDay, -1);
	const priorFrom = shiftDayKey(fromDay, -days);
	const [pulseRows, engagement] = await Promise.all([
		loadPulseDays(priorFrom, priorTo),
		loadEngagementData(priorFrom, priorTo)
	]);
	const active = pulseRows.filter((r) => Number(r.unique_visitors) > 0);
	if (!active.length) return null;
	const priorDaily = active.map((r) => ({
		day: String(r.day),
		traffic_dau: Number(r.unique_visitors) || 0,
		visit_dau: Number(r.authed_visitors) || 0
	}));
	const actionByDay = new Map();
	for (const e of engagement.events) {
		if (!CORE_ACTION_TYPES.has(e.type)) continue;
		if (!actionByDay.has(e.day)) actionByDay.set(e.day, new Set());
		actionByDay.get(e.day).add(e.user_id);
	}
	const actionDaus = priorDaily.map((d) => actionByDay.get(d.day)?.size || 0);
	return {
		avgTrafficDau: avg(priorDaily.map((d) => d.traffic_dau)),
		avgVisitDau: avg(priorDaily.map((d) => d.visit_dau)),
		avgActionDau: avg(actionDaus)
	};
}

/** Load engagement report + milestone for a US East day window (same as monthly report). */
export async function loadEngagementReportForWindow(fromDay, toDay) {
	const [pulseRows, engagement, priorSummary] = await Promise.all([
		loadPulseDays(fromDay, toDay),
		loadEngagementData(fromDay, toDay),
		summarizePriorPeriod(fromDay, toDay)
	]);
	const report = buildReport(
		fromDay,
		toDay,
		pulseRows,
		engagement.users,
		engagement.events,
		engagement.shareTryFunnel,
		engagement.detailByUser,
		priorSummary
	);
	return report;
}

export { buildStableSmallRoomMilestone, renderMilestoneHtml };

async function main() {
	const { fromDay, toDay } = resolveWindow();
	const report = await loadEngagementReportForWindow(fromDay, toDay);
	report.leaders = await enrichLeaders(report.leaders);
	const html = await renderHtml(report);
	const outLabel =
		fromDay === usEastMonthStartKey(fromDay) ? fromDay.slice(0, 7) : toDay;
	const out =
		getArg("out") ||
		process.env.OUT ||
		path.join(REPO_ROOT, ".output", "engagement-monthly", `engagement-monthly-${outLabel}.html`);
	await fs.mkdir(path.dirname(out), { recursive: true });
	await fs.writeFile(out, html, "utf8");
	console.log(out);
}

const isCli =
	process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
	main().catch((err) => {
		console.error("[engagement-monthly-report]", err?.message || err);
		process.exit(1);
	});
}
