#!/usr/bin/env node
/**
 * Click-next report: related-grid browsing via prsn_related_transitions.
 *
 * Default: all transition data in DB (full history).
 *
 * Usage:
 *   node scripts/analytics/click-next-report.js
 *   node scripts/analytics/click-next-report.js --from 2026-05-20 --to 2026-06-14
 *
 * HTML: click-next-report.html · CSS: report.css
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

const TEMPLATE_PATH = path.join(__dirname, "click-next-report.html");
const PULSE_DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

const esc = (s) =>
	String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const LIMITATION_NOTE =
	"Click-nexts are logged-in only (POST /api/creations/transitions). Anonymous visitors are excluded. " +
	"Each row is a lifetime count for one from→to pair; we do not store per-click timestamps, so daily charts count pairs whose <em>latest</em> click landed on that day — a proxy for ongoing related browsing, not exact daily volume.";

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

function parseMeta(value) {
	if (value == null) return {};
	if (typeof value === "object") return value;
	try {
		return JSON.parse(String(value));
	} catch {
		return {};
	}
}

function usEastWeekStartKey(dayKey) {
	const noonMs = usEastDayStartMs(dayKey) + 12 * 60 * 60 * 1000;
	const dow = new Date(noonMs).getUTCDay();
	const mondayShift = (dow + 6) % 7;
	return shiftDayKey(dayKey, -mondayShift);
}

function weekLabel(weekStart) {
	return `${weekStart} → ${shiftDayKey(weekStart, 6)}`;
}

function signedPct(curr, prev) {
	if (!prev && !curr) return "0.0%";
	if (!prev && curr) return "+100.0%";
	return `${(((curr - prev) / prev) * 100 >= 0 ? "+" : "")}${(((curr - prev) / prev) * 100).toFixed(1)}%`;
}

function fmt0(n) {
	return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0";
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
	return slope > 0 ? `+${slope.toFixed(2)}` : slope.toFixed(2);
}

function sparkline(rows, valueKey, labelKey, color, { showTrend = false } = {}) {
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
	let trendHtml = "";
	let trendLabelHtml = "";
	if (showTrend) {
		const lr = linearRegression(values);
		const y0 = lr.intercept;
		const yN = lr.intercept + lr.slope * Math.max(rows.length - 1, 0);
		const trendSlopeText = formatTrendSlope(lr.slope);
		trendHtml = `<line x1="${x(0).toFixed(1)}" y1="${y(y0).toFixed(1)}" x2="${x(rows.length - 1).toFixed(1)}" y2="${y(yN).toFixed(1)}" stroke="#ef4444" stroke-width="2" stroke-dasharray="6 5"><title>Trend: ${trendSlopeText} per day</title></line>`;
		trendLabelHtml = `<text x="${w - p}" y="${p - 8}" text-anchor="end" font-size="11" fill="#ef4444">trend ${trendSlopeText}/day</text>`;
	}
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="220" aria-label="${esc(valueKey)} trend">
		<rect width="${w}" height="${h}" fill="#fff"/>
		<line x1="${p}" y1="${h - p}" x2="${w - p}" y2="${h - p}" stroke="#cbd5e1"/>
		<line x1="${p}" y1="${p}" x2="${p}" y2="${h - p}" stroke="#cbd5e1"/>
		${trendHtml}
		<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${points}"/>
		${circles}
		<text x="${p}" y="${h - 8}" font-size="11" fill="#64748b">${esc(rows[0][labelKey])}</text>
		<text x="${w - p}" y="${h - 8}" text-anchor="end" font-size="11" fill="#64748b">${esc(rows[rows.length - 1][labelKey])}</text>
		<text x="${p}" y="${p - 8}" font-size="11" fill="#64748b">max ${maxY}</text>
		${trendLabelHtml}
	</svg>`;
}

function supabaseClient() {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
	return createClient(url, key, { auth: { persistSession: false } });
}

async function loadAllTransitions(client) {
	const out = [];
	let offset = 0;
	while (true) {
		const { data, error } = await client
			.from("prsn_related_transitions")
			.select("from_created_image_id, to_created_image_id, count, last_updated")
			.order("last_updated", { ascending: true })
			.range(offset, offset + PAGE_SIZE - 1);
		if (error) throw error;
		const rows = Array.isArray(data) ? data : [];
		out.push(...rows);
		if (rows.length < PAGE_SIZE) break;
		offset += rows.length;
	}
	return out;
}

async function loadCreationSummaries(client, ids) {
	const unique = [...new Set(ids.filter((id) => Number.isFinite(Number(id))).map(Number))];
	const out = new Map();
	for (let i = 0; i < unique.length; i += 200) {
		const chunk = unique.slice(i, i + 200);
		const { data, error } = await client
			.from("prsn_created_images")
			.select("id, user_id, meta, published")
			.in("id", chunk);
		if (error) throw error;
		for (const row of data || []) {
			out.set(Number(row.id), row);
		}
	}
	return out;
}

/** @param {number[]} userIds */
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
			label: getNotificationDisplayName(
				{
					email: user?.email,
					display_name: profile?.display_name,
					user_name: profile?.user_name
				},
				profile
			),
			user_name: profile?.user_name ?? null
		});
	}
	return out;
}

