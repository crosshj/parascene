#!/usr/bin/env node
/**
 * Visit pulse report: DB (flushed days) or Redis (--live, in-progress today).
 *
 * Usage:
 *   node scripts/analytics/visit-pulse-report.js
 *   node scripts/analytics/visit-pulse-report.js --day 2026-05-20
 *   node scripts/analytics/visit-pulse-report.js --live
 *   node scripts/analytics/visit-pulse-report.js --json
 *   node scripts/analytics/visit-pulse-report.js --html
 *   node scripts/analytics/visit-pulse-report.js --day 2026-05-20 --html --out .output/visit-pulse/day.html
 *
 * HTML: visit-pulse-report.html · CSS: report.css ({{!styleBlock}})
 *
 * DB: apply db/schemas/supabase_11_visit_pulse_days.sql in Supabase.
 * Redis: UPSTASH_REDIS_REST_* in .env
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { REPO_ROOT, loadEnv } from "../repo-root.cjs";
import { loadReportStyleBlock } from "./report-styles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();

const esc = (s) =>
	String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const VISIT_PULSE_HTML_TEMPLATE = path.join(__dirname, "visit-pulse-report.html");

let visitPulseHtmlTemplateCache = null;

/** {{name}} = escaped; {{!name}} = raw HTML from report builders. */
function fillHtmlTemplate(template, values) {
	return template.replace(/\{\{(!?)([a-zA-Z0-9_]+)\}\}/g, (_, raw, key) => {
		if (!(key in values)) return "";
		const v = values[key];
		return raw === "!" ? String(v ?? "") : esc(v);
	});
}

async function loadVisitPulseHtmlTemplate() {
	if (!visitPulseHtmlTemplateCache) {
		visitPulseHtmlTemplateCache = await fs.readFile(VISIT_PULSE_HTML_TEMPLATE, "utf8");
	}
	return visitPulseHtmlTemplateCache;
}

const ANON_CHART_COLOR = "#94a3b8";

/** @param {number} h 0–360 @param {number} s 0–100 @param {number} l 0–100 */
function hslToHex(h, s, l) {
	const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
	const f = (n) => {
		const k = (n + h / 30) % 12;
		const x = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
		return Math.round(255 * x)
			.toString(16)
			.padStart(2, "0");
	};
	return `#${f(0)}${f(8)}${f(4)}`;
}

/** Golden-angle hues with alternating S/L so 50+ authed series stay separable on light backgrounds. */
function buildDistinctChartPalette(size = 64) {
	const GOLDEN_DEG = 137.508;
	const profiles = [
		{ s: 78, l: 42 },
		{ s: 68, l: 52 },
		{ s: 88, l: 36 },
		{ s: 58, l: 48 }
	];
	const colors = [];
	for (let i = 0; i < size; i++) {
		const hue = (i * GOLDEN_DEG) % 360;
		const { s, l } = profiles[i % profiles.length];
		colors.push(hslToHex(hue, s, l));
	}
	return colors;
}

const AUTHED_CHART_COLORS = buildDistinctChartPalette(64);
const HOURS_PER_DAY = 24;

const EASTERN_TZ = "America/New_York";

