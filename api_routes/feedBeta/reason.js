/**
 * Feed [beta] placement reasons — stamped when rows are chosen during pull/merge, not inferred later.
 */

/** @typedef {'hot_24h'|'hot_7d'|'new'|'newcomer'|'catalog_unseen'|'catalog_relaxed'|'follow_sprinkle'|'fill_remainder'|'site_video_head'|'db_random_fallback'} FeedBetaPoolId */

const POOL_USER = {
	hot_24h: 'It is getting strong engagement in the last 24 hours.',
	hot_7d: 'It is getting strong engagement this week.',
	new: 'It was published recently.',
	newcomer: 'It highlights a new creator or welcomes someone new to the community.',
	catalog_unseen:
		'It is from the back catalog — not on your recent Feed [beta] pages and not something you have liked.',
	catalog_relaxed:
		'You are deep in the feed — ranked from the catalog with relaxed seen filters so scroll can keep going.',
	follow_sprinkle: 'You follow this creator — a small sprinkle from people you follow.',
	fill_remainder: 'It filled an open slot on this page after the main pools were drawn.',
	site_video_head: 'It is among the newest site-wide videos for the mobile spotlight strip.',
	db_random_fallback:
		'Ranked pools did not fill this page — it was added as a random pick from the catalog.'
};

const MERGE_USER = {
	slot_pack_head_video: 'On mobile, it was placed in a spotlight video slot at the top of the page.',
	slot_pack_head_image: 'On mobile, it was placed in the card strip between spotlight videos.',
	slot_pack_tail: 'It continued the page after the mobile spotlight section.',
	round_robin: 'It was merged into the page from the video and image threads.'
};

/**
 * @param {FeedBetaPoolId} pool
 * @returns {string}
 */
export function feedBetaPoolUserLine(pool) {
	return POOL_USER[pool] ?? 'It matched the Feed [beta] ranking mix for this page.';
}

/**
 * @param {string} layout
 * @returns {string|null}
 */
export function feedBetaMergeUserLine(layout) {
	return MERGE_USER[layout] ?? null;
}

/**
 * @param {object} row
 * @param {object} stamp
 * @param {object} [entry]
 * @returns {object}
 */
export function stampFeedBetaRowReason(row, stamp, entry = null) {
	if (!row || typeof row !== 'object') return row;
	const why = buildFeedBetaWhy(stamp, entry);
	return { ...row, feed_beta_why: why };
}

/**
 * @param {object} row
 * @param {{ merge_layout?: string, position_in_page?: number }} layout
 * @returns {object}
 */
export function appendFeedBetaMergeReason(row, layout) {
	if (!row || typeof row !== 'object' || !row.feed_beta_why) return row;
	const mergeLine = layout.merge_layout ? feedBetaMergeUserLine(layout.merge_layout) : null;
	const details = Array.isArray(row.feed_beta_why.details) ? row.feed_beta_why.details.slice() : [];
	if (mergeLine && !details.includes(mergeLine)) {
		details.push(mergeLine);
	}
	const developer = {
		...(row.feed_beta_why.developer && typeof row.feed_beta_why.developer === 'object'
			? row.feed_beta_why.developer
			: {}),
		...(layout.merge_layout ? { merge_layout: layout.merge_layout } : {}),
		...(layout.position_in_page != null ? { position_in_page: layout.position_in_page } : {})
	};
	return {
		...row,
		feed_beta_why: {
			...row.feed_beta_why,
			details,
			developer
		}
	};
}

/**
 * @param {object} stamp
 * @param {object|null|undefined} entry — scored pool entry
 * @returns {{ summary: string, details: string[], developer: object }}
 */
export function buildFeedBetaWhy(stamp, entry = null) {
	const pool = stamp.pool ?? null;
	const thread = stamp.thread ?? null;
	const summary = pool ? feedBetaPoolUserLine(pool) : 'Shown in Feed [beta].';
	const details = [];

	if (thread === 'video') {
		details.push('Drawn from the video thread for this page.');
	} else if (thread === 'other') {
		details.push('Drawn from the non-video thread for this page.');
	}

	if (entry?.isNewcomerAuthor) {
		details.push('Author is a new community member.');
	} else if (entry?.mentionsNewcomer) {
		details.push('Creation text mentions a new community member.');
	}
	if (entry?.isFollow && pool !== 'follow_sprinkle') {
		details.push('Small follow boost applied in scoring.');
	}
	if (stamp.ignore_seen === true) {
		details.push('Spotlight video head (not filtered by your seen list).');
	}
	if (stamp.relax_filters === true) {
		details.push('Relaxed page — prior Feed [beta] pages and likes were not used to filter this draw.');
	}
	if (stamp.source === 'db_random_fallback') {
		details.push('Random catalog backfill after ranked pools under-filled this page.');
	}

	const developer = {
		pool,
		thread,
		page_index: stamp.page_index ?? null,
		page_seed: stamp.page_seed ?? null,
		source: stamp.source ?? 'pool_draw',
		relax_filters: stamp.relax_filters === true,
		score: entry?.score ?? null,
		engagement: entry?.engagement ?? null,
		age_hours: entry?.ageHours ?? null,
		flags: {
			in_hot_24h: Boolean(entry?.inHot24),
			in_hot_7d: Boolean(entry?.inHot7),
			is_new_publish: Boolean(entry?.isNewPublish),
			is_newcomer_author: Boolean(entry?.isNewcomerAuthor),
			mentions_newcomer: Boolean(entry?.mentionsNewcomer),
			is_follow: Boolean(entry?.isFollow)
		}
	};

	return { summary, details, developer };
}
