import { encryptThreadText } from '../../providers/threads/private.js';
import { plainTextReplyPreview } from '../../shared/plainTextReplyPreview.js';

export function createConversationController({ view, provider, route, viewerId, getViewer = () => null, onUnauthorized }) {
	const abort = new AbortController();
	let destroyed = false;
	let lease = null;
	let unsubscribe = null;
	let thread = null;
	let loadingOlder = false;
	let lastData = null;
	let lastRead = 0;
	let readTarget = 0;
	let reading = false;
	let jumping = false;
	const outgoing = new Map();
	const confirmed = new Map();
	const reacting = new Set();
	function render() { if (!destroyed && lease?.query.data) view.render({ ...lease.query.data, viewerIsAdmin: provider.query.data?.viewerIsAdmin === true, editable: thread?.channel_slug !== 'challenges', messages: [...lease.query.data.messages.map((message) => confirmed.has(String(message.id)) ? { ...message, clientKey: confirmed.get(String(message.id)).clientKey, created_at: confirmed.get(String(message.id)).created_at } : message), ...outgoing.values()] }); }
	function error(reason) {
		if (destroyed || reason?.name === 'AbortError') return;
		if (reason?.status === 401) return onUnauthorized?.();
		view.setStatus({ error: reason });
	}
	async function refresh() {
		if (lease) await lease.query.refresh().catch(error);
		else await start();
	}
	async function start() {
		view.setStatus({ isLoading: true });
		try {
			let inbox = provider.query.data;
			if (inbox) { if (provider.query.isStale()) void provider.query.refresh().catch(() => undefined); }
			else inbox = await provider.query.loadIfNeeded();
			if (destroyed) return;
			thread = inbox.threads.find((row) => route.kind === 'channel'
				? row.type === 'channel' && (route.threadId ? Number(row.id) === Number(route.threadId) : row.channel_slug === route.slug)
				: row.type === 'dm' && (route.slug === 'self' ? Number(row.other_user_id) === Number(viewerId) : String(row.other_user_id) === route.slug || row.other_user?.user_name?.toLowerCase() === route.slug.toLowerCase()));
			if (!thread && provider.query.data === inbox) {
				inbox = await provider.query.refresh();
				if (destroyed) return;
				thread = inbox.threads.find((row) => route.kind === 'channel'
					? row.type === 'channel' && (route.threadId ? Number(row.id) === Number(route.threadId) : row.channel_slug === route.slug)
					: row.type === 'dm' && (route.slug === 'self' ? Number(row.other_user_id) === Number(viewerId) : String(row.other_user_id) === route.slug || row.other_user?.user_name?.toLowerCase() === route.slug.toLowerCase()));
			}
			if (!thread && route.kind === 'channel' && !route.threadId) {
				await provider.api.openChannel(route.slug, { signal: abort.signal });
				if (destroyed) return;
				inbox = await provider.query.refresh({ force: true });
				if (destroyed) return;
				thread = inbox.threads.find(row => row.type === 'channel' && row.channel_slug === route.slug);
			}
			if (!thread) throw new Error('This conversation is not in your thread list yet.');
			view.setThread?.(thread, inbox);
			lastRead = Number(thread.last_read_message_id) || 0;
			view.setUnreadBoundary?.(lastRead);
			lease = provider.acquireMessages(thread.id, { persist: thread.type === 'channel' && thread.visibility !== 'private' });
			unsubscribe = lease.query.subscribe((snapshot) => {
				if (destroyed) return;
				if (snapshot.error?.status === 401) return onUnauthorized?.();
				if (snapshot.data && snapshot.data !== lastData) { lastData = snapshot.data; render(); void view.refreshChrome?.(); }
				view.setStatus(snapshot);
				view.setReady?.(!!snapshot.data && !snapshot.error);
			});
			void lease.query.refresh().catch(error);
		} catch (reason) { error(reason); }
	}
	async function markRead(messageId) {
		if (destroyed || !thread || messageId <= lastRead) return;
		readTarget = Math.max(readTarget, messageId);
		if (reading) return;
		reading = true;
		try {
			while (!destroyed && readTarget > lastRead) {
				const response = await provider.markRead(thread.id, readTarget, { signal: abort.signal });
				lastRead = Math.max(lastRead, Number(response.last_read_message_id));
				view.clearUnread?.(lastRead);
			}
		} catch (reason) { if (reason?.status === 401) onUnauthorized?.(); }
		finally { reading = false; }
	}
	async function deliver(record) {
		if (destroyed || record.delivery.status === 'pending') return;
		record.delivery = { status: 'pending' }; render();
		try {
			const message = await provider.send(thread, record.body, record.meta?.reply);
			if (destroyed) return;
			outgoing.delete(record.id);
			confirmed.set(String(message.id), { clientKey: record.clientKey, created_at: record.created_at });
			const data = lease.query.data;
			lease.query.setData({ ...data, messages: [...data.messages.filter((row) => String(row.id) !== String(message.id)), message].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || Number(a.id) - Number(b.id)) });
		} catch (reason) {
			if (destroyed) return;
			record.delivery = { status: 'failed', error: reason.message || 'Could not send.' }; render();
			if (reason.status === 401) onUnauthorized?.();
		}
	}
	function send(body, reply) {
		if (destroyed || !thread || !lease?.query.data) return false;
		const viewer = getViewer() || {};
		const profile = viewer.profile || viewer;
		const clientKey = `pending-${crypto.randomUUID()}`;
		const record = { id: clientKey, clientKey, sender_id: viewerId, sender_user_name: profile.user_name, sender_avatar_url: profile.avatar_url, sender_plan: viewer.plan === 'founder' || viewer.meta?.plan === 'founder' ? 'founder' : 'free', body, created_at: new Date().toISOString(), meta: reply ? { reply: { ...reply } } : {}, reply_parent_exists: !!reply, delivery: { status: 'queued' } };
		outgoing.set(record.id, record); void deliver(record); return true;
	}
	async function loadOlder() {
		const data = lease?.query.data;
		if (destroyed || loadingOlder || !data?.hasMore || !data.nextBefore) return;
		loadingOlder = true;
		view.setLoadingOlder(true);
		try {
			const page = await provider.api.loadMessages(thread.id, { before: data.nextBefore, signal: abort.signal });
			if (destroyed) return;
			const current = lease.query.data;
			const existing = new Set(current.messages.map((row) => String(row.id)));
			lease.query.setData({ ...page, messages: [...page.messages.filter((row) => !existing.has(String(row.id))), ...current.messages] });
			return true;
		} catch (reason) { error(reason); }
		finally { loadingOlder = false; if (!destroyed) view.setLoadingOlder(false); }
	}
	void start();
	return {
		refresh, loadOlder, send, markRead,
		showError: error,
		async editCanvas(id, payload) {
			let body = payload.body;
			if (thread.visibility === 'private') { const { k } = await provider.api.getPrivateKey(thread.id, { signal: abort.signal }); body = await encryptThreadText(body, k); }
			return provider.api.editMessage(id, { title: payload.title, body }, { signal: abort.signal });
		},
		async remove(id) {
			if (destroyed || !thread || !lease?.query.data) return false;
			try {
				await provider.remove(thread, Number(id));
				if (destroyed) return false;
				lease.query.update((data) => ({ ...data, messages: data.messages.filter((row) => Number(row.id) !== Number(id)).map((row) => Number(row.meta?.reply?.referenced_id) === Number(id) ? { ...row, reply_parent_exists: false } : row) }));
				return true;
			} catch (reason) { if (!destroyed && reason?.status === 401) onUnauthorized?.(); throw reason; }
		},
		async react(id, emoji) {
			const messageId = Number(id);
			if (destroyed || !lease?.query.data || reacting.has(messageId)) return false;
			reacting.add(messageId);
			try {
				const response = await provider.react(thread, messageId, emoji);
				if (destroyed) return false;
				lease.query.update((data) => ({ ...data, messages: data.messages.map((row) => Number(row.id) === messageId
					? { ...row, reactions: response.reactions, viewer_reactions: response.viewer_reactions } : row) }));
				return true;
			} catch (reason) { if (!destroyed && reason?.status === 401) onUnauthorized?.(); throw reason; }
			finally { reacting.delete(messageId); }
		},
		async jumpToReply(id) {
			if (destroyed || jumping || loadingOlder || !lease) return;
			jumping = true;
			try {
				while (!destroyed && !lease.query.data?.messages.some((row) => Number(row.id) === Number(id)) && lease.query.data?.hasMore) {
					const before = lease.query.data.nextBefore;
					if (!await loadOlder() || lease.query.data.nextBefore === before) return;
				}
				if (!destroyed && !view.jumpToMessage?.(id)) view.setStatus({ error: new Error('The original message is no longer available.') });
			} finally { jumping = false; }
		},
		reply(id) {
			const message = lease?.query.data?.messages.find((row) => Number(row.id) === Number(id));
			if (destroyed || !message || thread?.channel_slug === 'challenges') return;
			view.setReply?.({ referenced_id: Number(message.id), sender_id: Number(message.sender_id), sender_user_name: message.sender_user_name,
				sender_avatar_url: message.sender_avatar_url, sender_plan: message.sender_plan, preview_text: plainTextReplyPreview(message.body) });
		},
		async edit(id, body) {
			if (destroyed || !thread || !lease?.query.data) return false;
			try {
				const message = await provider.edit(thread, Number(id), body);
				if (destroyed) return false;
				lease.query.update((data) => ({ ...data, messages: data.messages.map((row) => Number(row.id) === Number(id) ? { ...row, ...message } : row) }));
				return true;
			} catch (reason) { if (!destroyed && reason?.status === 401) onUnauthorized?.(); throw reason; }
		},
		retrySend(id) { const record = outgoing.get(id); if (record) void deliver(record); },
		destroy() { destroyed = true; abort.abort(); unsubscribe?.(); lease?.release(); },
	};
}
