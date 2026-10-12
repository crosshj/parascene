import { totalVoteCountFromChallengeReactions } from '../constants.js';

/**
 * Thin presenter: latest config payload → hero title string (escaped once in hero view).
 * @param {object | null} latestConfig
 * @param {object[]} [rankedSubmissions]
 */
export function participantHeroViewModel(latestConfig, rankedSubmissions = []) {
	const title =
		latestConfig &&
		typeof latestConfig.title === 'string' &&
		latestConfig.title.trim()
			? latestConfig.title.trim()
			: latestConfig
				? `Challenge ${latestConfig.challenge_id ?? ''}`
				: '';

	const entries = Array.isArray(rankedSubmissions) ? rankedSubmissions.length : 0;
	const submitters = new Set();
	for (const row of rankedSubmissions) {
		const sid = row?.senderId != null ? Number(row.senderId) : NaN;
		if (Number.isFinite(sid) && sid > 0) {
			submitters.add(`sid:${sid}`);
			continue;
		}
		const userName =
			typeof row?.msg?.sender_user_name === 'string' ? row.msg.sender_user_name.trim() : '';
		if (userName) {
			submitters.add(`uname:${userName.toLowerCase()}`);
			continue;
		}
		const mid = row?.messageId != null ? Number(row.messageId) : NaN;
		if (Number.isFinite(mid) && mid > 0) {
			submitters.add(`mid:${mid}`);
		}
	}
	const creators = submitters.size;

	let totalVotes = 0;
	for (const row of rankedSubmissions) {
		totalVotes += totalVoteCountFromChallengeReactions(row?.reactions);
	}

	return {
		title,
		stats: [
			{ key: 'entries', label: 'Entries so far', value: String(entries) },
			{ key: 'creators', label: 'Creators entered', value: String(creators) },
			{ key: 'votes', label: 'Total votes', value: String(totalVotes) }
		]
	};
}
