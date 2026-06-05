/** Default pool slot counts per thread (v0 — later `feed_beta.*` policy knobs). */
export const FEED_BETA_DEFAULT_PARAMS = {
	/** Candidate sources (merged per request). */
	recentFetchLimit: 800,
	hotEngagedFetchLimit: 350,
	backCatalogFetchLimit: 500,
	backCatalogMinAgeDays: 7,
	backCatalogMaxOffset: 8000,

	/** Pool draws per thread page (~20 items out of these slots). */
	hot24Take: 5,
	hot7Take: 4,
	newTake: 4,
	newcomerTake: 4,
	/** Unseen weighted sample — back-catalog + exploration. */
	catalogTake: 7,
	/** Items with recent comments. */
	recentCommentTake: 2,
	/** Viewer own creations with engagement (small feedback loop). */
	ownActivityTake: 1,
	/** Small follow sprinkle (not a gate). */
	followTake: 2,

	slotPackVideoCap: 12,
	slotPackOtherCap: 9,

	newPublishMaxHours: 72,
	newcomerAccountDays: 14,

	freshnessWeight: 40,
	engagementWeight: 35,
	newcomerAuthorMultiplier: 1.35,
	newcomerMentionMultiplier: 1.15,
	/** Light nudge only — most follow signal is the tiny follow pool. */
	followAuthorMultiplier: 1.06,

	hotWindowHours: 168,
	freshHalfLifeHours: 48,

	/** Stop infinite scroll when page index exceeds this (seen + catalog exhaustion). */
	maxPageIndex: 40,

	/** Pages 1…N always return hasMore when this page returned items (site catalog is large). */
	hasMoreThroughPage: 5,

	/** From this page index onward, pool draws ignore feedBetaSeen + liked filters. */
	relaxFiltersFromPage: 5,

	/** Max creations from the same author on one feed page. */
	maxCreationsPerAuthorPerPage: 2,

	/** Max rows fetched for random backfill when pools under-fill a page. */
	randomFallbackFetchLimit: 480,

	/** Extra random DB attempts when page is still short after merge + cap. */
	pageFillMaxRandomAttempts: 4,

	/** Page 1 fill may ignore feedBetaSeen + liked so the first screen hits client `limit`. */
	pageFillRelaxSeenFromPage: 1
};