/** Wall-clock US Eastern (DST-aware) for all report display. */
function createEasternFormatters() {
	const wallDate = new Intl.DateTimeFormat("en-US", {
		timeZone: EASTERN_TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	});
	const wallTime = new Intl.DateTimeFormat("en-US", {
		timeZone: EASTERN_TZ,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false
	});
	const wallHour12 = new Intl.DateTimeFormat("en-US", {
		timeZone: EASTERN_TZ,
		hour: "numeric",
		hour12: true
	});
	const wallTzName = new Intl.DateTimeFormat("en-US", {
		timeZone: EASTERN_TZ,
		timeZoneName: "short"
	});

	function tzAbbr(ms = Date.now()) {
		const parts = wallTzName.formatToParts(new Date(ms));
		return parts.find((p) => p.type === "timeZoneName")?.value || "ET";
	}

	function formatFromMs(ms, { showDate = true } = {}) {
		if (!Number.isFinite(ms)) return "?";
		const d = new Date(ms);
		const tz = tzAbbr(ms);
		const t = wallTime.format(d);
		if (!showDate) return `${t} ${tz}`;
		const parts = wallDate.formatToParts(d);
		const y = parts.find((p) => p.type === "year")?.value;
		const m = parts.find((p) => p.type === "month")?.value;
		const day = parts.find((p) => p.type === "day")?.value;
		return `${y}-${m}-${day} ${t} ${tz}`;
	}

	function formatIso(iso, opts) {
		return formatFromMs(Date.parse(iso), opts);
	}

	function formatUtcIso(iso) {
		const ms = Date.parse(iso);
		if (!Number.isFinite(ms)) return "?";
		return new Date(ms).toISOString().replace(".000Z", "Z");
	}

	function formatRangesEt(ranges, { showDate = false } = {}) {
		if (!Array.isArray(ranges) || !ranges.length) return "(no ranges)";
		return ranges
			.map(([a, b]) => `${formatIso(a, { showDate })} → ${formatIso(b, { showDate })}`)
			.join("; ");
	}

	function hourShortFromMs(ms) {
		if (!Number.isFinite(ms)) return "?";
		const parts = wallHour12.formatToParts(new Date(ms));
		const h = Number(parts.find((p) => p.type === "hour")?.value);
		const dp = parts.find((p) => p.type === "dayPeriod")?.value;
		if (!Number.isFinite(h) || !dp) return "?";
		if (h === 12 && dp === "am") return "12a";
		if (h === 12 && dp === "pm") return "12p";
		if (dp === "am") return `${h}a`;
		return `${h}p`;
	}

	/** Partition hour index → wall label at slot start (chart / tables). */
	function partitionHourShortLabel(hour, dayStartMs) {
		return hourShortFromMs(dayStartMs + hour * 60 * 60 * 1000);
	}

	function hourWindowEt(hour, dayStartMs) {
		const startMs = dayStartMs + hour * 60 * 60 * 1000;
		const endMs = startMs + 60 * 60 * 1000;
		return `${formatFromMs(startMs, { showDate: false })} – ${formatFromMs(endMs, { showDate: false })}`;
	}

	/** @param {object} v @param {number} dayStartMs */
	function visitorActiveHourLabels(v, dayStartMs) {
		const labels = [];
		const seen = new Set();
		for (const h of visitorActiveHours(v, dayStartMs)) {
			const label = partitionHourShortLabel(h, dayStartMs);
			if (!seen.has(label)) {
				seen.add(label);
				labels.push(label);
			}
		}
		return labels;
	}

	return {
		formatFromMs,
		formatIso,
		formatUtcIso,
		formatRangesEt,
		hourWindowEt,
		hourShortFromMs,
		partitionHourShortLabel,
		visitorActiveHourLabels,
		tzAbbr
	};
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

function hasFlag(name) {
	return process.argv.slice(2).includes(`--${name}`);
}


function pad(str, width) {
	const s = String(str ?? "");
	return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/** @param {string} dayKey @param {Array<[string,string]>} ranges */
function renderTimeline(dayKey, ranges, blocksPerDay, blockMinutes, dayStartMs) {
	const chars = new Array(blocksPerDay).fill("·");
	const dayStart = dayStartMs;
	for (const [startIso, endIso] of ranges || []) {
		const startMs = Date.parse(startIso);
		const endMs = Date.parse(endIso);
		if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
		for (let b = 0; b < blocksPerDay; b++) {
			const bStart = dayStart + b * blockMinutes * 60 * 1000;
			const bEnd = bStart + blockMinutes * 60 * 1000;
			if (bEnd > startMs && bStart < endMs) chars[b] = "#";
		}
	}
	return chars.join("");
}

async function loadFromDb(dayKey) {
	const { openDb } = await import("../../db/index.js");
	const { queries } = await openDb({ quiet: true });
	if (!queries.selectVisitPulseDay?.get) {
		throw new Error("selectVisitPulseDay not available — apply visit_pulse_days schema");
	}
	return queries.selectVisitPulseDay.get(dayKey);
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

/** @param {Array<object>} visitors @param {Array<object>} [activeNow] */
async function enrichAuthedVisitors(visitors, activeNow = []) {
	const userIds = [];
	for (const v of visitors) {
		if (v.user_id != null) userIds.push(v.user_id);
	}
	for (const v of activeNow) {
		if (v.user_id != null) userIds.push(v.user_id);
	}
	const labels = await resolveAuthedUserLabels(userIds);
	const attach = (v) => {
		if (v.user_id == null) return v;
		const info = labels.get(Number(v.user_id));
		if (!info) return { ...v, display_label: `user ${v.user_id}` };
		return { ...v, ...info, display_label: info.label };
	};
	return {
		visitors: visitors.map(attach),
		activeNow: activeNow.map(attach),
		labels
	};
}

function visitorSortKey(v) {
	const authed = v.user_id != null ? 0 : 1;
	const hits = -(Number(v.hits) || 0);
	return [authed, hits, String(v.visitor_key || "")];
}

function sortVisitors(visitors) {
	return [...(visitors || [])].sort((a, b) => {
		const ka = visitorSortKey(a);
		const kb = visitorSortKey(b);
		return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
	});
}

/** CLI --json and “Copy raw JSON” on HTML reports. */
function buildVisitPulseRawPayload({ dayKey, source, row, activeNow, visitors }) {
	const summary = {
		day: dayKey,
		source,
		unique_visitors: row?.unique_visitors ?? 0,
		authed_visitors: row?.authed_visitors ?? 0,
		anon_visitors: row?.anon_visitors ?? 0,
		total_hits: row?.total_hits ?? 0,
		total_active_blocks: row?.total_active_blocks ?? 0,
		flushed_at: row?.flushed_at ?? null,
		active_now: activeNow?.length ?? 0
	};
	return { summary, visitors: sortVisitors(visitors), active_now: activeNow ?? [] };
}

/** Anonymous table shape for HTML + summary (no activity ranges). */
function buildAnonTablePayload(anon, dayStartMs, et) {
	const multiHit = [...anon]
		.filter((v) => (Number(v.hits) || 0) > 1)
		.sort((a, b) => (Number(b.hits) || 0) - (Number(a.hits) || 0));
	const singleHit = anon.filter((v) => (Number(v.hits) || 0) <= 1);

	const byHour = Array.from({ length: HOURS_PER_DAY }, () => 0);
	for (const v of singleHit) {
		for (const h of visitorActiveHours(v, dayStartMs)) byHour[h]++;
	}
	const singleHitByHour = byHour
		.map((count, hour_index) => ({ hour_index, count }))
		.filter((r) => r.count > 0)
		.map((r) => ({
			kind: "single_hit_hour",
			label: "Single-hit",
			hits: r.count,
			hour_index: r.hour_index,
			hour_label: et.partitionHourShortLabel(r.hour_index, dayStartMs)
		}));

	return {
		multi_hit: multiHit.map((v) => ({
			kind: "cookie",
			cookie: anonCookieLabel(v),
			client_id: v.client_id ?? null,
			hits: Number(v.hits) || 0,
			active_hours: et.visitorActiveHourLabels(v, dayStartMs)
		})),
		single_hit_by_hour: singleHitByHour
	};
}

function buildHourlyActivitySummary(stack, dayStartMs, et) {
	const anonSeries = stack.series.find((s) => s.kind === "anon");
	return Array.from({ length: HOURS_PER_DAY }, (_, h) => {
		const stacked_total = stack.hourTotals[h] || 0;
		if (!stacked_total) return null;
		return {
			hour_index: h,
			hour_label: et.partitionHourShortLabel(h, dayStartMs),
			stacked_total,
			authed_count: stack.slotByHour[h]?.size ?? 0,
			anon_cookies: anonSeries ? Number(anonSeries.values[h]) || 0 : 0
		};
	}).filter(Boolean);
}

function buildChartSeriesSummary(stack, dayStartMs, et) {
	return stack.series.map((s) => ({
		id: s.id,
		label: s.label,
		sub: s.sub,
		kind: s.kind,
		hits: s.hits,
		active_hours: s.values
			.map((v, h) => (v ? et.partitionHourShortLabel(h, dayStartMs) : null))
			.filter(Boolean)
	}));
}

/** Page-visible data for “Copy summary JSON” (no per-visitor range timestamps). */
function buildVisitPulseSummaryPayload(bundle) {
	const { dayKey, source, row, activeNow, tzLabel, displayTz, stack, et, visitors, dayStartMs } = bundle;
	const anon = (visitors || []).filter((v) => v.user_id == null);
	const authed = (visitors || []).filter((v) => v.user_id != null);
	const oneHitAnon = anon.filter((v) => (Number(v.hits) || 0) <= 1).length;
	const colorMap = authedColorByUserId(stack.series);
	const anonTables = buildAnonTablePayload(anon, dayStartMs, et);

	return {
		day: dayKey,
		source,
		partition: tzLabel,
		display_tz: displayTz,
		eastern_tz: EASTERN_TZ,
		generated_at_et: et.formatFromMs(Date.now()),
		generated_at_utc: et.formatUtcIso(new Date().toISOString()),
		unique_visitors: row?.unique_visitors ?? 0,
		authed_visitors: row?.authed_visitors ?? 0,
		anon_visitors: row?.anon_visitors ?? 0,
		single_hit_anon: oneHitAnon,
		total_hits: row?.total_hits ?? 0,
		total_active_blocks: row?.total_active_blocks ?? 0,
		peak_hour: {
			count: stack.peakHour.n,
			label: et.partitionHourShortLabel(stack.peakHour.h, dayStartMs),
			hour_index: stack.peakHour.h,
			display_tz: displayTz
		},
		flushed_at: row?.flushed_at ?? null,
		active_now: {
			count: activeNow?.length ?? 0,
			visitors: (activeNow || []).map((v) => ({
				user_id: v.user_id ?? null,
				display_label: v.display_label ?? null,
				user_name: v.user_name ?? null,
				client_id: v.client_id ? anonCookieLabel(v) : null,
				last_pulse_at: v.last_pulse_at ?? null
			}))
		},
		hourly_activity: buildHourlyActivitySummary(stack, dayStartMs, et),
		chart_series: buildChartSeriesSummary(stack, dayStartMs, et),
		logged_in_users: [...authed]
			.sort((a, b) => (Number(b.hits) || 0) - (Number(a.hits) || 0))
			.map((v) => ({
				user_id: v.user_id,
				display_label: v.display_label || `user ${v.user_id}`,
				user_name: v.user_name ?? null,
				hits: Number(v.hits) || 0,
				chart_color: colorMap.get(Number(v.user_id)) ?? null,
				active_hours: et.visitorActiveHourLabels(v, dayStartMs)
			})),
		anonymous: anonTables
	};
}

function buildVisitPulsePageScriptHtml(summaryPayload, rawPayload) {
	const summaryJson = JSON.stringify(summaryPayload);
	const rawJson = JSON.stringify(rawPayload);
	return `<script>
(() => {
	const summaryPayload = ${summaryJson};
	const rawPayload = ${rawJson};
	const status = document.getElementById('copy-pulse-status');
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
	async function onCopy(btn, payload, label) {
		if (!btn) return;
		btn.addEventListener('click', async () => {
			try {
				setStatus('Copying…');
				await copyText(JSON.stringify(payload, null, 2));
				setStatus('Copied ' + label + ' to clipboard.');
			} catch (_err) {
				setStatus('Copy failed.');
			}
		});
	}
	onCopy(document.getElementById('copy-pulse-summary'), summaryPayload, 'summary JSON');
	onCopy(document.getElementById('copy-pulse-raw'), rawPayload, 'raw JSON');
	document.addEventListener('click', function (e) {
		var link = e.target && e.target.closest ? e.target.closest('[data-pulse-day-nav]') : null;
		if (!link) return;
		e.preventDefault();
		var day = link.getAttribute('data-day');
		if (!day) return;
		location.href = 'visit-pulse-' + day + '.html';
	});
})();
</script>`;
}

function formatVisitorLine(v) {
	if (v.user_id != null) {
		const handle = v.user_name ? `@${v.user_name}` : null;
		const extra = handle && handle !== v.display_label ? ` (${handle})` : "";
		return `${v.display_label}${extra}  id ${v.user_id}`;
	}
	if (v.client_id) return `anon ${String(v.client_id).slice(0, 12)}`;
	return String(v.visitor_key || "?");
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

/**
 * Stack slot per authed user per hour: left→right continuity, compact (no gaps).
 * Returning users keep relative order from h−1 but slots are 0..n−1; newcomers stack on top.
 * @param {Array<{ id: string, values: number[] }>} authedSeries
 */
function assignAuthedStackSlotsByHour(authedSeries) {
	const seriesOrder = new Map(
		authedSeries.map((s, i) => [Number(String(s.id).slice(2)), i])
	);
	const byHour = [];

	for (let h = 0; h < HOURS_PER_DAY; h++) {
		const activeIds = authedSeries
			.filter((s) => Number(s.values[h]))
			.map((s) => Number(String(s.id).slice(2)));
		const prev = h > 0 ? byHour[h - 1] : null;
		const assignment = new Map();

		if (!activeIds.length) {
			byHour[h] = assignment;
			continue;
		}

		let slot = 0;
		if (prev?.size) {
			const returning = activeIds
				.filter((id) => prev.has(id))
				.sort((a, b) => prev.get(a) - prev.get(b));
			for (const id of returning) assignment.set(id, slot++);
		}

		const newcomers = activeIds
			.filter((id) => !assignment.has(id))
			.sort((a, b) => (seriesOrder.get(a) ?? 0) - (seriesOrder.get(b) ?? 0));
		for (const id of newcomers) assignment.set(id, slot++);

		byHour[h] = assignment;
	}

	return byHour;
}

/** @param {Array<object>} visitors @param {number} dayStartMs */
function buildHourlyStackSeries(visitors, dayStartMs) {
	const authed = visitors.filter((v) => v.user_id != null).sort((a, b) => (Number(b.hits) || 0) - (Number(a.hits) || 0));
	const anon = visitors.filter((v) => v.user_id == null);

	const series = authed.map((v, i) => {
		const hours = visitorActiveHours(v, dayStartMs);
		const values = Array.from({ length: HOURS_PER_DAY }, (_, h) => (hours.has(h) ? 1 : 0));
		return {
			id: `u:${v.user_id}`,
			label: v.display_label || `user ${v.user_id}`,
			sub: v.user_name ? `@${v.user_name}` : `id ${v.user_id}`,
			color: AUTHED_CHART_COLORS[i % AUTHED_CHART_COLORS.length],
			kind: "authed",
			hits: Number(v.hits) || 0,
			values
		};
	});

	const anonValues = Array.from({ length: HOURS_PER_DAY }, () => 0);
	for (const v of anon) {
		for (const h of visitorActiveHours(v, dayStartMs)) anonValues[h]++;
	}
	if (anon.length) {
		series.push({
			id: "anon",
			label: "Anonymous",
			sub: `${anon.length} cookies (stack height = count active that hour)`,
			color: ANON_CHART_COLOR,
			kind: "anon",
			hits: anon.reduce((n, v) => n + (Number(v.hits) || 0), 0),
			values: anonValues
		});
	}

	const authedSeries = series.filter((s) => s.kind === "authed");
	const slotByHour = assignAuthedStackSlotsByHour(authedSeries);
	const hourTotals = Array.from({ length: HOURS_PER_DAY }, (_, h) => {
		const authedN = slotByHour[h]?.size ?? 0;
		const anonN = Number(anonValues[h]) || 0;
		return authedN + anonN;
	});
	const peakHour = hourTotals.reduce((best, n, h) => (n > best.n ? { h, n } : best), { h: 0, n: 0 });

	return { series, hourTotals, peakHour, slotByHour };
}

function stackedHourChartSvg({ series, hourTotals, slotByHour, dayStartMs, dayKey, et }) {
	const w = 1080;
	const h = 380;
	const padL = 44;
	const padR = 16;
	const padT = 16;
	const padB = 52;
	const chartW = w - padL - padR;
	const chartH = h - padT - padB;
	const colW = chartW / HOURS_PER_DAY;
	const maxY = Math.max(...hourTotals, 1);

	const authedSeries = series.filter((s) => s.kind === "authed");
	const anonSeries = series.find((s) => s.kind === "anon");
	const unitH = chartH / maxY;

	const grid = Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
		const total = Number(hourTotals[hour]) || 0;
		if (total <= 0) return "";

		const slots = slotByHour[hour] || new Map();
		const authedLayers = slots.size;

		const segments = [];
		const hourStartMs = dayStartMs + hour * 60 * 60 * 1000;
		const hourEndMs = dayStartMs + (hour + 1) * 60 * 60 * 1000;
		const utcStart = et.formatUtcIso(new Date(hourStartMs).toISOString());
		const utcEnd = et.formatUtcIso(new Date(hourEndMs).toISOString());
		const x = (padL + hour * colW + 1).toFixed(1);
		const barW = Math.max(1, colW - 2).toFixed(1);

		for (const s of authedSeries) {
			if (!Number(s.values[hour])) continue;
			const userId = Number(String(s.id).slice(2));
			const slot = slots.get(userId);
			if (slot == null) continue;
			const y = (padT + chartH - (slot + 1) * unitH).toFixed(1);
			segments.push(
				`<rect x="${x}" y="${y}" width="${barW}" height="${unitH.toFixed(1)}" fill="${s.color}" opacity="0.92"><title>${esc(s.label)} · ${esc(et.partitionHourShortLabel(hour, dayStartMs))} (${esc(et.hourWindowEt(hour, dayStartMs))})\nUTC ${esc(utcStart)} – ${esc(utcEnd)}\nactive</title></rect>`
			);
		}

		const anonN = Number(anonSeries?.values[hour]) || 0;
		if (anonN > 0 && anonSeries) {
			const anonH = anonN * unitH;
			const y = (padT + chartH - authedLayers * unitH - anonH).toFixed(1);
			segments.push(
				`<rect x="${x}" y="${y}" width="${barW}" height="${anonH.toFixed(1)}" fill="${anonSeries.color}" opacity="0.85"><title>${esc(anonSeries.label)} · ${esc(et.partitionHourShortLabel(hour, dayStartMs))} (${esc(et.hourWindowEt(hour, dayStartMs))})\nUTC ${esc(utcStart)} – ${esc(utcEnd)}\n${anonN} anon cookies</title></rect>`
			);
		}

		return segments.join("");
	}).join("");

	const xLabels = Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
		if (hour % 2 !== 0) return "";
		const x = padL + hour * colW + colW / 2;
		return `<text x="${x.toFixed(1)}" y="${h - 18}" text-anchor="middle" font-size="10" fill="#64748b">${esc(et.partitionHourShortLabel(hour, dayStartMs))}</text>`;
	}).join("");

	const yTicks = [0, Math.ceil(maxY / 2), maxY]
		.filter((v, i, a) => a.indexOf(v) === i)
		.map((tick) => {
			const y = padT + chartH - (tick / maxY) * chartH;
			return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-dasharray="4 4"/><text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#64748b">${tick}</text>`;
		})
		.join("");

	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" aria-label="Active visitors by hour">
		<rect width="${w}" height="${h}" fill="#fff"/>
		<line x1="${padL}" y1="${padT + chartH}" x2="${w - padR}" y2="${padT + chartH}" stroke="#cbd5e1"/>
		<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" stroke="#cbd5e1"/>
		${yTicks}
		${grid}
		${xLabels}
		<text x="${(padL + chartW / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle" font-size="11" fill="#475569">Hour (${esc(et.tzAbbr(dayStartMs))}) · partition ${esc(dayKey)}</text>
	</svg>`;
}

function authedColorByUserId(series) {
	const map = new Map();
	for (const s of series) {
		if (s.kind !== "authed") continue;
		const id = Number(String(s.id).replace(/^u:/, ""));
		if (Number.isFinite(id)) map.set(id, s.color);
	}
	return map;
}

function tableHtml(rows, cols, { subgrid = false } = {}) {
	if (!rows.length) return "<p class=\"small\">None.</p>";
	const tableClass = subgrid ? ' class="table-subgrid"' : "";
	const head = cols
		.map((c, i) => {
			const cls = subgrid && i === 1 ? ' class="col-end"' : "";
			return `<th${cls}>${esc(c.label)}</th>`;
		})
		.join("");
	const body = rows
		.map((r) => {
			const cells = cols
				.map((c, i) => {
					const cls = subgrid && i === 1 ? ' class="col-end"' : "";
					const inner = c.html ? c.html(r) : esc(r[c.key]);
					return `<td${cls}>${inner}</td>`;
				})
				.join("");
			return `<tr>${cells}</tr>`;
		})
		.join("");
	return `<table${tableClass}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function anonCookieLabel(v) {
	const cid =
		v.client_id || (String(v.visitor_key || "").startsWith("v:") ? String(v.visitor_key).slice(2) : "");
	return cid ? `${String(cid).slice(0, 8)}…` : "?";
}

function anonVisitorsTableHtml(anon, dayStartMs, et, displayTz) {
	const { single_hit_by_hour: singleHitRows } = buildAnonTablePayload(anon, dayStartMs, et);
	const multiHitVisitors = [...anon]
		.filter((v) => (Number(v.hits) || 0) > 1)
		.sort((a, b) => (Number(b.hits) || 0) - (Number(a.hits) || 0));
	const rows = [
		...multiHitVisitors.map((v) => ({ ...v, _visitor: true })),
		...singleHitRows.map((r) => ({
			_single_hit_hour: true,
			label: r.label,
			hits: r.hits,
			hours: r.hour_label,
			ranges: et.hourWindowEt(r.hour_index, dayStartMs)
		}))
	];

	if (!rows.length) return "<p class=\"small\">None.</p>";

	const anonSwatch = `<span class="swatch" style="background:${ANON_CHART_COLOR}" title="Chart color"></span>`;

	return tableHtml(
		rows,
		[
		{
			label: "Cookie",
			html: (r) => {
				const label = r._visitor
					? `<code>${esc(anonCookieLabel(r))}</code>`
					: `<strong>${esc(r.label)}</strong>`;
				return `<span class="label-row">${anonSwatch}<span>${label}</span></span>`;
			}
		},
		{ label: "Hits", html: (r) => String(r._visitor ? (r.hits ?? 0) : r.hits) },
		{
			label: `Active hours (${displayTz})`,
			html: (r) =>
				r._visitor
					? et.visitorActiveHourLabels(r, dayStartMs).join(", ") || "—"
					: esc(r.hours)
		},
		{
			label: `Ranges (${displayTz})`,
			html: (r) => (r._visitor ? esc(et.formatRangesEt(r.ranges)) : esc(r.ranges))
		}
	],
		{ subgrid: true }
	);
}

const PULSE_DAY_MS = 24 * 60 * 60 * 1000;

/** First N partition hours; bots usually show up on complete days. */
const PULSE_NAV_EARLY_HOUR_COUNT = 6;
/** Last N partition hours (18–23). */
const PULSE_NAV_LATE_START_HOUR = 18;
/** Min stacked visitors across the early/late band to enable Prev/Next. */
const PULSE_NAV_MIN_BAND_TOTAL = 3;

/** @param {number[]} hourTotals */
function pulseDayHasReasonableEarlyTraffic(hourTotals) {
	let n = 0;
	for (let h = 0; h < PULSE_NAV_EARLY_HOUR_COUNT; h++) n += Number(hourTotals[h]) || 0;
	return n >= PULSE_NAV_MIN_BAND_TOTAL;
}

/** @param {number[]} hourTotals */
function pulseDayHasReasonableLateTraffic(hourTotals) {
	let n = 0;
	for (let h = PULSE_NAV_LATE_START_HOUR; h < HOURS_PER_DAY; h++) n += Number(hourTotals[h]) || 0;
	return n >= PULSE_NAV_MIN_BAND_TOTAL;
}

/** @param {"Prev"|"Next"} label @param {string} dayKey @param {boolean} enabled */
function buildPulseDayNavLinkHtml(label, dayKey, enabled) {
	if (!enabled) return `<span aria-disabled="true">${esc(label)}</span>`;
	return `<a href="#" data-pulse-day-nav data-day="${esc(dayKey)}">${esc(label)}</a>`;
}

/** @param {string} dayKey @param {number} deltaDays */
async function adjacentPulseDayKey(dayKey, deltaDays) {
	const { usEastDayStartMs, usEastDayKey } = await import("../../api_routes/utils/visitPulseCore.js");
	return usEastDayKey(new Date(usEastDayStartMs(dayKey) + deltaDays * PULSE_DAY_MS));
}

async function renderVisitPulseHtml(bundle) {
	const { dayKey, source, row, activeNow, tzLabel, dayStartMs, stack, et, displayTz } = bundle;
	const hourTotals = stack.hourTotals || [];
	const prevNavEnabled = pulseDayHasReasonableEarlyTraffic(hourTotals);
	const nextNavEnabled = pulseDayHasReasonableLateTraffic(hourTotals);
	const [prevDayKey, nextDayKey] = await Promise.all([
		adjacentPulseDayKey(dayKey, -1),
		adjacentPulseDayKey(dayKey, 1)
	]);
	const visitors = bundle.visitors || [];
	const authed = visitors.filter((v) => v.user_id != null);
	const anon = visitors.filter((v) => v.user_id == null);
	const oneHitAnon = anon.filter((v) => (Number(v.hits) || 0) <= 1).length;

	const flushedNoteHtml = row?.flushed_at
		? `<li>DB flushed at ${esc(et.formatIso(row.flushed_at))} <span class="small">(UTC ${esc(et.formatUtcIso(row.flushed_at))})</span>.</li>`
		: "<li>Not flushed to DB yet (live Redis or partial day).</li>";
	const activeNowNoteHtml = activeNow?.length
		? `<li>${esc(String(activeNow.length))} visitor(s) in Redis active set right now.</li>`
		: "";

	const summaryPayload = buildVisitPulseSummaryPayload(bundle);
	const rawPayload = buildVisitPulseRawPayload({
		dayKey,
		source,
		row,
		activeNow,
		visitors
	});

	const template = await loadVisitPulseHtmlTemplate();
	const styleBlock = await loadReportStyleBlock();
	return fillHtmlTemplate(template, {
		styleBlock,
		dayKey,
		prevDayNavHtml: buildPulseDayNavLinkHtml("Prev", prevDayKey, prevNavEnabled),
		nextDayNavHtml: buildPulseDayNavLinkHtml("Next", nextDayKey, nextNavEnabled),
		tzLabel,
		source,
		generatedEt: et.formatFromMs(Date.now()),
		generatedUtc: et.formatUtcIso(new Date().toISOString()),
		uniqueVisitors: String(row?.unique_visitors ?? 0),
		authedVisitors: String(row?.authed_visitors ?? authed.length),
		anonVisitors: String(row?.anon_visitors ?? anon.length),
		oneHitAnon: String(oneHitAnon),
		peakHourCount: String(stack.peakHour.n),
		peakHourLabel: et.partitionHourShortLabel(stack.peakHour.h, dayStartMs),
		displayTz,
		easternTz: EASTERN_TZ,
		chartSvg: stackedHourChartSvg({
			...stack,
			slotByHour: stack.slotByHour,
			dayStartMs,
			dayKey,
			et
		}),
		authedTableHtml: tableHtml(
			[...authed].sort((a, b) => (Number(b.hits) || 0) - (Number(a.hits) || 0)),
			[
				{
					label: "User",
					html: (r) => {
						const color = authedColorByUserId(stack.series).get(Number(r.user_id)) || "#94a3b8";
						const label = r.display_label || `user ${r.user_id}`;
						const sub = r.user_name ? `@${r.user_name}` : `id ${r.user_id}`;
						return `<span class="label-row"><span class="swatch" style="background:${color}" title="Chart color"></span><span><strong>${esc(label)}</strong><span class="small"> ${esc(sub)}</span></span></span>`;
					}
				},
				{ label: "Hits", html: (r) => String(r.hits ?? 0) },
				{
					label: `Active hours (${displayTz})`,
					html: (r) => et.visitorActiveHourLabels(r, dayStartMs).join(", ") || "—"
				},
				{ label: `Ranges (${displayTz})`, html: (r) => esc(et.formatRangesEt(r.ranges)) }
			],
			{ subgrid: true }
		),
		anonTableHtml: anonVisitorsTableHtml(anon, dayStartMs, et, displayTz),
		flushedNoteHtml,
		activeNowNoteHtml,
		copyScriptHtml: buildVisitPulsePageScriptHtml(summaryPayload, rawPayload)
	});
}

async function loadLiveFromRedis(dayKey) {
	const { buildDaySnapshotFromRedis, PULSE_ACTIVE_KEY, parseVisitorKey } = await import(
		"../../api_routes/utils/visitPulseCore.js"
	);
	const { Redis } = await import("@upstash/redis");
	const redis = Redis.fromEnv();
	const snapshot = await buildDaySnapshotFromRedis(dayKey, redis);
	const raw = await redis.zrange(PULSE_ACTIVE_KEY, 0, -1, { withScores: true });
	const activeNow = [];
	if (Array.isArray(raw)) {
		for (let i = 0; i < raw.length; i += 2) {
			if (!raw[i]) continue;
			activeNow.push({
				...parseVisitorKey(raw[i]),
				last_pulse_at: Number.isFinite(Number(raw[i + 1])) ? new Date(Number(raw[i + 1])).toISOString() : null
			});
		}
	}
	return { snapshot, activeNow };
}

function printReport({ dayKey, source, row, activeNow, blocksPerDay, blockMinutes, dayStartMs, tzLabel, et, asJson }) {
	const visitors = sortVisitors(row?.details?.visitors ?? []);
	const authed = visitors.filter((v) => v.user_id != null);
	const activeAuthedIds = new Set(
		(activeNow || []).filter((v) => v.user_id != null).map((v) => Number(v.user_id))
	);

	if (asJson) {
		console.log(JSON.stringify(buildVisitPulseRawPayload({ dayKey, source, row, activeNow, visitors }), null, 2));
		return;
	}

	const summary = buildVisitPulseRawPayload({ dayKey, source, row, activeNow, visitors }).summary;

	console.log(`Visit pulse — ${dayKey} (${tzLabel})  [${source}]`);
	console.log("");
	console.log(
		`Visitors: ${summary.unique_visitors}  (authed ${summary.authed_visitors}, anon ${summary.anon_visitors})`
	);
	console.log(`Hits (throttled pulses): ${summary.total_hits}`);
	console.log(`Active 15-min blocks: ${summary.total_active_blocks}`);
	if (summary.flushed_at) {
		console.log(
			`Flushed at: ${et.formatIso(summary.flushed_at)} (UTC ${et.formatUtcIso(summary.flushed_at)})`
		);
	}
	if (summary.active_now) console.log(`Active now (Redis): ${summary.active_now}`);
	console.log("");
	console.log(`Timeline: # = active 15-min block, · = idle (${blockMinutes}m blocks, ${tzLabel})`);
	console.log("");

	if (activeNow?.length) {
		console.log("--- Active now ---");
		for (const v of activeNow) {
			const label = v.user_id != null ? formatVisitorLine(v) : `anon ${String(v.client_id || "").slice(0, 8)}…`;
			console.log(`  ${label}  ${v.last_pulse_at || "?"}`);
		}
		console.log("");
	}

	if (authed.length) {
		console.log("--- Logged in ---");
		for (const v of authed) {
			const live = activeAuthedIds.has(Number(v.user_id)) ? "  [active now]" : "";
			console.log(`  ${formatVisitorLine(v)}  hits ${v.hits ?? 0}${live}`);
			console.log(`    ${et.formatRangesEt(v.ranges)}`);
		}
		console.log("");
	}

	if (!visitors.length) {
		console.log("No visitors for this day.");
		if (source === "db") {
			console.log("Run flush: node scripts/analytics/visit-pulse-flush.js --day " + dayKey);
		} else {
			console.log("Browse the site (middleware records pulses) or try --live after traffic.");
		}
		return;
	}

	const anonAndRest = visitors.filter((v) => v.user_id == null);
	if (anonAndRest.length) {
		console.log("--- Anonymous / other ---");
	}
	for (const v of anonAndRest) {
		const id = formatVisitorLine(v);
		console.log(`${pad(id, 36)} hits ${pad(v.hits ?? 0, 5)}`);
		console.log(`  ${renderTimeline(dayKey, v.ranges, blocksPerDay, blockMinutes, dayStartMs)}`);
		console.log(`  ${et.formatRangesEt(v.ranges)}`);
		console.log("");
	}
}

async function loadReportBundle() {
	const live = hasFlag("live");
	const {
		PULSE_BLOCK_MINUTES,
		PULSE_BLOCKS_PER_DAY,
		usEastDayKey,
		usEastDayStartMs,
		PULSE_DAY_PARTITION_LABEL,
		PULSE_TIMESTAMPS_TZ
	} = await import("../../api_routes/utils/visitPulseCore.js");
	const dayKey = getArg("day") || usEastDayKey();
	const dayStartMs = usEastDayStartMs(dayKey);
	const et = createEasternFormatters();
	const displayTz = et.tzAbbr(dayStartMs + 12 * 60 * 60 * 1000);
	const tzLabel = `${PULSE_DAY_PARTITION_LABEL}; display ${displayTz}; stored ${PULSE_TIMESTAMPS_TZ}`;
	const reportOpts = {
		blocksPerDay: PULSE_BLOCKS_PER_DAY,
		blockMinutes: PULSE_BLOCK_MINUTES,
		dayStartMs,
		tzLabel,
		displayTz
	};

	const finish = async (source, row, activeNow) => {
		const enriched = await enrichAuthedVisitors(row?.details?.visitors ?? [], activeNow);
		const visitors = enriched.visitors;
		const stack = buildHourlyStackSeries(visitors, dayStartMs);
		return {
			dayKey,
			source,
			row: row ? { ...row, details: { ...row.details, visitors } } : { details: { visitors: [] } },
			activeNow: enriched.activeNow,
			visitors,
			stack,
			et,
			displayTz,
			...reportOpts
		};
	};

	if (live) {
		const { snapshot, activeNow } = await loadLiveFromRedis(dayKey);
		return finish("redis-live", snapshot, activeNow);
	}

	let row = null;
	try {
		row = await loadFromDb(dayKey);
	} catch (err) {
		console.error("[visit-pulse-report] DB:", err?.message || err);
	}

	if (row) {
		return finish("db", row, []);
	}

	const today = usEastDayKey();
	if (dayKey === today) {
		try {
			const { snapshot, activeNow } = await loadLiveFromRedis(dayKey);
			if (snapshot.unique_visitors > 0) {
				return finish("redis-live (not flushed)", snapshot, activeNow);
			}
		} catch (err) {
			console.error("[visit-pulse-report] Redis:", err?.message || err);
		}
	}

	return finish("none", { details: { visitors: [] } }, []);
}

async function main() {
	const asJson = hasFlag("json");
	const asHtml = hasFlag("html");
	const bundle = await loadReportBundle();

	if (asHtml) {
		const out =
			getArg("out") ||
			process.env.OUT ||
			path.join(REPO_ROOT, ".output", "visit-pulse", `visit-pulse-${bundle.dayKey}.html`);
		await fs.mkdir(path.dirname(out), { recursive: true });
		await fs.writeFile(out, await renderVisitPulseHtml(bundle), "utf8");
		console.log(out);
		return;
	}

	printReport({
		dayKey: bundle.dayKey,
		source: bundle.source,
		row: bundle.row,
		activeNow: bundle.activeNow,
		blocksPerDay: bundle.blocksPerDay,
		blockMinutes: bundle.blockMinutes,
		dayStartMs: bundle.dayStartMs,
		tzLabel: bundle.tzLabel,
		et: bundle.et,
		asJson
	});
}

main().catch((err) => {
	console.error("[visit-pulse-report]", err?.message || err);
	process.exit(1);
});
