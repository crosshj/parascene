/**
 * Raw text signals from prompt/title/caption — no predefined creative-move taxonomy.
 * The advanced LLM infers "intent atoms" from these patterns + examples.
 */

const STOPWORDS = new Set([
	'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
	'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
	'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'this', 'that',
	'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'our', 'you', 'your', 'he', 'she',
	'his', 'her', 'i', 'my', 'me', 'not', 'no', 'yes', 'all', 'any', 'some', 'into', 'through', 'over',
	'under', 'between', 'about', 'than', 'then', 'so', 'if', 'when', 'while', 'also', 'just', 'very',
	'more', 'most', 'other', 'such', 'only', 'same', 'both', 'each', 'few', 'own', 'same', 'up', 'out',
	'off', 'down', 'use', 'using', 'used', 'make', 'made', 'like', 'image', 'photo', 'picture', 'style',
	'high', 'quality', 'detailed', 'detail', 'resolution'
]);

/**
 * @param {{ prompt?: string, title?: string, caption?: string }} creation
 * @returns {string}
 */
export function creationTextBlob(creation) {
	return [creation.prompt, creation.title, creation.caption].filter(Boolean).join(' ');
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
	return String(text ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9\s'-]/g, ' ')
		.split(/\s+/)
		.map((t) => t.replace(/^'+|'+$/g, ''))
		.filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * @param {string[]} tokens
 * @param {number} n
 * @returns {string[]}
 */
function ngrams(tokens, n) {
	/** @type {string[]} */
	const out = [];
	for (let i = 0; i <= tokens.length - n; i++) {
		out.push(tokens.slice(i, i + n).join(' '));
	}
	return out;
}

/**
 * @param {{ prompt?: string, title?: string, caption?: string }} creation
 * @returns {{ terms: string[], phrases: string[] }}
 */
export function extractTextSignals(creation) {
	const tokens = tokenize(creationTextBlob(creation));
	const terms = [...new Set(tokens)];
	const phrases = [...new Set(ngrams(tokens, 2))].filter((p) => {
		const parts = p.split(' ');
		return parts[0] !== parts[1];
	});
	return { terms, phrases };
}

/**
 * Flat list for overlap / display (terms first, then phrases).
 * @param {{ terms: string[], phrases: string[] }} signals
 * @returns {string[]}
 */
export function allSignals(signals) {
	return [...signals.terms, ...signals.phrases];
}
