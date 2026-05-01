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
		const title = typeof p.title === 'string' ? p.title : '';
		latest.set(cid, {
			challenge_id: cid,
			title,
			payload: p,
			sortKey,
			configMessageId: sortKey
		});
	}
	return Array.from(latest.values()).sort((a, b) => b.sortKey - a.sortKey);
}
