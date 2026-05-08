import { broadcastUserInboxDirty } from "./realtimeBroadcast.js";

const TIMED_MESSAGE_KIND_CHANNEL_INVITE = "channel_invite";

function extractInviteChannelThreadId(meta) {
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
	const ts = meta.time_sensitive;
	if (!ts || typeof ts !== "object" || Array.isArray(ts)) return null;
	const invite =
		ts.private_channel_invite && typeof ts.private_channel_invite === "object"
			? ts.private_channel_invite
			: null;
	if (!invite) return null;
	const id = Number(invite.channel_thread_id ?? invite.channelThreadId);
	return Number.isFinite(id) && id > 0 ? id : null;
}

function extractInviteeUserId(meta) {
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
	const ts = meta.time_sensitive;
	if (!ts || typeof ts !== "object" || Array.isArray(ts)) return null;
	const invite =
		ts.private_channel_invite && typeof ts.private_channel_invite === "object"
			? ts.private_channel_invite
			: null;
	if (!invite) return null;
	const id = Number(invite.invitee_user_id ?? invite.inviteeUserId);
	return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Keep member read pointers valid when deleting messages in bulk.
 * Matches DELETE /api/chat/messages/:messageId behavior by rewinding to
 * the previous existing message in the same thread (or null).
 *
 * @param {{ sb: any, threadId: number, deleteMessageIds: number[] }} opts
 */
async function repairLastReadPointersForDeletedMessages({ sb, threadId, deleteMessageIds }) {
	const tid = Number(threadId);
	if (!Number.isFinite(tid) || tid <= 0) return;
	const deletedIds = [...new Set((deleteMessageIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
	if (deletedIds.length === 0) return;

	const { data: memberRows, error: membersErr } = await sb
		.from("prsn_chat_members")
		.select("user_id, last_read_message_id")
		.eq("thread_id", tid)
		.in("last_read_message_id", deletedIds);
	if (membersErr) throw membersErr;
	if (!Array.isArray(memberRows) || memberRows.length === 0) return;

	const uniquePointers = [...new Set(memberRows
		.map((row) => Number(row?.last_read_message_id))
		.filter((id) => Number.isFinite(id) && id > 0))];

	/** @type {Map<number, number | null>} */
	const fallbackByDeletedPointer = new Map();
	for (const pointerId of uniquePointers) {
		const { data: prevRow, error: prevErr } = await sb
			.from("prsn_chat_messages")
			.select("id")
			.eq("thread_id", tid)
			.lt("id", pointerId)
			.not("id", "in", `(${deletedIds.join(",")})`)
			.order("id", { ascending: false })
			.limit(1)
			.maybeSingle();
		if (prevErr) throw prevErr;
		const fallback =
			prevRow?.id != null && Number.isFinite(Number(prevRow.id)) && Number(prevRow.id) > 0
				? Number(prevRow.id)
				: null;
		fallbackByDeletedPointer.set(pointerId, fallback);
	}

	for (const pointerId of uniquePointers) {
		const fallback = fallbackByDeletedPointer.get(pointerId) ?? null;
		const patch = Number.isFinite(Number(fallback)) && Number(fallback) > 0
			? { last_read_message_id: Number(fallback) }
			: { last_read_message_id: null };
		const { error: updErr } = await sb
			.from("prsn_chat_members")
			.update(patch)
			.eq("thread_id", tid)
			.eq("last_read_message_id", pointerId);
		if (updErr) throw updErr;
	}
}

/**
 * Remove DM invite messages that point to channels the user already joined.
 * Safe to call opportunistically on unrelated requests (feed load, invite accept, etc).
 */
export async function removeJoinedPrivateChannelInviteDmMessages({ sb, userId }) {
	const viewerId = Number(userId);
	if (!sb || !Number.isFinite(viewerId) || viewerId <= 0) {
		return { removed_count: 0, affected_threads: [] };
	}

	const { data: membershipRows, error: membershipErr } = await sb
		.from("prsn_chat_members")
		.select("thread_id")
		.eq("user_id", viewerId);
	if (membershipErr) throw membershipErr;
	const memberThreadIds = [
		...new Set(
			(membershipRows || [])
				.map((row) => Number(row?.thread_id))
				.filter((id) => Number.isFinite(id) && id > 0)
		)
	];
	if (memberThreadIds.length === 0) {
		return { removed_count: 0, affected_threads: [] };
	}

	const { data: threadRows, error: threadErr } = await sb
		.from("prsn_chat_threads")
		.select("id, type")
		.in("id", memberThreadIds);
	if (threadErr) throw threadErr;

	const joinedChannelThreadIds = new Set();
	const dmThreadIds = [];
	for (const row of threadRows || []) {
		const id = Number(row?.id);
		if (!Number.isFinite(id) || id <= 0) continue;
		if (row?.type === "channel") joinedChannelThreadIds.add(id);
		if (row?.type === "dm") dmThreadIds.push(id);
	}
	if (joinedChannelThreadIds.size === 0 || dmThreadIds.length === 0) {
		return { removed_count: 0, affected_threads: [] };
	}

	const { data: inviteRows, error: inviteErr } = await sb
		.from("prsn_chat_messages")
		.select("id, thread_id, meta")
		.in("thread_id", dmThreadIds)
		.contains("meta", { time_sensitive: { kind: TIMED_MESSAGE_KIND_CHANNEL_INVITE } });
	if (inviteErr) throw inviteErr;
	if (!Array.isArray(inviteRows) || inviteRows.length === 0) {
		return { removed_count: 0, affected_threads: [] };
	}

	const deleteIds = [];
	const affectedThreadIds = new Set();
	/** @type {Map<number, number[]>} */
	const deleteIdsByThread = new Map();
	for (const row of inviteRows) {
		const messageId = Number(row?.id);
		const dmThreadId = Number(row?.thread_id);
		if (!Number.isFinite(messageId) || messageId <= 0) continue;
		if (!Number.isFinite(dmThreadId) || dmThreadId <= 0) continue;
		const inviteeUserId = extractInviteeUserId(row?.meta);
		// Only clear invites from the perspective of the invitee after they joined.
		if (!Number.isFinite(inviteeUserId) || inviteeUserId !== viewerId) continue;
		const invitedChannelThreadId = extractInviteChannelThreadId(row?.meta);
		if (!Number.isFinite(invitedChannelThreadId) || !joinedChannelThreadIds.has(invitedChannelThreadId)) continue;
		deleteIds.push(messageId);
		affectedThreadIds.add(dmThreadId);
		const existing = deleteIdsByThread.get(dmThreadId) || [];
		existing.push(messageId);
		deleteIdsByThread.set(dmThreadId, existing);
	}
	if (deleteIds.length === 0) {
		return { removed_count: 0, affected_threads: [] };
	}

	for (const [threadId, threadDeleteIds] of deleteIdsByThread.entries()) {
		await repairLastReadPointersForDeletedMessages({
			sb,
			threadId,
			deleteMessageIds: threadDeleteIds
		});
	}

	const { error: deleteErr } = await sb.from("prsn_chat_messages").delete().in("id", deleteIds);
	if (deleteErr) throw deleteErr;

	const affected = [...affectedThreadIds];
	if (affected.length > 0) {
		const { data: dmMembers, error: dmMembersErr } = await sb
			.from("prsn_chat_members")
			.select("thread_id, user_id")
			.in("thread_id", affected);
		if (!dmMembersErr && Array.isArray(dmMembers)) {
			const usersByThread = new Map();
			for (const row of dmMembers) {
				const threadId = Number(row?.thread_id);
				const uid = Number(row?.user_id);
				if (!Number.isFinite(threadId) || threadId <= 0) continue;
				if (!Number.isFinite(uid) || uid <= 0) continue;
				const existing = usersByThread.get(threadId) || [];
				existing.push(uid);
				usersByThread.set(threadId, existing);
			}
			for (const threadId of affected) {
				const members = usersByThread.get(threadId) || [];
				void broadcastUserInboxDirty(threadId, members);
			}
		}
	}

	return { removed_count: deleteIds.length, affected_threads: affected };
}
