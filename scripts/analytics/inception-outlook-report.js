#!/usr/bin/env node
/**
 * Inception → outlook: all-time action metrics + visit pulse (when available) + linear projections.
 *
 *   node scripts/analytics/inception-outlook-report.js
 *   node scripts/analytics/inception-outlook-report.js --out .output/inception-outlook/custom.html
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { REPO_ROOT, loadEnv } from "../repo-root.cjs";
import { loadReportStyleBlock } from "./report-styles.js";
import {
	buildStory,
	loadFromDbInstance,
	addDays,
	toIsoDate,
	startOfUtcDay,
	startOfUtcWeek
} from "./user-growth-story.js";
import {
	usEastDayKey,
	usEastDayStartMs,
	yesterdayUsEastDayKey
} from "../../api_routes/utils/visitPulseCore.js";

const PULSE_DAY_MS = 24 * 60 * 60 * 1000;

const CORE_ACTION_TYPES = new Set(["creation", "publish", "comment", "like", "reaction", "tip_sent"]);

/** Stable-small-room targets (same as engagement monthly report). */
const STABLE_ROOM = {
	action_wau: 20,
	visit_wau: 25,
	action_mau: 25,
	avg_action_dau: 12,
	high_action_days: 3,
	commenters: 5,
	publishers: 3,
	returning_visit_rate: 0.5,
	top2_action_share_max: 0.5,
	action_wau_streak_weeks: 4
};

const WINDOW_DAYS = Number(process.env.ENGAGEMENT_WINDOW_DAYS || 30);

