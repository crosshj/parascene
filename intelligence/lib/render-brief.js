/**
 * Render paste-ready Markdown brief for an advanced LLM.
 */

/**
 * @param {import('./normalize.js').NormalizedCreation} c
 */
function formatMetrics(c) {
	const parts = [
		`attention ${c.attention_score}`,
		`likes ${c.likes}`,
		`comments ${c.comments}`,
		`remixes ${c.remixes}`,
		`shares ${c.shares}`
	];
	if (c.views != null) parts.push(`views ${c.views}`);
	if (c.attention_rate != null) parts.push(`attention_rate ${c.attention_rate.toFixed(4)}`);
	return parts.join(' · ');
}

/**
 * @param {import('./normalize.js').NormalizedCreation} c
 */
function formatSignalSnippet(c) {
	const terms = c.text_signals.terms.slice(0, 10);
	const phrases = c.text_signals.phrases.slice(0, 5);
	const parts = [];
	if (terms.length) parts.push(`terms: ${terms.join(', ')}`);
	if (phrases.length) parts.push(`phrases: ${phrases.join('; ')}`);
	return parts.length ? parts.join(' · ') : '(no text signals)';
}

/**
 * @param {import('./normalize.js').NormalizedCreation} c
 */
function formatExampleBlock(c) {
	const promptOrCaption = c.prompt || c.caption || '(no prompt/caption)';
	const lines = [
		`### ${c.title} (id ${c.id})`,
		'',
		`- **created:** ${c.created_date ? c.created_date.slice(0, 10) : 'unknown'}`,
		`- **media:** ${c.media_type}`,
		`- **metrics:** ${formatMetrics(c)}`,
		`- **text signals:** ${formatSignalSnippet(c)}`,
		''
	];
	if (c.challenge_event) lines.push(`- **challenge/event:** ${c.challenge_event}`, '');
	if (c.model_used) lines.push(`- **model:** ${c.model_used}`, '');
	lines.push('**prompt or caption:**', '', '```', promptOrCaption, '```', '');
	return lines.join('\n');
}

/**
 * @param {import('./normalize.js').NormalizedCreation[]} list
 */
function formatExampleSection(title, list) {
	if (!list.length) return `## ${title}\n\n_(none in window)_\n`;
	return `## ${title}\n\n${list.map(formatExampleBlock).join('\n')}`;
}

/**
 * @param {{ signal: string, count: number, total_attention?: number, avg_attention?: number }[]} rows
 */
function formatSignalTable(rows, label) {
	if (!rows.length) return `### ${label}\n\n_(none)_\n`;
	const lines = rows.map(
		(r) =>
			`- **${r.signal}** — count ${r.count}` +
			(r.total_attention != null ? `, total attention ${Math.round(r.total_attention)}` : '') +
			(r.avg_attention != null ? `, avg attention ${r.avg_attention.toFixed(1)}` : '')
	);
	return `### ${label}\n\n${lines.join('\n')}\n`;
}

/**
 * @param {ReturnType<import('./analyze.js').buildAnalysis>} analysis
 * @param {{ windowStart: Date, windowEnd: Date, days: number, generatedAt: Date }} meta
 */
