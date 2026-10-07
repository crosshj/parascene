import { buildChallengesChannelModel } from './buildChannelModel.js';
import { rankedSubmissionsForPeerVoting } from './participantSlice.js';

const VOTE_PHASES = new Set(['voting', 'submit_and_vote']);

function liveItems(participant) {
	const active = Array.isArray(participant?.activeChallenges) ? participant.activeChallenges : [];
	if (active.length) return active;
	const phase = participant?.phase;
	if (participant?.latestConfig && (phase === 'submitting' || VOTE_PHASES.has(phase))) {
		return [{ phase, rankedSubmissions: participant.rankedSubmissions || [] }];
	}
	return [];
}

/** Submissions the viewer can still score. Same count the Vote button badge uses. */
export function outstandingChallengeVotes(messages, viewerId) {
	const model = buildChallengesChannelModel(Array.isArray(messages) ? messages : [], { viewerId });
	let total = 0;
	for (const item of liveItems(model.participant)) {
		if (!VOTE_PHASES.has(item.phase)) continue;
		for (const row of rankedSubmissionsForPeerVoting(item.rankedSubmissions || [], viewerId)) {
			if (row.messageId && !row.viewerVote) total += 1;
		}
	}
	return total;
}