function creationLabel(id, creationById) {
	const row = creationById.get(Number(id));
	if (!row) return `#${id}`;
	const meta = parseMeta(row.meta);
	const prompt =
		meta?.prompt ||
		meta?.args?.prompt ||
		meta?.title ||
		meta?.caption;
	const snippet = prompt ? String(prompt).trim().slice(0, 72) : null;
	return snippet ? `#${id} — ${snippet}` : `#${id}`;
}

function creationLinkHtml(id, creationById) {
	const label = creationLabel(id, creationById);
	return `<a href="/creations/${Number(id)}">${esc(label)}</a>`;
}

function filterByActivityWindow(rows, fromDay, toDay) {
	return rows.filter((r) => {
		const day = usEastDayKey(new Date(r.last_updated));
		return day >= fromDay && day <= toDay;
	});
}

function buildActivitySeries(allRows) {
	const byDay = new Map();
	const byWeek = new Map();
	for (const r of allRows) {
		const day = usEastDayKey(new Date(r.last_updated));
		const week = usEastWeekStartKey(day);
		byDay.set(day, (byDay.get(day) || 0) + 1);
		byWeek.set(week, (byWeek.get(week) || 0) + 1);
	}
	const dailyRows = [...byDay.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([day, paths_touched]) => ({ day, paths_touched }));
	const weeklyRows = [...byWeek.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([week_start, paths_touched]) => ({
			week_start,
			week_label: weekLabel(week_start),
			paths_touched
		}));
	const firstActivityDay = dailyRows[0]?.day ?? null;
	const lastActivityDay = dailyRows[dailyRows.length - 1]?.day ?? null;
	return { dailyRows, weeklyRows, firstActivityDay, lastActivityDay };
}

function countPathsInRange(allRows, fromDay, toDay) {
	let n = 0;
	for (const r of allRows) {
		const day = usEastDayKey(new Date(r.last_updated));
		if (day >= fromDay && day <= toDay) n++;
	}
	return n;
}

