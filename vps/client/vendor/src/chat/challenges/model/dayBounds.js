/**
 * Day-boundary helpers for challenge schedules (organizer local timezone).
 */

/**
 * @param {string} ymd YYYY-MM-DD
 * @returns {{ y: number, m: number, d: number } | null}
 */
export function parseYmd(ymd) {
	const s = typeof ymd === 'string' ? ymd.trim() : '';
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
	if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
	return { y, m: mo, d };
}

/**
 * @param {number} y
 * @param {number} m 1-12
 * @param {number} d
 */
export function formatYmd(y, m, d) {
	const pad = (n) => String(n).padStart(2, '0');
	return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Local calendar date as YYYY-MM-DD.
 * @param {Date} [date]
 */
export function dateToLocalYmd(date = new Date()) {
	const d = date instanceof Date ? date : new Date();
	if (!Number.isFinite(d.getTime())) return '';
	return formatYmd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Start of local day → ISO UTC.
 * @param {string} ymd YYYY-MM-DD
 */
export function localStartOfDayToIso(ymd) {
	const p = parseYmd(ymd);
	if (!p) return '';
	const d = new Date(p.y, p.m - 1, p.d, 0, 0, 0, 0);
	return Number.isFinite(d.getTime()) ? d.toISOString() : '';
}

/**
 * End of local day (23:59:59.999) → ISO UTC.
 * @param {string} ymd YYYY-MM-DD
 */
export function localEndOfDayToIso(ymd) {
	const p = parseYmd(ymd);
	if (!p) return '';
	const d = new Date(p.y, p.m - 1, p.d, 23, 59, 59, 999);
	return Number.isFinite(d.getTime()) ? d.toISOString() : '';
}

/**
 * ISO timestamp → local YYYY-MM-DD for date inputs.
 * @param {unknown} iso
 */
export function isoToLocalYmd(iso) {
	const s = typeof iso === 'string' ? iso.trim() : '';
	if (!s) return '';
	const d = new Date(s);
	if (!Number.isFinite(d.getTime())) return '';
	return dateToLocalYmd(d);
}

/**
 * Inclusive day count between two YMD strings (local).
 * @param {string} startYmd
 * @param {string} endYmd
 */
export function daysInclusive(startYmd, endYmd) {
	const a = parseYmd(startYmd);
	const b = parseYmd(endYmd);
	if (!a || !b) return 0;
	const t0 = Date.UTC(a.y, a.m - 1, a.d);
	const t1 = Date.UTC(b.y, b.m - 1, b.d);
	return Math.floor((t1 - t0) / 86400000) + 1;
}

/**
 * Add days to a YMD (local calendar math via UTC noon to avoid DST edge cases).
 * @param {string} ymd
 * @param {number} deltaDays
 */
export function addDaysYmd(ymd, deltaDays) {
	const p = parseYmd(ymd);
	if (!p) return '';
	const d = new Date(Date.UTC(p.y, p.m - 1, p.d));
	d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0));
	return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Compare YMD strings lexicographically (valid for ISO dates).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareYmd(a, b) {
	return String(a || '').localeCompare(String(b || ''));
}

/**
 * Inclusive ranges overlap?
 * @param {{ start: string, end: string }} a
 * @param {{ start: string, end: string }} b
 */
export function ymdRangesOverlap(a, b) {
	if (!a?.start || !a?.end || !b?.start || !b?.end) return false;
	return compareYmd(a.start, b.end) <= 0 && compareYmd(b.start, a.end) <= 0;
}

/**
 * First day of the month that contains the majority of days in [startYmd, endYmd].
 * Ties go to the earlier month. Empty/invalid range → ''.
 * @param {string} startYmd
 * @param {string} endYmd
 */
export function majorityMonthYmdFromRange(startYmd, endYmd) {
	let start = parseYmd(startYmd);
	let end = parseYmd(endYmd);
	if (!start && !end) return '';
	if (!start) start = end;
	if (!end) end = start;
	if (!start || !end) return '';
	if (compareYmd(formatYmd(start.y, start.m, start.d), formatYmd(end.y, end.m, end.d)) > 0) {
		const tmp = start;
		start = end;
		end = tmp;
	}
	/** @type {Map<string, number>} */
	const counts = new Map();
	let cur = formatYmd(start.y, start.m, start.d);
	const last = formatYmd(end.y, end.m, end.d);
	let guard = 0;
	while (compareYmd(cur, last) <= 0 && guard < 800) {
		guard += 1;
		const p = parseYmd(cur);
		if (!p) break;
		const key = formatYmd(p.y, p.m, 1);
		counts.set(key, (counts.get(key) || 0) + 1);
		cur = addDaysYmd(cur, 1);
		if (!cur) break;
	}
	let best = '';
	let bestCount = -1;
	for (const [key, n] of counts) {
		if (n > bestCount || (n === bestCount && (!best || compareYmd(key, best) < 0))) {
			best = key;
			bestCount = n;
		}
	}
	return best;
}
