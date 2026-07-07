#!/usr/bin/env node
/**
 * Visit pulse period report: traffic rhythms over a US East day window.
 *
 * Usage:
 *   node scripts/analytics/visit-pulse-period-report.js
 *   node scripts/analytics/visit-pulse-period-report.js --days 30
 *   node scripts/analytics/visit-pulse-period-report.js --from 2026-05-20 --to 2026-06-14
 *
 * `--to` today (or any future day) is clamped to yesterday — the last complete US East partition.
 * Default window already ends yesterday. Partial today belongs in the daily pulse report only.
 * HTML: visit-pulse-period-report.html · CSS: report.css
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { REPO_ROOT, loadEnv } from "../repo-root.cjs";
import { loadReportStyleBlock } from "./report-styles.js";
import { landingMetricsFromPulseRow } from "./landingFunnelReport.js";
import {
	usEastDayKey,
	usEastDayStartMs,
	yesterdayUsEastDayKey
} from "../../api_routes/utils/visitPulseCore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();

const TEMPLATE_PATH = path.join(__dirname, "visit-pulse-period-report.html");
const DEFAULT_DAYS = Number(process.env.PULSE_PERIOD_WINDOW_DAYS || 30);
const PULSE_DAY_MS = 24 * 60 * 60 * 1000;
const HOURS_PER_DAY = 24;
const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

/** Last flushed US East day (yesterday). Period rollups never include partial today. */
function lastCompletePulseDay() {
	return yesterdayUsEastDayKey();
}

/**
 * @param {string} dayKey
 * @param {string} label for warn messages
 */
function clampToCompletePulseDay(dayKey, label = "to") {
	const lastComplete = lastCompletePulseDay();
	if (dayKey <= lastComplete) return dayKey;
	if (dayKey === usEastDayKey()) {
		console.warn(
			`[visit-pulse-period] --${label} ${dayKey} is today (incomplete); using ${lastComplete}`
		);
	} else {
		console.warn(
			`[visit-pulse-period] --${label} ${dayKey} is after last complete day; using ${lastComplete}`
		);
	}
	return lastComplete;
}

function resolveWindow() {
	const fromArg = getArg("from");
	const toArg = getArg("to");
	if (/^\d{4}-\d{2}-\d{2}$/.test(fromArg) && /^\d{4}-\d{2}-\d{2}$/.test(toArg)) {
		const toDay = clampToCompletePulseDay(toArg, "to");
		const fromDay = fromArg > toDay ? toDay : fromArg;
		if (fromArg > toDay) {
			console.warn(
				`[visit-pulse-period] --from ${fromArg} is after --to ${toDay}; using single-day window ${toDay}`
			);
		}
		return { fromDay, toDay };
	}
	const days = Math.max(1, Number(getArg("days") || DEFAULT_DAYS) || DEFAULT_DAYS);
	const toDay = lastCompletePulseDay();
	const fromDay = shiftDayKey(toDay, -(days - 1));
	return { fromDay, toDay };
}

function avg(nums) {
	const list = nums.filter((n) => Number.isFinite(n));
	if (!list.length) return 0;
	return list.reduce((a, b) => a + b, 0) / list.length;
}

function fmt0(n) {
	return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0";
}

function fmt1(n) {
	return Number.isFinite(n) ? n.toFixed(1) : "0.0";
}

function signedPct(curr, prev) {
	if (!prev && !curr) return "0.0%";
	if (!prev && curr) return "+100.0%";
	return `${(((curr - prev) / prev) * 100 >= 0 ? "+" : "")}${(((curr - prev) / prev) * 100).toFixed(1)}%`;
}

function usEastWeekStartKey(dayKey) {
	const noonMs = usEastDayStartMs(dayKey) + 12 * 60 * 60 * 1000;
	const dow = new Date(noonMs).getUTCDay();
	const mondayShift = (dow + 6) % 7;
	return shiftDayKey(dayKey, -mondayShift);
}

function usEastDowMon0(dayKey) {
	const noonMs = usEastDayStartMs(dayKey) + 12 * 60 * 60 * 1000;
	const wd = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/New_York",
		weekday: "short"
	}).format(new Date(noonMs));
	const map = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
	return map[wd] ?? 0;
}

function formatHourET(h) {
	if (h === 0) return "12 AM ET";
	if (h < 12) return `${h} AM ET`;
	if (h === 12) return "12 PM ET";
	return `${h - 12} PM ET`;
}

function visitorKeyFromPulseVisitor(v) {
	if (v?.visitor_key) return String(v.visitor_key);
	if (v?.user_id != null && Number(v.user_id) > 0) return `u:${v.user_id}`;
	if (v?.client_id) return `v:${v.client_id}`;
	return null;
}

