/**
 * Thin presenter: latest config payload → hero title string (escaped once in hero view).
 * @param {object | null} latestConfig
 */
export function participantHeroViewModel(latestConfig) {
	const title =
		latestConfig &&
		typeof latestConfig.title === 'string' &&
		latestConfig.title.trim()
			? latestConfig.title.trim()
			: latestConfig
				? `Challenge ${latestConfig.challenge_id ?? ''}`
				: '';
	return { title };
}
