#!/usr/bin/env node
const fs = require('fs/promises')
const path = require('path')

const TZ = process.env.TZ_NAME || 'America/New_York'
const CONCURRENCY = Number(process.env.CONCURRENCY || 24)
const TOP_N = Number(process.env.TOP_N || 30)
const MIN_HOUR_SAMPLE = Number(process.env.MIN_HOUR_SAMPLE || 3)
const API = 'https://hacker-news.firebaseio.com/v0'

const now = new Date()

function zonedFilenameStamp(date, timeZone) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(date).reduce((m, p) => {
		if (p.type !== 'literal') m[p.type] = p.value
		return m
	}, {})

	const mm = parts.month
	const dd = parts.day
	const hh = parts.hour
	const min = parts.minute

	if (!mm || !dd || !hh || !min) throw new Error('Could not compute zoned filename stamp')
	return `${mm}-${dd}_${hh}-${min}`
}

const dayStart = zonedDayStartEpoch(now, TZ)
const hourFmt = new Intl.DateTimeFormat('en-US', {
	timeZone: TZ,
	hour: 'numeric',
	hour12: true,
	month: 'short',
	day: 'numeric'
})
const shortHourFmt = new Intl.DateTimeFormat('en-US', {
	timeZone: TZ,
	hour: 'numeric',
	hour12: true
})
const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
	timeZone: TZ,
	month: 'short',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit',
	hour12: true
})

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const n = x => Number.isFinite(x) ? x : 0
const median = a => !a.length ? 0 : [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const avg = a => !a.length ? 0 : a.reduce((s, x) => s + x, 0) / a.length
const pct = (a, b) => !b ? '0.0%' : `${(100 * a / b).toFixed(1)}%`
const ageHours = t => Math.max((Date.now() / 1000 - t) / 3600, 0.01)
const scorePerHour = s => n(s.score) / ageHours(s.time)
const commentsPerHour = s => n(s.descendants) / ageHours(s.time)

function zonedDayStartEpoch(date, timeZone) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(date).reduce((m, p) => {
		if (p.type !== 'literal') m[p.type] = p.value
		return m
	}, {})

	const y = +parts.year
	const m = +parts.month
	const d = +parts.day

	for (let h = 0; h < 48; h++) {
		const probe = new Date(Date.UTC(y, m - 1, d, h, 0, 0))
		const got = new Intl.DateTimeFormat('en-US', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false
		}).formatToParts(probe).reduce((m, p) => {
			if (p.type !== 'literal') m[p.type] = p.value
			return m
		}, {})

		const hour = +got.hour % 24

		if (
			+got.year === y &&
			+got.month === m &&
			+got.day === d &&
			hour === 0 &&
			+got.minute === 0 &&
			+got.second === 0
		) {
			return Math.floor(probe.getTime() / 1000)
		}
	}

	throw new Error(`Could not resolve midnight for ${timeZone}`)
}

async function j(path) {
	const r = await fetch(`${API}${path}`)
	if (!r.ok) throw new Error(`${r.status} ${path}`)
	return r.json()
}

async function mapLimit(items, limit, fn) {
	const out = new Array(items.length)
	let i = 0
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (i < items.length) {
			const idx = i++
			out[idx] = await fn(items[idx], idx)
		}
	}))
	return out
}

async function getTodayStories() {
	const maxitem = await j('/maxitem.json')
	const out = []
	let olderStoriesSeen = 0

	for (let cursor = maxitem; cursor > 0; cursor -= CONCURRENCY) {
		const ids = Array.from({ length: CONCURRENCY }, (_, i) => cursor - i).filter(Boolean)
		const batch = await mapLimit(ids, CONCURRENCY, id => j(`/item/${id}.json`).catch(() => null))

		for (const item of batch) {
			if (!item || item.type !== 'story' || item.deleted || item.dead || !item.time) continue
			if (item.time >= dayStart) {
				out.push(item)
				olderStoriesSeen = 0
			} else {
				olderStoriesSeen++
			}
		}

		if (out.length && olderStoriesSeen >= 100) break
	}

	return out.sort((a, b) => a.time - b.time)
}

function byHour(stories, topSet, bestSet) {
	const buckets = new Map()
	for (const s of stories) {
		const hourLabel = shortHourFmt.format(new Date(s.time * 1000))
		const key = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date(s.time * 1000))
		const b = buckets.get(key) || { key: +key, label: hourLabel, stories: [] }
		b.stories.push(s)
		buckets.set(key, b)
	}
	return [...buckets.values()].sort((a, b) => a.key - b.key).map(b => {
		const scores = b.stories.map(s => n(s.score))
		const comments = b.stories.map(s => n(s.descendants))
		const topHits = b.stories.filter(s => topSet.has(s.id)).length
		const bestHits = b.stories.filter(s => bestSet.has(s.id)).length
		return {
			hour: b.label,
			count: b.stories.length,
			topHits,
			bestHits,
			topHitRate: topHits / b.stories.length,
			bestHitRate: bestHits / b.stories.length,
			avgScore: avg(scores),
			medianScore: median(scores),
			avgComments: avg(comments),
			medianComments: median(comments)
		}
	})
}