/** @param {object} v @param {number} dayStartMs */
function visitorActiveHours(v, dayStartMs) {
	const hours = new Set();
	const dayEnd = dayStartMs + HOURS_PER_DAY * 60 * 60 * 1000;
	for (const [startIso, endIso] of v.ranges || []) {
		const startMs = Date.parse(startIso);
		const endMs = Date.parse(endIso);
		if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
		const clipStart = Math.max(startMs, dayStartMs);
		const clipEnd = Math.min(endMs, dayEnd);
		if (clipEnd <= clipStart) continue;
		const h0 = Math.floor((clipStart - dayStartMs) / (60 * 60 * 1000));
		const h1 = Math.floor((clipEnd - 1 - dayStartMs) / (60 * 60 * 1000));
		for (let h = h0; h <= h1 && h < HOURS_PER_DAY; h++) {
			if (h >= 0) hours.add(h);
		}
	}
	return hours;
}

function hourTotalsForVisitors(visitors, dayStartMs) {
	const totals = Array(HOURS_PER_DAY).fill(0);
	const authedTotals = Array(HOURS_PER_DAY).fill(0);
	for (const v of visitors || []) {
		const hours = visitorActiveHours(v, dayStartMs);
		const isAuthed = Number(v.user_id) > 0;
		for (const h of hours) {
			totals[h]++;
			if (isAuthed) authedTotals[h]++;
		}
	}
	return { totals, authedTotals };
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
	return slope > 0 ? `+${slope.toFixed(1)}` : slope.toFixed(1);
}

function sparkline(rows, valueKey, labelKey, color, { weekBoundaryKey = "week_start", showTrend = false } = {}) {
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
		trendHtml = `<line x1="${x(0).toFixed(1)}" y1="${y(y0).toFixed(1)}" x2="${x(rows.length - 1).toFixed(1)}" y2="${y(yN).toFixed(1)}" stroke="#ef4444" stroke-width="2" stroke-dasharray="6 5"><title>Linear trend slope: ${trendSlopeText} per day</title></line>`;
		trendLabelHtml = `<text x="${w - p}" y="${p - 8}" text-anchor="end" font-size="11" fill="#ef4444">trend ${trendSlopeText}/day</text>`;
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
		<text x="${p}" y="${p - 8}" font-size="11" fill="#64748b">max ${maxY}</text>
		${trendLabelHtml}
	</svg>`;
}

function barChart(categories, values, { color = "#64748b", title = "bar chart", height = 220 } = {}) {
	const w = 980;
	const h = height;
	const p = 36;
	if (!categories.length) return '<p class="small">No data.</p>';
	const maxY = Math.max(...values, 1);
	const gap = 6;
	const barW = (w - p * 2) / categories.length - gap;
	const bars = categories
		.map((label, i) => {
			const v = Number(values[i] || 0);
			const bh = ((h - p * 2) * v) / maxY;
			const x = p + i * ((w - p * 2) / categories.length) + gap / 2;
			const y = h - p - bh;
			return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" rx="2"><title>${esc(label)}: ${v.toFixed(1)}</title></rect>
				<text x="${(x + barW / 2).toFixed(1)}" y="${h - 10}" text-anchor="middle" font-size="10" fill="#64748b">${esc(label)}</text>`;
		})
		.join("");
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${height}" aria-label="${esc(title)}">
		<rect width="${w}" height="${h}" fill="#fff"/>
		<line x1="${p}" y1="${h - p}" x2="${w - p}" y2="${h - p}" stroke="#cbd5e1"/>
		${bars}
		<text x="${p}" y="${p - 10}" font-size="11" fill="#64748b">max ${maxY.toFixed(1)}</text>
	</svg>`;
}

function heatmapSvg(matrix, rowLabels, { colStep = 2, fillColor = "#0ea5e9", title = "weekday hour heatmap" } = {}) {
	const rows = matrix.length;
	const cols = matrix[0]?.length || 0;
	if (!rows || !cols) return '<p class="small">No data.</p>';
	const cellW = 28;
	const cellH = 28;
	const labelW = 44;
	const labelH = 22;
	const w = labelW + cols * cellW + 16;
	const h = labelH + rows * cellH + 16;
	let maxV = 0;
	for (const row of matrix) {
		for (const v of row) maxV = Math.max(maxV, Number(v) || 0);
	}
	maxV = Math.max(maxV, 1);
	const cells = [];
	for (let r = 0; r < rows; r++) {
		const y = labelH + r * cellH;
		cells.push(
			`<text x="0" y="${y + cellH * 0.72}" font-size="11" fill="#64748b">${esc(rowLabels[r])}</text>`
		);
		for (let c = 0; c < cols; c++) {
			const v = Number(matrix[r][c] || 0);
			const opacity = 0.08 + (0.92 * v) / maxV;
			const x = labelW + c * cellW;
			cells.push(
				`<rect x="${x}" y="${y}" width="${cellW - 2}" height="${cellH - 2}" fill="${fillColor}" fill-opacity="${opacity.toFixed(3)}" rx="2"><title>${esc(rowLabels[r])} ${formatHourET(c)}: avg ${v.toFixed(2)} active</title></rect>`
			);
		}
	}
	const hourLabels = [];
	for (let c = 0; c < cols; c += colStep) {
		const x = labelW + c * cellW + cellW / 2;
		hourLabels.push(
			`<text x="${x}" y="${labelH - 6}" text-anchor="middle" font-size="9" fill="#94a3b8">${c}</text>`
		);
	}
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;height:auto" aria-label="${esc(title)}">
		<rect width="${w}" height="${h}" fill="#fff"/>
		${hourLabels.join("")}
		${cells.join("")}
		<text x="${labelW}" y="${h - 2}" font-size="10" fill="#94a3b8">Hour (ET, 0–23)</text>
	</svg>`;
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

