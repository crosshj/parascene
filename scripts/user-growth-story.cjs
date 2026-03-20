#!/usr/bin/env node
const fs = require('fs/promises')
const path = require('path')
require('dotenv').config()

const TZ = process.env.TZ_NAME || 'UTC'
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 120)
const COHORT_WEEKS = Number(process.env.COHORT_WEEKS || 12)
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 30)
const now = new Date()

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const n = x => Number.isFinite(x) ? x : 0
const pct = (a, b) => !b ? '0.0%' : `${(100 * a / b).toFixed(1)}%`
const pp = (a, b) => `${((a - b) * 100).toFixed(1)}pp`
const signedPct = (curr, prev) => {
	if (!prev && !curr) return '0.0%'
	if (!prev && curr) return '+100.0%'
	return `${(((curr - prev) / prev) * 100 >= 0 ? '+' : '')}${(((curr - prev) / prev) * 100).toFixed(1)}%`
}
const fmt = new Intl.DateTimeFormat('en-US', {
	timeZone: TZ,
	month: 'short',
	day: 'numeric',
	year: 'numeric',
	hour: 'numeric',
	minute: '2-digit',
	hour12: true
})
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })

function toIsoDate(date) {
	return dayFmt.format(date)
}

function addDays(date, days) {
	const d = new Date(date.getTime())
	d.setUTCDate(d.getUTCDate() + days)
	return d
}