export function renderBrief(analysis, meta) {
	const windowLabel = `${meta.windowStart.toISOString().slice(0, 10)} → ${meta.windowEnd.toISOString().slice(0, 10)}`;

	const risingTermLines = analysis.language.rising_terms.map(
		(r) =>
			`- **${r.signal}** — week ${r.week_count}, historical ${r.hist_count}, lift ×${r.lift.toFixed(2)}`
	);

	const risingPhraseLines = analysis.language.rising_phrases.map(
		(r) =>
			`- **${r.signal}** — week ${r.week_count}, historical ${r.hist_count}, lift ×${r.lift.toFixed(2)}`
	);

	const comboLines = analysis.cooccurrences.map(
		(c) => `- **${c.combo}** — ${c.count} creations, total attention ${Math.round(c.total_attention)}`
	);

	const lowEngLines = analysis.language.low_engagement_high_frequency.map(
		(r) => `- **${r.signal}** — ${r.count}× this week, avg attention ${r.avg_attention.toFixed(1)}`
	);

	const mediaLines = Object.entries(analysis.media_mix)
		.sort((a, b) => b[1] - a[1])
		.map(([k, v]) => `- ${k}: ${v}`);

	const histBaseline = analysis.historical_baseline.top_terms
		.map((r) => `- ${r.signal} (${r.count})`)
		.join('\n');

	return `# Parascene past-week creative brief

Generated: ${meta.generatedAt.toISOString()}
Window: last **${meta.days}** days (${windowLabel})
Creations in window: **${analysis.counts.past_week}** · historical comparison set: **${analysis.counts.historical}**
Median attention in window: **${analysis.counts.median_week_attention}**

---

## Instructions for the advanced LLM

You are analyzing Parascene's recent creative behavior. Your job is to infer what the community has been trying to make over the past week, then generate **one new prompt** that feels adjacent to that recent activity.

**Rules:**
- Do not copy any example directly.
- Do not average everything into generic AI-art slop.
- **You** name the recurring creative moves ("intent atoms") — e.g. short vibe labels like *corporate monster*, *cute but wrong*, *mundane mythic*. The brief below only has raw language patterns from real prompts; it does not pre-label those moves.
- Extract hidden creative moves and recombine them into something fresh, specific, legible, and Parascene-native.
- Prefer moves (tonal collisions, desire patterns) over surface subject matter.

**Return the following:**

1. A short summary of what Parascene was like this past week
2. The top recurring creative moves (**your** intent atoms, inferred from the data)
3. What seemed to get attention
4. What seemed ignored or weak
5. **15 candidate prompt ideas** adjacent to the past week
6. For each candidate, scores (0–10) for:
   - similarity to past week
   - novelty
   - weirdness
   - legibility
   - remix potential
   - comment potential
   - Parascene fit
7. Top 3 candidates
8. **One final selected prompt**
9. Optional title
10. Optional caption
11. Explanation of why it fits the past week
12. Warning about what it might be too similar to

---

## Shape of the past week (raw language — not pre-labeled moves)

${formatSignalTable(analysis.language.common_terms, 'Most frequent terms (from prompts/titles/captions)')}

${formatSignalTable(analysis.language.common_phrases, 'Most frequent 2-word phrases')}

${formatSignalTable(analysis.language.strong_terms, 'Terms linked to highest total engagement')}

### Rising terms (vs historical baseline)

${risingTermLines.length ? risingTermLines.join('\n') : '_(none with sufficient signal)_'}

### Rising phrases (vs historical baseline)

${risingPhraseLines.length ? risingPhraseLines.join('\n') : '_(none with sufficient signal)_'}

### Repeated term co-occurrences (same creation)

${comboLines.length ? comboLines.join('\n') : '_(none detected)_'}

### Media mix

${mediaLines.length ? mediaLines.join('\n') : '_(empty window)_'}

### Frequent but low-engagement (possible generic filler)

${lowEngLines.length ? lowEngLines.join('\n') : '_(none flagged)_'}

### Historical baseline (for contrast)

Top historical terms (outside this window):

${histBaseline || '_(none)_'}

Historically strongest creations (outside window): ${analysis.historical_baseline.strongest
	.map((c) => `#${c.id} “${c.title}” (attention ${c.attention_score})`)
	.join('; ') || '_(none)_'}

---

${formatExampleSection('Strongest examples from the past week', analysis.examples.strongest_week)}

${formatExampleSection('Representative examples from the past week', analysis.examples.representative_week)}

${formatExampleSection('Weird / interesting examples from the past week', analysis.examples.weird_week)}

${formatExampleSection('Ignored or weak examples from the past week', analysis.examples.weak_week)}

${formatExampleSection('Historically strong examples similar to this week', analysis.examples.historically_similar)}

---

## Attention formula (for context)

\`attention_score = likes×1 + comments×4 + remixes×7 + shares×8\`

Text signals are stopword-filtered terms and 2-word phrases extracted locally (\`intelligence/lib/text-signals.js\`). They are descriptive, not interpretive — infer the creative moves yourself.
`;
}