function buildObservations(report) {
	const obs = [];
	const m = report.metrics;
	if (!m.uniquePaths) {
		obs.push("No click-next transitions recorded yet. Users must be logged in and click a related card on creation detail (?from= on the URL).");
		return obs;
	}
	obs.push(
		`${fmt0(m.totalClicks)} lifetime click-nexts across ${fmt0(m.uniquePaths)} unique from→to paths (${fmt0(m.sourceCreations)} source creations).`
	);
	if (m.repeatPaths > 0) {
		obs.push(
			`${fmt0(m.repeatPaths)} paths were clicked more than once (repeat related browsing); ${fmt0(m.singleClickPaths)} paths have exactly one click.`
		);
	}
	obs.push(
		`Last 7 US East days: ${fmt0(m.pathsActiveLast7d)} paths had their most recent click (${signedPct(m.pathsActiveLast7d, m.pathsActivePrior7d)} vs prior 7 days).`
	);
	if (m.dailyRows.length >= 2) {
		const values = m.dailyRows.map((d) => d.paths_touched);
		const lr = linearRegression(values);
		const trendWord = lr.slope > 0.05 ? "rising" : lr.slope < -0.05 ? "falling" : "flat";
		obs.push(
			`Daily “paths touched” proxy is ${trendWord} over the recorded span (${formatTrendSlope(lr.slope)} paths/day trend).`
		);
	}
	const top = report.topPaths[0];
	if (top) {
		obs.push(`Strongest single path: ${top.from_label} → ${top.to_label} (${fmt0(top.count)} clicks).`);
	}
	obs.push("Pair with visit pulse period report for total site traffic; click-next is only logged-in related-grid surfing.");
	return obs;
}

function buildClickNextReport(rows, { fromDay, toDay, windowFiltered, allRows }) {
	const totalClicks = rows.reduce((s, r) => s + Number(r.count || 0), 0);
	const uniquePaths = rows.length;
	const sourceCreations = new Set(rows.map((r) => Number(r.from_created_image_id))).size;
	const destCreations = new Set(rows.map((r) => Number(r.to_created_image_id))).size;
	const repeatPaths = rows.filter((r) => Number(r.count) > 1).length;
	const singleClickPaths = rows.filter((r) => Number(r.count) === 1).length;

	const yesterday = yesterdayUsEastDayKey();
	const last7Start = shiftDayKey(yesterday, -6);
	const prior7Start = shiftDayKey(last7Start, -7);
	const prior7End = shiftDayKey(last7Start, -1);
	const pathsActiveLast7d = countPathsInRange(allRows, last7Start, yesterday);
	const pathsActivePrior7d = countPathsInRange(allRows, prior7Start, prior7End);

	const { dailyRows, weeklyRows, firstActivityDay, lastActivityDay } = buildActivitySeries(allRows);

	const topPaths = [...rows]
		.sort((a, b) => Number(b.count) - Number(a.count) || String(a.last_updated).localeCompare(String(b.last_updated)))
		.slice(0, 20)
		.map((r) => ({
			from_id: Number(r.from_created_image_id),
			to_id: Number(r.to_created_image_id),
			count: Number(r.count),
			last_updated: r.last_updated
		}));

	const byFrom = new Map();
	for (const r of rows) {
		const from = Number(r.from_created_image_id);
		if (!byFrom.has(from)) byFrom.set(from, { outgoing_clicks: 0, destinations: new Set() });
		const rec = byFrom.get(from);
		rec.outgoing_clicks += Number(r.count);
		rec.destinations.add(Number(r.to_created_image_id));
	}
	const topSources = [...byFrom.entries()]
		.map(([from_id, v]) => ({
			from_id,
			outgoing_clicks: v.outgoing_clicks,
			destinations: v.destinations.size
		}))
		.sort((a, b) => b.outgoing_clicks - a.outgoing_clicks)
		.slice(0, 15);

	const periodLabel = windowFiltered
		? `activity ${fromDay} → ${toDay}`
		: firstActivityDay && lastActivityDay
			? `all data · ${firstActivityDay} → ${lastActivityDay}`
			: "all data";

	const dataNote = windowFiltered
		? `${uniquePaths} paths with last activity in window`
		: `${allRows.length} path rows in DB`;

	return {
		fromDay: fromDay || firstActivityDay,
		toDay: toDay || lastActivityDay,
		windowFiltered,
		periodLabel,
		dataNote,
		generatedAt: new Date().toISOString(),
		topPaths,
		topSources,
		dailyRows,
		weeklyRows,
		metrics: {
			totalClicks,
			uniquePaths,
			sourceCreations,
			destCreations,
			repeatPaths,
			singleClickPaths,
			pathsActiveLast7d,
			pathsActivePrior7d,
			firstActivityDay,
			lastActivityDay,
			dailyRows
		}
	};
}

