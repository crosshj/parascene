/**
 * Analyze past-week vs historical creation activity.
 */

import { allSignals } from './text-signals.js';

/**
 * @param {string|null|undefined} iso
 * @param {Date} windowStart
 * @param {Date} windowEnd
 */
export function isInWindow(iso, windowStart, windowEnd) {
	if (!iso) return false;
	const d = new Date(iso);
	if (!Number.isFinite(d.getTime())) return false;
	return d >= windowStart && d <= windowEnd;
}

/**
 * @param {import('./normalize.js').NormalizedCreation[]} creations
 * @param {Date} windowStart
 * @param {Date} windowEnd
 */
export function splitByWindow(creations, windowStart, windowEnd) {
	const pastWeek = [];
	const historical = [];
	for (const c of creations) {
		if (isInWindow(c.created_date, windowStart, windowEnd)) pastWeek.push(c);
		else historical.push(c);
	}
	return { pastWeek, historical };
}

/**
 * @param {import('./normalize.js').NormalizedCreation[]} list
 * @param {'terms'|'phrases'|'all'} field
 */
function signalStats(list, field = 'all') {
	/** @type {Map<string, { count: number, attention: number }>} */
	const map = new Map();
	for (const c of list) {
		let signals = [];
		if (field === 'terms') signals = c.text_signals.terms;
		else if (field === 'phrases') signals = c.text_signals.phrases;
		else signals = allSignals(c.text_signals);
		for (const sig of signals) {
			const cur = map.get(sig) ?? { count: 0, attention: 0 };
			cur.count += 1;
			cur.attention += c.attention_score;
			map.set(sig, cur);
		}
	}
	return map;
}

/**
 * @param {Map<string, { count: number, attention: number }>} stats
 * @param {'count'|'attention'} sortBy
 * @param {number} limit
 */
function topSignals(stats, sortBy, limit) {
	return [...stats.entries()]
		.map(([signal, s]) => ({
			signal,
			count: s.count,
			total_attention: s.attention,
			avg_attention: s.count ? s.attention / s.count : 0
		}))
		.sort((a, b) => (sortBy === 'count' ? b.count - a.count : b.total_attention - a.total_attention))
		.slice(0, limit);
}

/**
 * @param {import('./normalize.js').NormalizedCreation[]} pastWeek
 * @param {import('./normalize.js').NormalizedCreation[]} historical
 * @param {'terms'|'phrases'} field
 * @param {number} limit
 */
function risingSignals(pastWeek, historical, field, limit = 15) {
	const weekStats = signalStats(pastWeek, field);
	const histStats = signalStats(historical, field);
	const histTotal = Math.max(historical.length, 1);
	const weekTotal = Math.max(pastWeek.length, 1);

	const rows = [];
	for (const [signal, ws] of weekStats) {
		const hs = histStats.get(signal);
		const weekRate = ws.count / weekTotal;
		const histRate = (hs?.count ?? 0) / histTotal;
		const lift = histRate > 0 ? weekRate / histRate : weekRate > 0 ? 99 : 0;
		rows.push({
			signal,
			week_count: ws.count,
			hist_count: hs?.count ?? 0,
			week_rate: weekRate,
			hist_rate: histRate,
			lift
		});
	}
	return rows
		.filter((r) => r.week_count >= 2)
		.sort((a, b) => b.lift - a.lift || b.week_count - a.week_count)
		.slice(0, limit);
}

/**
 * @param {import('./normalize.js').NormalizedCreation[]} list
 * @param {number} limit
 */
function termCooccurrences(list, limit = 12) {
	/** @type {Map<string, { count: number, attention: number }>} */
	const pairs = new Map();
	for (const c of list) {
		const terms = [...c.text_signals.terms].sort();
		for (let i = 0; i < terms.length; i++) {
			for (let j = i + 1; j < terms.length; j++) {
				const key = `${terms[i]} + ${terms[j]}`;
				const cur = pairs.get(key) ?? { count: 0, attention: 0 };
				cur.count += 1;
				cur.attention += c.attention_score;
				pairs.set(key, cur);
			}
		}
	}
	return [...pairs.entries()]
		.map(([combo, s]) => ({ combo, count: s.count, total_attention: s.attention }))
		.sort((a, b) => b.count - a.count || b.total_attention - a.total_attention)
		.slice(0, limit);
}

/**
 * High frequency in the window but weak engagement — possible generic filler.
 * @param {import('./normalize.js').NormalizedCreation[]} list
 * @param {'terms'|'phrases'} field
 */
function lowEngagementHighFrequency(list, field, limit = 10) {
	const stats = signalStats(list, field);
	const medAttention =
		list.length === 0
			? 0
			: [...list].sort((a, b) => a.attention_score - b.attention_score)[
					Math.floor(list.length / 2)
				]?.attention_score ?? 0;

	return topSignals(stats, 'count', 50)
		.filter((row) => row.count >= 5 && row.avg_attention < medAttention * 0.5)
		.slice(0, limit);
}

/**
 * @param {import('./normalize.js').NormalizedCreation[]} list
 * @param {number} n
 */
export function strongestExamples(list, n = 8) {
	return [...list]
		.filter((c) => c.prompt || c.caption || c.title !== 'Untitled')
		.sort((a, b) => b.attention_score - a.attention_score)
		.slice(0, n);
}

/**
 * @param {import('./normalize.js').NormalizedCreation[]} list
 * @param {number} n
 */
