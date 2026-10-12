/**
 * Latest challenge_config per challenge_id (chronological configs: last wins).
 *
 * @param {{ msg: object, payload: object }[]} configs — chronological
 * @returns {{ challenge_id: string, title: string, payload: object, sortKey: number, configMessageId: number }[]}
 *          Newest-by-message-id first. `configMessageId` is the chat row to PATCH when editing.
 */
export function summarizeLatestChallengeConfigs(configs) {
	const latest = new Map();
	for (const row of configs || []) {
		const p = row?.payload;
		if (!p || typeof p !== 'object') continue;
		const cid =
			p.challenge_id != null ? String(p.challenge_id).trim() : '';
		if (!cid) continue;
		const msgId = Number(row.msg?.id);
		const sortKey = Number.isFinite(msgId) && msgId > 0 ? msgId : 0;
		const titleFromPayload =
			typeof p.title === 'string' && p.title.trim() ? p.title.trim() : '';
		const prev = latest.get(cid);
		if (prev && prev.sortKey > sortKey) {
			// Older patch arrived out of order: keep latest row, but retain a title if
			// the newer payload was a partial save without one.
			if (titleFromPayload && !prev.title) {
				latest.set(cid, { ...prev, title: titleFromPayload });
			}
			continue;
		}
		// Partial later patches often omit `title`; keep the last non-empty title.
		latest.set(cid, {
			challenge_id: cid,
			title: titleFromPayload || prev?.title || '',
			payload: p,
			sortKey,
			configMessageId: sortKey
		});
	}
	return Array.from(latest.values()).sort((a, b) => b.sortKey - a.sortKey);
}
