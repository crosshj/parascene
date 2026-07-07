/**
 * Overview report — static app (ES module).
 *
 * Served over http://localhost:2367/reports/ (dev only). Imports the shared
 * metric/chart math from ./metrics.js and fetches the local store (./store.json,
 * refreshed by overview-refresh.js). The HTML never changes; only the store does.
 */
import * as M from "./metrics.js";

(async function () {
	"use strict";

	const view = document.getElementById("view");
	const controls = document.getElementById("controls");
	const metaLine = document.getElementById("meta-line");
	const tabsEl = document.getElementById("tabs");
	const ignoreBar = document.getElementById("ignore-bar");

	const baseStore = await fetch(new URL("./store.json", import.meta.url))
		.then((r) => (r.ok ? r.json() : null))
		.catch(() => null);
	let store = baseStore; // active view — reassigned to the ignore-filtered store.

	if (!store || !store.meta) {
		metaLine.textContent = "";
		view.innerHTML = errorBox(
			"No data store found",
			"Run <code>node scripts/analytics/overview-refresh.js</code>, then reload this page."
		);
		return;
	}

	/* ------------------------------------------------------------ */
	/* Formatting helpers.                                          */
	/* ------------------------------------------------------------ */

	function esc(s) {
		return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
	}
	const fmt1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : "0.0");
	const fmt2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");
	const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "0.0%");
	const pctOf = (r) => `${(r * 100).toFixed(1)}%`;
	const int = (n) => String(Math.round(Number(n) || 0));

	function statGrid(cards) {
		return `<div class="stats">${cards
			.map((c) => `<div class="stat"><strong>${esc(c.value)}</strong><span>${esc(c.label)}</span></div>`)
			.join("")}</div>`;
	}

	function chart(title, svg, note) {
		return `<div class="block"><div class="block-title">${esc(title)}</div>${svg}${
			note ? `<p class="small block-note">${note}</p>` : ""
		}</div>`;
	}

	/* Sparkline with a visible linear-regression slope noted under the graph. */
	function trendChart(title, rows, valueKey, labelKey, color, unit) {
		const svg = M.sparkline(rows, valueKey, labelKey, color, { showTrend: true });
		let note = "";
		if (rows && rows.length >= 2) {
			const slope = M.linearRegression(rows.map((r) => Number(r[valueKey]) || 0)).slope;
			const sign = slope > 0 ? "+" : "";
			note = `Trend (linear fit): ${sign}${fmt2(slope)} ${unit}`;
		}
		return chart(title, svg, note);
	}

	function tableHtml(rows, cols) {
		if (!rows.length) return '<p class="small">None.</p>';
		const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join("");
		const body = rows
			.map((r) => `<tr>${cols.map((c) => `<td>${c.html ? c.html(r) : esc(r[c.key])}</td>`).join("")}</tr>`)
			.join("");
		return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
	}

	function errorBox(title, body) {
		return `<div class="card card-lg"><h2>${esc(title)}</h2><p>${body}</p></div>`;
	}

	/** Handle-only display for a user: "@name", else "user <id>". Never the display name. */
	function userHandle(u, id) {
		if (u && u.userName) return "@" + u.userName;
		return "user " + (u ? u.id : id);
	}

	function userMeta(id) {
		return (baseStore.users || []).find((x) => x.id === id) || (baseStore.userHandles || []).find((x) => x.id === id) || null;
	}

	function userLabelMap() {
		const m = new Map();
		for (const u of baseStore.users || []) m.set(u.id, userHandle(u));
		for (const u of baseStore.userHandles || []) {
			if (!m.has(u.id)) m.set(u.id, userHandle(u, u.id));
		}
		return m;
	}
	const LABELS = userLabelMap();

	/* ------------------------------------------------------------ */
	/* Ignore users (persisted, applies to every metric).           */
	/* ------------------------------------------------------------ */

	/* One persisted blob: active tab, per-tab control settings, ignored users. */
	const STATE_KEY = "overview.state";
	const LEGACY_IGNORE_KEY = "overview.ignoredUserNames";

	function loadPersisted() {
		try {
			const o = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
			return o && typeof o === "object" ? o : {};
		} catch (_e) {
			return {};
		}
	}
	function persistState() {
		try {
			localStorage.setItem(
				STATE_KEY,
				JSON.stringify({
					tab: state.tab,
					day: state.day,
					week: state.week,
					month: state.month,
					from: state.from,
					to: state.to,
					ignoredNames
				})
			);
		} catch (_e) {
			/* private mode — keep in-memory only */
		}
	}

	const persisted = loadPersisted();

	function loadIgnoredNames() {
		if (Array.isArray(persisted.ignoredNames)) return persisted.ignoredNames.filter((x) => typeof x === "string");
		try {
			const legacy = JSON.parse(localStorage.getItem(LEGACY_IGNORE_KEY) || "[]");
			return Array.isArray(legacy) ? legacy.filter((x) => typeof x === "string") : [];
		} catch (_e) {
			return [];
		}
	}

	let ignoredNames = loadIgnoredNames();

	/** Resolve typed names/handles/ids to user ids from the full user set. */
	function resolveIgnoredIds() {
		const set = new Set();
		const names = ignoredNames.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
		if (!names.length) return set;
		for (const u of baseStore.users || []) {
			const label = String(u.label || "").toLowerCase();
			const handle = String(u.userName || "").toLowerCase();
			for (const nm of names) {
				const bare = nm.replace(/^@/, "");
				if (nm === label || (handle && (bare === handle || nm === "@" + handle)) || bare === String(u.id)) {
					set.add(u.id);
					break;
				}
			}
		}
		for (const u of baseStore.userHandles || []) {
			const handle = String(u.userName || "").toLowerCase();
			for (const nm of names) {
				const bare = nm.replace(/^@/, "");
				if ((handle && (bare === handle || nm === "@" + handle)) || bare === String(u.id)) {
					set.add(u.id);
					break;
				}
			}
		}
		return set;
	}

	/** Immutable filtered view: drops ignored users from users, userDay, and visit presence. */
	function buildFilteredStore(base, ignoredIds) {
		if (!ignoredIds.size) return base;
		const users = (base.users || []).filter((u) => !ignoredIds.has(u.id));
		const userDay = (base.userDay || []).filter((r) => !ignoredIds.has(r.u));
		const visitDaily = (base.visitDaily || []).map((r) => {
			const keys = (r.visitorKeys || []).filter((k) => !(k.startsWith("u:") && ignoredIds.has(Number(k.slice(2)))));
			const authed = (r.authed || []).filter((a) => !ignoredIds.has(a.id));
			if (keys.length === (r.visitorKeys || []).length && authed.length === (r.authed || []).length) return r;
			return { ...r, visitorKeys: keys, authed, authedVisitors: authed.length, anonVisitors: keys.length - authed.length, uniqueVisitors: keys.length };
		});
		// Challenge rows carry user ids, so ignore-users filters submitters/voters.
		// (transitionsDaily/Top carry no user id and are left unfiltered — see caveat note.)
		const challengeSubs = (base.challengeSubs || []).filter((r) => !ignoredIds.has(r.u));
		const challengeVotes = (base.challengeVotes || []).filter((r) => !ignoredIds.has(r.u) && !ignoredIds.has(r.to));
		return { ...base, users, userDay, visitDaily, challengeSubs, challengeVotes };
	}

	function applyIgnore() {
		store = buildFilteredStore(baseStore, resolveIgnoredIds());
	}

	function renderIgnoreBar() {
		const ids = resolveIgnoredIds();
		const known = [
			...new Set(
				[...(baseStore.users || []), ...(baseStore.userHandles || [])]
					.map((u) => (u.userName ? "@" + u.userName : null))
					.filter(Boolean)
			)
		].sort((a, b) => a.localeCompare(b));
		const chips = ignoredNames.length
			? ignoredNames
					.map((name, i) => `<span class="pill">${esc(name)}<a href="#" data-ig-rm="${i}" title="Remove">×</a></span>`)
					.join("")
			: '<span class="small">none</span>';
		const unmatched = ignoredNames.length - ids.size;
		ignoreBar.innerHTML = `${chips}
			<input id="ig-input" list="ig-known" placeholder="name, @handle, or id" />
			<datalist id="ig-known">${known.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
			<button id="ig-add">Add</button>
			<span class="small">${ids.size} matched${unmatched > 0 ? ` · ${unmatched} unmatched` : ""}</span>`;

		const input = document.getElementById("ig-input");
		const add = () => {
			const val = String(input.value || "").trim();
			if (val && !ignoredNames.some((n) => n.toLowerCase() === val.toLowerCase())) {
				ignoredNames.push(val);
				commitIgnore();
			}
		};
		document.getElementById("ig-add").addEventListener("click", add);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				add();
			}
		});
		for (const rm of ignoreBar.querySelectorAll("[data-ig-rm]")) {
			rm.addEventListener("click", (e) => {
				e.preventDefault();
				ignoredNames.splice(Number(rm.getAttribute("data-ig-rm")), 1);
				commitIgnore();
			});
		}
	}

	function commitIgnore() {
		applyIgnore();
		persistState();
		renderIgnoreBar();
		render();
		refreshMeta();
	}

	/* ------------------------------------------------------------ */
	/* Shared derived helpers.                                      */
	/* ------------------------------------------------------------ */

	function visitDaysByUser(from, to) {
		const m = new Map();
		for (const r of M.visitDaysInRange(store, from, to)) {
			for (const k of r.visitorKeys || []) {
				if (!k.startsWith("u:")) continue;
				const id = Number(k.slice(2));
				if (!m.has(id)) m.set(id, new Set());
				m.get(id).add(r.day);
			}
		}
		return m;
	}

	function distinctByType(from, to, type) {
		const s = new Set();
		for (const r of M.userDaysInRange(store, from, to)) if (Number(r.c?.[type]) > 0) s.add(r.u);
		return s;
	}

	function actionMixCard(from, to) {
		const mix = M.actionMix(store, from, to);
		const total = Object.values(mix).reduce((s, n) => s + n, 0) || 1;
		const rows = Object.entries(mix)
			.sort((a, b) => b[1] - a[1])
			.map(([type, count]) => ({ type, count, share: pct(count, total) }));
		return `<div class="block"><div class="block-title">Action mix</div>${tableHtml(rows, [
			{ label: "Action", key: "type" },
			{ label: "Count", key: "count" },
			{ label: "Share", key: "share" }
		])}</div>`;
	}

	function leadersCard(from, to, limit) {
		const leaders = M.engagementLeaders(store, from, to).slice(0, limit || 12);
		return `<div class="block"><div class="block-title">Engagement leaders</div>${tableHtml(leaders, [
			{
				label: "User",
				html: (r) => `<strong>${esc(r.user_name ? "@" + r.user_name : "user " + r.user_id)}</strong>`
			},
			{ label: "Core", key: "core_actions" },
			{ label: "Days", key: "active_days" },
			{ label: "Per day", html: (r) => fmt2(r.actions_per_active_day) },
			{ label: "Creates", html: (r) => int(r.mix.creation) },
			{ label: "Comments", html: (r) => int(r.mix.comment) },
			{ label: "Likes", html: (r) => int(r.mix.like) }
		])}</div>`;
	}

	function funnelCard(from, to) {
		const f = M.funnelTotals(store, from, to);
		return `<div class="block"><div class="block-title">Anonymous share → try funnel</div>${tableHtml(
			[
				{ stage: "Share page views", count: f.shareViews, rate: "100%" },
				{ stage: "Try requests", count: f.tryRequests, rate: pct(f.tryRequests, f.shareViews) },
				{ stage: "Transitioned to user", count: f.transitionedUsers, rate: pct(f.transitionedUsers, f.tryRequests) }
			],
			[
				{ label: "Stage", key: "stage" },
				{ label: "Count", key: "count" },
				{ label: "Vs prev", key: "rate" }
			]
		)}<p class="small section-note">Volume sums over the range; unique-cid dedup is per-day.</p></div>`;
	}

	function relatedBrowsingCard(from, to, { showTop = false } = {}) {
		const series = M.transitionPathsSeries(store, from, to);
		const total = M.transitionPathsTotal(store, from, to);
		if (!total && !(store.transitionsDaily || []).length) return "";
		let slopeNote = "";
		if (series.length >= 2) {
			const slope = M.linearRegression(series.map((r) => Number(r.paths) || 0)).slope;
			slopeNote = `Trend (linear fit): ${slope > 0 ? "+" : ""}${fmt2(slope)} paths/day. `;
		}
		const trend = chart(
			"Related browsing (paths touched)",
			M.sparkline(series, "paths", "day", "#7c3aed", { showTrend: true }),
			`${slopeNote}Logged-in related-grid clicks. Daily value = paths whose latest click landed that day (a proxy, not exact daily volume). Not affected by ignored users.`
		);
		let top = "";
		if (showTop) {
			const rows = M.transitionTopInRange(store, from, to, 15);
			top = rows.length
				? `<div class="block"><div class="block-title">Top related paths (most recent click in range)</div>${tableHtml(rows, [
						{ label: "From", html: (r) => `<a href="/creations/${r.from}">${esc(r.fromLabel)}</a>` },
						{ label: "To", html: (r) => `<a href="/creations/${r.to}">${esc(r.toLabel)}</a>` },
						{ label: "Clicks", key: "count" },
						{ label: "Last click", key: "lastDay" }
					])}</div>`
				: "";
		}
		return trend + top;
	}

	function feedEngagementCard(from, to, { compact = false } = {}) {
		const totals = M.feedImpressionTotals(store, from, to);
		if (!totals.daysWithData) {
			if (compact) return "";
			return `<div class="block"><div class="block-title">Feed engagement</div><p class="small">No feed impressions in this range.</p></div>`;
		}
		const stats = statGrid([
			{ value: int(totals.total), label: "Feed impressions" },
			{ value: int(totals.dwell), label: "Dwell (scrolled)" },
			{ value: int(totals.click), label: "Click" },
			{ value: pctOf(totals.clickRate), label: "Click rate" },
			{ value: int(totals.peakImpressors), label: "Peak impressors/day" },
			{ value: int(totals.peakCreations), label: "Peak creations/day" }
		]);
		if (compact) {
			return `<div class="block"><div class="block-title">Feed engagement</div>${stats}<p class="small block-note">Logged-in feed-beta impressions (dwell = scrolled into view, click = tapped).</p></div>`;
		}
		const series = M.feedImpressionSeries(store, from, to);
		let slopeNote = "";
		if (series.length >= 2) {
			const slope = M.linearRegression(series.map((r) => Number(r.total) || 0)).slope;
			slopeNote = `Trend (linear fit): ${slope > 0 ? "+" : ""}${fmt2(slope)} impressions/day. `;
		}
		const trend = chart(
			"Feed engagement",
			M.sparkline(series, "total", "day", "#7c3aed", { showTrend: true }),
			`${slopeNote}Logged-in feed-beta impressions only (dwell = scrolled into view, click = tapped). Unique impressors/creations are per-day peaks, not range-distinct. Aggregate-only, so ignored users aren't subtracted.`
		);
		return `${trend}<div class="block">${stats}</div>`;
	}

	/* Lay two cards side by side; drop empties, and go full width if only one. */
	function inlinePair(a, b) {
		const items = [a, b].filter(Boolean);
		if (!items.length) return "";
		if (items.length === 1) return `<section>${items[0]}</section>`;
		return `<section class="grid-2">${items.map((c) => `<div>${c}</div>`).join("")}</section>`;
	}

	/* Wrap a single card in its own <section>, or "" when empty. */
	function sectionIf(card) {
		return card ? `<section>${card}</section>` : "";
	}

	function challengeCard(from, to) {
		const list = M.challengesInRange(store, from, to);
		const subsSeries = M.challengeSubmissionsSeries(store, from, to);
		const subsTotal = subsSeries.reduce((s, r) => s + r.submissions, 0);
		if (!list.length && !subsTotal) return "";
		const trend = subsTotal
			? chart("Challenge submissions by day", M.barChart(subsSeries, "submissions", "day", "#0891b2"))
			: "";
		const table = list.length
			? `<div class="block"><div class="block-title">Challenges active in range (${list.length})</div>${tableHtml(list, [
					{ label: "Challenge", html: (r) => `<strong>${esc(r.title)}</strong> <span class="small">${esc(r.phase)}</span>` },
					{ label: "Window", html: (r) => (r.subStartDay ? `${esc(r.subStartDay)}${r.voteEndDay ? " → " + esc(r.voteEndDay) : ""}` : "—") },
					{ label: "Subs", key: "submissions" },
					{ label: "Submitters", html: (r) => `${r.uniqueSubmitters}${r.submitterRate != null ? ` <span class="small">${pctOf(r.submitterRate)}</span>` : ""}` },
					{ label: "Votes", key: "totalVotes" },
					{ label: "Voters", html: (r) => `${r.uniqueVoters}${r.voterRate != null ? ` <span class="small">${pctOf(r.voterRate)}</span>` : ""}` }
				])}<p class="small section-note">Submitter/voter rates are vs #challenges channel members. Vote totals are lifetime (vote timestamps aren't stored). Ignored users excluded.</p></div>`
			: "";
		return trend + table;
	}

	function heatmapCard(from, to) {
		const authed = M.weekdayHourHeatmap(store, from, to, { series: "authed" });
		const anon = M.weekdayHourHeatmap(store, from, to, { series: "anon" });
		if (!authed.max && !anon.max) {
			return chart("Traffic rhythm (weekday × hour)", '<p class="small">No traffic data in range.</p>');
		}
		const one = (data, title, rgb, note) =>
			chart(
				title,
				data.max ? M.heatmapSvg(data, { label: title, rgb }) : '<p class="small">No data.</p>',
				note
			);
		return `<div class="grid-2">
			${one(authed, "Logged-in traffic rhythm (weekday × hour)", "180,83,9", "Logged-in visitors present per US-East hour. Darker = busier.")}
			${one(anon, "Anonymous traffic rhythm (weekday × hour)", "100,116,139", "Anonymous visitors present per US-East hour. Darker = busier.")}
		</div>`;
	}

	function cohortCard(from, to) {
		const cohorts = M.cohortRetention(store, from, to);
		return `<div class="block"><div class="block-title">Retention by signup-week cohort</div>${tableHtml(cohorts, [
			{ label: "Cohort", key: "cohort_label" },
			{ label: "Signups", key: "signups" },
			{ label: "W+1", html: (r) => `${r.w1_retained} · ${pctOf(r.w1_rate)}` },
			{ label: "W+4", html: (r) => `${r.w4_retained} · ${pctOf(r.w4_rate)}` }
		])}</div>`;
	}

	/* Milestone: "stable small room" for a window whose latest week is the scorecard week. */
	function milestoneCard(from, to) {
		const T = M.STABLE_ROOM.targets;
		const weekly = M.weeklyActiveSeries(store, from, to);
		if (!weekly.length) return "";
		const latest = weekly[weekly.length - 1];
		const wkFrom = latest.week;
		const wkEndFull = M.shiftDayKey(latest.week, 6);
		const wkTo = wkEndFull < to ? wkEndFull : to;
		const visitWau = M.visitActiveUsers(store, wkFrom, wkTo).size;
		const dau = M.actionDauSeries(store, wkFrom, wkTo).map((r) => r.dau);
		const avgActionDau = M.avg(dau);
		const highDays = dau.filter((v) => v >= T.avg_action_dau).length;
		const commenters = distinctByType(wkFrom, wkTo, "comment").size;
		const publishers = distinctByType(wkFrom, wkTo, "publish").size;
		const vdbu = visitDaysByUser(from, to);
		const visitMau = vdbu.size;
		const returning = [...vdbu.values()].filter((s) => s.size >= 2).length;
		const returningRate = M.pctRatio(returning, visitMau);
		const top2 = M.top2ActionShare(store, from, to).share;
		let streak = 0, best = 0;
		for (const w of weekly) {
			if (w.wau >= T.action_wau) { streak++; best = Math.max(best, streak); } else streak = 0;
		}
		const crit = [
			mk("Action WAU (latest week)", latest.wau, T.action_wau, "gte"),
			mk("Visit WAU (latest week)", visitWau, T.visit_wau, "gte"),
			mk("Avg action DAU (latest week)", avgActionDau, T.avg_action_dau, "gte"),
			mk(`Days action DAU ≥ ${T.avg_action_dau}`, highDays, T.high_action_days, "gte"),
			mk("Distinct commenters (latest week)", commenters, T.commenters, "gte"),
			mk("Distinct publishers (latest week)", publishers, T.publishers, "gte"),
			mk("Returning logged-in (2+ visit days ÷ visit MAU)", returningRate, T.returning_visit_rate, "gte", true),
			mk("Top-2 users' share of core actions", top2, T.top2_action_share_max, "lte", true),
			mk("Consecutive weeks action WAU ≥ 20", best, T.action_wau_streak_weeks, "gte")
		];
		const met = crit.filter((c) => c.met).length;
		const rows = crit
			.map(
				(c) => `<tr class="${c.met ? "milestone-met" : ""}"><td>${esc(c.label)}</td><td>${esc(c.current)}</td><td>${esc(
					c.target
				)}</td><td><div class="milestone-bar${c.met ? " is-met" : ""}"><span style="width:${c.pct}%"></span></div></td><td>${
					c.met ? "Met" : "Not yet"
				}</td></tr>`
			)
			.join("");
		return `<section class="milestone-section"><h2>Milestone: Stable small room</h2>
			<p class="milestone-summary"><strong>${met} of ${crit.length} criteria met</strong> · latest week ${esc(latest.week_label)}</p>
			<table class="milestone-table"><thead><tr><th>Criterion</th><th>Current</th><th>Target</th><th>Progress</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></section>`;

		function mk(label, value, target, compare, isRate) {
			const num = Number(value);
			let met, p;
			if (compare === "gte") {
				met = num >= target;
				p = target > 0 ? Math.min(100, Math.round((num / target) * 100)) : met ? 100 : 0;
			} else {
				met = num <= target;
				p = met ? 100 : target > 0 ? Math.max(0, Math.round(100 - ((num - target) / target) * 100)) : 0;
			}
			const current = isRate ? pctOf(num) : Number.isInteger(num) ? String(num) : fmt1(num);
			const targetLabel = isRate ? pctOf(target) : String(target);
			return {
				label,
				current,
				target: `${compare === "lte" ? "≤" : "≥"} ${targetLabel}`,
				met,
				pct: Math.max(0, Math.min(100, p))
			};
		}
	}

	/* ------------------------------------------------------------ */
	/* Tab renderers.                                               */
	/* ------------------------------------------------------------ */

	function renderToday(day) {
		const vd = (store.visitDaily || []).find((r) => r.day === day);
		const dauToday = M.actionDauSeries(store, day, day)[0]?.dau || 0;
		const peak = vd ? peakHour(vd.hourlyAuthed, vd.hourlyAnon) : { h: 0, n: 0 };

		const stats = statGrid([
			{ value: int(vd?.uniqueVisitors), label: "Unique visitors" },
			{ value: int(vd?.authedVisitors), label: "Logged-in" },
			{ value: int(vd?.anonVisitors), label: "Anonymous" },
			{ value: int(vd?.hits), label: "Hits" },
			{ value: dauToday, label: "Action DAU" },
			{ value: peak.n ? `${peak.h}:00 · ${peak.n}` : "—", label: "Peak hour" }
		]);

		const charts = vd
			? `<div class="grid-2">${chart("Logged-in present by hour", M.hourBars(vd.hourlyAuthed, "#b45309"))}${chart(
					"Anonymous present by hour",
					M.hourBars(vd.hourlyAnon, "#94a3b8")
			  )}</div>`
			: '<p class="small">No visit-pulse snapshot for today yet (run refresh with Redis available).</p>';

		const named = authedVisitorsCard(vd, day);
		const feed = feedEngagementCard(day, day, { compact: true });

		return `<section>
			<p class="small section-note">Live snapshot as of last refresh (${esc(fmtWhen(store.meta.lastRefresh))}). Rollup tabs end ${esc(store.meta.lastCompleteDay)}.</p>
			${stats}
		</section>
		<section>${charts}</section>
		<section class="grid-2">${named}${actionMixCard(day, day)}</section>
		${feed ? `<section>${feed}</section>` : ""}`;
	}

	function renderWeek(weekStart) {
		const from = weekStart;
		const weekEnd = M.shiftDayKey(weekStart, 6);
		const to = weekEnd < store.meta.lastCompleteDay ? weekEnd : store.meta.lastCompleteDay;
		const actionWau = M.actionActiveUsers(store, from, to).size;
		const visitWau = M.visitActiveUsers(store, from, to).size;
		const trafficWau = M.trafficVisitorKeys(store, from, to).size;
		const perActive = M.actionsPerActiveUser(store, from, to);
		const activation = M.pctRatio(actionWau, visitWau);
		const dau = M.actionDauSeries(store, from, to);
		const traffic = M.trafficDauSeries(store, from, to);

		const stats = statGrid([
			{ value: actionWau, label: "Action WAU" },
			{ value: visitWau, label: "Visit WAU" },
			{ value: int(trafficWau), label: "Traffic WAU" },
			{ value: M.newUsersInRange(store, from, to), label: "New signups" },
			{ value: pctOf(activation), label: "Activation" },
			{ value: fmt2(perActive.perActive), label: "Actions/active" }
		]);

		return `<section>
			${to < weekEnd ? `<p class="small section-note">Partial week — data through ${esc(to)} (today excluded from rollups).</p>` : ""}
			${stats}
		</section>
		<section class="grid-2">
			${trendChart("Action DAU (this week)", dau, "dau", "day", "#0f766e", "DAU/day")}
			${trendChart("Traffic DAU (this week)", traffic, "traffic_dau", "day", "#64748b", "visitors/day")}
		</section>
		<section class="grid-2">${actionMixCard(from, to)}${leadersCard(from, to, 8)}</section>
		<section>${heatmapCard(from, to)}</section>
		${inlinePair(feedEngagementCard(from, to), relatedBrowsingCard(from, to))}
		${sectionIf(challengeCard(from, to))}
		${milestoneCard(from, to)}`;
	}

	function renderMonth(monthStart) {
		const from = monthStart;
		const monthEnd = monthEndOf(monthStart);
		const to = monthEnd < store.meta.lastCompleteDay ? monthEnd : store.meta.lastCompleteDay;
		const actionMau = M.actionActiveUsers(store, from, to).size;
		const visitMau = M.visitActiveUsers(store, from, to).size;
		const trafficMau = M.trafficVisitorKeys(store, from, to).size;
		const dau = M.actionDauSeries(store, from, to);
		const traffic = M.trafficDauSeries(store, from, to);
		const newByDay = M.newUsersByDay(store, from, to);
		const churn = M.churnSplit(store, from, to);
		const funnel = M.signupFunnel(store, from, to);

		const stats = statGrid([
			{ value: fmt1(M.avg(dau.map((r) => r.dau))), label: "Avg action DAU" },
			{ value: fmt1(M.avg(traffic.map((r) => r.traffic_dau))), label: "Avg traffic DAU" },
			{ value: actionMau, label: "Action MAU" },
			{ value: visitMau, label: "Visit MAU" },
			{ value: int(trafficMau), label: "Traffic MAU" },
			{ value: pct(actionMau, visitMau), label: "Activation" }
		]);

		const funnelTable = tableHtml(
			[
				{ stage: "New signups", count: funnel.signups, rate: "100%" },
				{ stage: "Activated ≤7d", count: funnel.activated, rate: pct(funnel.activated, funnel.signups) },
				{ stage: "Retained days 8–30", count: funnel.retained, rate: pct(funnel.retained, funnel.signups) },
				{ stage: "Paid (snapshot)", count: funnel.paid, rate: pct(funnel.paid, funnel.signups) }
			],
			[
				{ label: "Stage", key: "stage" },
				{ label: "Users", key: "count" },
				{ label: "Vs signups", key: "rate" }
			]
		);

		return `<section>
			<p class="small section-note">${esc(from)} → ${esc(to)}. Churn: ${churn.churned} of ${churn.prevActive} first-half active users did not return in the second half (${pct(
				churn.churned,
				churn.prevActive
			)}).</p>
			${stats}
		</section>
		<section class="grid-2">
			${trendChart("Action DAU", dau, "dau", "day", "#0f766e", "DAU/day")}
			${chart("New signups by day", M.barChart(newByDay, "new_users", "day", "#d97706"))}
		</section>
		<section class="grid-2">${actionMixCard(from, to)}<div class="block"><div class="block-title">Signup funnel</div>${funnelTable}</div></section>
		<section class="grid-2">${cohortCard(from, to)}${funnelCard(from, to)}</section>
		<section>${heatmapCard(from, to)}</section>
		${inlinePair(feedEngagementCard(from, to), relatedBrowsingCard(from, to))}
		${sectionIf(challengeCard(from, to))}
		<section>${leadersCard(from, to, 15)}</section>
		${milestoneCard(from, to)}`;
	}

	function renderInception(from, to) {
		const dau = M.actionDauSeries(store, from, to);
		const traffic = M.trafficDauSeries(store, from, to);
		const weekly = M.weeklyActiveSeries(store, from, to);
		const monthly = M.monthlyActiveSeries(store, from, to);
		const newByWeekMap = new Map();
		for (const u of store.users || []) {
			if (u.signupDay < from || u.signupDay > to) continue;
			const wk = M.usEastWeekStartKey(u.signupDay);
			newByWeekMap.set(wk, (newByWeekMap.get(wk) || 0) + 1);
		}
		const weeks = M.enumerateDays(M.usEastWeekStartKey(from), M.usEastWeekStartKey(to)).filter((d) => M.usEastWeekStartKey(d) === d);
		let cum = 0;
		const newByWeek = weeks.map((wk) => {
			const nu = newByWeekMap.get(wk) || 0;
			cum += nu;
			return { week: wk, new_users: nu, total_users: cum };
		});

		const actionMau = M.actionActiveUsers(store, from, to).size;
		const visitDistinct = M.visitActiveUsers(store, from, to).size;
		const trafficDistinct = M.trafficVisitorKeys(store, from, to).size;
		const signups = M.newUsersInRange(store, from, to);
		const perActive = M.actionsPerActiveUser(store, from, to);

		const stats = statGrid([
			{ value: signups, label: "Signups in range" },
			{ value: actionMau, label: "Action-active users" },
			{ value: visitDistinct, label: "Logged-in visitors" },
			{ value: int(trafficDistinct), label: "Traffic (distinct)" },
			{ value: fmt1(M.avg(dau.map((r) => r.dau))), label: "Avg action DAU" },
			{ value: fmt2(perActive.perActive), label: "Actions/active" }
		]);

		const proj = projectMilestone(weekly);

		return `<section>
			<p class="small section-note">Range ${esc(from)} → ${esc(to)}. Adjust the dates above; every graph and stat recomputes.</p>
			${stats}
			<p class="section-note">${proj}</p>
		</section>
		<section class="grid-2">
			${trendChart("Action DAU (all days in range)", dau, "dau", "day", "#0ea5e9", "DAU/day")}
			${trendChart("Action WAU (weekly)", weekly, "wau", "week", "#2563eb", "WAU/week")}
		</section>
		<section class="grid-2">
			${chart("Action MAU (monthly)", M.barChart(monthly, "mau", "month", "#7c3aed"))}
			${chart("New users by week", M.barChart(newByWeek, "new_users", "week", "#d97706"))}
		</section>
		<section class="grid-2">
			${chart("Total users (cumulative)", M.sparkline(newByWeek, "total_users", "week", "#059669"))}
			${trendChart("Traffic DAU", traffic, "traffic_dau", "day", "#64748b", "visitors/day")}
		</section>
		<section>${heatmapCard(from, to)}</section>
		${inlinePair(feedEngagementCard(from, to), relatedBrowsingCard(from, to, { showTop: true }))}
		${sectionIf(challengeCard(from, to))}
		<section>${cohortCard(from, to)}</section>`;
	}

	/* ------------------------------------------------------------ */
	/* Projections + small utils.                                   */
	/* ------------------------------------------------------------ */

	function projectMilestone(weekly) {
		const target = M.STABLE_ROOM.targets.action_wau;
		if (weekly.length < 2) return "Not enough weeks in range to project a trend.";
		const values = weekly.map((w) => w.wau);
		const lr = M.linearRegression(values);
		const latest = values[values.length - 1];
		const slopeText = lr.slope > 0 ? `+${lr.slope.toFixed(2)}` : lr.slope.toFixed(2);
		if (latest >= target) return `Action WAU trend ${slopeText}/week; already at/above the stable-room target (${target}).`;
		if (lr.slope <= 0) return `Action WAU trend ${slopeText}/week — flat/declining, so the stable-room target (${target}) is not on track in this range.`;
		const weeksToTarget = Math.ceil((target - latest) / lr.slope);
		return `Action WAU trend ${slopeText}/week → ~${weeksToTarget} week(s) to the stable-room target (${target} WAU) at this pace.`;
	}

	function peakHour(a, b) {
		let h = 0, n = 0;
		for (let i = 0; i < 24; i++) {
			const t = (Number(a?.[i]) || 0) + (Number(b?.[i]) || 0);
			if (t > n) { n = t; h = i; }
		}
		return { h, n };
	}

	function monthEndOf(monthStart) {
		const [y, m] = monthStart.split("-").map(Number);
		const nextMonthStart = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
		return M.shiftDayKey(nextMonthStart, -1);
	}

	function monthLabel(monthStart) {
		const [y, m] = monthStart.split("-").map(Number);
		return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
	}

	function fmtWhen(iso) {
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? "?" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
	}

	/** Partition hour index → short wall label (6a, 12p, …) — US-East partition convention. */
	function hourShortLabel(hour, dayKey) {
		const ms = M.usEastDayStartMs(dayKey) + hour * 60 * 60 * 1000;
		const parts = new Intl.DateTimeFormat("en-US", {
			hour: "numeric",
			hour12: true,
			timeZone: "America/New_York"
		}).formatToParts(new Date(ms));
		const h = Number(parts.find((p) => p.type === "hour")?.value);
		const dp = String(parts.find((p) => p.type === "dayPeriod")?.value || "").toLowerCase();
		if (!Number.isFinite(h) || !dp) return `${hour}:00`;
		if (h === 12 && dp === "am") return "12a";
		if (h === 12 && dp === "pm") return "12p";
		if (dp === "am") return `${h}a`;
		return `${h}p`;
	}

	function activeHourLabels(hours, dayKey) {
		return (hours || []).map((h) => hourShortLabel(h, dayKey)).join(", ");
	}

	function authedVisitorsCard(vd, day) {
		const rows = (vd?.authed || []).map((a) => ({
			...a,
			label: userHandle(userMeta(a.id), a.id)
		}));
		if (!rows.length) return "";
		return `<div class="block"><div class="block-title">Logged-in visitors (${rows.length})</div>${tableHtml(rows, [
			{ label: "User", html: (r) => `<strong>${esc(r.label)}</strong>` },
			{ label: "Hits", key: "hits" },
			{ label: "Active hours", html: (r) => activeHourLabels(r.hours, day) || "—" }
		])}</div>`;
	}

	/* ------------------------------------------------------------ */
	/* Copy-for-LLM: serialize the current view to Markdown / JSON. */
	/* ------------------------------------------------------------ */

	const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
	const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
	const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
	const handleOf = (id) => userHandle(userMeta(id), id);

	/** Resolve the active tab's tab-name + inclusive date range (clamped like the render path). */
	function currentRange() {
		if (state.tab === "today") return { tab: "Daily", from: state.day, to: state.day, label: state.day };
		if (state.tab === "week") {
			const end = M.shiftDayKey(state.week, 6);
			const to = end < lastComplete ? end : lastComplete;
			return { tab: "Weekly", from: state.week, to, label: `${state.week} → ${to}` };
		}
		if (state.tab === "month") {
			const end = monthEndOf(state.month);
			const to = end < lastComplete ? end : lastComplete;
			return { tab: "Monthly", from: state.month, to, label: monthLabel(state.month) };
		}
		return { tab: "Time Range", from: state.from, to: state.to, label: `${state.from} → ${state.to}` };
	}

	function mixWithShares(mix) {
		const total = Object.values(mix).reduce((s, v) => s + (Number(v) || 0), 0);
		return Object.entries(mix).map(([type, count]) => ({ type, count, share: round3(total ? count / total : 0) }));
	}

	function feedSummary(feed) {
		return {
			impressions: feed.total,
			dwell: feed.dwell,
			click: feed.click,
			clickRate: round3(feed.clickRate),
			peakImpressorsPerDay: feed.peakImpressors,
			peakCreationsPerDay: feed.peakCreations
		};
	}

	function todayDigest(day) {
		const vd = (store.visitDaily || []).find((x) => x.day === day) || null;
		const peak = vd ? peakHour(vd.hourlyAuthed, vd.hourlyAnon) : { h: 0, n: 0 };
		const feed = M.feedImpressionTotals(store, day, day);
		return {
			traffic: {
				uniqueVisitors: Number(vd?.uniqueVisitors) || 0,
				loggedIn: Number(vd?.authedVisitors) || 0,
				anonymous: Number(vd?.anonVisitors) || 0,
				hits: Number(vd?.hits) || 0,
				peakHour: peak.n ? { hour: peak.h, present: peak.n } : null
			},
			actionDau: M.actionDauSeries(store, day, day)[0]?.dau || 0,
			actionMix: mixWithShares(M.actionMix(store, day, day)),
			loggedInVisitors: (vd?.authed || []).map((a) => ({
				user: handleOf(a.id),
				hits: Number(a.hits) || 0,
				activeHours: (a.hours || []).length
			})),
			feed: feed.daysWithData ? feedSummary(feed) : null
		};
	}

	function rangeDigest(from, to, tab) {
		const actionActive = M.actionActiveUsers(store, from, to).size;
		const visitActive = M.visitActiveUsers(store, from, to).size;
		const trafficActive = M.trafficVisitorKeys(store, from, to).size;
		const dau = M.actionDauSeries(store, from, to).map((x) => x.dau);
		const funnel = M.funnelTotals(store, from, to);
		const feed = M.feedImpressionTotals(store, from, to);
		const out = {
			activeUsers: {
				actionActive,
				visitActive,
				trafficActive,
				avgActionDau: round1(M.avg(dau)),
				activation: round3(M.pctRatio(actionActive, visitActive))
			},
			newSignups: M.newUsersInRange(store, from, to),
			actionsPerActiveUser: round2(M.actionsPerActiveUser(store, from, to).perActive),
			actionMix: mixWithShares(M.actionMix(store, from, to)),
			top2UserShareOfCoreActions: round3(M.top2ActionShare(store, from, to).share),
			engagementLeaders: M.engagementLeaders(store, from, to).slice(0, 10).map((l) => ({
				user: l.user_name ? "@" + l.user_name : "user " + l.user_id,
				coreActions: l.core_actions,
				activeDays: l.active_days,
				perActiveDay: round2(l.actions_per_active_day)
			})),
			shareToTryFunnel: {
				shareViews: funnel.shareViews,
				tryRequests: funnel.tryRequests,
				transitionedToUser: funnel.transitionedUsers
			},
			feed: feed.daysWithData ? feedSummary(feed) : null,
			relatedBrowsing: {
				pathsTouched: M.transitionPathsTotal(store, from, to),
				topPaths: M.transitionTopInRange(store, from, to, 10).map((p) => ({
					from: p.from,
					to: p.to,
					clicks: p.count,
					lastClick: p.lastDay
				}))
			},
			challenges: M.challengesInRange(store, from, to).map((c) => ({
				title: c.title,
				phase: c.phase,
				window: c.subStartDay ? `${c.subStartDay}${c.voteEndDay ? " → " + c.voteEndDay : ""}` : null,
				submissions: c.submissions,
				uniqueSubmitters: c.uniqueSubmitters,
				totalVotes: c.totalVotes,
				uniqueVoters: c.uniqueVoters
			}))
		};
		if (tab === "month" || tab === "inception") {
			out.cohorts = M.cohortRetention(store, from, to).map((c) => ({
				cohort: c.cohort_label,
				signups: c.signups,
				w1Retained: c.w1_retained,
				w1Rate: round3(c.w1_rate),
				w4Retained: c.w4_retained,
				w4Rate: round3(c.w4_rate)
			}));
			const churn = M.churnSplit(store, from, to);
			out.churn = { firstHalfActive: churn.prevActive, secondHalfActive: churn.currActive, churned: churn.churned };
		}
		if (tab === "inception") {
			out.mau = M.monthlyActiveSeries(store, from, to).map((m) => ({ month: m.month, mau: m.mau }));
		}
		return out;
	}

	function buildDigest() {
		const r = currentRange();
		const ignoredIds = resolveIgnoredIds();
		const digest = {
			report: "Parascene Overview",
			tab: r.tab,
			range: { from: r.from, to: r.to, days: M.enumerateDays(r.from, r.to).length, label: r.label },
			storeRefreshed: baseStore.meta.lastRefresh,
			timezone: baseStore.meta.tz,
			generatedAt: new Date().toISOString(),
			filters: { ignoredUserCount: ignoredIds.size, ignoredUsers: ignoredNames.slice() }
		};
		return Object.assign(digest, state.tab === "today" ? todayDigest(r.from) : rangeDigest(r.from, r.to, state.tab));
	}

	function pushFeedMd(L, f) {
		L.push("## Feed engagement (logged-in feed-beta)");
		L.push(`- Impressions: ${f.impressions} (dwell ${f.dwell} / click ${f.click}, ${(f.clickRate * 100).toFixed(1)}% click rate)`);
		L.push(`- Peak impressors/day: ${f.peakImpressorsPerDay} · peak creations/day: ${f.peakCreationsPerDay}`);
		L.push("");
	}

	function digestMarkdown(d) {
		const L = [];
		const pctS = (r) => `${(r * 100).toFixed(1)}%`;
		L.push(`# ${d.report} — ${d.tab}`);
		L.push(`Range: ${d.range.label} (${d.range.days} day${d.range.days === 1 ? "" : "s"})`);
		L.push(`Store refreshed: ${d.storeRefreshed} · TZ: ${d.timezone}`);
		if (d.filters.ignoredUserCount) L.push(`Filters: ${d.filters.ignoredUserCount} user(s) ignored (${d.filters.ignoredUsers.join(", ")})`);
		L.push("");
		if (d.tab === "Daily") {
			const t = d.traffic;
			L.push("## Traffic");
			L.push(`- Unique visitors: ${t.uniqueVisitors} (logged-in ${t.loggedIn}, anonymous ${t.anonymous})`);
			L.push(`- Hits: ${t.hits}`);
			if (t.peakHour) L.push(`- Peak hour: ${t.peakHour.hour}:00 (${t.peakHour.present} present)`);
			L.push(`- Action DAU: ${d.actionDau}`);
			L.push("");
			L.push("## Action mix (core actions)");
			for (const m of d.actionMix) L.push(`- ${m.type}: ${m.count} (${pctS(m.share)})`);
			L.push("");
			if (d.loggedInVisitors.length) {
				L.push("## Logged-in visitors");
				for (const v of d.loggedInVisitors) L.push(`- ${v.user}: ${v.hits} hit(s), ${v.activeHours} active hour(s)`);
				L.push("");
			}
			if (d.feed) pushFeedMd(L, d.feed);
		} else {
			const a = d.activeUsers;
			L.push("## Active users");
			L.push(`- Action-active (did a core action): ${a.actionActive}`);
			L.push(`- Visit-active (logged-in visits): ${a.visitActive}`);
			L.push(`- Traffic-active (all visits): ${a.trafficActive}`);
			L.push(`- Avg action DAU: ${a.avgActionDau}`);
			L.push(`- Activation (action ÷ visit): ${pctS(a.activation)}`);
			L.push(`- New signups: ${d.newSignups}`);
			L.push(`- Actions per active user: ${d.actionsPerActiveUser}`);
			L.push("");
			L.push("## Action mix (core actions)");
			for (const m of d.actionMix) L.push(`- ${m.type}: ${m.count} (${pctS(m.share)})`);
			L.push(`- Top-2 users' share of core actions: ${pctS(d.top2UserShareOfCoreActions)}`);
			L.push("");
			if (d.engagementLeaders.length) {
				L.push("## Engagement leaders");
				d.engagementLeaders.forEach((l, i) => L.push(`${i + 1}. ${l.user} — ${l.coreActions} core actions over ${l.activeDays} day(s) (${l.perActiveDay}/day)`));
				L.push("");
			}
			const f = d.shareToTryFunnel;
			L.push("## Anonymous share → try funnel");
			L.push(`- Share views: ${f.shareViews}`);
			L.push(`- Try requests: ${f.tryRequests}`);
			L.push(`- Transitioned to user: ${f.transitionedToUser}`);
			L.push("");
			if (d.feed) pushFeedMd(L, d.feed);
			L.push("## Related browsing (paths touched)");
			L.push(`- Total (proxy): ${d.relatedBrowsing.pathsTouched}`);
			for (const p of d.relatedBrowsing.topPaths) L.push(`  - #${p.from} → #${p.to}: ${p.clicks} clicks (last ${p.lastClick})`);
			L.push("");
			if (d.challenges.length) {
				L.push(`## Challenges active in range (${d.challenges.length})`);
				for (const c of d.challenges) {
					L.push(`- ${c.title} [${c.phase}]${c.window ? ` ${c.window}` : ""} — ${c.submissions} subs / ${c.uniqueSubmitters} submitters, ${c.totalVotes} votes / ${c.uniqueVoters} voters`);
				}
				L.push("");
			}
			if (d.cohorts) {
				L.push("## Weekly signup cohorts (retention)");
				for (const c of d.cohorts) L.push(`- ${c.cohort}: ${c.signups} signups · W1 ${c.w1Retained} (${pctS(c.w1Rate)}) · W4 ${c.w4Retained} (${pctS(c.w4Rate)})`);
				L.push("");
			}
			if (d.churn) {
				L.push("## Churn (first vs second half of range)");
				L.push(`- First-half active: ${d.churn.firstHalfActive} · second-half active: ${d.churn.secondHalfActive} · churned: ${d.churn.churned}`);
				L.push("");
			}
			if (d.mau) {
				L.push("## Monthly active users (MAU)");
				for (const m of d.mau) L.push(`- ${m.month}: ${m.mau}`);
				L.push("");
			}
		}
		L.push("---");
		L.push("Methodology notes:");
		L.push("- Action DAU/WAU counts distinct users with a core action (creation, publish, comment, like, reaction, tip_sent) in the period.");
		L.push("- Visit-active = distinct logged-in visitors; traffic-active = all visitors (authed + anonymous).");
		L.push("- Related browsing is a proxy (source stores lifetime counts + last-click day); logged-in only; not reduced by ignored users.");
		L.push("- Feed impressions are logged-in feed-beta only; unique impressors/creations are per-day peaks; not reduced by ignored users.");
		L.push("- Challenge vote totals are lifetime (vote timestamps are not stored); only submissions bucket by day.");
		L.push("- All day-keys use the US-East partition (fixed UTC-5, no DST).");
		return L.join("\n") + "\n";
	}

	function digestText(fmt) {
		const d = buildDigest();
		return fmt === "json" ? JSON.stringify(d, null, 2) : digestMarkdown(d);
	}

	async function copyToClipboard(text) {
		if (navigator?.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return;
		}
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "true");
		ta.style.position = "fixed";
		ta.style.top = "-1000px";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		document.body.removeChild(ta);
		if (!ok) throw new Error("copy failed");
	}

	function initCopy() {
		const doBtn = document.getElementById("copy-do");
		const preview = document.getElementById("copy-preview");
		const status = document.getElementById("copy-status");
		const scopeLabel = document.getElementById("copy-scope-label");
		const selectedFmt = () => document.querySelector('input[name="copy-fmt"]:checked')?.value || "md";

		const refreshPreview = () => {
			const r = currentRange();
			if (scopeLabel) scopeLabel.textContent = `${r.tab} · ${r.label}`;
			if (preview) preview.value = digestText(selectedFmt());
		};

		for (const radio of document.querySelectorAll('input[name="copy-fmt"]')) radio.addEventListener("change", refreshPreview);
		if (doBtn) {
			doBtn.addEventListener("click", async () => {
				try { await copyToClipboard(preview.value); status.textContent = "Copied to clipboard."; }
				catch { status.textContent = "Copy failed."; }
				setTimeout(() => { status.textContent = ""; }, 2000);
			});
		}
		document.addEventListener("click", (e) => {
			if (e.target.closest('[data-modal-open="copy-modal"]')) refreshPreview();
		});
	}

	/* ------------------------------------------------------------ */
	/* State + controls + tab switching.                            */
	/* ------------------------------------------------------------ */

	const today = M.usEastDayKey();
	const lastComplete = store.meta.lastCompleteDay;
	const launch = store.meta.launchDay;

	// Restore persisted controls, clamped to this store's bounds (a newer refresh
	// may have moved launch/lastComplete, so stale saved dates get pulled in-range).
	const isDayKey = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
	const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
	const weekLo = M.usEastWeekStartKey(launch);
	const weekHi = M.usEastWeekStartKey(lastComplete);
	const monthLo = M.usEastMonthStartKey(launch);
	const monthHi = M.usEastMonthStartKey(lastComplete);
	let seedFrom = isDayKey(persisted.from) ? clamp(persisted.from, launch, lastComplete) : launch;
	let seedTo = isDayKey(persisted.to) ? clamp(persisted.to, launch, lastComplete) : lastComplete;
	if (seedFrom > seedTo) { seedFrom = launch; seedTo = lastComplete; }

	const state = {
		tab: ["today", "week", "month", "inception"].includes(persisted.tab) ? persisted.tab : "today",
		day: isDayKey(persisted.day) ? clamp(persisted.day, launch, today) : today,
		week: isDayKey(persisted.week) ? clamp(M.usEastWeekStartKey(persisted.week), weekLo, weekHi) : weekHi,
		month: isDayKey(persisted.month) ? clamp(M.usEastMonthStartKey(persisted.month), monthLo, monthHi) : monthHi,
		from: seedFrom,
		to: seedTo
	};

	function renderControls() {
		if (state.tab === "today") {
			controls.innerHTML = `<button id="c-prev">‹ Prev day</button><span class="range-label">${esc(state.day)}</span><button id="c-next">Next day ›</button>`;
			bindNav("day", -1, 1, launch, today);
		} else if (state.tab === "week") {
			const to = M.shiftDayKey(state.week, 6);
			controls.innerHTML = `<button id="c-prev">‹ Prev week</button><span class="range-label">${esc(state.week)} → ${esc(to)}</span><button id="c-next">Next week ›</button>`;
			bindNav("week", -7, 7, M.usEastWeekStartKey(launch), M.usEastWeekStartKey(lastComplete));
		} else if (state.tab === "month") {
			controls.innerHTML = `<button id="c-prev">‹ Prev month</button><span class="range-label">${esc(monthLabel(state.month))}</span><button id="c-next">Next month ›</button>`;
			bindMonthNav();
		} else {
			controls.innerHTML = `<label class="small">From <input type="date" id="c-from" min="${launch}" max="${lastComplete}" value="${state.from}"></label>
				<label class="small">To <input type="date" id="c-to" min="${launch}" max="${lastComplete}" value="${state.to}"></label>
				<button id="c-apply">Apply</button><button id="c-reset">Reset (launch → yesterday)</button>`;
			document.getElementById("c-apply").addEventListener("click", () => {
				const f = document.getElementById("c-from").value;
				const t = document.getElementById("c-to").value;
				if (f && t && f <= t) { state.from = f; state.to = t; persistState(); render(); }
			});
			document.getElementById("c-reset").addEventListener("click", () => {
				state.from = launch; state.to = lastComplete; persistState(); renderControls(); render();
			});
		}
	}

	function bindNav(key, prevDelta, nextDelta, minKey, maxKey) {
		const prev = document.getElementById("c-prev");
		const next = document.getElementById("c-next");
		const cur = state[key];
		prev.disabled = M.shiftDayKey(cur, prevDelta) < minKey;
		next.disabled = M.shiftDayKey(cur, nextDelta) > maxKey;
		prev.addEventListener("click", () => { if (!prev.disabled) { state[key] = M.shiftDayKey(cur, prevDelta); persistState(); renderControls(); render(); } });
		next.addEventListener("click", () => { if (!next.disabled) { state[key] = M.shiftDayKey(cur, nextDelta); persistState(); renderControls(); render(); } });
	}

	function bindMonthNav() {
		const prev = document.getElementById("c-prev");
		const next = document.getElementById("c-next");
		const prevMonth = M.usEastMonthStartKey(M.shiftDayKey(state.month, -1));
		const nextMonth = M.usEastMonthStartKey(M.shiftDayKey(monthEndOf(state.month), 1));
		prev.disabled = monthEndOf(prevMonth) < launch;
		next.disabled = nextMonth > lastComplete;
		prev.addEventListener("click", () => { if (!prev.disabled) { state.month = prevMonth; persistState(); renderControls(); render(); } });
		next.addEventListener("click", () => { if (!next.disabled) { state.month = nextMonth; persistState(); renderControls(); render(); } });
	}

	function render() {
		if (state.tab === "today") view.innerHTML = renderToday(state.day);
		else if (state.tab === "week") view.innerHTML = renderWeek(state.week);
		else if (state.tab === "month") view.innerHTML = renderMonth(state.month);
		else view.innerHTML = renderInception(state.from, state.to);
	}

	tabsEl.addEventListener("click", (e) => {
		const btn = e.target.closest("button[data-tab]");
		if (!btn) return;
		state.tab = btn.getAttribute("data-tab");
		for (const b of tabsEl.querySelectorAll("button")) b.classList.toggle("is-active", b === btn);
		persistState();
		renderControls();
		render();
	});

	function refreshMeta() {
		const ignoredCount = resolveIgnoredIds().size;
		metaLine.innerHTML = `Store refreshed ${esc(fmtWhen(baseStore.meta.lastRefresh))} · launch ${esc(launch)} · rollups through ${esc(
			lastComplete
		)} · ${esc(baseStore.meta.tz)} · ${(store.userDay || []).length} user-days${
			ignoredCount ? ` · <strong>${ignoredCount} user(s) ignored</strong>` : ""
		}`;
	}

	/* ------------------------------------------------------------ */
	/* Generic modal/popup wiring (reusable for any .modal-overlay).*/
	/* [data-modal-open="<id>"] opens; [data-modal-close], backdrop */
	/* click, or Escape closes.                                     */
	/* ------------------------------------------------------------ */

	function initModals() {
		const closeAll = () => {
			for (const o of document.querySelectorAll(".modal-overlay")) o.hidden = true;
		};
		document.addEventListener("click", (e) => {
			const opener = e.target.closest("[data-modal-open]");
			if (opener) {
				const m = document.getElementById(opener.getAttribute("data-modal-open"));
				if (m) m.hidden = false;
				return;
			}
			if (e.target.closest("[data-modal-close]") || e.target.classList.contains("modal-overlay")) closeAll();
		});
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") closeAll();
		});
	}

	applyIgnore();
	refreshMeta();
	renderIgnoreBar();
	initModals();
	initCopy();
	for (const b of tabsEl.querySelectorAll("button")) b.classList.toggle("is-active", b.getAttribute("data-tab") === state.tab);
	renderControls();
	render();
	persistState();
})();
