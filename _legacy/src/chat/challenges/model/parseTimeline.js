import { extractChallengeEvents } from './extractEvents.js';
import { pickParticipantFocusConfig, submissionsForLatestChallenge } from './participantSlice.js';

/**
 * Back-compat shape used by older imports: latest challenge config + matching submissions only.
 * @param {object[]} messages chronological
 */
export function parseChallengeTimeline(messages) {
	const { configs, submissions } = extractChallengeEvents(messages);
	const { latestConfig, latestConfigMsg } = pickParticipantFocusConfig(configs, Date.now());
	const forChallenge = submissionsForLatestChallenge(submissions, latestConfig);
	return { latestConfig, latestConfigMsg, submissions: forChallenge };
}
