/**
 * Doom scroll pulls: chat `#feed` video display order first; site-wide video timeline fallback.
 */
import {
	buildChatFeedVideoSequenceForDoom,
	doomPageFromFeedVideoSequence,
	pullSiteVideoDoomPageFallback
} from "./chatFeedVideoTimeline.js";

export async function pullDoomFeedRows({
	queries,
	viewerId,
	user,
	limit,
	mode = "head",
	startCreationId,
	afterCreatedImageId,
	enableNsfw = false,
	showOwnPosts = false
}) {
	const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
	const viewer = user ?? { id: viewerId, meta: { enableNsfw } };

	if (mode === "head") {
		return pullSiteVideoDoomPageFallback({
			queries,
			viewerId,
			limit: safeLimit,
			mode: "head"
		});
	}

	const built = await buildChatFeedVideoSequenceForDoom({
		queries,
		viewerId,
		user: viewer,
		showOwnPosts,
		enableNsfw
	});

	if (mode === "from_anchor") {
		const anchorId = Number(startCreationId);
		await built.growUntil(() => indexOfCreation(built.seq, anchorId) >= 0);
		let page = doomPageFromFeedVideoSequence(built.seq, {
			startCreationId: anchorId,
			limit: safeLimit
		});
		if (page.anchorMissing) {
			return pullSiteVideoDoomPageFallback({
				queries,
				viewerId,
				limit: safeLimit,
				mode: "from_anchor",
				startCreationId: anchorId
			});
		}
		while (page.rows.length < safeLimit && built.hasMoreFeed) {
			const grew = await built.appendMore();
			if (!grew) break;
			page = doomPageFromFeedVideoSequence(built.seq, {
				startCreationId: anchorId,
				limit: safeLimit
			});
		}
		return finalizeDoomPage(page, built);
	}

	if (mode === "older_than") {
		const cursorId = Number(afterCreatedImageId);
		await built.growUntil(() => indexOfCreation(built.seq, cursorId) >= 0);
		let page = doomPageFromFeedVideoSequence(built.seq, {
			afterCreatedImageId: cursorId,
			limit: safeLimit
		});
		if (page.cursorMissing) {
			return pullSiteVideoDoomPageFallback({
				queries,
				viewerId,
				limit: safeLimit,
				mode: "older_than",
				afterCreatedImageId: cursorId
			});
		}
		while (page.rows.length === 0 && built.hasMoreFeed) {
			const grew = await built.appendMore();
			if (!grew) break;
			page = doomPageFromFeedVideoSequence(built.seq, {
				afterCreatedImageId: cursorId,
				limit: safeLimit
			});
		}
		if (page.rows.length === 0) {
			return pullSiteVideoDoomPageFallback({
				queries,
				viewerId,
				limit: safeLimit,
				mode: "older_than",
				afterCreatedImageId: cursorId
			});
		}
		while (page.rows.length < safeLimit && !page.hasMore && built.hasMoreFeed) {
			const grew = await built.appendMore();
			if (!grew) break;
			page = doomPageFromFeedVideoSequence(built.seq, {
				afterCreatedImageId: cursorId,
				limit: safeLimit
			});
		}
		return finalizeDoomPage(page, built);
	}

	return { rows: [], hasMore: false, cursor: null };
}

function indexOfCreation(seq, creationId) {
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) return -1;
	return seq.findIndex((row) => Number(row?.created_image_id ?? row?.id) === id);
}

function finalizeDoomPage(page, built) {
	const rows = page.rows ?? [];
	let hasMore = Boolean(page.hasMore);
	if (!hasMore && rows.length > 0) {
		const lastId = rows[rows.length - 1]?.created_image_id ?? rows[rows.length - 1]?.id;
		const idx = indexOfCreation(built.seq, lastId);
		if (idx >= 0 && idx < built.seq.length - 1) {
			hasMore = true;
		} else if (built.hasMoreFeed) {
			hasMore = true;
		}
	}
	return {
		rows,
		hasMore,
		cursor: page.cursor ?? null
	};
}