function analyze(stories, topIds, bestIds) {
	const topSet = new Set(topIds)
	const bestSet = new Set(bestIds)
	const topRank = new Map(topIds.map((id, i) => [id, i + 1]))
	const bestRank = new Map(bestIds.map((id, i) => [id, i + 1]))

	const enriched = stories.map(s => ({
		...s,
		ageHours: ageHours(s.time),
		scorePerHour: scorePerHour(s),
		commentsPerHour: commentsPerHour(s),
		isTop: topSet.has(s.id),
		isBest: bestSet.has(s.id),
		topRank: topRank.get(s.id) || null,
		bestRank: bestRank.get(s.id) || null
	}))

	const topToday = enriched.filter(s => s.isTop).sort((a, b) => (a.topRank || 9999) - (b.topRank || 9999))
	const bestToday = enriched.filter(s => s.isBest).sort((a, b) => (a.bestRank || 9999) - (b.bestRank || 9999))
	const hourStats = byHour(enriched, topSet, bestSet)
	const stableHours = hourStats.filter(h => h.count >= MIN_HOUR_SAMPLE)

	const strongestTopHour = [...stableHours].sort((a, b) => b.topHitRate - a.topHitRate || b.medianScore - a.medianScore)[0]
	const strongestBestHour = [...stableHours].sort((a, b) => b.bestHitRate - a.bestHitRate || b.medianScore - a.medianScore)[0]
	const strongestMedianHour = [...stableHours].sort((a, b) => b.medianScore - a.medianScore || b.topHitRate - a.topHitRate)[0]

	const fastest = [...enriched].filter(s => s.ageHours >= 1).sort((a, b) => b.scorePerHour - a.scorePerHour).slice(0, 12)
	const scoreLeaders = [...enriched].sort((a, b) => n(b.score) - n(a.score)).slice(0, 20)
	const commentLeaders = [...enriched].sort((a, b) => n(b.descendants) - n(a.descendants)).slice(0, 20)

	const observations = [
		`Today has ${enriched.length} story submissions so far in ${TZ}. ${topToday.length} made the current top feed and ${bestToday.length} made the current best feed.`,
		strongestTopHour && `The strongest submission window for breaking into the current top feed was ${strongestTopHour.hour} with a ${pct(strongestTopHour.topHits, strongestTopHour.count)} hit rate across ${strongestTopHour.count} stories.`,
		strongestBestHour && `The strongest window for landing in best was ${strongestBestHour.hour} with a ${pct(strongestBestHour.bestHits, strongestBestHour.count)} hit rate.`,
		strongestMedianHour && `The hour with the strongest typical outcome was ${strongestMedianHour.hour}: median score ${strongestMedianHour.medianScore.toFixed(1)}, median comments ${strongestMedianHour.medianComments.toFixed(1)}.`,
		fastest[0] && `The fastest riser right now is “${fastest[0].title}” at ${fastest[0].scorePerHour.toFixed(1)} points/hour, submitted ${dateTimeFmt.format(new Date(fastest[0].time * 1000))}.`,
		`Use this as a proxy for reader presence, not literal “liker activity.” HN exposes current score and comments, but not a vote timeline.`
	].filter(Boolean)

	return {
		stories: enriched,
		topToday,
		bestToday,
		hourStats,
		scoreLeaders,
		commentLeaders,
		fastest,
		observations
	}
}

