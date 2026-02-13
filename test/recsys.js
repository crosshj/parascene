// Barebones "after-detail" recommender for image feeds.
// ES module, no deps, deterministic RNG support for tests.

export function createRecommender(config = {}) {
	const cfg = {
		// Signal weights (map these to your UI controls)
		lineageWeight: 100,
		sameCreatorWeight: 50,
		sameServerMethodWeight: 40,
		clickNextWeight: 100,
		fallbackWeight: 60,

		// Transition behavior
		transitionCapPerFrom: 30,
		decayHalfLifeDays: 7,
		windowDays: 0, // 0 => use decay only

		// Random & caps
		randomFraction: 0.3, // ignored if randomSlotsPerBatch > 0
		randomSlotsPerBatch: 0,
		candidateCapPerSignal: 100,
		batchSize: 20,
		lineageMinSlots: 2,

		fallbackEnabled: true,
		now: () => Date.now(),
		rng: Math.random,

		...config
	};

	function recommend({ anchor, pool, transitions, userId = null }) {
		if (!anchor) throw new Error("anchor is required");
		if (!Array.isArray(pool)) throw new Error("pool must be an array");
		if (!Array.isArray(transitions)) throw new Error("transitions must be an array");

		const poolById = new Map(pool.map(x => [x.id, x]));
		const anchorTs = +new Date(anchor.createdAt || cfg.now());

		// 1) Candidate buckets
		const buckets = {
			lineage: [],
			sameCreator: [],
			sameServerMethod: [],
			clickNext: [],
			fallback: []
		};

		for (const item of pool) {
			if (item.id === anchor.id) continue;
			if (!item.isActive && item.isActive !== undefined) continue;

			if (isSameLineage(anchor, item)) buckets.lineage.push(item);
			if (item.creatorId === anchor.creatorId) buckets.sameCreator.push(item);
			if (sameServerMethod(anchor, item)) buckets.sameServerMethod.push(item);
		}

		// click-next transitions from anchor.id
		const fromTransitions = transitions
			.filter(t => t.fromId === anchor.id && poolById.has(t.toId))
			.slice(0, cfg.transitionCapPerFrom)
			.map(t => ({
				...t,
				ageDays: ageDays(t.updatedAt || t.createdAt || cfg.now(), cfg.now())
			}))
			.filter(t => inWindowOrDecay(t.ageDays, cfg.windowDays));

		for (const t of fromTransitions) {
			const candidate = poolById.get(t.toId);
			if (!candidate || candidate.id === anchor.id) continue;
			buckets.clickNext.push({
				item: candidate,
				t
			});
		}

		if (cfg.fallbackEnabled) {
			// "around time period" + recent random as fallback
			const around = pool.filter(item => {
				if (item.id === anchor.id) return false;
				const d = Math.abs(ageDays(item.createdAt || cfg.now(), anchorTs));
				return d <= 7;
			});
			buckets.fallback = around.length ? around : pool.filter(i => i.id !== anchor.id);
		}

		// cap each signal bucket
		buckets.lineage = cap(buckets.lineage, cfg.candidateCapPerSignal);
		buckets.sameCreator = cap(buckets.sameCreator, cfg.candidateCapPerSignal);
		buckets.sameServerMethod = cap(buckets.sameServerMethod, cfg.candidateCapPerSignal);
		buckets.clickNext = cap(buckets.clickNext, cfg.candidateCapPerSignal);
		buckets.fallback = cap(buckets.fallback, cfg.candidateCapPerSignal);

		// 2) Score merge
		const scored = new Map();

		function addScore(item, delta, reason) {
			const row = scored.get(item.id) || { item, score: 0, reasons: [] };
			row.score += delta;
			row.reasons.push(reason);
			scored.set(item.id, row);
		}

		for (const item of buckets.lineage) {
			addScore(item, cfg.lineageWeight, "lineage");
		}
		for (const item of buckets.sameCreator) {
			addScore(item, cfg.sameCreatorWeight, "sameCreator");
		}
		for (const item of buckets.sameServerMethod) {
			addScore(item, cfg.sameServerMethodWeight, "sameServerMethod");
		}
		for (const c of buckets.clickNext) {
			const decay = transitionDecay(c.t.ageDays, cfg.decayHalfLifeDays);
			const count = Math.max(0, c.t.count || 0);
			addScore(c.item, cfg.clickNextWeight * count * decay, "clickNext");
		}
		for (const item of buckets.fallback) {
			addScore(item, cfg.fallbackWeight * 0.1, "fallback");
		}

		let ranked = [...scored.values()]
			.sort((a, b) => b.score - a.score);

		// 3) Enforce lineage min slots
		const lineageSet = new Set(buckets.lineage.map(x => x.id));
		ranked = enforceLineageMinSlots(ranked, lineageSet, cfg.lineageMinSlots);

		// 4) Randomness blending
		const batchSize = cfg.batchSize;
		const randomSlots = cfg.randomSlotsPerBatch > 0
			? Math.min(cfg.randomSlotsPerBatch, batchSize)
			: Math.floor(batchSize * cfg.randomFraction);

		const topDeterministic = ranked.slice(0, Math.max(0, batchSize - randomSlots));
		const used = new Set(topDeterministic.map(x => x.item.id));

		const randomPool = ranked.slice(topDeterministic.length)
			.filter(x => !used.has(x.item.id));

		shuffleInPlace(randomPool, cfg.rng);
		const randomPick = randomPool.slice(0, randomSlots);

		const batch = [...topDeterministic, ...randomPick];
		batch.sort((a, b) => b.score - a.score); // keep "highest to lowest" even with randomness

		return batch.slice(0, batchSize).map(x => ({
			id: x.item.id,
			score: round2(x.score),
			reasons: x.reasons
		}));
	}

	return { recommend, config: cfg };
}

