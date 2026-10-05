export function mergeThreadsInbox(inbox, current = {}) {
	const readMarkers = { ...(current?.readMarkers || {}) };
	const threads = (Array.isArray(inbox?.threads) ? inbox.threads : []).map((row) => {
		const marker = readMarkers[String(row.id)];
		if (!Number.isFinite(Number(marker))) return row;
		const latestMessageId = Number(row.last_message?.id) || 0;
		if (latestMessageId > Number(marker)) {
			delete readMarkers[String(row.id)];
			return row;
		}
		return { ...row, unread_count: 0, last_read_message_id: Number(marker) || null };
	});
 const challenges = threads.find(row => row.channel_slug === 'challenges');
 const marker = readMarkers[String(challenges?.id)];
 const challengeRead = challenges && Number.isFinite(Number(marker)) && Number(challenges.last_message?.id || 0) <= Number(marker);
 const summary = inbox?.unreadSummary;
 const unreadSummary = summary && challengeRead ? { ...summary, challenges_unread: 0,
  total_unread: Math.max(0, Number(summary.total_unread || 0) - Number(summary.challenges_unread || 0)),
 } : summary;
	return {
		...inbox,
  unreadSummary,
		threads,
		pinnedIds: Array.isArray(current?.pinnedIds) ? current.pinnedIds : [],
		hiddenIds: Array.isArray(current?.hiddenIds) ? current.hiddenIds : [],
		readMarkers
	};
}