async function enrichReport(report, client) {
	const ids = [];
	for (const p of report.topPaths) {
		ids.push(p.from_id, p.to_id);
	}
	for (const s of report.topSources) {
		ids.push(s.from_id);
	}
	const creationById = await loadCreationSummaries(client, ids);
	const userIds = [...creationById.values()].map((r) => Number(r.user_id)).filter((id) => id > 0);
	const userLabels = await resolveUserLabels(userIds);

	for (const p of report.topPaths) {
		p.from_label = creationLabel(p.from_id, creationById);
		p.to_label = creationLabel(p.to_id, creationById);
	}
	for (const s of report.topSources) {
		const creation = creationById.get(s.from_id);
		s.from_label = creationLabel(s.from_id, creationById);
		const uid = Number(creation?.user_id);
		const user = uid > 0 ? userLabels.get(uid) : null;
		s.creator_label = user?.label ?? (uid > 0 ? `user ${uid}` : "—");
		s.creator_user_name = user?.user_name ?? null;
	}

	report.observations = buildObservations(report);
	return report;
}

function buildSummaryExport(report) {
	return {
		report: "click-next",
		generated_at: report.generatedAt,
		period_label: report.periodLabel,
		from_day: report.fromDay,
		to_day: report.toDay,
		window_filtered: report.windowFiltered,
		total_clicks: report.metrics.totalClicks,
		unique_paths: report.metrics.uniquePaths,
		source_creations: report.metrics.sourceCreations,
		dest_creations: report.metrics.destCreations,
		repeat_paths: report.metrics.repeatPaths,
		paths_active_last_7d: report.metrics.pathsActiveLast7d,
		paths_active_prior_7d: report.metrics.pathsActivePrior7d,
		first_activity_day: report.metrics.firstActivityDay,
		last_activity_day: report.metrics.lastActivityDay,
		observations: report.observations,
		top_paths: report.topPaths.map((p) => ({
			from_id: p.from_id,
			to_id: p.to_id,
			from_label: p.from_label,
			to_label: p.to_label,
			count: p.count
		})),
		top_sources: report.topSources.map((s) => ({
			from_id: s.from_id,
			from_label: s.from_label,
			creator_label: s.creator_label,
			outgoing_clicks: s.outgoing_clicks,
			destinations: s.destinations
		})),
		daily_paths_touched: report.dailyRows,
		weekly_paths_touched: report.weeklyRows
	};
}

function buildCopyScriptHtml(summaryPayload, rawPayload) {
	return `<script>
(() => {
	const summaryPayload = ${JSON.stringify(summaryPayload)};
	const rawPayload = ${JSON.stringify(rawPayload)};
	const status = document.getElementById('copy-click-next-status');
	const setStatus = (msg) => { if (status) status.textContent = msg || ''; };
	async function copyText(text) {
		if (navigator?.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return;
		}
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', 'true');
		ta.style.position = 'fixed';
		ta.style.top = '-1000px';
		document.body.appendChild(ta);
		ta.select();
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
				setStatus('Copied ' + label + '.');
			} catch {
				setStatus('Copy failed.');
			}
		});
	}
	onCopy(document.getElementById('copy-click-next-summary'), JSON.stringify(summaryPayload, null, 2), 'summary JSON');
	onCopy(document.getElementById('copy-click-next-raw'), JSON.stringify(rawPayload, null, 2), 'raw JSON');
})();
</script>`;
}