/** @param {number[]} userIds */
async function resolveAuthedUserLabels(userIds) {
	const ids = [...new Set(userIds.filter((id) => id != null && Number.isFinite(Number(id))).map(Number))];
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
		const label = getNotificationDisplayName(
			{
				email: user?.email,
				display_name: profile?.display_name,
				user_name: profile?.user_name
			},
			profile
		);
		out.set(id, {
			user_id: id,
			user_name: profile?.user_name ?? null,
			display_name: profile?.display_name ?? null,
			label
		});
	}
	return out;
}

async function enrichTopAuthed(topAuthed) {
	const labels = await resolveAuthedUserLabels(topAuthed.map((r) => r.user_id));
	return topAuthed.map((r) => {
		const info = labels.get(Number(r.user_id));
		return {
			...r,
			label: info?.label ?? `user ${r.user_id}`,
			user_name: info?.user_name ?? null,
			display_name: info?.display_name ?? null
		};
	});
}

function computeWindowWau(pulseRows, { authedOnly = false } = {}) {
	const keys = new Set();
	for (const row of pulseRows) {
		if (Number(row.unique_visitors) <= 0) continue;
		for (const v of row.details?.visitors || []) {
			if (authedOnly) {
				if (Number(v.user_id) > 0) keys.add(Number(v.user_id));
			} else {
				const key = visitorKeyFromPulseVisitor(v);
				if (key) keys.add(key);
			}
		}
	}
	return keys.size;
}

function buildTopAuthedVisitors(pulseRows, limit = 12) {
	const byUser = new Map();
	for (const row of pulseRows) {
		if (Number(row.unique_visitors) <= 0) continue;
		const day = String(row.day);
		for (const v of row.details?.visitors || []) {
			const uid = Number(v.user_id);
			if (!uid) continue;
			if (!byUser.has(uid)) byUser.set(uid, { user_id: uid, visit_days: new Set(), hits: 0 });
			const rec = byUser.get(uid);
			rec.visit_days.add(day);
			rec.hits += Number(v.hits) || 0;
		}
	}
	return [...byUser.values()]
		.map((r) => ({
			user_id: r.user_id,
			visit_days: r.visit_days.size,
			hits: r.hits
		}))
		.sort((a, b) => b.visit_days - a.visit_days || b.hits - a.hits)
		.slice(0, limit);
}

