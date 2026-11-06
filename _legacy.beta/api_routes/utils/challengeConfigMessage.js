/**
 * Challenge configs are one chat message per challenge_id.
 * Writes always update that message with a full body; duplicate rows are deleted.
 */

/**
 * @param {Iterable<number | string | null | undefined>} ids
 * @returns {number[]}
 */
export function normalizeChallengeConfigMessageIds(ids) {
	const out = [];
	const seen = new Set();
	for (const raw of ids || []) {
		const n = Number(raw);
		if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
		seen.add(n);
		out.push(n);
	}
	out.sort((a, b) => a - b);
	return out;
}

/**
 * Prefer the newest message id (matches organize PATCH target).
 * @param {Iterable<number | string | null | undefined>} ids
 * @returns {number}
 */
export function pickCanonicalChallengeConfigMessageId(ids) {
	const sorted = normalizeChallengeConfigMessageIds(ids);
	return sorted.length ? sorted[sorted.length - 1] : 0;
}

/**
 * Full challenge_config body: merged state plus optional field patch.
 * @param {object | null | undefined} merged
 * @param {string} challengeId
 * @param {object} [patch]
 */
export function buildFullChallengeConfigBody(merged, challengeId, patch = {}) {
	const cid = String(challengeId || '').trim();
	const base =
		merged && typeof merged === 'object' && !Array.isArray(merged) ? { ...merged } : {};
	delete base._last_msg_id;
	delete base._last_at;
	return {
		...base,
		...(patch && typeof patch === 'object' ? patch : {}),
		kind: 'challenge_config',
		challenge_id: cid
	};
}

/**
 * Update the canonical config message with a full body; delete any other
 * challenge_config rows for the same challenge_id.
 *
 * @param {{
 *   sb: { from: Function },
 *   threadId: number,
 *   challengeId: string,
 *   messageIds: Iterable<number | string>,
 *   merged: object,
 *   patch?: object,
 * }} args
 * @returns {Promise<{ messageId: number, payload: object, deletedIds: number[] }>}
 */
export async function persistSingleChallengeConfigMessage(args) {
	const challengeId = String(args?.challengeId || '').trim();
	if (!challengeId) throw new Error('challenge_id required');
	const ids = normalizeChallengeConfigMessageIds(args?.messageIds);
	const keepId = pickCanonicalChallengeConfigMessageId(ids);
	if (!keepId) throw new Error('No challenge_config message to update');

	const payload = buildFullChallengeConfigBody(args?.merged, challengeId, args?.patch);
	const body = JSON.stringify(payload);
	const { error } = await args.sb
		.from('prsn_chat_messages')
		.update({ body })
		.eq('id', keepId)
		.eq('thread_id', Number(args.threadId));
	if (error) throw error;

	const deletedIds = ids.filter((id) => id !== keepId);
	if (deletedIds.length) {
		const { error: delErr } = await args.sb
			.from('prsn_chat_messages')
			.delete()
			.in('id', deletedIds)
			.eq('thread_id', Number(args.threadId));
		if (delErr) throw delErr;
	}

	return { messageId: keepId, payload, deletedIds };
}
