import { parseChallengesDetailsPath } from '../../shared/challenges/model/detailsRoute.js';
import { captureChallengeSubmitThread } from '../../shared/challengeSubmitContext.js';
import { requestJson } from '../../core/request.js';

/**
 * Binds the challenges view to the history provider.
 * The view asks for the main page or one challenge. The provider decides
 * cache, fetch, and stale-while-revalidate. A later channel change — a
 * reaction, a new message, an edit — is handed to the provider so the short
 * active cache updates.
 * @param {{
 *   services: { providers: { threads: any, challengeHistory: any } },
 *   organizing: boolean,
 *   bindChannel: (channel: { threadId: number, lease: any, refresh: () => Promise<void> }) => void,
 *   onQuery: (snapshot: any) => void,
 *   onDelivery: (delivery: any) => void,
 *   onThreadMissing: (snapshot: any) => void,
 * }} opts
 */
export function createChallengesController({ services, organizing, bindChannel, onQuery, onDelivery, onThreadMissing }) {
	const threads = services.providers.threads;
	const history = services.providers.challengeHistory;
	let destroyed = false;
	let lease = null;
	let unsubscribeMessages = null;
	let unsubscribeObserve = null;
	let unsubscribeInbox = null;
	let threadId = null;
	let suppress = 0;
	let baseline = false;
	let seenStamp = '';
	let lastDelivery = null;

	function channelStamp(messages) {
		const list = Array.isArray(messages) ? messages : [];
		let hash = list.length;
		for (const message of list) {
			hash = Math.imul(hash, 33) + (Number(message?.id) || 0);
			const body = typeof message?.body === 'string' ? message.body : '';
			hash = Math.imul(hash, 33) + body.length;
			const reactions = message?.reactions;
			if (reactions) hash = Math.imul(hash, 33) + JSON.stringify(reactions).length;
			const viewerReactions = message?.viewer_reactions;
			if (viewerReactions) hash = Math.imul(hash, 33) + JSON.stringify(viewerReactions).length;
		}
		return String(hash);
	}

	function viewingPastChallenge() {
		return lastDelivery?.paint === 'challenge' && lastDelivery.active === false;
	}

	function requestFor(pathname) {
		const detailId = parseChallengesDetailsPath(pathname)?.challengeId || '';
		return detailId ? { kind: 'challenge', challengeId: detailId } : { kind: 'main' };
	}

	async function loadChannel() {
		suppress++;
		try {
			const data = await lease?.query.refresh();
			return data?.messages || lease?.query.data?.messages || [];
		} finally {
			suppress--;
		}
	}

	async function refresh() {
		if (!lease) {
			await threads.query?.refresh().catch(() => undefined);
			return;
		}
		if (organizing) {
			await lease.query.refresh().catch(() => undefined);
			return;
		}
		await loadChannel().catch(() => undefined);
		history?.invalidateActive?.(threadId, { reason: 'refresh', messages: lease.query.data?.messages });
	}

	function onMessages(snapshot) {
		if (destroyed) return;
		onQuery(snapshot);
		if (organizing || !snapshot.data?.complete) return;
		const stamp = channelStamp(snapshot.data.messages);
		if (!baseline) {
			baseline = true;
			seenStamp = stamp;
			const served = lastDelivery?.messages;
			if (!viewingPastChallenge() && Array.isArray(served) && channelStamp(served) !== stamp) {
				history?.applyChannelSnapshot?.(threadId, snapshot.data.messages);
			}
			return;
		}
		if (suppress) {
			seenStamp = stamp;
			return;
		}
		// A past challenge is already served from the channel snapshot. Reloading that
		// snapshot, or a refresh that does not change the messages, is not a channel change.
		if (viewingPastChallenge() || stamp === seenStamp) {
			seenStamp = stamp;
			return;
		}
		seenStamp = stamp;
		history?.invalidateActive?.(threadId, { reason: 'channel change', messages: snapshot.data.messages });
	}

	function connect(inboxSnapshot) {
		if (destroyed || lease) return;
		const thread = inboxSnapshot.data?.threads?.find((row) => row.channel_slug === 'challenges');
		if (!thread) {
			onThreadMissing(inboxSnapshot);
			return;
		}
		threadId = Number(thread.id);
		captureChallengeSubmitThread(threadId);
		lease = threads.acquireMessages(threadId, { persist: true, complete: true });
		bindChannel({ threadId, lease, refresh });
		if (!organizing && history?.observe) {
			unsubscribeObserve = history.observe({
				threadId,
				request: requestFor(location.pathname),
				loadChannel,
				loadEntryCreations: (id, challengeId, items) => requestJson(
					`/api/chat/challenges/${id}/entry-creations`,
					{ method: 'POST', body: { challengeId, items } }
				)
			}, (delivery) => {
				if (destroyed) return;
				lastDelivery = delivery;
				onDelivery(delivery);
			});
		}
		unsubscribeMessages = lease.query.subscribe(onMessages);
	}

	unsubscribeInbox = threads.query?.subscribe(connect);
	if (threads.query) void threads.query.loadIfNeeded().catch(() => undefined);

	return {
		refresh,
		repaint() {
			if (lastDelivery) onDelivery(lastDelivery);
		},
		destroy() {
			destroyed = true;
			unsubscribeInbox?.();
			unsubscribeMessages?.();
			unsubscribeObserve?.();
			lease?.release();
		}
	};
}