function startOfUtcDay(date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function startOfUtcWeek(date) {
	const d = startOfUtcDay(date)
	const dow = d.getUTCDay()
	const mondayShift = (dow + 6) % 7
	return addDays(d, -mondayShift)
}

function getWeekKey(date) {
	return toIsoDate(startOfUtcWeek(date))
}

function safeDate(value) {
	if (!value) return null
	const d = new Date(value)
	return Number.isNaN(d.getTime()) ? null : d
}

function table(rows, cols) {
	return `<table><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${c.html ? c.html(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

function sparkline(rows, valueKey, labelKey, color) {
	const w = 980
	const h = 220
	const p = 28
	if (!rows.length) return '<p class="small">No data.</p>'
	const values = rows.map(r => Number(r[valueKey] || 0))
	const minY = Math.min(...values, 0)
	const maxY = Math.max(...values, 1)
	const range = Math.max(maxY - minY, 1)
	const x = i => p + ((w - p * 2) * (i / Math.max(rows.length - 1, 1)))
	const y = v => h - p - ((h - p * 2) * ((v - minY) / range))
	const points = rows.map((r, i) => `${x(i).toFixed(1)},${y(Number(r[valueKey] || 0)).toFixed(1)}`).join(' ')
	const circles = rows.map((r, i) => {
		const cx = x(i).toFixed(1)
		const cy = y(Number(r[valueKey] || 0)).toFixed(1)
		return `<circle cx="${cx}" cy="${cy}" r="${i === rows.length - 1 ? 4 : 2.5}" fill="${color}"><title>${esc(r[labelKey])}: ${Number(r[valueKey] || 0)}</title></circle>`
	}).join('')
	const firstLabel = esc(rows[0][labelKey])
	const lastLabel = esc(rows[rows.length - 1][labelKey])
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="220" aria-label="${esc(valueKey)} trend">
		<rect x="0" y="0" width="${w}" height="${h}" fill="white"/>
		<line x1="${p}" y1="${h - p}" x2="${w - p}" y2="${h - p}" stroke="#cbd5e1"/>
		<line x1="${p}" y1="${p}" x2="${p}" y2="${h - p}" stroke="#cbd5e1"/>
		<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${points}"/>
		${circles}
		<text x="${p}" y="${h - 8}" font-size="11" fill="#64748b">${firstLabel}</text>
		<text x="${w - p}" y="${h - 8}" text-anchor="end" font-size="11" fill="#64748b">${lastLabel}</text>
		<text x="${p}" y="${p - 8}" font-size="11" fill="#64748b">max ${maxY}</text>
		<text x="${p}" y="${h - p + 14}" font-size="11" fill="#64748b">min ${minY}</text>
	</svg>`
}

function linearRegression(values) {
	const n = values.length
	if (!n) return { slope: 0, intercept: 0 }
	if (n === 1) return { slope: 0, intercept: values[0] || 0 }
	let sumX = 0
	let sumY = 0
	let sumXY = 0
	let sumXX = 0
	for (let i = 0; i < n; i++) {
		const x = i
		const y = Number(values[i] || 0)
		sumX += x
		sumY += y
		sumXY += x * y
		sumXX += x * x
	}
	const denom = (n * sumXX) - (sumX * sumX)
	if (!denom) return { slope: 0, intercept: sumY / n }
	const slope = ((n * sumXY) - (sumX * sumY)) / denom
	const intercept = (sumY - (slope * sumX)) / n
	return { slope, intercept }
}

function sparklineWithTrend(rows, valueKey, labelKey, color, trendColor = '#ef4444') {
	const w = 980
	const h = 220
	const p = 28
	if (!rows.length) return '<p class="small">No data.</p>'
	const values = rows.map(r => Number(r[valueKey] || 0))
	const minY = Math.min(...values, 0)
	const maxY = Math.max(...values, 1)
	const range = Math.max(maxY - minY, 1)
	const x = i => p + ((w - p * 2) * (i / Math.max(rows.length - 1, 1)))
	const y = v => h - p - ((h - p * 2) * ((v - minY) / range))
	const points = rows.map((r, i) => `${x(i).toFixed(1)},${y(Number(r[valueKey] || 0)).toFixed(1)}`).join(' ')
	const circles = rows.map((r, i) => {
		const cx = x(i).toFixed(1)
		const cy = y(Number(r[valueKey] || 0)).toFixed(1)
		return `<circle cx="${cx}" cy="${cy}" r="${i === rows.length - 1 ? 4 : 2.5}" fill="${color}"><title>${esc(r[labelKey])}: ${Number(r[valueKey] || 0)}</title></circle>`
	}).join('')
	const firstLabel = esc(rows[0][labelKey])
	const lastLabel = esc(rows[rows.length - 1][labelKey])
	const lr = linearRegression(values)
	const y0 = lr.intercept
	const yN = lr.intercept + (lr.slope * Math.max(rows.length - 1, 0))
	const trendSlopeText = lr.slope > 0 ? `+${lr.slope.toFixed(3)}` : lr.slope.toFixed(3)
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="220" aria-label="${esc(valueKey)} trend with regression">
		<rect x="0" y="0" width="${w}" height="${h}" fill="white"/>
		<line x1="${p}" y1="${h - p}" x2="${w - p}" y2="${h - p}" stroke="#cbd5e1"/>
		<line x1="${p}" y1="${p}" x2="${p}" y2="${h - p}" stroke="#cbd5e1"/>
		<line x1="${x(0).toFixed(1)}" y1="${y(y0).toFixed(1)}" x2="${x(rows.length - 1).toFixed(1)}" y2="${y(yN).toFixed(1)}" stroke="${trendColor}" stroke-width="2" stroke-dasharray="6 5">
			<title>Linear trend slope: ${trendSlopeText} per period</title>
		</line>
		<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${points}"/>
		${circles}
		<text x="${p}" y="${h - 8}" font-size="11" fill="#64748b">${firstLabel}</text>
		<text x="${w - p}" y="${h - 8}" text-anchor="end" font-size="11" fill="#64748b">${lastLabel}</text>
		<text x="${p}" y="${p - 8}" font-size="11" fill="#64748b">max ${maxY}</text>
		<text x="${w - p}" y="${p - 8}" text-anchor="end" font-size="11" fill="${trendColor}">trend slope ${trendSlopeText}/period</text>
	</svg>`
}

function bars(rows, valueKey, labelKey, color) {
	const w = 980
	const h = 240
	const p = 28
	if (!rows.length) return '<p class="small">No data.</p>'
	const values = rows.map(r => Number(r[valueKey] || 0))
	const maxY = Math.max(...values, 1)
	const colW = (w - p * 2) / rows.length
	const bw = Math.max(2, colW * 0.8)
	const barsSvg = rows.map((r, i) => {
		const v = Number(r[valueKey] || 0)
		const bh = ((h - p * 2) * (v / maxY))
		const x = p + i * colW + (colW - bw) / 2
		const y = h - p - bh
		return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}"><title>${esc(r[labelKey])}: ${v}</title></rect>`
	}).join('')
	const firstLabel = esc(rows[0][labelKey])
	const lastLabel = esc(rows[rows.length - 1][labelKey])
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="240" aria-label="${esc(valueKey)} bars">
		<rect x="0" y="0" width="${w}" height="${h}" fill="white"/>
		<line x1="${p}" y1="${h - p}" x2="${w - p}" y2="${h - p}" stroke="#cbd5e1"/>
		<line x1="${p}" y1="${p}" x2="${p}" y2="${h - p}" stroke="#cbd5e1"/>
		${barsSvg}
		<text x="${p}" y="${h - 8}" font-size="11" fill="#64748b">${firstLabel}</text>
		<text x="${w - p}" y="${h - 8}" text-anchor="end" font-size="11" fill="#64748b">${lastLabel}</text>
		<text x="${p}" y="${p - 8}" font-size="11" fill="#64748b">max ${maxY}</text>
	</svg>`
}

function buildAnonymizedExportPayload(report) {
	const leaderRows = Array.isArray(report?.actionLeaders) ? report.actionLeaders : []
	const byCoreActions = [...leaderRows].sort((a, b) => Number(b.core_actions || 0) - Number(a.core_actions || 0))
	const aliasByUserId = new Map()
	byCoreActions.forEach((row, idx) => {
		const userId = Number(row?.user_id)
		if (!Number.isFinite(userId)) return
		aliasByUserId.set(userId, `user_${String(idx + 1).padStart(3, '0')}`)
	})

	const anonymizedLeaders = byCoreActions.map((row) => {
		const userId = Number(row?.user_id)
		return {
			user_alias: aliasByUserId.get(userId) || 'user_unknown',
			core_actions: Number(row?.core_actions || 0),
			active_days: Number(row?.active_days || 0),
			actions_per_active_day: Number(Number(row?.actions_per_active_day || 0).toFixed(2)),
			creations: Number(row?.creations || 0),
			publishes: Number(row?.publishes || 0),
			comments: Number(row?.comments || 0),
			likes: Number(row?.likes || 0),
			reactions: Number(row?.reactions || 0),
			mutations: Number(row?.mutations || 0)
		}
	})

	return {
		export_version: 1,
		exported_at: new Date().toISOString(),
		scope: 'parascene_user_growth_story',
		pii_policy: 'Anonymized export: no emails, no raw user IDs, no profile fields.',
		metrics: {
			total_users_all_time: Number(report?.totalUsers || 0),
			paid_users_current_snapshot: Number(report?.paidUsers || 0),
			latest_dau: Number(report?.latestDay?.dau || 0),
			latest_wau: Number(report?.latestWeek?.wau || 0),
			latest_mau: Number(report?.latestMonth?.mau || 0),
			core_actions_per_active_user_30d: Number(Number(report?.actionsPerActive || 0).toFixed(2))
		},
		series: {
			dau_all_days: Array.isArray(report?.dailyAllTimeRows) ? report.dailyAllTimeRows.map((r) => ({ day: r.day, dau: Number(r.dau || 0) })) : [],
			wau_all_weeks: Array.isArray(report?.weeklyAllTimeRows) ? report.weeklyAllTimeRows.map((r) => ({ week: r.week, wau: Number(r.wau || 0) })) : [],
			mau_all_months: Array.isArray(report?.monthlyAllTimeRows) ? report.monthlyAllTimeRows.map((r) => ({ month: r.month, mau: Number(r.mau || 0) })) : [],
			new_users_all_weeks: Array.isArray(report?.cumulativeUsersByWeek) ? report.cumulativeUsersByWeek.map((r) => ({ week: r.week, new_users: Number(r.new_users || 0) })) : [],
			total_users_cumulative_all_weeks: Array.isArray(report?.cumulativeUsersByWeek) ? report.cumulativeUsersByWeek.map((r) => ({ week: r.week, total_users: Number(r.total_users || 0) })) : []
		},
		retention_by_cohort: Array.isArray(report?.cohortRows) ? report.cohortRows.map((r) => ({
			cohort_week: r.cohort,
			signups: Number(r.signups || 0),
			w1_retained: Number(r.w1_retained || 0),
			w1_rate: Number(Number(r.w1_rate || 0).toFixed(4)),
			w4_retained: Number(r.w4_retained || 0),
			w4_rate: Number(Number(r.w4_rate || 0).toFixed(4))
		})) : [],
		churn_snapshot: {
			churned_users: Number(report?.churned || 0),
			prev_window_active_users: Number(report?.prevActive || 0),
			curr_window_active_users: Number(report?.currActive || 0)
		},
		share_try_funnel: report?.shareTryFunnel || null,
		funnel_30d_signup_cohort: {
			signups: Number(report?.funnel?.signup30 || 0),
			activated_within_7d: Number(report?.funnel?.activated30 || 0),
			retained_days_8_to_30: Number(report?.funnel?.retained30 || 0),
			paid_now: Number(report?.funnel?.paid30 || 0)
		},
		engagement_leaders_anonymized: anonymizedLeaders
	}
}

function parseUserMeta(value) {
	if (value == null) return {}
	if (typeof value === 'object') return value
	if (typeof value !== 'string' || !value.trim()) return {}
	try {
		return JSON.parse(value)
	} catch {
		return {}
	}
}

function parseEventMeta(value) {
	if (value == null) return {}
	if (typeof value === 'object') return value
	if (typeof value !== 'string' || !value.trim()) return {}
	try {
		return JSON.parse(value)
	} catch {
		return {}
	}
}

function normalizeUsers(rows) {
	return rows
		.map((row) => {
			const meta = parseUserMeta(row.meta)
			return {
				id: row.id,
				email: row.email,
				role: row.role,
				created_at: row.created_at,
				last_active_at: row.last_active_at,
				meta,
				suspended: meta?.suspended === true
			}
		})
		.filter((u) => u.role === 'consumer' && !u.suspended)
}

function getRows(db, sql, params = []) {
	try {
		return db.prepare(sql).all(...params)
	} catch {
		return []
	}
}

function loadEvents(db, minIso, allowedUserIds) {
	const events = []
	const allowed = allowedUserIds instanceof Set ? allowedUserIds : null
	const push = (rows, type, userKey = 'user_id', tsKey = 'created_at', extra = null) => {
		for (const row of rows) {
			const userId = Number(row?.[userKey])
			const ts = safeDate(row?.[tsKey])
			if (!Number.isFinite(userId) || userId <= 0 || !ts) continue
			if (allowed && !allowed.has(userId)) continue
			if (ts < new Date(minIso)) continue
			events.push({
				user_id: userId,
				ts,
				type,
				...(typeof extra === 'function' ? extra(row) : {})
			})
		}
	}

	push(getRows(db, `SELECT user_id, created_at, published_at, meta FROM created_images WHERE created_at >= datetime(?)`, [minIso]), 'creation', 'user_id', 'created_at', row => {
		let isMutation = false
		try {
			const meta = row?.meta && typeof row.meta === 'string' ? JSON.parse(row.meta) : (row?.meta || {})
			const mid = Number(meta?.mutate_of_id)
			isMutation = Number.isFinite(mid) && mid > 0
		} catch {
			isMutation = false
		}
		return { isMutation, published_at: row?.published_at || null }
	})
	push(getRows(db, `SELECT user_id, created_at FROM comments_created_image WHERE created_at >= datetime(?)`, [minIso]), 'comment')
	push(getRows(db, `SELECT user_id, created_at FROM likes_created_image WHERE created_at >= datetime(?)`, [minIso]), 'like')
	push(getRows(db, `SELECT user_id, created_at FROM comment_reactions WHERE created_at >= datetime(?)`, [minIso]), 'reaction')
	push(getRows(db, `SELECT user_id, created_at FROM sessions WHERE created_at >= datetime(?)`, [minIso]), 'session')
	push(getRows(db, `SELECT from_user_id, created_at FROM tip_activity WHERE created_at >= datetime(?)`, [minIso]), 'tip_sent', 'from_user_id', 'created_at')
	push(getRows(db, `SELECT to_user_id, created_at FROM tip_activity WHERE created_at >= datetime(?)`, [minIso]), 'tip_received', 'to_user_id', 'created_at')
	push(getRows(db, `SELECT id AS user_id, last_active_at AS created_at FROM users WHERE last_active_at IS NOT NULL AND last_active_at >= datetime(?)`, [minIso]), 'touch')

	// Treat published_at as a separate action while preserving creation time events.
	const publishedRows = getRows(db, `SELECT user_id, published_at FROM created_images WHERE published_at IS NOT NULL AND published_at >= datetime(?)`, [minIso])
	for (const row of publishedRows) {
		const userId = Number(row?.user_id)
		const ts = safeDate(row?.published_at)
		if (!Number.isFinite(userId) || userId <= 0 || !ts) continue
		if (allowed && !allowed.has(userId)) continue
		events.push({ user_id: userId, ts, type: 'publish' })
	}

	return events
}

async function fetchSupabaseRows(client, table, columns) {
	const pageSize = 1000
	const out = []
	let from = 0
	while (true) {
		const to = from + pageSize - 1
		const { data, error } = await client
			.from(table)
			.select(columns)
			.range(from, to)
		if (error) throw new Error(`Supabase query failed for ${table}: ${error.message}`)
		const rows = Array.isArray(data) ? data : []
		out.push(...rows)
		if (rows.length < pageSize) break
		from += rows.length
	}
	return out
}

async function loadFromDbInstance(dbInstance, minIso) {
	const usersRaw = await dbInstance?.queries?.selectUsers?.all?.()
	const users = normalizeUsers(Array.isArray(usersRaw) ? usersRaw : [])
	const allowedUserIds = new Set(users.map((u) => Number(u.id)))
	const events = []
	const minDate = new Date(minIso)
	const window30Start = addDays(startOfUtcDay(new Date()), -(WINDOW_DAYS - 1))
	const add = (userIdRaw, tsRaw, type, extra = {}) => {
		const userId = Number(userIdRaw)
		const ts = safeDate(tsRaw)
		if (!Number.isFinite(userId) || userId <= 0 || !ts) return
		if (!allowedUserIds.has(userId)) return
		if (ts < minDate) return
		events.push({ user_id: userId, ts, type, ...extra })
	}
	const buildShareTryFunnel = (shareRows, tryRows) => {
		const clientIdFromMeta = (m) => {
			const a = typeof m?.prsn_cid === 'string' ? m.prsn_cid.trim() : ''
			const b = typeof m?.client_id === 'string' ? m.client_id.trim() : ''
			return a || b
		}
		const safeShare = Array.isArray(shareRows) ? shareRows : []
		const safeTry = Array.isArray(tryRows) ? tryRows : []
		const shareCids = new Set(safeShare.map((r) => String(r?.anon_cid || '').trim()).filter(Boolean))
		const shareClientIds = new Set()
		const tryCids = new Set()
		const tryFromShareCids = new Set()
		const transitionedCids = new Set()
		const transitionedFromShareCids = new Set()
		const transitionedUserIds = new Set()
		const tryClientIds = new Set()
		const tryCidsWithClientId = new Set()
		const transitionedClientIds = new Set()
		let shareViews30 = 0
		let tryRequests30 = 0
		const shareCids30 = new Set()
		const shareClientIds30 = new Set()
		const tryCids30 = new Set()
		const transitionedCids30 = new Set()
		const transitionedFromShareCids30 = new Set()
		const transitionedUsers30 = new Set()
		const tryClientIds30 = new Set()
		const tryCidsWithClientId30 = new Set()
		const transitionedClientIds30 = new Set()

		for (const row of safeShare) {
			const cid = String(row?.anon_cid || '').trim()
			const meta = parseEventMeta(row?.meta)
			const clientId = clientIdFromMeta(meta)
			if (clientId) shareClientIds.add(clientId)
			const at = safeDate(row?.viewed_at)
			if (at && at >= window30Start) {
				shareViews30++
				if (cid) shareCids30.add(cid)
				if (clientId) shareClientIds30.add(clientId)
			}
		}

		for (const row of safeTry) {
			const cid = String(row?.anon_cid || '').trim()
			if (!cid || cid === '__pool__') continue
			const createdAt = safeDate(row?.created_at)
			const meta = parseEventMeta(row?.meta)
			const clientId = clientIdFromMeta(meta)
			const transitionedUserId = Number(meta?.transitioned?.user_id)
			const transitioned = Number.isFinite(transitionedUserId) && transitionedUserId > 0
			tryCids.add(cid)
			if (clientId) {
				tryClientIds.add(clientId)
				tryCidsWithClientId.add(cid)
			}
			if (shareCids.has(cid)) tryFromShareCids.add(cid)
			if (transitioned) {
				transitionedCids.add(cid)
				transitionedUserIds.add(transitionedUserId)
				if (clientId) transitionedClientIds.add(clientId)
				if (shareCids.has(cid)) transitionedFromShareCids.add(cid)
			}
			if (createdAt && createdAt >= window30Start) {
				tryRequests30++
				tryCids30.add(cid)
				if (clientId) {
					tryClientIds30.add(clientId)
					tryCidsWithClientId30.add(cid)
				}
				if (transitioned) {
					transitionedCids30.add(cid)
					transitionedUsers30.add(transitionedUserId)
					if (clientId) transitionedClientIds30.add(clientId)
					if (shareCids.has(cid)) transitionedFromShareCids30.add(cid)
				}
			}
		}

		const safeRate = (a, b) => Number(b ? (a / b).toFixed(4) : 0)
		const tryRequestCountAll = safeTry.filter((r) => {
			const cid = String(r?.anon_cid || '').trim()
			return cid && cid !== '__pool__'
		}).length

		return {
			all_time: {
				share_page_views: safeShare.length,
				share_unique_anon_cids: shareCids.size,
				try_requests: tryRequestCountAll,
				try_unique_anon_cids: tryCids.size,
				try_unique_cids_from_share: tryFromShareCids.size,
				try_from_share_rate_by_cid: safeRate(tryFromShareCids.size, tryCids.size),
				share_unique_client_ids: shareClientIds.size,
				try_unique_client_ids: tryClientIds.size,
				try_unique_cids_with_client_id: tryCidsWithClientId.size,
				try_client_id_coverage_by_cid: safeRate(tryCidsWithClientId.size, tryCids.size),
				transitioned_unique_client_ids: transitionedClientIds.size,
				try_client_to_transition_rate: safeRate(transitionedClientIds.size, tryClientIds.size),
				transitioned_unique_anon_cids: transitionedCids.size,
				transitioned_unique_users: transitionedUserIds.size,
				transitioned_from_share_unique_cids: transitionedFromShareCids.size,
				try_to_transition_rate_by_cid: safeRate(transitionedCids.size, tryCids.size),
				share_to_transition_rate_by_cid: safeRate(transitionedFromShareCids.size, shareCids.size)
			},
			last_30d: {
				share_page_views: shareViews30,
				share_unique_anon_cids: shareCids30.size,
				try_requests: tryRequests30,
				try_unique_anon_cids: tryCids30.size,
				share_unique_client_ids: shareClientIds30.size,
				try_unique_client_ids: tryClientIds30.size,
				try_unique_cids_with_client_id: tryCidsWithClientId30.size,
				try_client_id_coverage_by_cid: safeRate(tryCidsWithClientId30.size, tryCids30.size),
				transitioned_unique_client_ids: transitionedClientIds30.size,
				try_client_to_transition_rate: safeRate(transitionedClientIds30.size, tryClientIds30.size),
				transitioned_unique_anon_cids: transitionedCids30.size,
				transitioned_unique_users: transitionedUsers30.size,
				transitioned_from_share_unique_cids: transitionedFromShareCids30.size,
				try_to_transition_rate_by_cid: safeRate(transitionedCids30.size, tryCids30.size),
				share_to_transition_rate_by_cid: safeRate(transitionedFromShareCids30.size, shareCids30.size)
			}
		}
	}

	if (dbInstance?.db && typeof dbInstance.db.from === 'function') {
		// Use service role when available so event reads match admin visibility.
		const { createClient } = await import('@supabase/supabase-js')
		const supabaseUrl = process.env.SUPABASE_URL
		const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
		if (!supabaseUrl || !supabaseKey) {
			throw new Error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).')
		}
		const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
		const [
			createdImages,
			comments,
			likes,
			reactions,
			sessions,
			tips,
			shareRows,
			tryRows
		] = await Promise.all([
			fetchSupabaseRows(client, 'prsn_created_images', 'user_id,created_at,published_at,meta'),
			fetchSupabaseRows(client, 'prsn_comments_created_image', 'user_id,created_at'),
			fetchSupabaseRows(client, 'prsn_likes_created_image', 'user_id,created_at'),
			fetchSupabaseRows(client, 'prsn_comment_reactions', 'user_id,created_at'),
			fetchSupabaseRows(client, 'prsn_sessions', 'user_id,created_at'),
			fetchSupabaseRows(client, 'prsn_tip_activity', 'from_user_id,to_user_id,created_at'),
			fetchSupabaseRows(client, 'prsn_share_page_views', 'viewed_at,anon_cid,meta'),
			fetchSupabaseRows(client, 'prsn_try_requests', 'anon_cid,created_at,meta')
		])

		for (const row of createdImages) {
			let isMutation = false
			try {
				const meta = row?.meta && typeof row.meta === 'string' ? JSON.parse(row.meta) : (row?.meta || {})
				const mid = Number(meta?.mutate_of_id)
				isMutation = Number.isFinite(mid) && mid > 0
			} catch {
				isMutation = false
			}
			add(row.user_id, row.created_at, 'creation', { isMutation })
			add(row.user_id, row.published_at, 'publish')
		}
		for (const row of comments) add(row.user_id, row.created_at, 'comment')
		for (const row of likes) add(row.user_id, row.created_at, 'like')
		for (const row of reactions) add(row.user_id, row.created_at, 'reaction')
		for (const row of sessions) add(row.user_id, row.created_at, 'session')
		for (const row of tips) {
			add(row.from_user_id, row.created_at, 'tip_sent')
			add(row.to_user_id, row.created_at, 'tip_received')
		}
		for (const u of users) add(u.id, u.last_active_at, 'touch')
		const shareTryFunnel = buildShareTryFunnel(shareRows, tryRows)
		return { users, events, sourceLabel: 'supabase', shareTryFunnel }
	}

	if (dbInstance?.db && typeof dbInstance.db.prepare === 'function') {
		const sqliteEvents = loadEvents(dbInstance.db, minIso, allowedUserIds)
		let shareRows = []
		let tryRows = []
		try {
			shareRows = dbInstance.db.prepare(`SELECT viewed_at, anon_cid, meta FROM share_page_views`).all()
		} catch {
			shareRows = []
		}
		try {
			tryRows = dbInstance.db.prepare(`SELECT anon_cid, created_at, meta FROM try_requests`).all()
		} catch {
			tryRows = []
		}
		const shareTryFunnel = buildShareTryFunnel(shareRows, tryRows)
		return { users, events: sqliteEvents, sourceLabel: 'sqlite', shareTryFunnel }
	}

	throw new Error('Unsupported DB adapter: expected Supabase client or SQLite database handle.')
}

function buildStory(users, events) {
	const activeByDay = new Map()
	const activeByWeek = new Map()
	const activeByMonth = new Map()
	const newUsersByDay = new Map()
	const newUsersByWeek = new Map()
	const actionCountsByUser = new Map()
	const activeDaysByUser = new Map()
	const activityWeeksByUser = new Map()
	const usersById = new Map()

	for (const user of users) {
		usersById.set(Number(user.id), user)
		const created = safeDate(user.created_at)
		if (!created) continue
		const dayKey = toIsoDate(startOfUtcDay(created))
		const weekKey = getWeekKey(created)
		newUsersByDay.set(dayKey, (newUsersByDay.get(dayKey) || 0) + 1)
		newUsersByWeek.set(weekKey, (newUsersByWeek.get(weekKey) || 0) + 1)
	}

	const coreActionTypes = new Set(['creation', 'publish', 'comment', 'like', 'reaction', 'tip_sent'])
	for (const e of events) {
		const dayKey = toIsoDate(startOfUtcDay(e.ts))
		const weekKey = getWeekKey(e.ts)
		const monthKey = `${e.ts.getUTCFullYear()}-${String(e.ts.getUTCMonth() + 1).padStart(2, '0')}`

		if (!activeByDay.has(dayKey)) activeByDay.set(dayKey, new Set())
		if (!activeByWeek.has(weekKey)) activeByWeek.set(weekKey, new Set())
		if (!activeByMonth.has(monthKey)) activeByMonth.set(monthKey, new Set())
		activeByDay.get(dayKey).add(e.user_id)
		activeByWeek.get(weekKey).add(e.user_id)
		activeByMonth.get(monthKey).add(e.user_id)

		if (!activeDaysByUser.has(e.user_id)) activeDaysByUser.set(e.user_id, new Set())
		activeDaysByUser.get(e.user_id).add(dayKey)
		if (!activityWeeksByUser.has(e.user_id)) activityWeeksByUser.set(e.user_id, new Set())
		activityWeeksByUser.get(e.user_id).add(weekKey)

		if (!actionCountsByUser.has(e.user_id)) {
			actionCountsByUser.set(e.user_id, {
				sessions: 0, creations: 0, publishes: 0, comments: 0, likes: 0, reactions: 0, mutations: 0, tips_sent: 0
			})
		}
		const c = actionCountsByUser.get(e.user_id)
		if (e.type === 'session') c.sessions++
		if (e.type === 'creation') {
			c.creations++
			if (e.isMutation) c.mutations++
		}
		if (e.type === 'publish') c.publishes++
		if (e.type === 'comment') c.comments++
		if (e.type === 'like') c.likes++
		if (e.type === 'reaction') c.reactions++
		if (e.type === 'tip_sent') c.tips_sent++
	}

	const dayRows = [...activeByDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, set]) => ({
		day,
		dau: set.size,
		new_users: newUsersByDay.get(day) || 0
	}))
	const dailyAllTimeRows = []
	if (users.length) {
		const firstUserDate = safeDate(users[0]?.created_at) || startOfUtcDay(new Date())
		const startDay = startOfUtcDay(firstUserDate)
		const endDay = startOfUtcDay(new Date())
		for (let d = new Date(startDay.getTime()); d <= endDay; d = addDays(d, 1)) {
			const key = toIsoDate(d)
			dailyAllTimeRows.push({
				day: key,
				dau: (activeByDay.get(key) || new Set()).size
			})
		}
	}

	const weekRows = [...activeByWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, set]) => ({
		week,
		wau: set.size,
		new_users: newUsersByWeek.get(week) || 0
	}))
	const weeklyAllTimeRows = []
	if (users.length) {
		const firstUserDate = safeDate(users[0]?.created_at) || startOfUtcWeek(new Date())
		const startWeek = startOfUtcWeek(firstUserDate)
		const endWeek = startOfUtcWeek(new Date())
		for (let d = new Date(startWeek.getTime()); d <= endWeek; d = addDays(d, 7)) {
			const weekKey = toIsoDate(d)
			weeklyAllTimeRows.push({
				week: weekKey,
				new_users: newUsersByWeek.get(weekKey) || 0,
				wau: (activeByWeek.get(weekKey) || new Set()).size
			})
		}
	}
	let runningUsers = 0
	const cumulativeUsersByWeek = weeklyAllTimeRows.map((r) => {
		runningUsers += r.new_users
		return {
			week: r.week,
			new_users: r.new_users,
			total_users: runningUsers,
			wau: r.wau
		}
	})

	const monthRows = [...activeByMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, set]) => ({
		month,
		mau: set.size
	}))
	const monthlyAllTimeRows = []
	if (users.length) {
		const firstUserDate = safeDate(users[0]?.created_at) || new Date()
		const startMonth = new Date(Date.UTC(firstUserDate.getUTCFullYear(), firstUserDate.getUTCMonth(), 1))
		const endMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
		for (let d = new Date(startMonth.getTime()); d <= endMonth; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
			const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
			monthlyAllTimeRows.push({
				month: key,
				mau: (activeByMonth.get(key) || new Set()).size
			})
		}
	}

	const latestDay = dayRows[dayRows.length - 1] || { day: '-', dau: 0, new_users: 0 }
	const prevDay = dayRows[dayRows.length - 2] || { day: '-', dau: 0, new_users: 0 }
	const latestWeek = weekRows[weekRows.length - 1] || { week: '-', wau: 0, new_users: 0 }
	const prevWeek = weekRows[weekRows.length - 2] || { week: '-', wau: 0, new_users: 0 }
	const latestMonth = monthRows[monthRows.length - 1] || { month: '-', mau: 0 }
	const prevMonth = monthRows[monthRows.length - 2] || { month: '-', mau: 0 }

	const cohortRows = []
	const mondayNow = startOfUtcWeek(new Date())
	for (let i = COHORT_WEEKS - 1; i >= 0; i--) {
		const cohortStart = addDays(mondayNow, -i * 7)
		const cohortEnd = addDays(cohortStart, 7)
		const cohortKey = toIsoDate(cohortStart)
		const usersInCohort = users.filter(u => {
			const d = safeDate(u.created_at)
			return d && d >= cohortStart && d < cohortEnd
		})
		const size = usersInCohort.length
		const w1Start = addDays(cohortStart, 7)
		const w1End = addDays(cohortStart, 14)
		const w4Start = addDays(cohortStart, 28)
		const w4End = addDays(cohortStart, 35)
		let w1 = 0
		let w4 = 0
		for (const u of usersInCohort) {
			const uid = Number(u.id)
			const userEvents = events.filter(e => e.user_id === uid)
			const hasW1 = userEvents.some(e => e.ts >= w1Start && e.ts < w1End)
			const hasW4 = userEvents.some(e => e.ts >= w4Start && e.ts < w4End)
			if (hasW1) w1++
			if (hasW4) w4++
		}
		cohortRows.push({
			cohort: cohortKey,
			signups: size,
			w1_retained: w1,
			w1_rate: size ? w1 / size : 0,
			w4_retained: w4,
			w4_rate: size ? w4 / size : 0
		})
	}

	const latestWindowStart = addDays(startOfUtcDay(new Date()), -(WINDOW_DAYS - 1))
	const latestWindowEnd = addDays(startOfUtcDay(new Date()), 1)
	const prevWindowStart = addDays(latestWindowStart, -WINDOW_DAYS)
	const prevWindowEnd = latestWindowStart

	const inRange = (ts, start, end) => ts >= start && ts < end
	const currActive = new Set(events.filter(e => inRange(e.ts, latestWindowStart, latestWindowEnd)).map(e => e.user_id))
	const prevActive = new Set(events.filter(e => inRange(e.ts, prevWindowStart, prevWindowEnd)).map(e => e.user_id))
	let churned = 0
	for (const uid of prevActive) if (!currActive.has(uid)) churned++

	const currEvents = events.filter(e => inRange(e.ts, latestWindowStart, latestWindowEnd))
	const coreActions = currEvents.filter(e => coreActionTypes.has(e.type)).length
	const actionsPerActive = currActive.size ? coreActions / currActive.size : 0

	const paidUsers = users.filter(u => {
		try {
			const meta = typeof u.meta === 'string' ? JSON.parse(u.meta || '{}') : (u.meta || {})
			return meta?.plan === 'founder' || (meta?.stripeSubscriptionId && String(meta.stripeSubscriptionId).trim())
		} catch {
			return false
		}
	})

	const signup30d = users.filter(u => {
		const d = safeDate(u.created_at)
		return d && d >= latestWindowStart && d < latestWindowEnd
	})
	const signup30Ids = new Set(signup30d.map(u => Number(u.id)))
	const activated30 = new Set()
	const retained30 = new Set()
	for (const u of signup30d) {
		const uid = Number(u.id)
		const created = safeDate(u.created_at)
		if (!created) continue
		const hasActivation = events.some(e => e.user_id === uid && coreActionTypes.has(e.type) && e.ts >= created && e.ts < addDays(created, 7))
		const hasRetention = events.some(e => e.user_id === uid && e.ts >= addDays(created, 7) && e.ts < addDays(created, 30))
		if (hasActivation) activated30.add(uid)
		if (hasRetention) retained30.add(uid)
	}
	const payingFromSignup30 = signup30d.filter(u => {
		try {
			const meta = typeof u.meta === 'string' ? JSON.parse(u.meta || '{}') : (u.meta || {})
			return meta?.plan === 'founder' || (meta?.stripeSubscriptionId && String(meta.stripeSubscriptionId).trim())
		} catch {
			return false
		}
	}).length

	const actionLeaders = [...actionCountsByUser.entries()].map(([uid, c]) => {
		const core = c.creations + c.publishes + c.comments + c.likes + c.reactions + c.mutations + c.tips_sent
		const days = (activeDaysByUser.get(uid) || new Set()).size
		const user = usersById.get(uid) || {}
		return {
			user_id: uid,
			email: user.email || `user-${uid}`,
			core_actions: core,
			active_days: days,
			actions_per_active_day: days ? core / days : 0,
			...c
		}
	}).sort((a, b) => b.core_actions - a.core_actions).slice(0, 25)

	const weeklyGrowthRows = weekRows.slice(-10).map((row, idx, arr) => {
		const prev = arr[idx - 1]
		return {
			week: row.week,
			wau: row.wau,
			new_users: row.new_users,
			wau_wow: prev ? signedPct(row.wau, prev.wau) : '—',
			new_users_wow: prev ? signedPct(row.new_users, prev.new_users) : '—'
		}
	})

	const last6Weeks = weekRows.slice(-6)
	const avgWau = last6Weeks.length ? last6Weeks.reduce((s, r) => s + r.wau, 0) / last6Weeks.length : 0
	const avgNewUsers = last6Weeks.length ? last6Weeks.reduce((s, r) => s + r.new_users, 0) / last6Weeks.length : 0
	const avgW1 = cohortRows.filter(r => r.signups > 0).slice(-8).reduce((s, r) => s + r.w1_rate, 0) / Math.max(cohortRows.filter(r => r.signups > 0).slice(-8).length, 1)
	const avgW4 = cohortRows.filter(r => r.signups > 0).slice(-8).reduce((s, r) => s + r.w4_rate, 0) / Math.max(cohortRows.filter(r => r.signups > 0).slice(-8).length, 1)

	const observations = [
		`Active base: DAU is ${latestDay.dau} (${signedPct(latestDay.dau, prevDay.dau)} vs prior day), WAU is ${latestWeek.wau} (${signedPct(latestWeek.wau, prevWeek.wau)} vs prior week), and MAU is ${latestMonth.mau} (${signedPct(latestMonth.mau, prevMonth.mau)} vs prior month).`,
		`Acquisition: ${latestWeek.new_users} new users joined this week (${signedPct(latestWeek.new_users, prevWeek.new_users)} WoW). Recent 6-week averages are ${avgWau.toFixed(1)} WAU and ${avgNewUsers.toFixed(1)} new users/week.`,
		`Retention quality: average W+1 retention across recent cohorts is ${(avgW1 * 100).toFixed(1)}%, and W+4 is ${(avgW4 * 100).toFixed(1)}%.`,
		`Engagement depth: in the last ${WINDOW_DAYS} days, active users performed ${coreActions} core actions, or ${actionsPerActive.toFixed(2)} core actions per active user.`,
		`Churn pressure: ${churned} users were active in the previous ${WINDOW_DAYS}-day window but not in the latest window (${pct(churned, prevActive.size)} of prior-window active users).`,
		`Paid conversion snapshot: ${payingFromSignup30}/${signup30d.length} users who joined in the last ${WINDOW_DAYS} days are currently paid (${pct(payingFromSignup30, signup30d.length)}).`
	]

	return {
		latestDay, latestWeek, latestMonth, dayRows, weekRows, monthRows,
		cohortRows, weeklyGrowthRows, observations, actionLeaders,
		dailyAllTimeRows, weeklyAllTimeRows, cumulativeUsersByWeek, monthlyAllTimeRows,
		churned, prevActive: prevActive.size, currActive: currActive.size,
		coreActions, actionsPerActive, paidUsers: paidUsers.length, totalUsers: users.length,
		funnel: {
			signup30: signup30d.length,
			activated30: activated30.size,
			retained30: retained30.size,
			paid30: payingFromSignup30,
			signup30Ids: signup30Ids.size
		}
	}
}

function renderHtml(report) {
	const anonymizedPayload = buildAnonymizedExportPayload(report)
	const anonymizedPayloadJson = JSON.stringify(anonymizedPayload)
	const earliestWeek = report.cumulativeUsersByWeek[0]?.week || '—'
	const latestWeek = report.cumulativeUsersByWeek[report.cumulativeUsersByWeek.length - 1]?.week || '—'
	return `<!doctype html>
