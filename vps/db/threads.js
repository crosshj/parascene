import { createThreadCanvases } from './threadCanvases.js';
import crypto from 'node:crypto';
import { broadcastThreadHint } from './threadBroadcast.js';
import { plainTextReplyPreview } from '../shared/plainTextReplyPreview.js';
import { REACTION_ORDER, normalizeReactionBucket } from '../shared/reactions.js';
import { collectChatMiscGenericKeysFromMessageBody, isChatMiscGenericKeyOwnedByUser } from './threadAttachmentKeys.js';

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function result(request) {
	const { data, error } = await request;
	if (error) throw error;
	return data;
}
function decrypt(token, secret) {
	try {
		const [iv, packed] = String(token).split('.').map((part) => Buffer.from(part, 'base64url'));
		if (!secret || iv.length !== 12 || packed.length <= 16) return null;
		const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(secret).digest(), iv);
		decipher.setAuthTag(packed.subarray(-16));
		return Buffer.concat([decipher.update(packed.subarray(0, -16)), decipher.final()]).toString('utf8');
	} catch { return null; }
}

// Ported from WWW chat's membership, roster, and chronological page contracts.
export function createThreadsStore(client, users, { broadcast = broadcastThreadHint } = {}) {
	async function enrichReactions(rows, userId, anonymous = false) {
		const buckets = rows.map((row) => normalizeReactionBucket(row.reactions));
		const ids = anonymous ? [] : [...new Set(buckets.flatMap((bucket) => Object.values(bucket).flat()))];
		const profiles = ids.length ? await result(client.from('prsn_user_profiles').select('user_id, user_name, display_name').in('user_id', ids)) : [];
		const names = new Map(profiles.map((profile) => [Number(profile.user_id), profile.user_name ? `@${profile.user_name}` : profile.display_name]));
		return rows.map((row, index) => {
			const reactions = {}; const viewer_reactions = [];
			for (const key of REACTION_ORDER) {
				const voters = buckets[index][key] || []; if (!voters.length) continue;
				const shown = anonymous ? [] : voters.map((id) => names.get(id)).filter(Boolean).slice(0, 5);
				const overflow = voters.length - shown.length;
				reactions[key] = anonymous ? voters.length : [...shown, ...(overflow ? [overflow] : [])];
				if (voters.includes(Number(userId))) viewer_reactions.push(key);
			}
			return { ...row, reactions, viewer_reactions, viewer_vote_intent: row.reactions?._challenge_vote_versions?.[userId] || null };
		});
	}
	async function privateSecret(userId, threadId) {
		const user = await users.byId(userId);
		return user?.meta?.chat_private_keys?.[String(threadId)]?.k || '';
	}
	async function threadForMember(userId, threadId) {
		const member = await result(client.from('prsn_chat_members').select('last_read_message_id').eq('thread_id', threadId).eq('user_id', userId).maybeSingle());
		if (!member) fail(403, 'Not a member of this thread');
		const thread = await result(client.from('prsn_chat_threads').select('id, type, channel_slug, dm_pair_key, meta').eq('id', threadId).maybeSingle());
		if (!thread) fail(404, 'Thread not found');
		return { ...thread, ...member, visibility: thread.meta?.visibility === 'private' ? 'private' : 'public' };
	}
	async function inbox(userId) {
		const rows = await result(client.rpc('prsn_chat_threads_for_user', { p_user_id: userId })) || [];
		const ids = rows.map((row) => Number(row.thread_id));
		const metadata = ids.length ? await result(client.from('prsn_chat_threads').select('id, meta').in('id', ids)) : [];
		const metaById = new Map(metadata.map((row) => [Number(row.id), row.meta || {}]));
		const viewer = await users.byId(userId);
		const otherIds = [...new Set(rows.filter((row) => row.thread_type === 'dm').map((row) => {
			const pair = String(row.dm_pair_key).split(':').map(Number);
			return pair.find((id) => id !== Number(userId)) || Number(userId);
		}))];
		const profiles = otherIds.length ? await result(client.from('prsn_user_profiles').select('user_id, user_name, display_name, avatar_url').in('user_id', otherIds)) : [];
		const profileById = new Map(profiles.map((row) => [Number(row.user_id), row]));
		const threads = rows.map((row) => {
			const id = Number(row.thread_id);
			const meta = metaById.get(id) || {};
			const visibility = meta.visibility === 'private' ? 'private' : 'public';
			const pair = String(row.dm_pair_key || '').split(':').map(Number);
			const otherId = pair.find((value) => value !== Number(userId)) || Number(userId);
			const profile = profileById.get(otherId);
			const secret = viewer?.meta?.chat_private_keys?.[String(id)]?.k;
			const title = row.thread_type === 'channel'
				? `#${visibility === 'private' ? decrypt(meta.enc_name, String(secret || '').trim())?.trim() || 'private' : row.channel_slug}`
				: profile?.display_name || profile?.user_name || `User ${otherId}`;
			return {
				id, type: row.thread_type, channel_slug: row.channel_slug, dm_pair_key: row.dm_pair_key,
				title, visibility, unread_count: Math.max(0, Number(row.unread_count) || 0), last_read_message_id: row.last_read_message_id,
				other_user_id: row.thread_type === 'dm' ? otherId : null,
				other_user: row.thread_type === 'dm' ? { id: otherId, user_name: profile?.user_name, display_name: profile?.display_name, avatar_url: profile?.avatar_url } : null,
				last_message: row.last_message_id ? { id: Number(row.last_message_id), body: visibility === 'private' ? '[Encrypted message]' : row.last_message_body, created_at: row.last_message_at, sender_id: Number(row.last_sender_id) } : null,
			};
		});
		return { viewer_id: Number(userId), viewer_is_admin: viewer?.role === 'admin', viewer_is_founder: viewer?.meta?.plan === 'founder', threads };
	}
	async function openPublicChannel(userId, tag) {
		const slug = typeof tag === 'string' ? tag.trim().replace(/^#+/, '').trim().toLowerCase() : '';
		if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(slug) || ['comments', 'feed', 'explore', 'creations'].includes(slug)) fail(400, 'Invalid or reserved channel name');
		let thread = await result(client.from('prsn_chat_threads').select('id,meta').eq('type', 'channel').eq('channel_slug', slug).maybeSingle());
		if (!thread) {
			const inserted = await client.from('prsn_chat_threads').insert({ type: 'channel', dm_pair_key: null, channel_slug: slug, meta: {} }).select('id,meta').single();
			if (inserted.error) {
				thread = await result(client.from('prsn_chat_threads').select('id,meta').eq('type', 'channel').eq('channel_slug', slug).maybeSingle());
				if (!thread) throw inserted.error;
			} else thread = inserted.data;
		}
		if (thread.meta?.visibility === 'private') fail(403, 'Private channels require an invitation');
		await result(client.from('prsn_chat_members').upsert({ thread_id: thread.id, user_id: userId }, { onConflict: 'thread_id,user_id', ignoreDuplicates: true }));
		return { thread: { id: thread.id, type: 'channel', channel_slug: slug, visibility: 'public' } };
	}
	function dmPairKey(a, b) {
		const x = Number(a);
		const y = Number(b);
		if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return null;
		return `${Math.min(x, y)}:${Math.max(x, y)}`;
	}
	async function openDm(userId, { otherUserId, otherUserName } = {}) {
		let otherId = Number(otherUserId);
		if (!Number.isFinite(otherId) || otherId <= 0) {
			const name = typeof otherUserName === 'string' ? otherUserName.trim().replace(/^@/, '') : '';
			if (!name) fail(400, 'other_user_id or other_user_name required');
			const other = await users.byUsername(name);
			otherId = Number(other?.id);
		} else {
			const other = await users.byId(otherId);
			if (!other) otherId = 0;
		}
		if (!Number.isFinite(otherId) || otherId <= 0) fail(404, 'User not found');
		const key = dmPairKey(userId, otherId);
		if (!key) fail(400, 'Invalid user ids');
		let thread = await result(client.from('prsn_chat_threads').select('id').eq('type', 'dm').eq('dm_pair_key', key).maybeSingle());
		if (!thread) {
			const inserted = await client.from('prsn_chat_threads').insert({ type: 'dm', dm_pair_key: key, channel_slug: null }).select('id').single();
			if (inserted.error) {
				thread = await result(client.from('prsn_chat_threads').select('id').eq('type', 'dm').eq('dm_pair_key', key).maybeSingle());
				if (!thread) throw inserted.error;
			} else thread = inserted.data;
		}
		const members = otherId === Number(userId)
			? [{ thread_id: thread.id, user_id: Number(userId) }]
			: [{ thread_id: thread.id, user_id: Number(userId) }, { thread_id: thread.id, user_id: otherId }];
		await result(client.from('prsn_chat_members').upsert(members, { onConflict: 'thread_id,user_id', ignoreDuplicates: true }));
		await result(client.from('prsn_chat_members').update({ hidden_at: null }).eq('thread_id', thread.id).eq('user_id', userId));
		return { thread: { id: thread.id, type: 'dm', dm_pair_key: key, channel_slug: null } };
	}
	async function listPublicChannelSlugs() {
		const rows = await result(client.from('prsn_chat_threads').select('channel_slug, meta').eq('type', 'channel')) || [];
		const slugs = [...new Set(rows.filter((row) => row?.meta?.visibility !== 'private' && String(row?.channel_slug || '').trim()).map((row) => String(row.channel_slug).trim()))];
		slugs.sort((a, b) => a.localeCompare(b));
		return { slugs };
	}
	async function hideThread(userId, threadId, hidden = true) {
		const thread = await result(client.from('prsn_chat_threads').select('id, type').eq('id', threadId).maybeSingle());
		if (!thread) fail(404, 'Thread not found');
		if (thread.type !== 'dm') fail(400, 'Only direct messages can be hidden');
		const member = await result(client.from('prsn_chat_members').select('user_id').eq('thread_id', threadId).eq('user_id', userId).maybeSingle());
		if (!member) fail(403, 'Not a member of this thread');
		const shouldHide = hidden !== false;
		await result(client.from('prsn_chat_members').update({ hidden_at: shouldHide ? new Date().toISOString() : null }).eq('thread_id', threadId).eq('user_id', userId));
		return { ok: true, hidden: shouldHide };
	}
	async function leaveThread(userId, threadId) {
		const thread = await result(client.from('prsn_chat_threads').select('id, type').eq('id', threadId).maybeSingle());
		if (!thread) fail(404, 'Thread not found');
		if (thread.type !== 'channel') fail(400, 'Only channels can be left');
		const member = await result(client.from('prsn_chat_members').select('user_id').eq('thread_id', threadId).eq('user_id', userId).maybeSingle());
		if (!member) return { ok: true, left: false };
		await result(client.from('prsn_chat_members').delete().eq('thread_id', threadId).eq('user_id', userId));
		return { ok: true, left: true };
	}
	async function messages(userId, threadId, { limit = 40, before } = {}) {
		const thread = await threadForMember(userId, threadId);
		let cursor = null;
		if (before) {
			try {
				cursor = JSON.parse(Buffer.from(before, 'base64url').toString('utf8'));
				if (!Number.isSafeInteger(Number(cursor.i)) || Number(cursor.i) <= 0 || !Number.isFinite(Date.parse(cursor.c))) fail(400, 'Invalid before cursor');
			} catch { fail(400, 'Invalid before cursor'); }
		}
		const rows = await result(client.rpc('prsn_chat_messages_page', { p_thread_id: threadId, p_before_created_at: cursor?.c || null, p_before_id: cursor?.i || null, p_limit: limit + 1 })) || [];
		const hasMore = rows.length > limit;
		const page = rows.slice(0, limit).reverse();
		const senderIds = [...new Set(page.map((row) => Number(row.sender_id)))];
		const profiles = senderIds.length ? await result(client.from('prsn_user_profiles').select('user_id, user_name, avatar_url').in('user_id', senderIds)) : [];
		const profilesById = new Map(profiles.map((row) => [Number(row.user_id), row]));
		const senderUsers = senderIds.length ? await result(client.from('prsn_users').select('id, meta').in('id', senderIds)) : [];
		const plansById = new Map(senderUsers.map((row) => [Number(row.id), row.meta?.plan === 'founder' ? 'founder' : 'free']));
		const secret = thread.visibility === 'private' ? await privateSecret(userId, threadId) : null;
		const parentIds = [...new Set(page.map((row) => Number(row.meta?.reply?.referenced_id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
		const parents = parentIds.length ? await result(client.from('prsn_chat_messages').select('id').eq('thread_id', threadId).in('id', parentIds)) : [];
		const alive = new Set(parents.map((row) => Number(row.id)));
		const messages = page.map((row) => {
			const profile = profilesById.get(Number(row.sender_id));
			const timed = row.meta?.time_sensitive;
			const expired = timed?.kind && Number.isFinite(Date.parse(timed.expires_at)) && Date.parse(timed.expires_at) <= Date.now();
			return { ...row, sender_user_name: profile?.user_name, sender_avatar_url: profile?.avatar_url, sender_plan: plansById.get(Number(row.sender_id)) || 'free',
				body: expired ? '[Expired message]' : thread.visibility === 'private' ? (String(row.body).startsWith('enc:v1:') ? decrypt(String(row.body).slice(7), secret) : null) || '[Encrypted message]' : row.body,
				private_decrypted: thread.visibility === 'private',
				...(row.meta?.reply ? { reply_parent_exists: alive.has(Number(row.meta.reply.referenced_id)) } : {}),
			};
		});
		const first = page[0];
		return { messages: await enrichReactions(messages, userId, thread.channel_slug === 'challenges'), hasMore, nextBefore: hasMore && first ? Buffer.from(JSON.stringify({ c: first.created_at, i: Number(first.id) })).toString('base64url') : null };
	}
	async function unread(userId) {
		const [total, roster] = await Promise.all([result(client.rpc('prsn_chat_unread_total', { p_user_id: userId })), inbox(userId)]);
		const challenges = roster.threads.find((row) => row.channel_slug === 'challenges')?.unread_count || 0;
		return { viewer_id: Number(userId), total_unread: Math.max(0, Number(total) || 0), challenges_unread: challenges, chat_unread: Math.max(0, Number(total) - challenges) };
	}
	async function markRead(userId, threadId, messageId) {
		await threadForMember(userId, threadId);
		const mid = Number(messageId);
		if (!Number.isSafeInteger(mid) || mid <= 0) fail(400, 'last_read_message_id required');
		const message = await result(client.from('prsn_chat_messages').select('id').eq('thread_id', threadId).eq('id', mid).maybeSingle());
		if (!message) fail(404, 'Message not found in this thread');
		// Guard the update in the database so overlapping acknowledgements never
		// move the marker backward, including across tabs.
		await result(client.from('prsn_chat_members').update({ last_read_message_id: mid }).eq('thread_id', threadId).eq('user_id', userId).or(`last_read_message_id.is.null,last_read_message_id.lt.${mid}`));
		const member = await result(client.from('prsn_chat_members').select('last_read_message_id').eq('thread_id', threadId).eq('user_id', userId).maybeSingle());
		void broadcast(client, `user:${userId}`, { threadId: String(threadId) });
		return { ok: true, last_read_message_id: Number(member?.last_read_message_id) || mid };
	}
	async function send(userId, threadId, payload) {
		const thread = await threadForMember(userId, threadId);
		const body = typeof payload?.body === 'string' ? payload.body.replace(/\u0000/g, '').trim() : '';
		if (!body || body.length > (thread.visibility === 'private' ? 22000 : 4000)) fail(400, 'Message must contain 1–4000 characters');
		if (thread.channel_slug === 'challenges') fail(403, 'Use the Challenges view for challenge messages');
		const plain = thread.visibility === 'private' ? (body.startsWith('enc:v1:') ? decrypt(body.slice(7), await privateSecret(userId, threadId)) : null) : body;
		if (!plain) fail(400, 'Private channel messages must be encrypted with your channel key');
		if (plain.length > 4000) fail(400, 'Message must contain 1–4000 characters');
		const meta = {};
		if (payload?.referenced_message_id != null) {
			const referencedId = Number(payload.referenced_message_id);
			if (!Number.isSafeInteger(referencedId) || referencedId <= 0) fail(400, 'Invalid referenced message');
			const parent = await result(client.from('prsn_chat_messages').select('id, sender_id, body, meta').eq('thread_id', threadId).eq('id', referencedId).maybeSingle());
			if (!parent) fail(400, 'Referenced message is no longer available in this thread');
			const profile = await result(client.from('prsn_user_profiles').select('user_name, avatar_url').eq('user_id', parent.sender_id).maybeSingle());
			const sender = await users.byId(parent.sender_id);
			const timed = parent.meta?.time_sensitive;
			const expired = timed?.kind && Date.parse(timed.expires_at) <= Date.now();
			const parentBody = expired ? '[Expired message]' : thread.visibility === 'private'
				? (String(parent.body).startsWith('enc:v1:') ? decrypt(String(parent.body).slice(7), await privateSecret(userId, threadId)) : '') || '' : parent.body;
			meta.reply = { referenced_id: referencedId, sender_id: Number(parent.sender_id), sender_user_name: profile?.user_name || null,
				sender_avatar_url: profile?.avatar_url || null, sender_plan: sender?.meta?.plan === 'founder' ? 'founder' : 'free', preview_text: plainTextReplyPreview(parentBody) };
		}
		const message = await result(client.from('prsn_chat_messages').insert({ thread_id: threadId, sender_id: userId, body, meta }).select('id, thread_id, sender_id, body, created_at, meta, reactions').single());
		// Follow-up failures must not report a committed message as a failed send.
		void broadcast(client, `room:${threadId}`, { roomId: String(threadId), afterMessageId: String(message.id) });
		void (async () => {
			try {
				const members = await result(client.from('prsn_chat_members').select('user_id').eq('thread_id', threadId));
				for (const member of members || []) void broadcast(client, `user:${member.user_id}`, { threadId: String(threadId) });
			} catch (error) { console.warn('[threads] inbox broadcast failed:', error.message); }
		})();
		return { message: { ...message, body: plain, private_decrypted: thread.visibility === 'private', ...(meta.reply ? { reply_parent_exists: true } : {}) } };
	}
	async function edit(userId, messageId, payload) {
		if (!Number.isSafeInteger(messageId) || messageId <= 0) fail(400, 'Invalid message id');
		const message = await result(client.from('prsn_chat_messages').select('id, thread_id, sender_id, body, meta').eq('id', messageId).maybeSingle());
		if (!message) fail(404, 'Message not found');
		const thread = await threadForMember(userId, message.thread_id);
		const viewer = await users.byId(userId);
		if (Number(message.sender_id) !== Number(userId) && viewer?.role !== 'admin') fail(403, 'You can only edit your own messages');
		if (thread.channel_slug === 'challenges' || message.meta?.system_event) fail(403, 'This message requires its dedicated editor');
		const body = typeof payload?.body === 'string' ? payload.body.replace(/\u0000/g, '').trim() : '';
		if (body.length > (thread.visibility === 'private' ? 22000 : 4000)) fail(400, 'Message must contain 1–4000 characters');
		const plain = thread.visibility === 'private' ? (body.startsWith('enc:v1:') ? decrypt(body.slice(7), await privateSecret(userId, thread.id)) : null) : body;
		if (!plain || plain.length > 4000) fail(400, 'Message must contain 1–4000 characters');
		const canvasTitle = typeof payload?.title === 'string' ? payload.title.replace(/\u0000/g, '').trim() : '';
		if (payload?.title !== undefined && (!message.meta?.canvas || !canvasTitle || canvasTitle.length > 200)) fail(400, 'Invalid canvas title');
		const meta = { ...message.meta, ...(canvasTitle ? { canvas: { ...message.meta.canvas, title: canvasTitle } } : {}), edited_at: new Date().toISOString(), edited_by_user_id: Number(userId) };
		await result(client.from('prsn_chat_messages').update({ body, meta }).eq('id', messageId).eq('thread_id', thread.id));
		void broadcast(client, `room:${thread.id}`, { roomId: String(thread.id), afterMessageId: String(messageId) });
		void (async () => {
			try {
				const members = await result(client.from('prsn_chat_members').select('user_id').eq('thread_id', thread.id));
				for (const member of members || []) void broadcast(client, `user:${member.user_id}`, { threadId: String(thread.id) });
			} catch (error) { console.warn('[threads] edit inbox broadcast failed:', error.message); }
		})();
		return { message: { ...message, body: plain, meta, private_decrypted: thread.visibility === 'private' } };
	}
	async function react(userId, messageId, payload) {
		if (!Number.isSafeInteger(messageId) || messageId <= 0) fail(400, 'Invalid message id');
		const key = payload?.emoji_key;
		if (!REACTION_ORDER.includes(key)) fail(400, 'Invalid reaction');
		const op = payload?.op || 'toggle';
		if (!['add', 'remove', 'toggle'].includes(op)) fail(400, 'Invalid reaction operation');
		for (let attempt = 0; attempt < 5; attempt++) {
			const message = await result(client.from('prsn_chat_messages').select('id, thread_id, reactions, meta').eq('id', messageId).maybeSingle());
			if (!message) fail(404, 'Message not found');
			const thread = await threadForMember(userId, message.thread_id);
			if (thread.channel_slug === 'challenges' || message.meta?.system_event) fail(403, 'This message requires its dedicated reaction controls');
			const bucket = normalizeReactionBucket(message.reactions);
			const voters = bucket[key] || [];
			const added = op === 'add' || (op === 'toggle' && !voters.includes(Number(userId)));
			const next = added ? [...new Set([...voters, Number(userId)])] : voters.filter((id) => id !== Number(userId));
			if (next.length) bucket[key] = next; else delete bucket[key];
			// Finish profile reads before committing, so a lookup failure cannot
			// report a successful toggle as failed and invite an inverse retry.
			const [enriched] = await enrichReactions([{ id: messageId, reactions: bucket }], userId);
			// Compare the entire JSON value in the database: concurrent voters
			// must not overwrite each other's additions to any reaction key.
			let update = client.from('prsn_chat_messages').update({ reactions: bucket }).eq('id', messageId).eq('thread_id', thread.id);
			update = message.reactions == null ? update.is('reactions', null) : update.eq('reactions', JSON.stringify(message.reactions));
			const saved = await result(update.select('id, reactions').maybeSingle());
			if (!saved) continue;
			void broadcast(client, `room:${thread.id}`, { roomId: String(thread.id), afterMessageId: String(messageId) });
			return { ...enriched, added, count: next.length };
		}
		fail(409, 'Reactions changed while saving. Please try again.');
	}
	async function remove(userId, messageId) {
		if (!Number.isSafeInteger(messageId) || messageId <= 0) fail(400, 'Invalid message id');
		const message = await result(client.from('prsn_chat_messages').select('id, thread_id, sender_id, body, meta').eq('id', messageId).maybeSingle());
		if (!message) fail(404, 'Message not found');
		const thread = await threadForMember(userId, message.thread_id);
		const viewer = await users.byId(userId);
		if (Number(message.sender_id) !== Number(userId) && viewer?.role !== 'admin') fail(403, 'You can only delete your own messages');
		if (thread.channel_slug === 'challenges' || message.meta?.system_event) fail(403, 'This message requires its dedicated controls');
		const body = thread.visibility === 'private' && String(message.body).startsWith('enc:v1:')
			? decrypt(String(message.body).slice(7), await privateSecret(userId, thread.id)) || '' : message.body;
		// Preserve unrelated thread metadata if another writer changes it while
		// clearing a pin. Repair pointers before deleting their referenced row.
		for (let attempt = 0; attempt < 5; attempt++) {
			const current = await result(client.from('prsn_chat_threads').select('meta').eq('id', thread.id).maybeSingle());
			const pin = current?.meta?.channel_pin;
			const canvasPin = current?.meta?.canvas?.pinned_message_id ?? current?.meta?.canvas?.pinnedMessageId;
			if (Number(pin?.message_id ?? pin?.messageId) !== messageId && Number(canvasPin) !== messageId) break;
			const meta = { ...current.meta };
			if (Number(pin?.message_id ?? pin?.messageId) === messageId) delete meta.channel_pin;
			if (Number(canvasPin) === messageId) { meta.canvas = { ...meta.canvas }; delete meta.canvas.pinned_message_id; delete meta.canvas.pinnedMessageId; if (!Object.keys(meta.canvas).length) delete meta.canvas; }
			const saved = await result(client.from('prsn_chat_threads').update({ meta }).eq('id', thread.id).eq('meta', JSON.stringify(current.meta)).select('id').maybeSingle());
			if (saved) break;
			if (attempt === 4) fail(409, 'Thread changed while clearing its pin. Please try again.');
		}
		const previous = await result(client.from('prsn_chat_messages').select('id').eq('thread_id', thread.id).lt('id', messageId).order('id', { ascending: false }).limit(1).maybeSingle());
		await result(client.from('prsn_chat_members').update({ last_read_message_id: previous?.id ?? null }).eq('thread_id', thread.id).eq('last_read_message_id', messageId));
		await result(client.from('prsn_chat_messages').delete().eq('id', messageId).eq('thread_id', thread.id));
		void broadcast(client, `room:${thread.id}`, { roomId: String(thread.id), afterMessageId: String(messageId) });
		void (async () => {
			try {
				const members = await result(client.from('prsn_chat_members').select('user_id').eq('thread_id', thread.id));
				for (const member of members || []) void broadcast(client, `user:${member.user_id}`, { threadId: String(thread.id) });
			} catch (error) { console.warn('[threads] delete inbox broadcast failed:', error.message); }
			for (const key of collectChatMiscGenericKeysFromMessageBody(body)) {
				if (!isChatMiscGenericKeyOwnedByUser(key, message.sender_id)) continue;
				try { await result(client.storage.from(/\/misc_/i.test(key) ? 'prsn_misc' : 'prsn_generic-images').remove([key])); }
				catch (error) { console.warn('[threads] deleted message attachment cleanup failed:', error.message); }
			}
		})();
		return { ok: true, deleted_id: messageId, thread_id: thread.id };
	}
	const canvases = createThreadCanvases({ client, users, threadForMember, privateSecret, decrypt, broadcast });
	return { canvases, inbox, openPublicChannel, openDm, listPublicChannelSlugs, hideThread, leaveThread, messages, unread, threadForMember, markRead, send, edit, react, remove,
		async getPrivateKey(userId, threadId) { const thread = await threadForMember(userId, threadId); if (thread.visibility !== 'private') fail(400, 'Not a private channel'); const k = await privateSecret(userId, threadId); if (!k) fail(403, 'Private channel key missing'); return { k }; },
	};
}
