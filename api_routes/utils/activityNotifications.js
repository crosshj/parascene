import {
	collectCreationMentionSourceTexts,
	extractUserMentionHandles
} from "./textMentions.js";

/** Non-chat activity types handled here; chat uses chatMentionNotifications.js only. */
const CREATION_ACTIVITY_TYPES = new Set(["creation_mention", "comment_mention"]);

/**
 * @param {object} target
 * @returns {string}
 */
function stableTargetKey(target) {
	try {
		return JSON.stringify(target ?? {});
	} catch {
		return "{}";
	}
}

/**
 * Skip duplicate unacknowledged rows (same recipient, type, actor, target).
 */
async function hasDuplicateUnackNotification({ queries, toUserId, type, actorUserId, target }) {
	if (!queries?.selectNotificationsForUser?.all) return false;
	const rows = await queries.selectNotificationsForUser.all(toUserId, null, 80);
	const key = stableTargetKey(target);
	for (const row of rows ?? []) {
		if (row?.acknowledged_at) continue;
		if (row?.type !== type) continue;
		if (Number(row?.actor_user_id) !== Number(actorUserId)) continue;
		if (stableTargetKey(parseJsonField(row?.target)) !== key) continue;
		return true;
	}
	return false;
}

function parseJsonField(value) {
	if (value == null) return null;
	if (typeof value === "object") return value;
	if (typeof value !== "string") return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

/**
 * @param {{ queries: object, toUserId: number, actorUserId: number, type: string, target: object, link: string, meta?: object }} args
 */
export async function insertActivityNotification({
	queries,
	toUserId,
	actorUserId,
	type,
	target,
	link,
	meta = {}
}) {
	if (!queries?.insertNotification?.run) return { inserted: false };
	const uid = Number(toUserId);
	const aid = Number(actorUserId);
	if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(aid) || aid <= 0) {
		return { inserted: false };
	}
	if (uid === aid) return { inserted: false };

	const dup = await hasDuplicateUnackNotification({
		queries,
		toUserId: uid,
		type,
		actorUserId: aid,
		target
	});
	if (dup) return { inserted: false, reason: "duplicate" };

	try {
		await queries.insertNotification.run(
			uid,
			null,
			"Notification",
			"",
			link,
			aid,
			type,
			target,
			meta
		);
		return { inserted: true };
	} catch (err) {
		if (process.env.NODE_ENV !== "production") {
			console.error("[activity notification]", type, err?.message ?? err);
		}
		return { inserted: false, reason: "error" };
	}
}

/**
 * Resolve @handles to user ids (registered profiles only).
 * @param {{ queries: object, handles: string[], excludeUserId?: number }} args
 * @returns {Promise<number[]>}
 */
export async function resolveUserIdsFromMentionHandles({ queries, handles, excludeUserId }) {
	if (!queries?.selectUserProfileByUsername?.get) return [];
	const out = [];
	const seen = new Set();
	for (const handle of handles ?? []) {
		let profile;
		try {
			profile = await queries.selectUserProfileByUsername.get(handle);
		} catch {
			continue;
		}
		const id = profile?.user_id != null ? Number(profile.user_id) : null;
		if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
		if (excludeUserId != null && id === Number(excludeUserId)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

/**
 * Notify users @mentioned when a creation is published (title, description, prompt).
 */
export async function notifyCreationMentionsOnPublish({
	queries,
	creationId,
	publisherUserId,
	title,
	description,
	meta
}) {
	const cid = Number(creationId);
	const pid = Number(publisherUserId);
	if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(pid) || pid <= 0) return;

	const texts = collectCreationMentionSourceTexts({ title, description, meta });
	const handles = new Set();
	for (const t of texts) {
		for (const h of extractUserMentionHandles(t)) handles.add(h);
	}
	if (handles.size === 0) return;

	const recipientIds = await resolveUserIdsFromMentionHandles({
		queries,
		handles: [...handles],
		excludeUserId: pid
	});
	if (recipientIds.length === 0) return;

	const creationTitle =
		typeof title === "string" && title.trim() ? title.trim() : "Untitled";
	const link = `/creations/${encodeURIComponent(String(cid))}`;
	const target = { creation_id: cid };
	const metaPayload = { creation_title: creationTitle };

	for (const toUserId of recipientIds) {
		await insertActivityNotification({
			queries,
			toUserId,
			actorUserId: pid,
			type: "creation_mention",
			target,
			link,
			meta: metaPayload
		});
	}
}

/**
 * Notify @mentioned users in a comment body (excluding users already notified as owner/thread).
 */
export async function notifyCommentMentions({
	queries,
	creationId,
	commenterId,
	commentText,
	creationTitle,
	alreadyNotifiedUserIds = []
}) {
	const cid = Number(creationId);
	const commenter = Number(commenterId);
	if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(commenter) || commenter <= 0) return;

	const handles = extractUserMentionHandles(commentText);
	if (handles.length === 0) return;

	const skip = new Set(
		[...alreadyNotifiedUserIds, commenter]
			.map((id) => Number(id))
			.filter((id) => Number.isFinite(id) && id > 0)
	);
	const recipientIds = (await resolveUserIdsFromMentionHandles({
		queries,
		handles,
		excludeUserId: commenter
	})).filter((id) => !skip.has(id));

	const link = `/creations/${encodeURIComponent(String(cid))}`;
	const target = { creation_id: cid };
	const title =
		typeof creationTitle === "string" && creationTitle.trim() ? creationTitle.trim() : null;
	const metaPayload = title ? { creation_title: title } : {};

	for (const toUserId of recipientIds) {
		await insertActivityNotification({
			queries,
			toUserId,
			actorUserId: commenter,
			type: "comment_mention",
			target,
			link,
			meta: metaPayload
		});
	}
}

export { CREATION_ACTIVITY_TYPES };