function buildObservations(report) {
	const obs = [];
	const { dailyRows, dowRows, hourProfile, metrics, peakDays } = report;
	if (!dailyRows.length) {
		obs.push("No pulse traffic in this window.");
		return obs;
	}
	const trafficValues = dailyRows.map((d) => d.traffic_dau);
	const lr = linearRegression(trafficValues);
	const trendWord =
		lr.slope > 2 ? "rising" : lr.slope < -2 ? "falling" : "roughly flat";
	obs.push(
		`Avg traffic DAU ${fmt0(metrics.avgTrafficDau)} over ${metrics.pulseDaysWithData} active day(s); daily trend is ${trendWord} (${formatTrendSlope(lr.slope)}/day).`
	);
	if (metrics.weekdayAvgTraffic && metrics.weekendAvgTraffic) {
		const ratio = metrics.weekendAvgTraffic / Math.max(metrics.weekdayAvgTraffic, 1);
		const weekendNote =
			ratio > 1.05
				? `Weekends run hotter (${fmt0(metrics.weekendAvgTraffic)} vs ${fmt0(metrics.weekdayAvgTraffic)} weekday avg).`
				: ratio < 0.95
					? `Weekdays run hotter (${fmt0(metrics.weekdayAvgTraffic)} vs ${fmt0(metrics.weekendAvgTraffic)} weekend avg).`
					: "Weekday and weekend traffic are similar on average.";
		obs.push(weekendNote);
	}
	const busiestDow = [...dowRows].sort((a, b) => b.avg_traffic - a.avg_traffic)[0];
	const quietestDow = [...dowRows].sort((a, b) => a.avg_traffic - b.avg_traffic)[0];
	if (busiestDow && quietestDow && busiestDow.dow !== quietestDow.dow) {
		obs.push(
			`Busiest weekday: ${busiestDow.dow} (avg ${fmt0(busiestDow.avg_traffic)} traffic DAU, n=${busiestDow.sample_days}). Quietest: ${quietestDow.dow} (avg ${fmt0(quietestDow.avg_traffic)}).`
		);
	}
	obs.push(
		`Peak hour all traffic (ET): ${metrics.busiestHourLabel} (avg ${fmt1(metrics.busiestHourValue)} stacked active). Logged-in peak: ${metrics.busiestAuthedHourLabel} (avg ${fmt1(metrics.busiestAuthedHourValue)}).`
	);
	if (peakDays[0]) {
		obs.push(
			`Highest traffic day: ${peakDays[0].day} with ${fmt0(peakDays[0].traffic_dau)} unique visitors (${fmt0(peakDays[0].visit_dau)} logged-in).`
		);
	}
	if (metrics.firstHalfAvg != null && metrics.secondHalfAvg != null) {
		obs.push(
			`First half of window avg ${fmt0(metrics.firstHalfAvg)} traffic DAU vs second half ${fmt0(metrics.secondHalfAvg)} (${signedPct(metrics.secondHalfAvg, metrics.firstHalfAvg)}).`
		);
	}
	const authedShare = metrics.avgTrafficDau ? metrics.avgVisitDau / metrics.avgTrafficDau : 0;
	obs.push(
		`Logged-in share of daily traffic averages ${(authedShare * 100).toFixed(1)}% (visit DAU ÷ traffic DAU). Window WAU: ${fmt0(metrics.trafficWau)} traffic, ${fmt0(metrics.visitWau)} logged-in.`
	);
	if (report.landingDailyRows?.length) {
		const avgLandingViews = avg(report.landingDailyRows.map((d) => d.landing_view_unique));
		const avgLandingCta = avg(report.landingDailyRows.map((d) => d.landing_cta_unique));
		const avgLandingPlay = avg(report.landingDailyRows.map((d) => d.landing_play_unique));
		const playRate =
			avgLandingViews > 0 ? `${Math.round((avgLandingPlay / avgLandingViews) * 100)}%` : null;
		const ctaRate =
			avgLandingViews > 0 ? `${Math.round((avgLandingCta / avgLandingViews) * 100)}%` : null;
		let landingObs = `Landing funnel: avg ${fmt0(avgLandingViews)} views/day (unique) on ${report.landingDailyRows.length} day(s) with data.`;
		if (playRate) landingObs += ` Play rate ${playRate} of views.`;
		if (ctaRate) landingObs += ` CTA rate ${ctaRate} of views.`;
		obs.push(landingObs);
	}
	if (report.feedDailyRows?.length) {
		const avgFeedImpressors = avg(report.feedDailyRows.map((d) => d.feed_impressors));
		const avgFeedImpressions = avg(report.feedDailyRows.map((d) => d.feed_impressions));
		const avgUserTop1 = avg(
			report.feedDailyRows.map((d) => d.feed_user_top1_share).filter((n) => Number.isFinite(n))
		);
		obs.push(
			`Feed impressions (beta): avg ${fmt1(avgFeedImpressors)} impressors/day and ${fmt0(avgFeedImpressions)} impressions/day on ${report.feedDailyRows.length} day(s) with data.`
		);
		if (Number.isFinite(avgUserTop1) && avgUserTop1 > 0) {
			obs.push(
				`Avg user top1_share ${(avgUserTop1 * 100).toFixed(0)}% (${avgUserTop1 > 0.5 ? "concentrated" : "broad"} — lower is more users sharing the activity).`
			);
		}
	}
	if (metrics.pulseDaysWithData < metrics.windowDayCount) {
		obs.push(
			`Pulse covers ${metrics.pulseDaysWithData} of ${metrics.windowDayCount} calendar days in the window (missing days treated as no traffic).`
		);
	}
	return obs;
}

