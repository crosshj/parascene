import { deriveChallengePhase } from './phases.js';
import { isChallengeListedForUpcoming } from '../challengeAdmin.js';

/**
 * View-model for challenge timeline / organizer strip: past vs active vs upcoming.
 * Each bucket entry carries phase at nowMs for display.
 * Public upcoming only includes listed pre_submit challenges.
 *
 * @param {Array<{ msg: object, payload: object }>} configEntries
 * @param {number} nowMs
 */
export function bucketConfigsForSetup(configEntries, nowMs) {
	const past = [];
	const current = [];
	const upcoming = [];

	for (const entry of configEntries) {
		const phase = deriveChallengePhase(entry.payload, nowMs);
		const row = { ...entry, phase };
		if (phase === 'deleted' || phase === 'purged' || phase === 'empty') {
			continue;
		} else if (phase === 'results') {
			past.push(row);
		} else if (phase === 'pre_submit') {
			if (isChallengeListedForUpcoming(entry.payload)) upcoming.push(row);
		} else {
			current.push(row);
		}
	}

	return { past, current, upcoming };
}
