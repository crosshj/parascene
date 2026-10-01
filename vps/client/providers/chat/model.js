export function mergeChatInbox(inbox, current = {}) {
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
	return {
		...inbox,
		threads,
		pinnedIds: Array.isArray(current?.pinnedIds) ? current.pinnedIds : [],
		hiddenIds: Array.isArray(current?.hiddenIds) ? current.hiddenIds : [],
		readMarkers
	};
}