export function weakExamples(list, n = 6) {
	return [...list]
		.filter((c) => c.prompt || c.caption)
		.sort((a, b) => a.attention_score - b.attention_score || String(a.created_date).localeCompare(String(b.created_date)))
		.slice(0, n);
}

/**
 * @param {import('./normalize.js').NormalizedCreation} c
 * @param {string} signal
 */
function creationHasSignal(c, signal) {
	return c.text_signals.terms.includes(signal) || c.text_signals.phrases.includes(signal);
}

/**
 * @param {import('./normalize.js').NormalizedCreation[]} list
 * @param {string[]} topSignals
 * @param {number} n
 */
export function representativeExamples(list, topSignals, n = 6) {
	const picked = [];
	const used = new Set();
	for (const signal of topSignals) {
		const match = list.find(
			(c) => !used.has(c.id) && creationHasSignal(c, signal) && (c.prompt || c.caption)
		);
		if (match) {
			picked.push(match);
			used.add(match.id);
		}
		if (picked.length >= n) break;
	}
	if (picked.length < n) {
		const median = [...list].sort((a, b) => a.attention_score - b.attention_score)[
			Math.floor(list.length / 2)
		];
		if (median && !used.has(median.id)) picked.push(median);
	}
	return picked.slice(0, n);
}

/**
 * Rare phrases + some text density — oddballs, not pre-labeled.
 * @param {import('./normalize.js').NormalizedCreation[]} list
 * @param {number} n
 */
export function weirdExamples(list, n = 5) {
	const phraseFreq = signalStats(list, 'phrases');
	return [...list]
		.filter((c) => c.text_signals.phrases.length >= 1 && (c.prompt || c.caption))
		.map((c) => {
			const rarity =
				c.text_signals.phrases.reduce(
					(sum, p) => sum + 1 / Math.max(phraseFreq.get(p)?.count ?? 1, 1),
					0
				) / Math.max(c.text_signals.phrases.length, 1);
			const textLen = (c.prompt || c.caption || '').length;
			const score = rarity * 10 + Math.min(textLen / 200, 5) + Math.min(c.attention_score, 20) * 0.05;
			return { c, score };
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, n)
		.map((x) => x.c);
}

/**
 * @param {import('./normalize.js').NormalizedCreation[]} historical
 * @param {string[]} weekTopSignals
 * @param {number} n
 */
export function historicallySimilar(historical, weekTopSignals, n = 6) {
	const signalSet = new Set(weekTopSignals);
	return [...historical]
		.map((c) => {
			const overlap = allSignals(c.text_signals).filter((s) => signalSet.has(s)).length;
			return { c, score: c.attention_score * (1 + overlap * 0.5) };
		})
		.filter((x) => allSignals(x.c.text_signals).some((s) => signalSet.has(s)))
		.sort((a, b) => b.score - a.score)
		.slice(0, n)
		.map((x) => x.c);
}

/**
 * @param {import('./normalize.js').NormalizedCreation[]} pastWeek
 * @param {import('./normalize.js').NormalizedCreation[]} historical
 */
export function buildAnalysis(pastWeek, historical) {
	const weekTermStats = signalStats(pastWeek, 'terms');
	const weekPhraseStats = signalStats(pastWeek, 'phrases');
	const histTermStats = signalStats(historical, 'terms');

	const commonTerms = topSignals(weekTermStats, 'count', 20);
	const commonPhrases = topSignals(weekPhraseStats, 'count', 15);
	const strongTerms = topSignals(weekTermStats, 'attention', 15);
	const risingTerms = risingSignals(pastWeek, historical, 'terms', 12);
	const risingPhrases = risingSignals(pastWeek, historical, 'phrases', 10);
	const cooccurrences = termCooccurrences(pastWeek, 12);
	const lowEngagementTerms = lowEngagementHighFrequency(pastWeek, 'terms', 10);

	const topTermNames = commonTerms.slice(0, 8).map((a) => a.signal);

	const mediaMix = {};
	for (const c of pastWeek) {
		mediaMix[c.media_type] = (mediaMix[c.media_type] ?? 0) + 1;
	}

	const attnSorted = [...pastWeek].sort((a, b) => b.attention_score - a.attention_score);
	const medianAttention =
		attnSorted.length === 0
			? 0
			: attnSorted[Math.floor(attnSorted.length / 2)]?.attention_score ?? 0;

	const histStrong = [...historical]
		.sort((a, b) => b.attention_score - a.attention_score)
		.slice(0, 20);

	return {
		counts: {
			past_week: pastWeek.length,
			historical: historical.length,
			median_week_attention: medianAttention
		},
		language: {
			common_terms: commonTerms,
			common_phrases: commonPhrases,
			strong_terms: strongTerms,
			rising_terms: risingTerms,
			rising_phrases: risingPhrases,
			low_engagement_high_frequency: lowEngagementTerms
		},
		cooccurrences,
		media_mix: mediaMix,
		historical_baseline: {
			top_terms: topSignals(histTermStats, 'count', 10),
			strongest: histStrong.slice(0, 5).map((c) => ({
				id: c.id,
				title: c.title,
				attention_score: c.attention_score,
				sample_terms: c.text_signals.terms.slice(0, 8)
			}))
		},
		examples: {
			strongest_week: strongestExamples(pastWeek, 8),
			representative_week: representativeExamples(pastWeek, topTermNames, 6),
			weird_week: weirdExamples(pastWeek, 5),
			weak_week: weakExamples(pastWeek, 6),
			historically_similar: historicallySimilar(historical, topTermNames, 6)
		}
	};
}