function usEastWeekStartKey(dayKey) {
	const startMs = usEastDayStartMs(dayKey);
	const d = new Date(startMs);
	const dow = d.getUTCDay();
	const mondayOffset = (dow + 6) % 7;
	return usEastDayKey(new Date(startMs - mondayOffset * PULSE_DAY_MS));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();

const TEMPLATE_PATH = path.join(__dirname, "inception-outlook-report.html");
const FORWARD_WEEKS_SHORT = Number(process.env.OUTLOOK_FORWARD_WEEKS || 13);
const FORWARD_MONTHS = Number(process.env.OUTLOOK_FORWARD_MONTHS || 4);
/** Weekly projection length — at least 4 months so short vs long horizons differ. */
const FORWARD_WEEKS = Math.max(FORWARD_WEEKS_SHORT, Math.round(FORWARD_MONTHS * (52 / 12)));
const REGRESSION_WEEKS = Number(process.env.OUTLOOK_REGRESSION_WEEKS || 10);
const REGRESSION_MONTHS = Number(process.env.OUTLOOK_REGRESSION_MONTHS || 4);
/** Daily regression window once visit-pulse history is longer than PULSE_USE_ALL_HISTORY_DAYS. */
const REGRESSION_DAYS = Number(process.env.OUTLOOK_REGRESSION_DAYS || 7);
/** While pulse is young, regress on all complete days since instrumentation (not a trailing 7d slice). */
const PULSE_USE_ALL_HISTORY_DAYS = Number(process.env.OUTLOOK_PULSE_ALL_HISTORY_DAYS || 28);

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

function shiftMonthKey(monthKey, deltaMonths) {
	const [y, m] = String(monthKey).split("-").map(Number);
	const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftWeekKey(weekKey, deltaWeeks) {
	return toIsoDate(addDays(new Date(`${weekKey}T00:00:00.000Z`), deltaWeeks * 7));
}

function currentMonthKey() {
	const now = new Date();
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentWeekKey() {
	return toIsoDate(startOfUtcWeek(new Date()));
}

function shiftDayKey(dayKey, deltaDays) {
	return usEastDayKey(new Date(usEastDayStartMs(dayKey) + deltaDays * PULSE_DAY_MS));
}

function eventUsEastDay(e) {
	return usEastDayKey(e.ts);
}

/** Months before the current calendar month (partial month excluded from trends). */
function completeMonths(monthly) {
	const cur = currentMonthKey();
	return monthly.filter((m) => m.month < cur);
}

/** Weeks before the current ISO week (partial week excluded from trends). */
function completeWeeks(weekly) {
	const cur = currentWeekKey();
	return weekly.filter((w) => w.week < cur);
}

function projectFromRecent(rows, valueKey, labelKey, forwardCount, recentCount, nextLabel, regressionRows = null) {
	const fitRows = regressionRows?.length ? regressionRows : rows;
	if (!fitRows.length) return { projected: [], slope: 0, recent: [] };
	const slice = fitRows.slice(-recentCount);
	const values = slice.map((r) => Number(r[valueKey] || 0));
	const lr = linearRegression(values);
	const anchor = fitRows[fitRows.length - 1];
	const out = [];
	for (let i = 1; i <= forwardCount; i++) {
		const raw = lr.intercept + lr.slope * (slice.length - 1 + i);
		out.push({
			[labelKey]: nextLabel(anchor[labelKey], i),
			[valueKey]: Math.max(0, Math.round(raw * 10) / 10),
			projected: true
		});
	}
	return { projected: out, slope: lr.slope, recent: slice };
}

function weeksUntilTarget(recentRows, valueKey, target, recentCount) {
	const slice = recentRows.slice(-recentCount);
	if (!slice.length) return null;
	const values = slice.map((r) => Number(r[valueKey] || 0));
	const lr = linearRegression(values);
	if (lr.slope <= 0) return null;
	const lastVal = values[values.length - 1];
	const need = target - lastVal;
	if (need <= 0) return { weeks: 0, projectedValue: lastVal, slope: lr.slope };
	const weeks = Math.ceil(need / lr.slope);
	return { weeks, projectedValue: lastVal + lr.slope * weeks, slope: lr.slope };
}

function weeksUntilTargetLte(recentRows, valueKey, target, recentCount) {
	const slice = recentRows.slice(-recentCount);
	if (!slice.length) return null;
	const values = slice.map((r) => Number(r[valueKey] || 0));
	const lr = linearRegression(values);
	if (lr.slope >= 0) return null;
	const lastVal = values[values.length - 1];
	if (lastVal <= target) return { weeks: 0, projectedValue: lastVal, slope: lr.slope };
	const need = lastVal - target;
	const weeks = Math.ceil(need / Math.abs(lr.slope));
	return { weeks, projectedValue: lastVal + lr.slope * weeks, slope: lr.slope };
}

function renderChartMilestoneLines(markers, all, labelKey, x, chartTop, chartBottom) {
	if (!markers?.length) return "";
	return markers
		.map((m) => {
			const i = all.findIndex((r) => String(r[labelKey]) === String(m.at));
			if (i < 0) return "";
			const xi = x(i).toFixed(1);
			const stroke = m.projected ? "#c2410c" : m.historical ? "#64748b" : "#0f766e";
			return `<line x1="${xi}" y1="${chartTop}" x2="${xi}" y2="${chartBottom}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="3 4"/><text x="${xi}" y="${chartTop + 11}" text-anchor="start" font-size="9" fill="${stroke}" transform="rotate(-55 ${xi} ${chartTop + 11})">${esc(m.short)}</text>`;
		})
		.join("");
}

function formatChartTick(v, { percent = false } = {}) {
	const n = Number(v);
	if (!Number.isFinite(n)) return percent ? "0%" : "0";
	let base;
	if (Math.abs(n) >= 100) base = String(Math.round(n));
	else if (Math.abs(n - Math.round(n)) < 0.05) base = String(Math.round(n));
	else base = n.toFixed(1);
	return percent ? `${base}%` : base;
}

/** Round min/max to readable tick steps for grid + labels. */
function buildChartYTicks(minVal, maxVal, targetCount = 5) {
	const lo = Math.min(minVal, 0);
	const hi = Math.max(maxVal, 1);
	const range = hi - lo || 1;
	const roughStep = range / Math.max(targetCount - 1, 1);
	const mag = Math.pow(10, Math.floor(Math.log10(roughStep))) || 1;
	const norm = roughStep / mag;
	let step = 10 * mag;
	if (norm <= 1) step = mag;
	else if (norm <= 2) step = 2 * mag;
	else if (norm <= 5) step = 5 * mag;
	const start = Math.floor(lo / step) * step;
	const ticks = [];
	for (let t = start; t <= hi + step * 0.001; t += step) {
		ticks.push(Math.round(t * 100) / 100);
		if (ticks.length > 8) break;
	}
	const end = ticks.length ? ticks[ticks.length - 1] : hi;
	if (end < hi) ticks.push(Math.round((end + step) * 100) / 100);
	return ticks.length ? ticks : [0, hi];
}

function renderChartYTicks(ticks, yFn, padL, padR, w, { percent = false } = {}) {
	return ticks
		.map((tick) => {
			const yy = yFn(tick);
			return `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${w - padR}" y2="${yy.toFixed(1)}" stroke="#e2e8f0" stroke-dasharray="4 4"/><text x="${padL - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#64748b">${esc(formatChartTick(tick, { percent }))}</text>`;
		})
		.join("");
}

function renderChartXTicks(rows, labelKey, xFn, w, padR, chartBottom, maxTicks = 6) {
	const n = rows.length;
	if (!n) return "";
	const indices =
		n <= maxTicks
			? [...Array(n).keys()]
			: Array.from({ length: maxTicks }, (_, t) => Math.round((t * (n - 1)) / (maxTicks - 1)));
	const uniq = [...new Set(indices)];
	return uniq
		.map((i) => {
			const xi = xFn(i);
			const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
			return `<text x="${xi.toFixed(1)}" y="${chartBottom + 18}" text-anchor="${anchor}" font-size="10" fill="#64748b">${esc(rows[i][labelKey])}</text>`;
		})
		.join("");
}

function buildMilestoneMarkers(histRows, projRows, regressionRows, valueKey, labelKey, target, shortName, stepLabel) {
	const markers = [];
	const past = histRows.find((r) => Number(r[valueKey]) >= target);
	if (past) {
		markers.push({ at: past[labelKey], short: `${shortName} ✓`, projected: false });
		return markers;
	}
	if (!regressionRows.length || !projRows.length) return markers;
	const hit = weeksUntilTarget(regressionRows, valueKey, target, REGRESSION_WEEKS);
	if (!hit || hit.weeks <= 0) return markers;
	const anchor = regressionRows[regressionRows.length - 1];
	const at = stepLabel(anchor[labelKey], hit.weeks);
	const onProj = projRows.find((r) => String(r[labelKey]) === String(at));
	if (onProj) markers.push({ at, short: `${shortName} ~${at}`, projected: true });
	return markers;
}

function buildMilestoneMarkersLte(histRows, projRows, regressionRows, valueKey, labelKey, target, shortName, stepLabel) {
	const markers = [];
	const past = histRows.find((r) => Number(r[valueKey]) <= target);
	if (past) {
		markers.push({ at: past[labelKey], short: `${shortName} ✓`, projected: false });
		return markers;
	}
	if (!regressionRows.length || !projRows.length) return markers;
	const hit = weeksUntilTargetLte(regressionRows, valueKey, target, REGRESSION_WEEKS);
	if (!hit || hit.weeks <= 0) return markers;
	const anchor = regressionRows[regressionRows.length - 1];
	const at = stepLabel(anchor[labelKey], hit.weeks);
	const onProj = projRows.find((r) => String(r[labelKey]) === String(at));
	if (onProj) markers.push({ at, short: `${shortName} ~${at}`, projected: true });
	return markers;
}

function chartHistoryProjection(
	histRows,
	projRows,
	valueKey,
	labelKey,
	{
		title,
		histColor = "#0ea5e9",
		projColor = "#94a3b8",
		markers = [],
		referenceY = null,
		referenceLabel = "",
		yAxisPercent = false,
		trendSlope = null,
		trendUnit = null
	} = {}
) {
	const w = 980;
	const h = 268;
	const padL = 52;
	const padR = 24;
	const padT = 28;
	const padB = 44;
	const chartBottom = h - padB;
	const chartTop = padT;
	const chartH = chartBottom - chartTop;
	const hist = histRows.map((r) => ({ ...r, projected: false }));
	const proj = projRows.map((r) => ({ ...r, projected: true }));
	const all = [...hist, ...proj];
	if (!all.length) return '<p class="small">No data.</p>';
	const labelSet = new Set(all.map((r) => String(r[labelKey])));
	const chartMarkers = (markers || []).filter((m) => labelSet.has(String(m.at)));

	const values = all.map((r) => Number(r[valueKey] || 0));
	const yTicks = buildChartYTicks(Math.min(...values, 0), Math.max(...values, 1));
	const minY = yTicks[0];
	const maxY = yTicks[yTicks.length - 1];
	const range = Math.max(maxY - minY, 1);
	const x = (i) => padL + ((w - padL - padR) * i) / Math.max(all.length - 1, 1);
	const y = (v) => chartBottom - (chartH * (v - minY)) / range;

	const yTicksHtml = renderChartYTicks(yTicks, y, padL, padR, w, { percent: yAxisPercent });
	const xTicksHtml = renderChartXTicks(all, labelKey, x, w, padR, chartBottom);
	const refLineHtml =
		Number.isFinite(referenceY) && referenceY >= minY && referenceY <= maxY
			? (() => {
					const yy = y(referenceY).toFixed(1);
					return `<line x1="${padL}" y1="${yy}" x2="${w - padR}" y2="${yy}" stroke="#0f766e" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${w - padR}" y="${(Number(yy) - 5).toFixed(1)}" text-anchor="end" font-size="10" fill="#0f766e">${esc(referenceLabel || String(referenceY))}</text>`;
				})()
			: "";

	const histPoints = hist.map((r, i) => `${x(i).toFixed(1)},${y(Number(r[valueKey] || 0)).toFixed(1)}`).join(" ");
	const projStart = hist.length - 1;
	const projPoints = proj.length
		? [
				`${x(projStart).toFixed(1)},${y(Number(hist[hist.length - 1]?.[valueKey] || 0)).toFixed(1)}`,
				...proj.map((r, i) => `${x(projStart + 1 + i).toFixed(1)},${y(Number(r[valueKey] || 0)).toFixed(1)}`)
			].join(" ")
		: "";

	const dividerX = hist.length > 0 ? x(hist.length - 1).toFixed(1) : padL;
	const unit =
		trendUnit || (labelKey === "month" ? "month" : labelKey === "week" ? "week" : "day");
	const regressionCount =
		unit === "month" ? REGRESSION_MONTHS : unit === "week" ? REGRESSION_WEEKS : REGRESSION_DAYS;
	const slopeVal =
		Number.isFinite(trendSlope)
			? trendSlope
			: hist.length >= 2
				? linearRegression(hist.slice(-regressionCount).map((r) => Number(r[valueKey] || 0))).slope
				: 0;
	const slopeNote =
		projRows.length && hist.length >= 2
			? `Recent trend: ${slopeVal > 0 ? "+" : ""}${slopeVal.toFixed(2)}/${unit}`
			: "";

	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" aria-label="${esc(title)}">
		<rect width="${w}" height="${h}" fill="#fff"/>
		<line x1="${padL}" y1="${chartBottom}" x2="${w - padR}" y2="${chartBottom}" stroke="#cbd5e1"/>
		<line x1="${padL}" y1="${chartTop}" x2="${padL}" y2="${chartBottom}" stroke="#cbd5e1"/>
		${yTicksHtml}
		${refLineHtml}
		<line x1="${dividerX}" y1="${chartTop}" x2="${dividerX}" y2="${chartBottom}" stroke="#e2e8f0" stroke-dasharray="4 4"/>
		<text x="${Number(dividerX) + 4}" y="${chartTop + 12}" font-size="10" fill="#64748b">now →</text>
		${renderChartMilestoneLines(chartMarkers, all, labelKey, x, chartTop, chartBottom)}
		${histPoints ? `<polyline fill="none" stroke="${histColor}" stroke-width="2.5" points="${histPoints}"/>` : ""}
		${projPoints ? `<polyline fill="none" stroke="${projColor}" stroke-width="2.5" stroke-dasharray="8 5" points="${projPoints}"/>` : ""}
		${xTicksHtml}
		<text x="${w - padR}" y="${chartTop + 10}" text-anchor="end" font-size="10" fill="#64748b">${esc(slopeNote)}</text>
	</svg>`;
}

function table(rows, cols) {
	if (!rows.length) return "<p class=\"small\">None.</p>";
	const head = `<thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead>`;
	const body = rows
		.map((r) => `<tr>${cols.map((c) => `<td>${c.html ? c.html(r) : esc(r[c.key])}</td>`).join("")}</tr>`)
		.join("");
	return `<table>${head}<tbody>${body}</tbody></table>`;
}

async function loadAllPulseDays() {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) return [];
	const client = createClient(url, key, { auth: { persistSession: false } });
	const { data, error } = await client
		.from("prsn_visit_pulse_days")
		.select("day, authed_visitors, unique_visitors, details")
		.order("day");
	if (error) throw error;
	return Array.isArray(data) ? data : [];
}

function avg(nums) {
	const list = nums.filter((n) => Number.isFinite(n));
	return list.length ? list.reduce((s, n) => s + n, 0) / list.length : 0;
}

function buildWeeklyDepthSeries(events) {
	const byWeek = new Map();
	for (const e of events) {
		if (!CORE_ACTION_TYPES.has(e.type)) continue;
		const day = eventUsEastDay(e);
		const wk = usEastWeekStartKey(day);
		if (!byWeek.has(wk)) {
			byWeek.set(wk, { commenters: new Set(), publishers: new Set(), actionDauByDay: new Map() });
		}
		const bucket = byWeek.get(wk);
		if (e.type === "comment") bucket.commenters.add(e.user_id);
		if (e.type === "publish") bucket.publishers.add(e.user_id);
		if (!bucket.actionDauByDay.has(day)) bucket.actionDauByDay.set(day, new Set());
		bucket.actionDauByDay.get(day).add(e.user_id);
	}
	return [...byWeek.entries()]
		.map(([week, b]) => {
			const dauValues = [...b.actionDauByDay.values()].map((s) => s.size);
			return {
				week,
				commenters: b.commenters.size,
				publishers: b.publishers.size,
				avg_action_dau: dauValues.length ? avg(dauValues) : 0,
				high_action_days: dauValues.filter((d) => d >= STABLE_ROOM.avg_action_dau).length
			};
		})
		.sort((a, b) => a.week.localeCompare(b.week));
}

function firstAtTarget(rows, valueKey, labelKey, target) {
	const hit = rows.find((r) => Number(r[valueKey]) >= target);
	return hit ? hit[labelKey] : null;
}

function firstAtTargetLte(rows, valueKey, labelKey, target) {
	const hit = rows.find((r) => Number(r[valueKey]) <= target);
	return hit ? hit[labelKey] : null;
}

function longestStreak(rows, valueKey, target) {
	let best = 0;
	let cur = 0;
	for (const r of rows) {
		if (Number(r[valueKey]) >= target) {
			cur++;
			if (cur > best) best = cur;
		} else {
			cur = 0;
		}
	}
	return best;
}

function firstFourWeekStreakWeek(rows, valueKey, target) {
	let streak = 0;
	for (const r of rows) {
		if (Number(r[valueKey]) >= target) {
			streak++;
			if (streak >= STABLE_ROOM.action_wau_streak_weeks) return r.week;
		} else {
			streak = 0;
		}
	}
	return null;
}

function projectedCrossLabel(projRows, regressionRows, valueKey, labelKey, target, stepLabel) {
	if (!projRows.length || !regressionRows.length) return null;
	const past = regressionRows.find((r) => Number(r[valueKey]) >= target);
	if (past) return null;
	const hit = weeksUntilTarget(regressionRows, valueKey, target, REGRESSION_WEEKS);
	if (!hit || hit.weeks <= 0) return null;
	const anchor = regressionRows[regressionRows.length - 1];
	const at = stepLabel(anchor[labelKey], hit.weeks);
	return projRows.find((r) => String(r[labelKey]) === String(at)) ? at : at;
}

function projectedCrossLabelLte(projRows, regressionRows, valueKey, labelKey, target, stepLabel) {
	if (!projRows.length || !regressionRows.length) return null;
	const past = regressionRows.find((r) => Number(r[valueKey]) <= target);
	if (past) return past[labelKey];
	const hit = weeksUntilTargetLte(regressionRows, valueKey, target, REGRESSION_WEEKS);
	if (!hit || hit.weeks <= 0) return null;
	const anchor = regressionRows[regressionRows.length - 1];
	const at = stepLabel(anchor[labelKey], hit.weeks);
	return projRows.find((r) => String(r[labelKey]) === String(at)) ? at : at;
}

function top2SharePct(actionCounts) {
	const sorted = [...actionCounts.entries()].sort((a, b) => b[1] - a[1]);
	const total = sorted.reduce((s, [, n]) => s + n, 0);
	if (!total) return 0;
	const top2 = (sorted[0]?.[1] || 0) + (sorted[1]?.[1] || 0);
	return Math.round((top2 / total) * 1000) / 10;
}

function buildWeeklyTop2ShareSeries(events) {
	const byWeek = new Map();
	for (const e of events) {
		if (!CORE_ACTION_TYPES.has(e.type)) continue;
		const wk = usEastWeekStartKey(eventUsEastDay(e));
		if (!byWeek.has(wk)) byWeek.set(wk, new Map());
		const counts = byWeek.get(wk);
		counts.set(e.user_id, (counts.get(e.user_id) || 0) + 1);
	}
	return [...byWeek.entries()]
		.map(([week, counts]) => ({ week, top2_share_pct: top2SharePct(counts) }))
		.sort((a, b) => a.week.localeCompare(b.week));
}

function buildWindowMetrics(pulseDays, events, fromDay, toDay) {
	const visitDaysByUser = new Map();
	for (const row of pulseDays) {
		const day = String(row.day);
		if (day < fromDay || day > toDay) continue;
		for (const v of row.details?.visitors || []) {
			const uid = Number(v.user_id);
			if (!Number.isFinite(uid) || uid <= 0) continue;
			if (!visitDaysByUser.has(uid)) visitDaysByUser.set(uid, new Set());
			visitDaysByUser.get(uid).add(day);
		}
	}
	const visitMau = visitDaysByUser.size;
	const returning = [...visitDaysByUser.values()].filter((days) => days.size >= 2).length;
	const returningRate = visitMau ? returning / visitMau : 0;

	const actionCounts = new Map();
	for (const e of events) {
		const day = eventUsEastDay(e);
		if (day < fromDay || day > toDay) continue;
		if (!CORE_ACTION_TYPES.has(e.type)) continue;
		actionCounts.set(e.user_id, (actionCounts.get(e.user_id) || 0) + 1);
	}
	const top2Share = top2SharePct(actionCounts) / 100;

	return { visitMau, returning, returningRate, top2Share };
}

function buildMilestoneRoadmap(ctx) {
	const {
		weeklyComplete,
		wauProj,
		weeklyVisitComplete,
		visitWauProj,
		monthlyComplete,
		mauProj,
		depthComplete,
		commentersProj,
		publishersProj,
		avgDauProj,
		highDaysProj,
		top2Complete,
		top2Proj,
		windowMetrics,
		weekLabelFrom,
		visitWeekLabelFrom,
		mauLabelFrom
	} = ctx;

	const top2TargetPct = STABLE_ROOM.top2_action_share_max * 100;

	const wauHist = weeklyComplete;
	const wauProjRows = wauProj.projected;
	const wauCombined = [...wauHist.map((w) => ({ week: w.week, wau: w.wau })), ...wauProjRows];

	const rowForSeries = ({
		label,
		current,
		targetLabel,
		met,
		achievedAt,
		projectedAt,
		note = ""
	}) => ({
		criterion: label,
		current,
		target: targetLabel,
		status: met ? "Met" : projectedAt ? "On track (proj.)" : "Not yet",
		achieved_at: achievedAt || (met ? "—" : "—"),
		projected_at: projectedAt || (met ? "—" : note || "Trend unlikely"),
		met
	});

	const rows = [
		rowForSeries({
			label: "Action WAU",
			current: String(wauHist.at(-1)?.wau ?? 0),
			targetLabel: `≥ ${STABLE_ROOM.action_wau}`,
			met: (wauHist.at(-1)?.wau ?? 0) >= STABLE_ROOM.action_wau,
			achievedAt: firstAtTarget(wauHist, "wau", "week", STABLE_ROOM.action_wau),
			projectedAt: projectedCrossLabel(wauProjRows, wauHist, "wau", "week", STABLE_ROOM.action_wau, (w, i) =>
				shiftWeekKey(weekLabelFrom, i)
			)
		}),
		rowForSeries({
			label: "Visit WAU (pulse)",
			current: String(weeklyVisitComplete.at(-1)?.visit_wau ?? 0),
			targetLabel: `≥ ${STABLE_ROOM.visit_wau}`,
			met: (weeklyVisitComplete.at(-1)?.visit_wau ?? 0) >= STABLE_ROOM.visit_wau,
			achievedAt: firstAtTarget(weeklyVisitComplete, "visit_wau", "week", STABLE_ROOM.visit_wau),
			projectedAt: projectedCrossLabel(
				visitWauProj.projected,
				weeklyVisitComplete,
				"visit_wau",
				"week",
				STABLE_ROOM.visit_wau,
				(w, i) => shiftWeekKey(visitWeekLabelFrom, i)
			),
			note: weeklyVisitComplete.length ? "" : "No pulse weeks"
		}),
		rowForSeries({
			label: "Action MAU",
			current: String(monthlyComplete.at(-1)?.mau ?? 0),
			targetLabel: `≥ ${STABLE_ROOM.action_mau}`,
			met: (monthlyComplete.at(-1)?.mau ?? 0) >= STABLE_ROOM.action_mau,
			achievedAt: firstAtTarget(monthlyComplete, "mau", "month", STABLE_ROOM.action_mau),
			projectedAt: projectedCrossLabel(mauProj.projected, monthlyComplete, "mau", "month", STABLE_ROOM.action_mau, (m, i) =>
				shiftMonthKey(mauLabelFrom, i)
			)
		}),
		rowForSeries({
			label: "Avg action DAU (week)",
			current: avg(depthComplete.slice(-4).map((r) => r.avg_action_dau)).toFixed(1),
			targetLabel: `≥ ${STABLE_ROOM.avg_action_dau}`,
			met: (depthComplete.at(-1)?.avg_action_dau ?? 0) >= STABLE_ROOM.avg_action_dau,
			achievedAt: firstAtTarget(depthComplete, "avg_action_dau", "week", STABLE_ROOM.avg_action_dau),
			projectedAt: projectedCrossLabel(
				avgDauProj.projected,
				depthComplete,
				"avg_action_dau",
				"week",
				STABLE_ROOM.avg_action_dau,
				(w, i) => shiftWeekKey(weekLabelFrom, i)
			)
		}),
		rowForSeries({
			label: "Days / week with action DAU ≥ 12",
			current: String(depthComplete.at(-1)?.high_action_days ?? 0),
			targetLabel: `≥ ${STABLE_ROOM.high_action_days}`,
			met: (depthComplete.at(-1)?.high_action_days ?? 0) >= STABLE_ROOM.high_action_days,
			achievedAt: firstAtTarget(depthComplete, "high_action_days", "week", STABLE_ROOM.high_action_days),
			projectedAt: projectedCrossLabel(
				highDaysProj.projected,
				depthComplete,
				"high_action_days",
				"week",
				STABLE_ROOM.high_action_days,
				(w, i) => shiftWeekKey(weekLabelFrom, i)
			)
		}),
		rowForSeries({
			label: "Distinct commenters (week)",
			current: String(depthComplete.at(-1)?.commenters ?? 0),
			targetLabel: `≥ ${STABLE_ROOM.commenters}`,
			met: (depthComplete.at(-1)?.commenters ?? 0) >= STABLE_ROOM.commenters,
			achievedAt: firstAtTarget(depthComplete, "commenters", "week", STABLE_ROOM.commenters),
			projectedAt: projectedCrossLabel(
				commentersProj.projected,
				depthComplete,
				"commenters",
				"week",
				STABLE_ROOM.commenters,
				(w, i) => shiftWeekKey(weekLabelFrom, i)
			)
		}),
		rowForSeries({
			label: "Distinct publishers (week)",
			current: String(depthComplete.at(-1)?.publishers ?? 0),
			targetLabel: `≥ ${STABLE_ROOM.publishers}`,
			met: (depthComplete.at(-1)?.publishers ?? 0) >= STABLE_ROOM.publishers,
			achievedAt: firstAtTarget(depthComplete, "publishers", "week", STABLE_ROOM.publishers),
			projectedAt: projectedCrossLabel(
				publishersProj.projected,
				depthComplete,
				"publishers",
				"week",
				STABLE_ROOM.publishers,
				(w, i) => shiftWeekKey(weekLabelFrom, i)
			)
		}),
		rowForSeries({
			label: `Returning visit rate (${WINDOW_DAYS}d window)`,
			current: `${(windowMetrics.returningRate * 100).toFixed(1)}%`,
			targetLabel: `≥ ${STABLE_ROOM.returning_visit_rate * 100}%`,
			met: windowMetrics.returningRate >= STABLE_ROOM.returning_visit_rate,
			achievedAt: windowMetrics.returningRate >= STABLE_ROOM.returning_visit_rate ? "Current window" : "—",
			projectedAt: null,
			note: "Window metric — not projected on a weekly slope"
		}),
		rowForSeries({
			label: "Top-2 share of core actions (week)",
			current: `${top2Complete.at(-1)?.top2_share_pct ?? 0}%`,
			targetLabel: `≤ ${top2TargetPct}%`,
			met: (top2Complete.at(-1)?.top2_share_pct ?? 100) <= top2TargetPct,
			achievedAt: firstAtTargetLte(top2Complete, "top2_share_pct", "week", top2TargetPct),
			projectedAt: projectedCrossLabelLte(
				top2Proj.projected,
				top2Complete,
				"top2_share_pct",
				"week",
				top2TargetPct,
				(w, i) => shiftWeekKey(weekLabelFrom, i)
			),
			note: "Lower is broader participation"
		}),
		rowForSeries({
			label: `Top-2 share (${WINDOW_DAYS}d pulse window)`,
			current: `${(windowMetrics.top2Share * 100).toFixed(1)}%`,
			targetLabel: `≤ ${top2TargetPct}%`,
			met: windowMetrics.top2Share <= STABLE_ROOM.top2_action_share_max,
			achievedAt: windowMetrics.top2Share <= STABLE_ROOM.top2_action_share_max ? "Current window" : "—",
			projectedAt: null,
			note: "Rolling window — see weekly chart for trend"
		}),
		rowForSeries({
			label: `${STABLE_ROOM.action_wau_streak_weeks} consecutive weeks action WAU ≥ 20`,
			current: "—",
			targetLabel: `${STABLE_ROOM.action_wau_streak_weeks} weeks`,
			met: Boolean(firstFourWeekStreakWeek(wauHist, "wau", STABLE_ROOM.action_wau)),
			achievedAt: firstFourWeekStreakWeek(wauHist, "wau", STABLE_ROOM.action_wau),
			projectedAt: firstFourWeekStreakWeek(wauCombined, "wau", STABLE_ROOM.action_wau),
			note: "Streak from actual + projected weekly WAU",
			current: `${longestStreak(wauHist, "wau", STABLE_ROOM.action_wau)} wk streak (need ${STABLE_ROOM.action_wau_streak_weeks})`
		})
	];

	return rows;
}

function depthChart(hist, proj, valueKey, title, color, target, shortName, weekLabelFrom) {
	const markers = buildMilestoneMarkers(
		hist,
		proj.projected,
		hist,
		valueKey,
		"week",
		target,
		shortName,
		(w, i) => shiftWeekKey(weekLabelFrom, i)
	);
	return chartHistoryProjection(hist, proj.projected, valueKey, "week", {
		title,
		histColor: color,
		markers
	});
}

function top2ShareChart(hist, proj, weekLabelFrom) {
	const targetPct = STABLE_ROOM.top2_action_share_max * 100;
	const markers = buildMilestoneMarkersLte(
		hist,
		proj.projected,
		hist,
		"top2_share_pct",
		"week",
		targetPct,
		`≤${targetPct}%`,
		(w, i) => shiftWeekKey(weekLabelFrom, i)
	);
	return chartHistoryProjection(hist, proj.projected, "top2_share_pct", "week", {
		title: "Top-2 users’ share of core actions (%)",
		histColor: "#b45309",
		markers,
		referenceY: targetPct,
		referenceLabel: `≤${targetPct}% target`,
		yAxisPercent: true
	});
}

function buildWeeklyVisitWau(pulseDays) {
	const byWeek = new Map();
	for (const row of pulseDays) {
		const day = String(row.day);
		const ws = usEastWeekStartKey(day);
		if (!byWeek.has(ws)) byWeek.set(ws, new Set());
		for (const v of row.details?.visitors || []) {
			const uid = Number(v.user_id);
			if (Number.isFinite(uid) && uid > 0) byWeek.get(ws).add(uid);
		}
	}
	return [...byWeek.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([week, set]) => ({ week, visit_wau: set.size }));
}

function buildStoryBullets(growth, pulseDays) {
	const dau = growth.dailyAllTimeRows || [];
	const firstActive = dau.find((r) => r.dau > 0);
	const mau = growth.monthlyAllTimeRows || [];
	const peakMau = mau.reduce((a, b) => (b.mau > (a?.mau || 0) ? b : a), mau[0]);
	const cum = growth.cumulativeUsersByWeek || [];
	const firstPulse = pulseDays.find((r) => Number(r.authed_visitors) > 0);
	const bullets = [];

	if (cum.length) {
		bullets.push(
			`Signups since ${cum[0].week}: ${growth.totalUsers} accounts total (cumulative ${cum[cum.length - 1]?.total_users ?? growth.totalUsers} by ${cum[cum.length - 1]?.week}).`
		);
	}
	if (firstActive) {
		bullets.push(
			`First day with core-action activity: ${firstActive.day} (DAU ${firstActive.dau}). Jan signups preceded the action loop by ~2 weeks.`
		);
	}
	if (peakMau) {
		bullets.push(`Peak action MAU so far: ${peakMau.mau} (${peakMau.month}).`);
	}
	if (firstPulse) {
		bullets.push(
			`Visit pulse (passive traffic) begins ${firstPulse.day}; earlier months have no stored browse/traffic series — only actions.`
		);
	}
	const curMonth = currentMonthKey();
	const partialMonth = growth.monthlyAllTimeRows?.find((m) => m.month === curMonth);
	const partialDays = (growth.dailyAllTimeRows || []).filter((d) => d.day.startsWith(`${curMonth}-`)).length;
	if (partialMonth && partialDays > 0) {
		bullets.push(
			`${curMonth} is partial (${partialDays} day(s) so far): action MAU ${partialMonth.mau} so far — not used in month-over-month trend lines.`
		);
	}
	const lastCompleteMonth = completeMonths(growth.monthlyAllTimeRows || []).at(-1);
	bullets.push(
		`Latest complete month: ${lastCompleteMonth?.month ?? "—"} (action MAU ${lastCompleteMonth?.mau ?? 0}). Today: action DAU ${growth.latestDay?.dau ?? 0}, WAU ${growth.latestWeek?.wau ?? 0}; ${growth.paidUsers} paid.`
	);
	return bullets;
}

function resolvePulseWindow() {
	const toDay = yesterdayUsEastDayKey();
	let fromDay = toDay;
	for (let i = 0; i < WINDOW_DAYS - 1; i++) fromDay = shiftDayKey(fromDay, -1);
	return { fromDay, toDay };
}

function buildOutlook(growth, pulseDays, events) {
	const weekly = growth.cumulativeUsersByWeek || [];
	const monthly = growth.monthlyAllTimeRows || [];
	const weeklyComplete = completeWeeks(weekly);
	const monthlyComplete = completeMonths(monthly);
	const daily = (growth.dailyAllTimeRows || []).filter((r) => r.dau > 0);
	const curMonth = currentMonthKey();
	const partialMonth = monthly.find((m) => m.month === curMonth);
	const partialDaysInMonth = (growth.dailyAllTimeRows || []).filter((d) =>
		d.day.startsWith(`${curMonth}-`)
	).length;

	const usersProj = projectFromRecent(
		weekly,
		"total_users",
		"week",
		FORWARD_WEEKS,
		REGRESSION_WEEKS,
		(w, i) => shiftWeekKey(w, i),
		weeklyComplete
	);
	const mauLabelFrom = partialMonth ? curMonth : monthlyComplete.at(-1)?.month;
	const weekLabelFrom = weekly.some((w) => w.week === currentWeekKey())
		? currentWeekKey()
		: weeklyComplete.at(-1)?.week;
	const mauProj = projectFromRecent(
		monthly,
		"mau",
		"month",
		FORWARD_MONTHS,
		REGRESSION_MONTHS,
		(_m, i) => shiftMonthKey(mauLabelFrom, i),
		monthlyComplete
	);
	const wauProj = projectFromRecent(
		weekly,
		"wau",
		"week",
		FORWARD_WEEKS,
		REGRESSION_WEEKS,
		(_w, i) => shiftWeekKey(weekLabelFrom, i),
		weeklyComplete
	);
	const dauProj = projectFromRecent(
		daily,
		"dau",
		"day",
		Math.min(90, FORWARD_WEEKS * 7),
		30,
		(d, i) => toIsoDate(addDays(new Date(`${d}T00:00:00.000Z`), i))
	);

	const pulseVisit = pulseDays
		.filter((r) => Number(r.authed_visitors) > 0)
		.map((r) => ({ day: String(r.day), visit_dau: Number(r.authed_visitors) }));
	const pulseThroughDay = yesterdayUsEastDayKey();
	const pulseVisitComplete = pulseVisit.filter((r) => r.day <= pulseThroughDay);
	const pulseVisitPartial = pulseVisit.filter((r) => r.day > pulseThroughDay);
	const visitUseAllPulseHistory =
		pulseVisitComplete.length > 0 && pulseVisitComplete.length <= PULSE_USE_ALL_HISTORY_DAYS;
	const visitRegressionDays = visitUseAllPulseHistory
		? pulseVisitComplete.length
		: Math.min(REGRESSION_DAYS, pulseVisitComplete.length);
	const visitProj = projectFromRecent(
		pulseVisitComplete,
		"visit_dau",
		"day",
		Math.min(60, FORWARD_WEEKS * 7),
		visitRegressionDays,
		(d, i) => toIsoDate(addDays(new Date(`${d}T00:00:00.000Z`), i))
	);

	const weeklyDepth = buildWeeklyDepthSeries(events);
	const depthComplete = completeWeeks(weeklyDepth);
	const commentersProj = projectFromRecent(
		weeklyDepth,
		"commenters",
		"week",
		FORWARD_WEEKS,
		REGRESSION_WEEKS,
		(_w, i) => shiftWeekKey(weekLabelFrom, i),
		depthComplete
	);
	const publishersProj = projectFromRecent(
		weeklyDepth,
		"publishers",
		"week",
		FORWARD_WEEKS,
		REGRESSION_WEEKS,
		(_w, i) => shiftWeekKey(weekLabelFrom, i),
		depthComplete
	);
	const avgDauProj = projectFromRecent(
		weeklyDepth,
		"avg_action_dau",
		"week",
		FORWARD_WEEKS,
		REGRESSION_WEEKS,
		(_w, i) => shiftWeekKey(weekLabelFrom, i),
		depthComplete
	);
	const highDaysProj = projectFromRecent(
		weeklyDepth,
		"high_action_days",
		"week",
		FORWARD_WEEKS,
		REGRESSION_WEEKS,
		(_w, i) => shiftWeekKey(weekLabelFrom, i),
		depthComplete
	);

	const weeklyTop2 = buildWeeklyTop2ShareSeries(events);
	const top2Complete = completeWeeks(weeklyTop2);
	const top2Proj = projectFromRecent(
		weeklyTop2,
		"top2_share_pct",
		"week",
		FORWARD_WEEKS,
		REGRESSION_WEEKS,
		(_w, i) => shiftWeekKey(weekLabelFrom, i),
		top2Complete
	);
	top2Proj.projected = top2Proj.projected.map((r) => ({
		...r,
		top2_share_pct: Math.min(100, Math.max(0, r.top2_share_pct))
	}));

	const pulseWindow = resolvePulseWindow();
	const windowMetrics = buildWindowMetrics(pulseDays, events, pulseWindow.fromDay, pulseWindow.toDay);

	const weeklyVisit = buildWeeklyVisitWau(pulseDays);
	const weeklyVisitComplete = completeWeeks(weeklyVisit);
	const visitWeekLabelFrom = weeklyVisitComplete.at(-1)?.week || weekLabelFrom;
	const visitWauProj = projectFromRecent(
		weeklyVisit,
		"visit_wau",
		"week",
		FORWARD_WEEKS,
		REGRESSION_WEEKS,
		(_w, i) => shiftWeekKey(visitWeekLabelFrom, i),
		weeklyVisitComplete
	);

	const wauMilestones = [
		...buildMilestoneMarkers(
			weeklyComplete,
			wauProj.projected,
			weeklyComplete,
			"wau",
			"week",
			STABLE_ROOM.action_wau,
			"WAU≥20",
			(_w, i) => shiftWeekKey(weekLabelFrom, i)
		),
		...buildMilestoneMarkers(
			weeklyVisitComplete,
			visitWauProj.projected,
			weeklyVisitComplete,
			"visit_wau",
			"week",
			STABLE_ROOM.visit_wau,
			"Visit≥25",
			(_w, i) => shiftWeekKey(visitWeekLabelFrom, i)
		)
	];

	const mauMilestones = buildMilestoneMarkers(
		monthlyComplete,
		mauProj.projected,
		monthlyComplete,
		"mau",
		"month",
		STABLE_ROOM.action_mau,
		"MAU≥25",
		(_m, i) => shiftMonthKey(mauLabelFrom, i)
	);

	const pulseMarkers = pulseVisit.length
		? [{ at: pulseVisit[0].day, short: "Pulse on", projected: false, historical: true }]
		: [];

	const scenarioMonths = mauProj.projected.slice(0, FORWARD_MONTHS).map((r, i) => {
		const wauAt = wauProj.projected[Math.min(i * 4, wauProj.projected.length - 1)];
		const usersAt = usersProj.projected[Math.min(i * 4, usersProj.projected.length - 1)];
		return {
			month: r.month,
			action_mau: Math.round(r.mau),
			action_wau: wauAt ? Math.round(wauAt.wau) : "—",
			total_users: usersAt ? Math.round(usersAt.total_users) : "—",
			kind: "projected"
		};
	});

	const histMonths = monthlyComplete.slice(-3).map((r) => ({
		month: r.month,
		action_mau: r.mau,
		action_wau: weeklyComplete.find((w) => w.week.startsWith(r.month))?.wau ?? "—",
		total_users: weeklyComplete.filter((w) => w.week.startsWith(r.month)).pop()?.total_users ?? "—",
		kind: "actual"
	}));
	if (partialMonth && partialDaysInMonth > 0) {
		histMonths.push({
			month: `${partialMonth.month} (partial, ${partialDaysInMonth}d)`,
			action_mau: `${partialMonth.mau} so far`,
			action_wau: "—",
			total_users: "—",
			kind: "partial"
		});
	}

	const lastCompleteMonth = monthlyComplete.at(-1);

	const weekIndex13 = Math.min(FORWARD_WEEKS_SHORT - 1, wauProj.projected.length - 1);
	const weekIndex4mo = Math.min(FORWARD_WEEKS - 1, wauProj.projected.length - 1);
	const monthIndex13 = Math.min(Math.max(0, Math.round(FORWARD_WEEKS_SHORT / 4.33) - 1), mauProj.projected.length - 1);
	const monthIndex4mo = Math.min(FORWARD_MONTHS - 1, mauProj.projected.length - 1);

	const outlookHorizons = [
		{
			horizon: `~${FORWARD_WEEKS_SHORT} weeks (~3 mo)`,
			target_week: wauProj.projected[weekIndex13]?.week ?? "—",
			target_month: mauProj.projected[monthIndex13]?.month ?? "—",
			action_wau: Math.round(wauProj.projected[weekIndex13]?.wau ?? 0),
			action_mau: Math.round(mauProj.projected[monthIndex13]?.mau ?? 0),
			total_users: Math.round(usersProj.projected[weekIndex13]?.total_users ?? 0)
		},
		{
			horizon: `~${FORWARD_MONTHS} months`,
			target_week: wauProj.projected[weekIndex4mo]?.week ?? "—",
			target_month: mauProj.projected[monthIndex4mo]?.month ?? "—",
			action_wau: Math.round(wauProj.projected[weekIndex4mo]?.wau ?? 0),
			action_mau: Math.round(mauProj.projected[monthIndex4mo]?.mau ?? 0),
			total_users: Math.round(usersProj.projected[weekIndex4mo]?.total_users ?? 0)
		}
	];

	return {
		usersProj,
		mauProj,
		wauProj,
		dauProj,
		visitProj,
		pulseVisit,
		pulseVisitComplete,
		pulseVisitPartial,
		pulseThroughDay,
		visitRegressionDays,
		visitUseAllPulseHistory,
		wauMilestones,
		mauMilestones,
		pulseMarkers,
		scenarioRows: [...histMonths, ...scenarioMonths],
		firstPulseDay: pulseVisit[0]?.day || "—",
		lastCompleteMonth,
		partialMonth,
		partialDaysInMonth,
		outlookHorizons,
		depthComplete,
		commentersProj,
		publishersProj,
		avgDauProj,
		highDaysProj,
		top2Complete,
		top2Proj,
		windowMetrics,
		pulseWindow,
		milestoneRoadmap: buildMilestoneRoadmap({
			weeklyComplete,
			wauProj,
			weeklyVisitComplete,
			visitWauProj,
			monthlyComplete,
			mauProj,
			depthComplete,
			commentersProj,
			publishersProj,
			avgDauProj,
			highDaysProj,
			top2Complete,
			top2Proj,
			windowMetrics,
			weekLabelFrom,
			visitWeekLabelFrom,
			mauLabelFrom
		}),
		weekLabelFrom
	};
}

async function main() {
	const { openDb } = await import("../../db/index.js");
	const dbInstance = await openDb({ quiet: true });
	const loaded = await loadFromDbInstance(dbInstance, "1970-01-01T00:00:00.000Z");
	const growth = buildStory(loaded.users, loaded.events);
	const pulseDays = await loadAllPulseDays();
	const outlook = buildOutlook(growth, pulseDays, loaded.events);

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

	const lastMau = outlook.lastCompleteMonth;
	const projEndMau = outlook.mauProj.projected[outlook.mauProj.projected.length - 1];
	const partialNote =
		outlook.partialMonth && outlook.partialDaysInMonth > 0
			? ` ${currentMonthKey()} has only ${outlook.partialDaysInMonth} day(s) of data (MAU ${outlook.partialMonth.mau} so far) and is excluded from trend fits.`
			: "";
	const outlookSummary = projEndMau
		? `If recent monthly slopes hold (last complete month: ${lastMau?.month ?? "—"}, action MAU ${lastMau?.mau ?? "?"}), action MAU could reach ~${Math.round(projEndMau.mau)} by ${projEndMau.month}.${partialNote} User base cumulative total ~${Math.round(outlook.usersProj.projected[outlook.usersProj.projected.length - 1]?.total_users ?? 0)}. Pulse visit DAU projected only from ${outlook.firstPulseDay} onward.`
		: "Insufficient history for projection.";

	const template = await loadTemplate();
	const html = fillHtmlTemplate(template, {
		styleBlock: await loadReportStyleBlock(),
		generatedAt,
		forwardMonths: String(FORWARD_MONTHS),
		forwardWeeksShort: String(FORWARD_WEEKS_SHORT),
		regressionWeeks: String(REGRESSION_WEEKS),
		regressionDays: String(REGRESSION_DAYS),
		pulseFromDay: outlook.firstPulseDay,
		visitPulsePartialNote: (() => {
			const fitLabel = outlook.visitUseAllPulseHistory
				? `dashed trend fits all ${outlook.visitRegressionDays} complete pulse day(s) since ${outlook.firstPulseDay}`
				: `dashed trend fits last ${outlook.visitRegressionDays} complete day(s)`;
			const partial = outlook.pulseVisitPartial.length
				? ` ${outlook.pulseVisitPartial[0].day} is partial (visit DAU ${outlook.pulseVisitPartial[0].visit_dau} so far) — excluded.`
				: "";
			return `${fitLabel} through ${outlook.pulseThroughDay}.${partial}`;
		})(),
		lede:
			"Combines all-time core-action history (since first signup) with visit pulse where it exists, then extends recent trends forward ~3–4 months. Use for direction, not forecasting.",
		methodology:
			"Projections use simple linear regression on the most recent 10 complete weeks or 4 complete months. The current calendar month and week are partial and excluded from trend fits (shown separately). Pre–May 2026 has no visit/traffic data. Anonymous traffic is omitted. Small-N community data is volatile — treat dashed lines as scenarios, not targets.",
		milestoneLegend:
			"Vertical dotted ticks: green = stable-small-room target already hit on that series; orange = projected week/month when the trend line reaches the target; gray = pulse instrumentation start.",
		milestoneWindowLabel: `${outlook.pulseWindow.fromDay} → ${outlook.pulseWindow.toDay} (${WINDOW_DAYS}d, for window metrics)`,
		milestoneTableHtml: table(outlook.milestoneRoadmap, [
			{ label: "Criterion", key: "criterion" },
			{ label: "Current", key: "current" },
			{ label: "Target", key: "target" },
			{ label: "Status", key: "status" },
			{ label: "Achieved", key: "achieved_at" },
			{ label: "Projected hit", key: "projected_at" }
		]),
		milestoneMetCount: String(outlook.milestoneRoadmap.filter((r) => r.met).length),
		milestoneTotalCount: String(outlook.milestoneRoadmap.length),
		outlookSummary,
		storyHtml: buildStoryBullets(growth, pulseDays).map((b) => `<li>${esc(b)}</li>`).join(""),
		outlookTableHtml: table(outlook.outlookHorizons, [
			{ label: "Horizon", key: "horizon" },
			{ label: "Target week (WAU / users)", key: "target_week" },
			{ label: "Target month (MAU)", key: "target_month" },
			{ label: "Projected action WAU", key: "action_wau" },
			{ label: "Projected action MAU", key: "action_mau" },
			{ label: "Projected total users", key: "total_users" }
		]),
		usersChartHtml: chartHistoryProjection(
			growth.cumulativeUsersByWeek || [],
			outlook.usersProj.projected,
			"total_users",
			"week",
			{ title: "Cumulative users", histColor: "#7c3aed" }
		),
		mauChartHtml: chartHistoryProjection(
			completeMonths(growth.monthlyAllTimeRows || []),
			outlook.mauProj.projected,
			"mau",
			"month",
			{ title: "Action MAU (complete months)", histColor: "#0f766e", markers: outlook.mauMilestones }
		),
		wauChartHtml: chartHistoryProjection(
			completeWeeks(growth.weeklyAllTimeRows || []),
			outlook.wauProj.projected,
			"wau",
			"week",
			{ title: "Action WAU (complete weeks)", histColor: "#2563eb", markers: outlook.wauMilestones }
		),
		visitDauChartHtml: chartHistoryProjection(
			outlook.pulseVisitComplete,
			outlook.visitProj.projected,
			"visit_dau",
			"day",
			{
				title: "Logged-in visit DAU",
				histColor: "#b45309",
				markers: outlook.pulseMarkers,
				trendSlope: outlook.visitProj.slope,
				trendUnit: "day"
			}
		),
		commentersChartHtml: depthChart(
			outlook.depthComplete,
			outlook.commentersProj,
			"commenters",
			"Distinct commenters per week",
			"#7c3aed",
			STABLE_ROOM.commenters,
			"Cmt≥5",
			outlook.weekLabelFrom
		),
		publishersChartHtml: depthChart(
			outlook.depthComplete,
			outlook.publishersProj,
			"publishers",
			"Distinct publishers per week",
			"#db2777",
			STABLE_ROOM.publishers,
			"Pub≥3",
			outlook.weekLabelFrom
		),
		avgActionDauChartHtml: depthChart(
			outlook.depthComplete,
			outlook.avgDauProj,
			"avg_action_dau",
			"Avg action DAU per week",
			"#0f766e",
			STABLE_ROOM.avg_action_dau,
			"DAU≥12",
			outlook.weekLabelFrom
		),
		highActionDaysChartHtml: depthChart(
			outlook.depthComplete,
			outlook.highDaysProj,
			"high_action_days",
			"Days / week with action DAU ≥ 12",
			"#0891b2",
			STABLE_ROOM.high_action_days,
			"3d≥12",
			outlook.weekLabelFrom
		),
		top2ShareChartHtml: top2ShareChart(outlook.top2Complete, outlook.top2Proj, outlook.weekLabelFrom),
		scenarioTableHtml: table(outlook.scenarioRows, [
			{ label: "Month", key: "month" },
			{
				label: "Kind",
				html: (r) =>
					r.kind === "projected" ? "Projected" : r.kind === "partial" ? "Partial (in progress)" : "Actual"
			},
			{ label: "Action MAU", key: "action_mau" },
			{ label: "Action WAU (proxy)", key: "action_wau" },
			{ label: "Total users", key: "total_users" }
		])
	});

	const stamp = toIsoDate(startOfUtcDay(new Date()));
	const out =
		process.env.OUT || path.join(REPO_ROOT, ".output", "inception-outlook", `inception-outlook-${stamp}.html`);
	await fs.mkdir(path.dirname(out), { recursive: true });
	await fs.writeFile(out, html, "utf8");
	console.log(out);
}

main().catch((err) => {
	console.error("[inception-outlook-report]", err?.message || err);
	process.exit(1);
});