// ---------- helpers ----------

function isSameLineage(a, b) {
	if (a.familyId && b.familyId) return a.familyId === b.familyId;
	// optional parent/child fallback
	if (a.parentId && b.id === a.parentId) return true;
	if (b.parentId && a.id === b.parentId) return true;
	return false;
}

function sameServerMethod(a, b) {
	return a.provider === b.provider && a.method === b.method;
}

function ageDays(ts, nowTs) {
	const t = +new Date(ts);
	const n = +new Date(nowTs);
	return Math.max(0, (n - t) / 86400000);
}

function inWindowOrDecay(age, windowDays) {
	if (!windowDays || windowDays <= 0) return true;
	return age <= windowDays;
}

function transitionDecay(ageDaysVal, halfLifeDays) {
	if (!halfLifeDays || halfLifeDays <= 0) return 1;
	// 0.5^(age/halfLife)
	return Math.pow(0.5, ageDaysVal / halfLifeDays);
}

function cap(arr, n) {
	return arr.length <= n ? arr : arr.slice(0, n);
}

function enforceLineageMinSlots(ranked, lineageSet, minSlots) {
	if (minSlots <= 0) return ranked;

	const inTop = ranked.slice(0, minSlots).filter(x => lineageSet.has(x.item.id)).length;
	if (inTop >= minSlots) return ranked;

	const need = minSlots - inTop;
	const lineageRest = ranked.filter(x => lineageSet.has(x.item.id));
	if (!lineageRest.length) return ranked;

	const top = ranked.slice(0, minSlots);
	const rest = ranked.slice(minSlots);

	let promoted = 0;
	const promotedItems = [];

	for (const x of lineageRest) {
		if (top.find(y => y.item.id === x.item.id)) continue;
		promotedItems.push(x);
		promoted++;
		if (promoted >= need) break;
	}

	const topNonLineage = top.filter(x => !lineageSet.has(x.item.id));
	const keptTop = top.filter(x => lineageSet.has(x.item.id));
	const fillCount = Math.max(0, minSlots - (keptTop.length + promotedItems.length));
	const survivors = topNonLineage.slice(0, fillCount);

	const rebuiltTop = [...keptTop, ...promotedItems, ...survivors]
		.sort((a, b) => b.score - a.score);

	const removedIds = new Set(topNonLineage.slice(fillCount).map(x => x.item.id));
	const rebuiltRest = [
		...rest.filter(x => !removedIds.has(x.item.id)),
		...topNonLineage.slice(fillCount)
	];

	return [...rebuiltTop, ...rebuiltRest];
}

function shuffleInPlace(arr, rng) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

function round2(x) {
	return Math.round(x * 100) / 100;
}

export const _helpers = {
	isSameLineage,
	sameServerMethod,
	transitionDecay,
	enforceLineageMinSlots
};
