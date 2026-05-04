import { deriveChallengePhase } from './phases.js';

/**
 * View-model for challenge timeline / organizer strip: past vs active vs upcoming.
 * Each bucket entry carries phase at nowMs for display.
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
		if (phase === 'results') {
			past.push(row);
		} else if (phase === 'pre_submit') {
			upcoming.push(row);
		} else if (phase === 'empty') {
			continue;
		} else {
			current.push(row);
		}
	}

	return { past, current, upcoming };
}
