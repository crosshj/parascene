import assert from 'node:assert/strict';
import test from 'node:test';
import { bellView } from '../client/providers/notifications/index.js';
import { notificationDestination, notificationPreview, notificationSlots } from '../client/providers/notifications/preview.js';
import { isDmChatMentionNotification, summarizeNotificationUnread } from '../db/notifications.js';
import { attentionCount, composeDocumentTitle, explainTitleCount, messageUnread, shouldPing } from '../client/providers/document/chrome.js';
import { createDocumentProvider } from '../client/providers/document/index.js';

function source(initial) {
	const state = { value: initial };
	const subscribers = new Set();
	return {
		state,
		query: {
			get data() { return state.value; },
			subscribe(fn) {
				subscribers.add(fn);
				fn({ data: state.value });
				return () => subscribers.delete(fn);
			},
			refresh() { return Promise.resolve(); },
			emit() { for (const fn of subscribers) fn({ data: state.value }); },
		},
	};
}

function page() {
	const link = {
		href: '/favicon.svg',
		getAttribute: () => link.href,
		setAttribute(_name, value) { link.href = value; },
	};
	return {
		title: '',
		visibilityState: 'visible',
		link,
		querySelector: () => link,
		addEventListener() {},
		removeEventListener() {},
	};
}

test('the document title and favicon follow messages plus notifications', () => {
	assert.equal(composeDocumentTitle('Feed · Parascene beta', 0), 'Feed · Parascene beta');
	assert.equal(composeDocumentTitle('(4) Feed · Parascene beta', 2), '(2) Feed · Parascene beta');
	assert.equal(composeDocumentTitle('Chat', 120), '(99+) Chat');
	assert.equal(attentionCount(3, 2), 5);
	assert.equal(shouldPing({ initialized: false, previous: 0, next: 4, hidden: true, audible: true }), false);
	assert.equal(shouldPing({ initialized: true, previous: 1, next: 2, hidden: false, audible: true }), false);
	assert.equal(shouldPing({ initialized: true, previous: 1, next: 2, hidden: true, audible: false }), false);
	assert.equal(shouldPing({ initialized: true, previous: 1, next: 2, hidden: true, audible: true }), true);
	assert.equal(isDmChatMentionNotification({ type: 'chat_mention', meta: { thread_type: 'dm' } }), true);
	assert.equal(isDmChatMentionNotification({ type: 'comment', link: '/creations/1' }), false);
	const summary = summarizeNotificationUnread([
		{ type: 'chat_mention', title: 'DM mention', meta: { thread_type: 'dm' } },
		{ type: 'chat_mention', title: 'Channel mention', meta: { thread_type: 'channel' } },
		{ id: 9, type: 'comment', title: 'New comment', link: '/creations/1' },
	]);
	assert.equal(summary.count, 2);
	assert.equal(summary.attention, 1);
	assert.deepEqual(summary.items, [{ id: 9, type: 'comment', title: 'New comment', link: '/creations/1' }]);
	const report = explainTitleCount({
		inbox: {
			unreadSummary: { total_unread: 3 },
			threads: [
				{ title: '#general', type: 'channel', unread_count: 2 },
				{ title: 'Ada', type: 'dm', unread_count: 1 },
				{ title: '#quiet', type: 'channel', unread_count: 0 },
			],
		},
		notifications: summary,
	});
	assert.equal(messageUnread({ unreadSummary: { total_unread: 0, challenges_unread: 0 } }, 1), 1);
	assert.equal(messageUnread({ unreadSummary: { total_unread: 4, challenges_unread: 1 } }, 1), 4);
	assert.equal(messageUnread({ unreadSummary: { total_unread: 2, challenges_unread: 0 } }, 1), 3);
	const voteReport = explainTitleCount({
		inbox: { unreadSummary: { total_unread: 0, challenges_unread: 0 } },
		challengeAttention: 1,
	});
	assert.equal(voteReport.total, 1);
	assert.match(voteReport.text, /\(1\) = 1 outstanding challenge vote/);
	assert.equal(report.total, 4);
	assert.match(report.text, /\(4\) = 3 unread messages \+ 1 notification/);
	assert.match(report.text, /#general: 2/);
	assert.match(report.text, /comment: New comment \(\/creations\/1\)/);
	assert.match(report.text, /Channel mention: chat mention, already in unread messages/);
	assert.deepEqual(bellView({ count: 4, attention: 1 }), { known: true, count: 4, text: '4', label: 'Notifications, 4 unread' });
	assert.equal(bellView(undefined).text, '');
	assert.equal(bellView({ count: 120 }).text, '99+');
	const preview = notificationPreview([
		{ id: 5, title: 'Unread comment', link: '/creations/5' },
		{ id: 3, title: 'Unread mention', type: 'chat_mention', link: '/chat/channel/general' },
		{ id: 2, title: 'Newer comment', acknowledged_at: '2026-10-02T00:00:00Z', link: '/creations/2' },
		{ id: 4, title: 'DM mention', type: 'chat_mention', link: '/chat/dm/9' },
		{ id: 1, title: 'Old comment', acknowledged_at: '2026-10-01T00:00:00Z', link: '/creations/1' },
	], 3);
	assert.deepEqual(preview.map((row) => row.id), [5, 3, 2]);
	const slots = notificationSlots(preview, 5);
	assert.equal(slots.length, 5);
	assert.deepEqual(slots.slice(0, 3).map((row) => row.id), [5, 3, 2]);
	assert.deepEqual(slots.slice(3), [null, null]);
	assert.equal(notificationDestination({ link: '/creations/5' }), '/creations/5');
	assert.equal(notificationDestination({ creation_id: 8 }), '/creations/8');
});

test('a background increase plays once and a claim clears the badge without another module writing the title', async () => {
	const messages = source({ unreadSummary: { total_unread: 1 } });
	const attentionListeners = new Set();
	messages.challengeAttention = null;
	messages.subscribeChallengeAttention = (listener) => {
		attentionListeners.add(listener);
		return () => attentionListeners.delete(listener);
	};
	messages.emitAttention = () => { for (const listener of attentionListeners) listener(messages.challengeAttention); };
	const notes = source({ count: 1 });
	const tab = page();
	let played = 0;
	const documentProvider = createDocumentProvider({
		threads: messages,
		notifications: notes,
		audible: () => true,
		sound: { play: async () => { played += 1; return true; }, bind() {} },
		pollMs: 0,
		target: tab,
	});
	documentProvider.start();
	assert.equal(played, 0);
	assert.equal(tab.title, '(2) parascene');
	assert.equal(tab.link.href, '/favicon-unread.svg');
	documentProvider.setTitle('Feed · Parascene beta');
	assert.equal(tab.title, '(2) Feed · Parascene beta');
	tab.visibilityState = 'hidden';
	messages.state.value = { unreadSummary: { total_unread: 3 } };
	messages.query.emit();
	assert.equal(played, 1);
	assert.equal(tab.title, '(4) Feed · Parascene beta');
	messages.query.emit();
	assert.equal(played, 1);
	tab.visibilityState = 'visible';
	notes.state.value = { count: 0 };
	notes.query.emit();
	assert.equal(played, 1);
	assert.equal(tab.title, '(3) Feed · Parascene beta');
	messages.state.value = { unreadSummary: { total_unread: 0, challenges_unread: 0 } };
	messages.query.emit();
	assert.equal(tab.title, 'Feed · Parascene beta');
	assert.equal(tab.link.href, '/favicon.svg');
	messages.challengeAttention = 1;
	messages.emitAttention();
	assert.equal(tab.title, '(1) Feed · Parascene beta');
	assert.equal(tab.link.href, '/favicon-unread.svg');
	assert.equal(documentProvider.explain().total, 1);
	documentProvider.destroy();
});

test('a ready daily credit claim is part of the shared attention count', () => {
	const messages = source({ unreadSummary: { total_unread: 0, challenges_unread: 0 } });
	messages.challengeAttention = null;
	messages.subscribeChallengeAttention = () => () => {};
	const notes = source({ count: 2, attention: 2 });
	const credits = source({ canClaim: true, lastClaimDate: null });
	const tab = page();
	const documentProvider = createDocumentProvider({
		threads: messages,
		notifications: notes,
		credits,
		audible: () => false,
		sound: { play: async () => false, bind() {} },
		pollMs: 0,
		target: tab,
	});
	documentProvider.start();
	assert.equal(tab.title, '(3) parascene');
	assert.equal(tab.link.href, '/favicon-unread.svg');
	assert.equal(documentProvider.attention().bell.text, '2');
	assert.equal(documentProvider.attention().bell.label, 'Notifications, 2 unread');
	assert.equal(documentProvider.attention().dailyClaim, 1);
	assert.match(documentProvider.explain().text, /1 daily credit claim/);
	credits.state.value = { canClaim: false, lastClaimDate: '2026-10-07T01:00:00.000Z' };
	credits.query.emit();
	assert.equal(tab.title, '(2) parascene');
	assert.equal(documentProvider.attention().bell.text, '2');
	assert.equal(documentProvider.attention().dailyClaim, 0);
	documentProvider.destroy();
});