function buildPeriodReport(fromDay, toDay, pulseRows) {
	const windowDayCount = dayCountInclusive(fromDay, toDay);
	const activeRows = pulseRows.filter((r) => Number(r.unique_visitors) > 0);
	const pulseByDay = new Map(pulseRows.map((r) => [String(r.day), r]));

	const dailyRows = [];
	const dowBuckets = DOW_LABELS.map((dow) => ({
		dow,
		traffic: [],
		visit: [],
		hits: [],
		sample_days: 0
	}));
	const hourSum = Array(HOURS_PER_DAY).fill(0);
	const authedHourSum = Array(HOURS_PER_DAY).fill(0);
	const heatmapSum = DOW_LABELS.map(() => Array(HOURS_PER_DAY).fill(0));
	const heatmapCounts = DOW_LABELS.map(() => Array(HOURS_PER_DAY).fill(0));
	const authedHeatmapSum = DOW_LABELS.map(() => Array(HOURS_PER_DAY).fill(0));
	const authedHeatmapCounts = DOW_LABELS.map(() => Array(HOURS_PER_DAY).fill(0));

	for (let d = fromDay; d <= toDay; d = shiftDayKey(d, 1)) {
		const row = pulseByDay.get(d);
		const traffic = Number(row?.unique_visitors) || 0;
		const visit = Number(row?.authed_visitors) || 0;
		const hits = Number(row?.total_hits) || 0;
		const week_start = usEastWeekStartKey(d);
		const feed = row?.details?.feed_impressions;
		const landing = landingMetricsFromPulseRow(row);
		dailyRows.push({
			day: d,
			week_start,
			traffic_dau: traffic,
			visit_dau: visit,
			hits,
			feed_impressors: Number(feed?.unique_impressors) || 0,
			feed_impressions: Number(feed?.total_impressions) || 0,
			feed_dwell: Number(feed?.dwell_impressions) || 0,
			feed_click: Number(feed?.click_impressions) || 0,
			feed_user_top1_share: Number(feed?.concentration?.users?.top1_share) || null,
			feed_creation_top1_share: Number(feed?.concentration?.creations?.top1_share) || null,
			landing_view_unique: landing?.landing_view_unique ?? 0,
			landing_view_total: landing?.landing_view_total ?? 0,
			landing_play_unique: landing?.landing_play_unique ?? 0,
			landing_cta_unique: landing?.landing_cta_unique ?? 0
		});
		if (traffic <= 0) continue;

		const dowIdx = usEastDowMon0(d);
		dowBuckets[dowIdx].traffic.push(traffic);
		dowBuckets[dowIdx].visit.push(visit);
		dowBuckets[dowIdx].hits.push(hits);
		dowBuckets[dowIdx].sample_days++;

		const visitors = row?.details?.visitors || [];
		const dayStartMs = usEastDayStartMs(d);
		const { totals, authedTotals } = hourTotalsForVisitors(visitors, dayStartMs);
		for (let h = 0; h < HOURS_PER_DAY; h++) {
			hourSum[h] += totals[h];
			authedHourSum[h] += authedTotals[h];
			heatmapSum[dowIdx][h] += totals[h];
			authedHeatmapSum[dowIdx][h] += authedTotals[h];
			if (totals[h] > 0) heatmapCounts[dowIdx][h]++;
			if (authedTotals[h] > 0) authedHeatmapCounts[dowIdx][h]++;
		}
	}

	const pulseDaysWithData = activeRows.length;
	const avgTrafficDau = avg(dailyRows.filter((d) => d.traffic_dau > 0).map((d) => d.traffic_dau));
	const avgVisitDau = avg(dailyRows.filter((d) => d.traffic_dau > 0).map((d) => d.visit_dau));
	const trafficWau = computeWindowWau(activeRows, { authedOnly: false });
	const visitWau = computeWindowWau(activeRows, { authedOnly: true });

	const dowRows = dowBuckets.map((b) => {
		const dowIdx = DOW_LABELS.indexOf(b.dow);
		const hourAvgs = b.sample_days
			? heatmapSum[dowIdx].map((sum, h) => (heatmapCounts[dowIdx][h] ? sum / heatmapCounts[dowIdx][h] : 0))
			: Array(HOURS_PER_DAY).fill(0);
		const authedHourAvgs = b.sample_days
			? authedHeatmapSum[dowIdx].map((sum, h) =>
					authedHeatmapCounts[dowIdx][h] ? sum / authedHeatmapCounts[dowIdx][h] : 0
				)
			: Array(HOURS_PER_DAY).fill(0);
		let peakHour = 0;
		let peakVal = 0;
		let peakVisitHour = 0;
		let peakVisitVal = 0;
		for (let h = 0; h < HOURS_PER_DAY; h++) {
			if (hourAvgs[h] > peakVal) {
				peakVal = hourAvgs[h];
				peakHour = h;
			}
			if (authedHourAvgs[h] > peakVisitVal) {
				peakVisitVal = authedHourAvgs[h];
				peakVisitHour = h;
			}
		}
		return {
			dow: b.dow,
			sample_days: b.sample_days,
			avg_traffic: avg(b.traffic),
			avg_visit: avg(b.visit),
			avg_hits: avg(b.hits),
			peak_hour: peakHour,
			peak_hour_label: formatHourET(peakHour),
			peak_visit_hour: peakVisitHour,
			peak_visit_hour_label: formatHourET(peakVisitHour)
		};
	});

	const hourProfile = hourSum.map((sum, h) => ({
		hour: h,
		hour_label: formatHourET(h),
		avg_all: pulseDaysWithData ? sum / pulseDaysWithData : 0,
		avg_authed: pulseDaysWithData ? authedHourSum[h] / pulseDaysWithData : 0
	}));

	let busiestHour = 0;
	let busiestHourValue = 0;
	let busiestAuthedHour = 0;
	let busiestAuthedHourValue = 0;
	for (const hp of hourProfile) {
		if (hp.avg_all > busiestHourValue) {
			busiestHourValue = hp.avg_all;
			busiestHour = hp.hour;
		}
		if (hp.avg_authed > busiestAuthedHourValue) {
			busiestAuthedHourValue = hp.avg_authed;
			busiestAuthedHour = hp.hour;
		}
	}

	const heatmapMatrix = DOW_LABELS.map((_, dowIdx) =>
		Array(HOURS_PER_DAY)
			.fill(0)
			.map((_, h) => {
				const n = heatmapCounts[dowIdx][h];
				return n ? heatmapSum[dowIdx][h] / n : 0;
			})
	);

	const authedHeatmapMatrix = DOW_LABELS.map((_, dowIdx) =>
		Array(HOURS_PER_DAY)
			.fill(0)
			.map((_, h) => {
				const n = authedHeatmapCounts[dowIdx][h];
				return n ? authedHeatmapSum[dowIdx][h] / n : 0;
			})
	);

	const weekdayTraffic = dailyRows.filter((d) => {
		if (d.traffic_dau <= 0) return false;
		const idx = usEastDowMon0(d.day);
		return idx < 5;
	});
	const weekendTraffic = dailyRows.filter((d) => {
		if (d.traffic_dau <= 0) return false;
		const idx = usEastDowMon0(d.day);
		return idx >= 5;
	});

	const activeDaily = dailyRows.filter((d) => d.traffic_dau > 0);
	const feedDaily = dailyRows.filter((d) => d.feed_impressors > 0);
	const landingDaily = dailyRows.filter((d) => d.landing_view_unique > 0);
	const mid = Math.floor(activeDaily.length / 2);
	const firstHalf = activeDaily.slice(0, mid);
	const secondHalf = activeDaily.slice(mid);

	const peakDays = [...activeDaily].sort((a, b) => b.traffic_dau - a.traffic_dau).slice(0, 8);
	const topAuthed = buildTopAuthedVisitors(activeRows);

	const busiestDowRow = [...dowRows].sort((a, b) => b.avg_traffic - a.avg_traffic)[0];

	const metrics = {
		avgTrafficDau,
		avgVisitDau,
		trafficWau,
		visitWau,
		weekdayAvgTraffic: avg(weekdayTraffic.map((d) => d.traffic_dau)),
		weekendAvgTraffic: avg(weekendTraffic.map((d) => d.traffic_dau)),
		busiestDow: busiestDowRow ? `${busiestDowRow.dow} (avg ${fmt0(busiestDowRow.avg_traffic)})` : "—",
		busiestHour: formatHourET(busiestHour),
		busiestHourLabel: formatHourET(busiestHour),
		busiestHourValue,
		busiestAuthedHour: formatHourET(busiestAuthedHour),
		busiestAuthedHourLabel: formatHourET(busiestAuthedHour),
		busiestAuthedHourValue,
		pulseDaysWithData,
		windowDayCount,
		firstHalfAvg: firstHalf.length ? avg(firstHalf.map((d) => d.traffic_dau)) : null,
		secondHalfAvg: secondHalf.length ? avg(secondHalf.map((d) => d.traffic_dau)) : null
	};

	const report = {
		fromDay,
		toDay,
		windowDayCount,
		generatedAt: new Date().toISOString(),
		dailyRows: activeDaily,
		feedDailyRows: feedDaily,
		landingDailyRows: landingDaily,
		dowRows,
		hourProfile,
		heatmapMatrix,
		authedHeatmapMatrix,
		peakDays,
		topAuthed,
		metrics
	};
	report.observations = buildObservations(report);
	return report;
}

