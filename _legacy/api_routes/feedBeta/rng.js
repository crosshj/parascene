/**
 * Deterministic PRNG from string seed (page-1 variety on refresh).
 * @param {string} seed
 * @returns {() => number}
 */
export function createSeededRng(seed) {
	let h = 2166136261;
	const s = String(seed ?? '');
	for (let i = 0; i < s.length; i += 1) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return () => {
		h += 0x6d2b79f5;
		let t = Math.imul(h ^ (h >>> 15), 1 | h);
		t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * @param {object[]} list
 * @param {() => number} rng
 */
export function shuffleInPlace(list, rng) {
	for (let i = list.length - 1; i > 0; i -= 1) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = list[i];
		list[i] = list[j];
		list[j] = tmp;
	}
}