function scatterSvg(stories, topSet) {
	const w = 960, h = 260, p = 32
	const xs = stories.map(s => s.time)
	const ys = stories.map(s => n(s.score))
	const minX = Math.min(...xs), maxX = Math.max(...xs, minX + 1)
	const maxY = Math.max(...ys, 1)
	const x = v => p + (w - p * 2) * ((v - minX) / (maxX - minX))
	const y = v => h - p - (h - p * 2) * (v / maxY)
	const dots = stories.map(s => `<circle cx="${x(s.time).toFixed(1)}" cy="${y(n(s.score)).toFixed(1)}" r="${topSet.has(s.id) ? 4 : 2.5}" fill="${topSet.has(s.id) ? '#d97706' : '#2563eb'}"><title>${esc(s.title)} | ${n(s.score)} points | ${hourFmt.format(new Date(s.time * 1000))}</title></circle>`).join('')
	const ticks = Array.from({ length: 6 }, (_, i) => {
		const v = minX + ((maxX - minX) * i / 5)
		return `<text x="${x(v)}" y="${h - 8}" text-anchor="middle">${esc(shortHourFmt.format(new Date(v * 1000)))}</text>`
	}).join('')
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="260" aria-label="score scatter">
		<rect x="0" y="0" width="${w}" height="${h}" fill="white"/>
		<line x1="${p}" y1="${h - p}" x2="${w - p}" y2="${h - p}" stroke="#cbd5e1"/>
		<line x1="${p}" y1="${p}" x2="${p}" y2="${h - p}" stroke="#cbd5e1"/>
		${dots}
		${ticks}
	</svg>`
}

function table(rows, cols) {
	return `<table><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${c.html ? c.html(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')
		}</tbody></table>`
}

function html(report) {
	const topSet = new Set(report.topToday.map(s => s.id))
	return `<!doctype html>
<meta charset="utf-8">
<title>HN Today</title>
<meta name="darkreader-lock" />
<style>
	body{font:14px/1.45 system-ui,sans-serif;max-width:1180px;margin:24px auto;padding:0 16px;color:#111}
	h1,h2{margin:0 0 12px}
	section{margin:0 0 28px}
	table{border-collapse:collapse;width:100%}
	th,td{padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;text-align:left}
	th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#475569}
	.small{color:#64748b;font-size:12px}
	.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
	.card{border:1px solid #e5e7eb;padding:12px}
	a{color:#b45309;text-decoration:none}
	ul{padding-left:18px;margin:8px 0 0}
</style>
<p class="small"><a href=".">Up one folder</a></p>
<h1>Hacker News Today</h1>
<p class="small">Timezone: ${esc(TZ)} · Generated: ${esc(dateTimeFmt.format(now))}</p>

<section class="grid">
	<div class="card"><div class="small">Stories submitted today</div><div>${report.stories.length}</div></div>
	<div class="card"><div class="small">Made current top feed</div><div>${report.topToday.length}</div></div>
	<div class="card"><div class="small">Made current best feed</div><div>${report.bestToday.length}</div></div>
	<div class="card"><div class="small">Top-feed hit rate</div><div>${pct(report.topToday.length, report.stories.length)}</div></div>
</section>

<section>
	<h2>Observations</h2>
	<ul>${report.observations.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
</section>

<section>
	<h2>Submission time vs score</h2>
	${scatterSvg(report.stories, topSet)}
	<p class="small">Blue = all stories today. Gold = stories that are currently in the top feed.</p>
</section>

<section>
	<h2>Hourly windows</h2>
	${table(report.hourStats, [
		{ label: 'Hour', key: 'hour' },
		{ label: 'Stories', key: 'count' },
		{ label: 'Top hits', key: 'topHits' },
		{ label: 'Best hits', key: 'bestHits' },
		{ label: 'Top hit rate', html: r => pct(r.topHits, r.count) },
		{ label: 'Median score', html: r => r.medianScore.toFixed(1) },
		{ label: 'Median comments', html: r => r.medianComments.toFixed(1) }
	])}
</section>

<section>
	<h2>Stories from today in current top feed</h2>
	${table(report.topToday, [
		{ label: 'Rank', html: r => r.topRank },
		{ label: 'Submitted', html: r => esc(dateTimeFmt.format(new Date(r.time * 1000))) },
		{ label: 'Age(h)', html: r => r.ageHours.toFixed(1) },
		{ label: 'Score', key: 'score' },
		{ label: 'Comments', html: r => n(r.descendants) },
		{ label: 'Score/h', html: r => r.scorePerHour.toFixed(1) },
		{ label: 'Title', html: r => `<a href="https://news.ycombinator.com/item?id=${r.id}">${esc(r.title)}</a>` }
	])}
</section>

<section>
	<h2>Fastest risers</h2>
	${table(report.fastest, [
		{ label: 'Submitted', html: r => esc(dateTimeFmt.format(new Date(r.time * 1000))) },
		{ label: 'Age(h)', html: r => r.ageHours.toFixed(1) },
		{ label: 'Score', key: 'score' },
		{ label: 'Score/h', html: r => r.scorePerHour.toFixed(1) },
		{ label: 'Comments/h', html: r => r.commentsPerHour.toFixed(1) },
		{ label: 'Title', html: r => `<a href="https://news.ycombinator.com/item?id=${r.id}">${esc(r.title)}</a>` }
	])}
</section>

<section>
	<h2>Score leaders today</h2>
	${table(report.scoreLeaders, [
		{ label: 'Submitted', html: r => esc(dateTimeFmt.format(new Date(r.time * 1000))) },
		{ label: 'Score', key: 'score' },
		{ label: 'Comments', html: r => n(r.descendants) },
		{ label: 'Top', html: r => r.topRank || '' },
		{ label: 'Best', html: r => r.bestRank || '' },
		{ label: 'Title', html: r => `<a href="https://news.ycombinator.com/item?id=${r.id}">${esc(r.title)}</a>` }
	])}
</section>

<section>
	<h2>Notes</h2>
	<ul>
		<li>This only measures stories submitted today in ${esc(TZ)}.</li>
		<li>“Top” and “best” are current snapshots, not a historical replay.</li>
		<li>The script infers audience presence from outcome concentration by submission window, not from actual vote events.</li>
	</ul>
</section>`
}

async function main() {
	const [topIds, bestIds, stories] = await Promise.all([
		j('/topstories.json'),
		j('/beststories.json'),
		getTodayStories()
	])

	const report = analyze(stories, topIds, bestIds)

	const stamp = zonedFilenameStamp(now, TZ)
	const defaultOut = `.output/hn-today/hn-today-${stamp}.html`
	const OUT = process.env.OUT || defaultOut

	await fs.mkdir(path.dirname(OUT), { recursive: true })
	await fs.writeFile(OUT, html(report))
	console.log(`wrote ${OUT}`)
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})