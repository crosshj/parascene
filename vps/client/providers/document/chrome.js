export const DOCUMENT_TITLE_PREFIX = /^\((?:99\+|\d+)\)\s+/;

function inboxMessageUnread(inbox) {
	const total = Number(inbox?.unreadSummary?.total_unread);
	if (Number.isFinite(total)) return Math.max(0, total);
	const threads = Array.isArray(inbox?.threads) ? inbox.threads : [];
	return threads.reduce((sum, row) => sum + Math.max(0, Number(row?.unread_count) || 0), 0);
}

function challengesInSummary(inbox) {
	if (!Number.isFinite(Number(inbox?.unreadSummary?.total_unread))) return 0;
	return Math.max(0, Number(inbox?.unreadSummary?.challenges_unread) || 0);
}

export function outstandingChallengeVotes(challengeAttention) {
	const votes = Number(challengeAttention);
	if (!Number.isFinite(votes) || votes <= 0) return 0;
	return Math.floor(votes);
}

export function messageUnread(inbox, challengeAttention) {
	const base = inboxMessageUnread(inbox);
	const included = challengesInSummary(inbox);
	const votes = outstandingChallengeVotes(challengeAttention);
	return Math.max(0, base - included) + Math.max(included, votes);
}

export function attentionCount(messages, notifications, dailyClaim = 0) {
	return Math.max(0, Number(messages) || 0) + Math.max(0, Number(notifications) || 0) + (Number(dailyClaim) > 0 ? 1 : 0);
}

export function composeAttention({
	messages = 0,
	notifications,
	dailyClaim = 0,
	notificationsKnown = false,
	claimKnown = false,
} = {}) {
	const messageCount = Math.max(0, Math.floor(Number(messages) || 0));
	const notificationCount = Math.max(0, Math.floor(Number(notifications?.count) || 0));
	const notificationAttention = notifications && Number.isFinite(Number(notifications.attention))
		? Math.max(0, Math.floor(Number(notifications.attention)))
		: notificationCount;
	const claim = claimKnown && Number(dailyClaim) > 0 ? 1 : 0;
	const bellCount = (notificationsKnown ? notificationCount : 0) + claim;
	const bellKnown = notificationsKnown || claim > 0;
	return {
		total: attentionCount(messageCount, notificationsKnown ? notificationAttention : 0, claim),
		messageCount,
		notificationCount,
		notificationAttention,
		dailyClaim: claim,
		bell: {
			known: bellKnown,
			count: bellKnown ? bellCount : 0,
			text: bellKnown && bellCount > 0 ? (bellCount > 99 ? '99+' : String(bellCount)) : '',
			label: bellCount > 0 ? `Notifications, ${bellCount} unread` : 'Notifications',
		},
	};
}

export function composeDocumentTitle(base, count) {
	const clean = String(base || 'parascene').replace(DOCUMENT_TITLE_PREFIX, '').trim() || 'parascene';
	const total = Math.max(0, Math.floor(Number(count) || 0));
	if (!total) return clean;
	return `(${total > 99 ? '99+' : String(total)}) ${clean}`;
}

export function shouldPing({ initialized, previous, next, hidden, audible }) {
	return initialized === true && audible === true && hidden === true && Number(next) > Number(previous);
}

export function faviconHref(count, defaultHref = '/favicon.svg') {
	return Number(count) > 0 ? '/favicon-unread.svg' : (defaultHref || '/favicon.svg');
}

function threadLabel(row) {
	const title = String(row?.title || '').trim();
	if (title) return title;
	if (row?.channel_slug) return `#${row.channel_slug}`;
	return 'Untitled';
}

function countNoun(count, singular, plural = `${singular}s`) {
	return `${count} ${count === 1 ? singular : plural}`;
}

export function explainTitleCount({ inbox, notifications, challengeAttention, dailyClaim = 0 } = {}) {
	const summaryTotal = Number(inbox?.unreadSummary?.total_unread);
	const votes = outstandingChallengeVotes(challengeAttention);
	const challengesIncluded = challengesInSummary(inbox);
	const challengeExtra = Math.max(0, votes - challengesIncluded);
	const messages = (Array.isArray(inbox?.threads) ? inbox.threads : [])
		.map((row) => ({
			title: threadLabel(row),
			unread: Math.max(0, Number(row?.unread_count) || 0),
			kind: row?.channel_slug === 'challenges' ? 'challenges' : (row?.type || 'thread'),
		}))
		.filter((row) => row.unread > 0);
	const listed = messages.reduce((sum, row) => sum + row.unread, 0);
	const messageCount = messageUnread(inbox, challengeAttention);
	const attention = Math.max(0, Math.floor(Number(notifications?.attention ?? notifications?.count) || 0));
	const claim = Number(dailyClaim) > 0 ? 1 : 0;
	const notes = (Array.isArray(notifications?.items) ? notifications.items : []).map((row) => ({
		type: row?.type || '',
		title: String(row?.title || '').trim() || 'Notification',
		link: row?.link || '',
	}));
	const skipped = (Array.isArray(notifications?.skipped) ? notifications.skipped : []).map((row) => ({
		type: row?.type || '',
		title: String(row?.title || '').trim() || 'Notification',
		reason: row?.reason || 'not included in the title',
	}));
	const total = attentionCount(messageCount, attention, claim);
	const parts = [];
	const inboxMessages = Math.max(0, messageCount - challengeExtra);
	if (inboxMessages) parts.push(countNoun(inboxMessages, 'unread message'));
	if (challengeExtra) parts.push(countNoun(challengeExtra, 'outstanding challenge vote'));
	if (attention) parts.push(countNoun(attention, 'notification'));
	if (claim) parts.push('1 daily credit claim');
	let text = total ? `(${total > 99 ? '99+' : total}) = ${parts.join(' + ')}` : 'The title has no unread count.';
	if (Number.isFinite(summaryTotal) && listed !== messageCount - challengeExtra) {
		text += `\nThe threads below add up to ${listed}. The title uses the unread summary (${messageCount - challengeExtra}).`;
	}
	if (messages.length) {
		text += `\n\nMessages\n${messages.map((row) => `- ${row.title}: ${row.unread}`).join('\n')}`;
	}
	if (notes.length) {
		text += `\n\nNotifications\n${notes.map((row) => `- ${row.type ? `${row.type}: ` : ''}${row.title}${row.link ? ` (${row.link})` : ''}`).join('\n')}`;
	} else if (attention) {
		text += `\n\nNotifications\n- ${countNoun(attention, 'notification')} (details have not loaded)`;
	}
	if (votes) {
		text += `\n\nChallenges\n- ${countNoun(votes, 'outstanding vote')}${challengesIncluded ? ` (${countNoun(challengesIncluded, 'unread challenge message')} already in the inbox)` : ''}`;
	}
	if (claim) text += '\n\nCredits\n- Daily credits ready to claim';
	if (skipped.length) {
		text += `\n\nNot counted in the title\n${skipped.map((row) => `- ${row.title}: ${row.reason}`).join('\n')}`;
	}
	return { total, messageCount, notificationCount: attention, dailyClaim: claim, challengeVotes: votes, messages, notifications: notes, skipped, text };
}
