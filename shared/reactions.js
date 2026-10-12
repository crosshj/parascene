// WWW reaction keys, shared by the API and client controls.
export const REACTION_ORDER = [
	'heart', 'thumbsUp', 'thumbsDown', 'joy', 'grin', 'openMouth', 'sad', 'angry',
	'clap', 'hundred', 'fire', 'thinking', 'eyes', 'rocket', 'pray',
];

export function normalizeReactionBucket(raw) {
	const bucket = {};
	for (const key of REACTION_ORDER) {
		const ids = [...new Set((Array.isArray(raw?.[key]) ? raw[key] : []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
		if (ids.length) bucket[key] = ids;
	}
	return bucket;
}