<meta charset="utf-8">
<title>Parascene User Growth Story</title>
<meta name="darkreader-lock" />
<style>
	body{font:14px/1.45 system-ui,sans-serif;max-width:1240px;margin:24px auto;padding:0 16px;color:#111}
	h1,h2{margin:0 0 12px}
	section{margin:0 0 28px}
	table{border-collapse:collapse;width:100%}
	th,td{padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;text-align:left}
	th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#475569}
	.small{color:#64748b;font-size:12px}
	.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
	.grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
	.card{border:1px solid #e5e7eb;padding:12px}
	ul{padding-left:18px;margin:8px 0 0}
	.warn{color:#92400e}
	.copy-row{display:flex;gap:8px;align-items:center;margin:8px 0 16px}
	.copy-status{color:#64748b;font-size:12px}
	@media (max-width: 900px){.grid,.grid-2{grid-template-columns:1fr}}
</style>
<p class="small"><a href=".">Up one folder</a></p>
<h1>Parascene User Growth Story</h1>
<div class="copy-row">
	<button type="button" id="copy-anonymized-report">Copy anonymized report data</button>
	<span class="copy-status" id="copy-anonymized-status" aria-live="polite"></span>
</div>
<p class="small">Generated: ${esc(fmt.format(now))} (${esc(TZ)})</p>
<p class="small">Coverage: all-time user growth from ${esc(earliestWeek)} to ${esc(latestWeek)}. Activity/engagement calculations use last ${LOOKBACK_DAYS} days by default (set LOOKBACK_DAYS to change).</p>

<section class="grid">
	<div class="card"><div class="small">Total users (all-time)</div><div>${report.totalUsers}</div></div>
	<div class="card"><div class="small">Paid users (current snapshot)</div><div>${report.paidUsers}</div></div>
	<div class="card"><div class="small">DAU (latest day)</div><div>${report.latestDay.dau}</div></div>
	<div class="card"><div class="small">WAU (latest week)</div><div>${report.latestWeek.wau}</div></div>
	<div class="card"><div class="small">MAU (latest month)</div><div>${report.latestMonth.mau}</div></div>
	<div class="card"><div class="small">Core actions / active user (${WINDOW_DAYS}d)</div><div>${report.actionsPerActive.toFixed(2)}</div></div>
</section>

<section>
	<h2>Quick glossary (plain English)</h2>
	<ul>
		<li><strong>DAU</strong>: daily active users (unique users active on a day). Use for daily heartbeat.</li>
		<li><strong>WAU</strong>: weekly active users (unique users active in a week). Use for short-term trend and stickiness.</li>
		<li><strong>MAU</strong>: monthly active users (unique users active in a month). Use for broader growth baseline.</li>
		<li><strong>Retention (W+1, W+4)</strong>: of users who joined in a week, % who come back 1 and 4 weeks later. Use for product-market fit signal.</li>
		<li><strong>Core actions/user</strong>: how much users actually do (comments, creations, publish, likes, reactions, mutations, tips sent).</li>
	</ul>
</section>

<section>
	<h2>All-time growth since launch</h2>
	<div class="grid-2">
		<div class="card">
			<div class="small">DAU (all days, with trend)</div>
			${sparklineWithTrend(report.dailyAllTimeRows, 'dau', 'day', '#0ea5e9')}
		</div>
		<div class="card">
			<div class="small">WAU (all weeks, with trend)</div>
			${sparklineWithTrend(report.weeklyAllTimeRows, 'wau', 'week', '#2563eb')}
		</div>
	</div>
	<div class="grid-2">
		<div class="card">
			<div class="small">MAU (all months, with trend)</div>
			${sparklineWithTrend(report.monthlyAllTimeRows, 'mau', 'month', '#7c3aed')}
		</div>
		<div class="card">
			<div class="small">New users by week (all-time, with trend)</div>
			${sparklineWithTrend(report.cumulativeUsersByWeek, 'new_users', 'week', '#d97706')}
		</div>
	</div>
	<div class="grid-2">
		<div class="card">
			<div class="small">Total users (cumulative, all-time)</div>
			${sparkline(report.cumulativeUsersByWeek, 'total_users', 'week', '#059669')}
		</div>
		<div class="card"><div class="small">Legend</div><p class="small">Dashed red line indicates linear regression trend.</p></div>
	</div>
	<p class="small">This section answers “are we gaining users over all time?” directly from user signups since launch.</p>
</section>

<section>
	<h2>Story</h2>
	<ul>${report.observations.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
</section>

<section>
	<h2>If we keep only three</h2>
	<ul>
		<li><strong>Active users:</strong> WAU ${report.latestWeek.wau}, MAU ${report.latestMonth.mau}.</li>
		<li><strong>Retention:</strong> review W+1 and W+4 cohort rates below.</li>
		<li><strong>Core action per user:</strong> ${report.actionsPerActive.toFixed(2)} over the last ${WINDOW_DAYS} days.</li>
	</ul>
</section>

<section>
	<h2>Active users and growth</h2>
	<p class="small">No non-all-time charts are shown. This section keeps a numeric weekly table only.</p>
	${table(report.weeklyGrowthRows, [
		{ label: 'Week', key: 'week' },
		{ label: 'WAU', key: 'wau' },
		{ label: 'New users', key: 'new_users' },
		{ label: 'WAU WoW', key: 'wau_wow' },
		{ label: 'New users WoW', key: 'new_users_wow' }
	])}
</section>

<section>
	<h2>Retention by cohort</h2>
	${table(report.cohortRows, [
		{ label: 'Cohort week', key: 'cohort' },
		{ label: 'Signups', key: 'signups' },
		{ label: 'W+1 retained', key: 'w1_retained' },
		{ label: 'W+1 rate', html: r => pct(r.w1_retained, r.signups) },
		{ label: 'W+4 retained', key: 'w4_retained' },
		{ label: 'W+4 rate', html: r => pct(r.w4_retained, r.signups) },
		{ label: 'W1-W4 gap', html: r => r.signups ? pp(r.w1_rate, r.w4_rate) : '—' }
	])}
</section>

<section>
	<h2>Engagement depth leaders (core actions)</h2>
	${table(report.actionLeaders, [
		{ label: 'User', html: r => esc(r.email) },
		{ label: 'Core actions', key: 'core_actions' },
		{ label: 'Active days', key: 'active_days' },
		{ label: 'Actions/active day', html: r => r.actions_per_active_day.toFixed(2) },
		{ label: 'Creations', key: 'creations' },
		{ label: 'Publishes', key: 'publishes' },
		{ label: 'Comments', key: 'comments' },
		{ label: 'Likes', key: 'likes' },
		{ label: 'Reactions', key: 'reactions' },
		{ label: 'Mutations', key: 'mutations' }
	])}
</section>

<section>
	<h2>Conversion funnel (${WINDOW_DAYS}d signup cohort)</h2>
	${table([{
		visitors: 'N/A (not tracked in app DB)',
		signups: report.funnel.signup30,
		activated: report.funnel.activated30,
		retained: report.funnel.retained30,
		paid: report.funnel.paid30
	}], [
		{ label: 'Visitors', key: 'visitors' },
		{ label: 'Signups', key: 'signups' },
		{ label: 'Activated (core action <= 7d)', key: 'activated' },
		{ label: 'Retained (activity days 8-30)', key: 'retained' },
		{ label: 'Paid now', key: 'paid' },
		{ label: 'Activation rate', html: r => pct(r.activated, r.signups) },
		{ label: 'Retention rate', html: r => pct(r.retained, r.signups) },
		{ label: 'Paid conversion', html: r => pct(r.paid, r.signups) }
	])}
	<p class="small warn">Visitor-level funnel stages require web analytics/page-view instrumentation outside the app DB.</p>
</section>

${report.shareTryFunnel ? `
<section>
	<h2>Share + try-flow conversion signals</h2>
	${table([
		{
			window: 'All-time',
			share_views: report.shareTryFunnel.all_time.share_page_views,
			share_cids: report.shareTryFunnel.all_time.share_unique_anon_cids,
			try_requests: report.shareTryFunnel.all_time.try_requests,
			try_cids: report.shareTryFunnel.all_time.try_unique_anon_cids,
			try_from_share_cids: report.shareTryFunnel.all_time.try_unique_cids_from_share,
			transitioned_cids: report.shareTryFunnel.all_time.transitioned_unique_anon_cids,
			transitioned_users: report.shareTryFunnel.all_time.transitioned_unique_users,
			try_to_transition: report.shareTryFunnel.all_time.try_to_transition_rate_by_cid,
			share_to_transition: report.shareTryFunnel.all_time.share_to_transition_rate_by_cid
		},
		{
			window: `Last ${WINDOW_DAYS}d`,
			share_views: report.shareTryFunnel.last_30d.share_page_views,
			share_cids: report.shareTryFunnel.last_30d.share_unique_anon_cids,
			try_requests: report.shareTryFunnel.last_30d.try_requests,
			try_cids: report.shareTryFunnel.last_30d.try_unique_anon_cids,
			try_from_share_cids: '—',
			transitioned_cids: report.shareTryFunnel.last_30d.transitioned_unique_anon_cids,
			transitioned_users: report.shareTryFunnel.last_30d.transitioned_unique_users,
			try_to_transition: report.shareTryFunnel.last_30d.try_to_transition_rate_by_cid,
			share_to_transition: report.shareTryFunnel.last_30d.share_to_transition_rate_by_cid
		}
	], [
		{ label: 'Window', key: 'window' },
		{ label: 'Share views', key: 'share_views' },
		{ label: 'Share unique anon cids', key: 'share_cids' },
		{ label: 'Try requests', key: 'try_requests' },
		{ label: 'Try unique anon cids', key: 'try_cids' },
		{ label: 'Try from share cids', key: 'try_from_share_cids' },
		{ label: 'Transitioned cids', key: 'transitioned_cids' },
		{ label: 'Transitioned users', key: 'transitioned_users' },
		{ label: 'Try->transition rate', html: r => typeof r.try_to_transition === 'number' ? pct(r.try_to_transition, 1) : '—' },
		{ label: 'Share->transition rate', html: r => typeof r.share_to_transition === 'number' ? pct(r.share_to_transition, 1) : '—' }
	])}
	<p class="small">“Transitioned” is a proxy for try-flow visits converting into an identified user via transition metadata.</p>
	${table([
		{
			window: 'All-time',
			share_clients: report.shareTryFunnel.all_time.share_unique_client_ids,
			try_clients: report.shareTryFunnel.all_time.try_unique_client_ids,
			try_cids_with_client: report.shareTryFunnel.all_time.try_unique_cids_with_client_id,
			try_client_coverage: report.shareTryFunnel.all_time.try_client_id_coverage_by_cid,
			transitioned_clients: report.shareTryFunnel.all_time.transitioned_unique_client_ids,
			client_to_transition: report.shareTryFunnel.all_time.try_client_to_transition_rate
		},
		{
			window: `Last ${WINDOW_DAYS}d`,
			share_clients: report.shareTryFunnel.last_30d.share_unique_client_ids,
			try_clients: report.shareTryFunnel.last_30d.try_unique_client_ids,
			try_cids_with_client: report.shareTryFunnel.last_30d.try_unique_cids_with_client_id,
			try_client_coverage: report.shareTryFunnel.last_30d.try_client_id_coverage_by_cid,
			transitioned_clients: report.shareTryFunnel.last_30d.transitioned_unique_client_ids,
			client_to_transition: report.shareTryFunnel.last_30d.try_client_to_transition_rate
		}
	], [
		{ label: 'Window', key: 'window' },
		{ label: 'Share unique prsn_cid', key: 'share_clients' },
		{ label: 'Try unique prsn_cid', key: 'try_clients' },
		{ label: 'Try cids with prsn_cid', key: 'try_cids_with_client' },
		{ label: 'Try prsn_cid coverage', html: r => typeof r.try_client_coverage === 'number' ? pct(r.try_client_coverage, 1) : '—' },
		{ label: 'Transitioned prsn_cid', key: 'transitioned_clients' },
		{ label: 'prsn_cid→transition rate', html: r => typeof r.client_to_transition === 'number' ? pct(r.client_to_transition, 1) : '—' }
	])}
	<p class="small">Identity graph coverage: how well prsn_cid is present and linked across share/try/transition events.</p>
</section>
` : ''}

<section>
	<h2>Churn snapshot</h2>
	<p>${report.churned} of ${report.prevActive} users active in the previous ${WINDOW_DAYS}-day window did not return in the latest window (${pct(report.churned, report.prevActive)}).</p>
</section>
<script>
(() => {
	const payload = ${anonymizedPayloadJson};
	const btn = document.getElementById('copy-anonymized-report');
	const status = document.getElementById('copy-anonymized-status');
	if (!btn) return;
	const setStatus = (msg) => { if (status) status.textContent = msg || ''; };
	const text = 'PARASCENE_ANONYMIZED_REPORT\\n' + JSON.stringify(payload, null, 2);
	async function copy() {
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
	btn.addEventListener('click', async () => {
		try {
			setStatus('Copying…');
			await copy();
			setStatus('Copied anonymized JSON to clipboard.');
		} catch (err) {
			setStatus('Copy failed.');
		}
	});
})();
</script>
`
}

async function main() {
	// Default to Supabase when .env provides credentials.
	if (!process.env.DB_ADAPTER) process.env.DB_ADAPTER = 'supabase'
	const { openDb } = await import('../db/index.js')
	const dbInstance = await openDb({ quiet: true })
	const lookbackStart = addDays(startOfUtcDay(new Date()), -LOOKBACK_DAYS)
	const loaded = await loadFromDbInstance(dbInstance, lookbackStart.toISOString())
	const users = loaded.users
	const events = loaded.events
	const sourceLabel = loaded.sourceLabel
	const report = buildStory(users, events)
	report.shareTryFunnel = loaded.shareTryFunnel || null

	const outStamp = toIsoDate(startOfUtcDay(now))
	const defaultOut = path.join('.output', 'user-growth-story', `user-growth-story-${outStamp}.html`)
	const OUT = process.env.OUT || defaultOut
	await fs.mkdir(path.dirname(OUT), { recursive: true })
	const html = renderHtml(report).replace('</h1>', `</h1>\n<p class="small">Data source: ${esc(sourceLabel === 'supabase' ? 'Supabase (via DB adapter)' : 'SQLite (via DB adapter)')}</p>`)
	await fs.writeFile(OUT, html)
	if (typeof dbInstance?.db?.close === 'function') dbInstance.db.close()
	console.log(`wrote ${OUT}`)
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