function buildSummaryExport(report) {
	return {
		report: "visit-pulse-period",
		generated_at: report.generatedAt,
		from_day: report.fromDay,
		to_day: report.toDay,
		window_days: report.windowDayCount,
		pulse_days_with_data: report.metrics.pulseDaysWithData,
		avg_traffic_dau: Math.round(report.metrics.avgTrafficDau),
		avg_visit_dau: Math.round(report.metrics.avgVisitDau * 10) / 10,
		traffic_wau: report.metrics.trafficWau,
		visit_wau: report.metrics.visitWau,
		busiest_dow: report.metrics.busiestDow,
		busiest_hour_et: report.metrics.busiestHour,
		busiest_authed_hour_et: report.metrics.busiestAuthedHour,
		weekday_avg_traffic: Math.round(report.metrics.weekdayAvgTraffic),
		weekend_avg_traffic: Math.round(report.metrics.weekendAvgTraffic),
		observations: report.observations,
		dow: report.dowRows.map((r) => ({
			dow: r.dow,
			sample_days: r.sample_days,
			avg_traffic: Math.round(r.avg_traffic),
			avg_visit: Math.round(r.avg_visit * 10) / 10,
			peak_hour_et: r.peak_hour
		})),
		hour_profile: report.hourProfile.map((h) => ({
			hour: h.hour,
			avg_all: Math.round(h.avg_all * 10) / 10,
			avg_authed: Math.round(h.avg_authed * 10) / 10
		})),
		top_authed: report.topAuthed.map((r) => ({
			user_id: r.user_id,
			label: r.label,
			user_name: r.user_name,
			visit_days: r.visit_days,
			hits: r.hits
		})),
		peak_days: report.peakDays.map((d) => ({
			day: d.day,
			traffic_dau: d.traffic_dau,
			visit_dau: d.visit_dau
		}))
	};
}

