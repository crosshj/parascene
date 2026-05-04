import { extractChallengeEvents } from './extractEvents.js';
import { pickLatestConfig, submissionsForLatestChallenge } from './participantSlice.js';

/**
 * Back-compat shape used by older imports: latest challenge config + matching submissions only.
 * @param {object[]} messages chronological
 */
export function parseChallengeTimeline(messages) {
	const { configs, submissions } = extractChallengeEvents(messages);
	const { latestConfig, latestConfigMsg } = pickLatestConfig(configs);
	const forChallenge = submissionsForLatestChallenge(submissions, latestConfig);
	return { latestConfig, latestConfigMsg, submissions: forChallenge };
}