async function renderHtml(report) {
	const template = await loadTemplate();
	const styleBlock = await loadReportStyleBlock();
	const observationsHtml = report.observations.map((o) => `<li>${esc(o)}</li>`).join("");

	return fillHtmlTemplate(template, {
		styleBlock,
		periodLabel: report.periodLabel,
		generatedAt: report.generatedAt,
		dataNote: report.dataNote,
		totalClicks: fmt0(report.metrics.totalClicks),
		uniquePaths: fmt0(report.metrics.uniquePaths),
		sourceCreations: fmt0(report.metrics.sourceCreations),
		destCreations: fmt0(report.metrics.destCreations),
		repeatPaths: fmt0(report.metrics.repeatPaths),
		pathsActiveLast7d: fmt0(report.metrics.pathsActiveLast7d),
		pathsActivePrior7d: fmt0(report.metrics.pathsActivePrior7d),
		firstActivityDay: report.metrics.firstActivityDay || "—",
		lastActivityDay: report.metrics.lastActivityDay || "—",
		observationsHtml,
		limitationNote: LIMITATION_NOTE,
		dailyActivityChartHtml: sparkline(report.dailyRows, "paths_touched", "day", "#7c3aed", {
			showTrend: true
		}),
		weeklyActivityChartHtml: sparkline(report.weeklyRows, "paths_touched", "week_label", "#2563eb", {
			showTrend: true
		}),
		topPathsTableHtml: table(report.topPaths, [
			{ label: "From", html: (r) => esc(r.from_label) },
			{ label: "To", html: (r) => esc(r.to_label) },
			{ label: "Clicks", key: "count" },
			{
				label: "Last activity (ET)",
				html: (r) => esc(usEastDayKey(new Date(r.last_updated)))
			}
		]),
		topSourcesTableHtml: table(report.topSources, [
			{
				label: "Creator",
				html: (r) => {
					const handle = r.creator_user_name ? `@${r.creator_user_name}` : null;
					const extra =
						handle && handle !== r.creator_label ? ` <span class="small">${esc(handle)}</span>` : "";
					return `<strong>${esc(r.creator_label)}</strong>${extra}`;
				}
			},
			{ label: "Source creation", html: (r) => esc(r.from_label) },
			{ label: "Outgoing clicks", key: "outgoing_clicks" },
			{ label: "Destinations", key: "destinations" }
		]),
		copyScriptHtml: buildCopyScriptHtml(buildSummaryExport(report), {
			...buildSummaryExport(report),
			all_path_rows: report.topPaths
		})
	});
}

export async function loadClickNextReport({ fromDay = null, toDay = null } = {}) {
	const client = supabaseClient();
	const allRows = await loadAllTransitions(client);
	const fromArg = getArg("from");
	const toArg = getArg("to");
	const windowFiltered = /^\d{4}-\d{2}-\d{2}$/.test(fromArg) && /^\d{4}-\d{2}-\d{2}$/.test(toArg);
	const activity = buildActivitySeries(allRows);
	const resolvedFrom = windowFiltered ? fromArg : activity.firstActivityDay;
	const resolvedTo = windowFiltered ? toArg : activity.lastActivityDay;
	const rows = windowFiltered
		? filterByActivityWindow(allRows, fromArg, toArg)
		: allRows;

	let report = buildClickNextReport(rows, {
		fromDay: resolvedFrom,
		toDay: resolvedTo,
		windowFiltered,
		allRows
	});
	report = await enrichReport(report, client);
	return report;
}

async function main() {
	const report = await loadClickNextReport();
	const html = await renderHtml(report);
	const stamp = report.metrics.lastActivityDay || usEastDayKey(new Date());
	const out =
		getArg("out") ||
		process.env.OUT ||
		path.join(REPO_ROOT, ".output", "click-next", `click-next-${stamp}.html`);
	await fs.mkdir(path.dirname(out), { recursive: true });
	await fs.writeFile(out, html, "utf8");
	console.log(out);
}

const isCli =
	process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
	main().catch((err) => {
		console.error("[click-next-report]", err?.message || err);
		process.exit(1);
	});
}