function buildRawExport(report) {
	return {
		...buildSummaryExport(report),
		daily_rows: report.dailyRows,
		top_authed: report.topAuthed,
		heatmap: report.heatmapMatrix,
		authed_heatmap: report.authedHeatmapMatrix
	};
}

function buildCopyScriptHtml(summaryPayload, rawPayload) {
	const summaryJson = JSON.stringify(summaryPayload);
	const rawJson = JSON.stringify(rawPayload);
	return `<script>
(() => {
	const summaryPayload = ${summaryJson};
	const rawPayload = ${rawJson};
	const status = document.getElementById('copy-pulse-period-status');
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
	onCopy(document.getElementById('copy-pulse-period-summary'), JSON.stringify(summaryPayload, null, 2), 'summary JSON');
	onCopy(document.getElementById('copy-pulse-period-raw'), JSON.stringify(rawPayload, null, 2), 'raw JSON');
})();
</script>`;
}

async function renderHtml(report) {
	const template = await loadTemplate();
	const styleBlock = await loadReportStyleBlock();
	const periodLabel =
		report.fromDay === report.toDay
			? report.fromDay
			: `${report.fromDay} → ${report.toDay}`;
	const pulseDaysNote =
		report.metrics.pulseDaysWithData < report.windowDayCount
			? `${report.metrics.pulseDaysWithData} days with traffic`
			: "full window coverage";

	const observationsHtml = report.observations.map((o) => `<li>${esc(o)}</li>`).join("");

	const feedFirstDay = report.feedDailyRows[0]?.day;
	const feedImpressionsIntro = !report.feedDailyRows.length
		? "Logged-in feed-beta dwell/click beacons, flushed with visit pulse."
		: feedFirstDay && feedFirstDay > report.fromDay
			? `Rollup from pulse flush. Data begins ${feedFirstDay}; earlier days in this window have no feed block.`
			: "Logged-in feed-beta dwell/click beacons, flushed with visit pulse.";
	const landingFirstDay = report.landingDailyRows[0]?.day;
	const landingFunnelIntro = !report.landingDailyRows.length
		? "Logged-out landing page views and client funnel events, flushed with visit pulse."
		: landingFirstDay && landingFirstDay > report.fromDay
			? `Rollup from pulse flush. Data begins ${landingFirstDay}; earlier days in this window have no landing block.`
			: "Logged-out landing page views and client funnel events, flushed with visit pulse.";
	const feedSparklineOpts = { weekBoundaryKey: "week_start", showTrend: true };
	const landingSparklineOpts = { weekBoundaryKey: "week_start", showTrend: true };

	return fillHtmlTemplate(template, {
		styleBlock,
		periodLabel,
		generatedAt: report.generatedAt,
		fromDay: report.fromDay,
		toDay: report.toDay,
		windowDays: report.windowDayCount,
		pulseDaysNote,
		avgTrafficDau: fmt0(report.metrics.avgTrafficDau),
		avgVisitDau: fmt1(report.metrics.avgVisitDau),
		trafficWau: fmt0(report.metrics.trafficWau),
		visitWau: fmt0(report.metrics.visitWau),
		busiestDow: report.metrics.busiestDow,
		busiestHour: report.metrics.busiestHour,
		busiestAuthedHour: report.metrics.busiestAuthedHour,
		weekdayAvgTraffic: fmt0(report.metrics.weekdayAvgTraffic),
		weekendAvgTraffic: fmt0(report.metrics.weekendAvgTraffic),
		observationsHtml,
		landingFunnelIntro,
		landingViewsChartHtml: report.landingDailyRows.length
			? sparkline(report.landingDailyRows, "landing_view_unique", "day", "#7c3aed", landingSparklineOpts)
			: '<p class="small">No landing funnel rollups in this window yet (requires landing analytics after deploy).</p>',
		landingCtaChartHtml: report.landingDailyRows.length
			? sparkline(report.landingDailyRows, "landing_cta_unique", "day", "#a855f7", landingSparklineOpts)
			: "",
		feedImpressionsIntro,
		trafficDailyChartHtml: sparkline(report.dailyRows, "traffic_dau", "day", "#0ea5e9", {
			weekBoundaryKey: "week_start",
			showTrend: true
		}),
		visitDailyChartHtml: sparkline(report.dailyRows, "visit_dau", "day", "#d97706", {
			weekBoundaryKey: "week_start",
			showTrend: true
		}),
		feedImpressorsChartHtml: report.feedDailyRows.length
			? sparkline(report.feedDailyRows, "feed_impressors", "day", "#059669", feedSparklineOpts)
			: '<p class="small">No feed impression rollups in this window yet (requires feed-beta beacons after deploy).</p>',
		feedImpressionVolumeChartHtml: report.feedDailyRows.length
			? sparkline(report.feedDailyRows, "feed_impressions", "day", "#10b981", feedSparklineOpts)
			: "",
		dowTrafficChartHtml: barChart(
			report.dowRows.map((r) => r.dow),
			report.dowRows.map((r) => r.avg_traffic),
			{ color: "#0ea5e9", title: "Average traffic DAU by weekday" }
		),
		dowVisitChartHtml: barChart(
			report.dowRows.map((r) => r.dow),
			report.dowRows.map((r) => r.avg_visit),
			{ color: "#d97706", title: "Average logged-in visit DAU by weekday" }
		),
		dowTableHtml: table(report.dowRows, [
			{ label: "Day", key: "dow" },
			{ label: "Sample days", key: "sample_days" },
			{ label: "Avg traffic", html: (r) => fmt0(r.avg_traffic) },
			{ label: "Avg logged-in", html: (r) => fmt1(r.avg_visit) },
			{ label: "Avg hits", html: (r) => fmt0(r.avg_hits) },
			{ label: "Peak hour all (ET)", key: "peak_hour_label" },
			{ label: "Peak hour logged-in (ET)", key: "peak_visit_hour_label" }
		]),
		hourProfileAllChartHtml: barChart(
			report.hourProfile.map((h) => String(h.hour)),
			report.hourProfile.map((h) => h.avg_all),
			{ color: "#0ea5e9", title: "Hourly profile — all traffic", height: 240 }
		),
		hourProfileAuthedChartHtml: barChart(
			report.hourProfile.map((h) => String(h.hour)),
			report.hourProfile.map((h) => h.avg_authed),
			{ color: "#d97706", title: "Hourly profile — logged-in", height: 240 }
		),
		heatmapAllHtml: heatmapSvg(report.heatmapMatrix, DOW_LABELS, {
			title: "Weekday hour heatmap — all traffic"
		}),
		heatmapAuthedHtml: heatmapSvg(report.authedHeatmapMatrix, DOW_LABELS, {
			fillColor: "#d97706",
			title: "Weekday hour heatmap — logged-in"
		}),
		peakDaysTableHtml: table(report.peakDays, [
			{ label: "Day", key: "day" },
			{ label: "Traffic DAU", key: "traffic_dau" },
			{ label: "Logged-in DAU", key: "visit_dau" },
			{ label: "Hits", key: "hits" }
		]),
		topAuthedTableHtml: table(report.topAuthed, [
			{
				label: "User",
				html: (r) => {
					const handle = r.user_name ? `@${r.user_name}` : null;
					const extra =
						handle && handle !== r.label ? ` <span class="small">${esc(handle)}</span>` : "";
					return `<strong>${esc(r.label)}</strong>${extra}`;
				}
			},
			{ label: "Visit days", key: "visit_days" },
			{ label: "Hits", key: "hits" }
		]),
		copyScriptHtml: buildCopyScriptHtml(buildSummaryExport(report), buildRawExport(report))
	});
}

export async function loadVisitPulsePeriodReport(fromDay, toDay) {
	const lastComplete = lastCompletePulseDay();
	const safeTo = toDay > lastComplete ? lastComplete : toDay;
	const safeFrom = fromDay > safeTo ? safeTo : fromDay;
	const pulseRows = await loadPulseDays(safeFrom, safeTo);
	const report = buildPeriodReport(safeFrom, safeTo, pulseRows);
	report.topAuthed = await enrichTopAuthed(report.topAuthed);
	return report;
}

async function main() {
	const { fromDay, toDay } = resolveWindow();
	const report = await loadVisitPulsePeriodReport(fromDay, toDay);
	const html = await renderHtml(report);
	const out =
		getArg("out") ||
		process.env.OUT ||
		path.join(REPO_ROOT, ".output", "visit-pulse-period", `visit-pulse-period-${toDay}.html`);
	await fs.mkdir(path.dirname(out), { recursive: true });
	await fs.writeFile(out, html, "utf8");
	console.log(out);
}

const isCli =
	process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
	main().catch((err) => {
		console.error("[visit-pulse-period-report]", err?.message || err);
		process.exit(1);
	});
}
