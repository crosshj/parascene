import { extractChallengeEvents } from './extractEvents.js';
import { bucketConfigsForSetup } from './setupBuckets.js';
import { buildParticipantSliceFromExtracted } from './participantSlice.js';

/**
 * Full challenges domain model from chat thread messages (no HTML).
 *
 * @param {object[]} messages — chronological chat rows (canvas rows already stripped)
 * @param {{ nowMs?: number, viewerId?: number | null }} [opts]
 */
export function buildChallengesChannelModel(messages, opts = {}) {
	const nowMs = typeof opts.nowMs === 'number' && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();

	const extracted = extractChallengeEvents(messages);
	const participant = buildParticipantSliceFromExtracted(extracted, messages, nowMs);
	const setup = bucketConfigsForSetup(extracted.configs, nowMs);

	return {
		nowMs,
		viewerId: opts.viewerId ?? null,
		raw: { configs: extracted.configs, submissions: extracted.submissions },
		participant,
		setup
	};
}
