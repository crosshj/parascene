/**
 * Organizer-attached creations on challenge_config:
 * hero_image_url, results_creation_url, topic_vote_creation_url.
 * Stamped onto the creation as meta.challenge_organizer_refs (like challenge_submissions).
 */

/** @typedef {'hero'|'results'|'topic_vote'} ChallengeOrganizerRefRole */

/**
 * @param {unknown} meta
 * @returns {{ challenge_id: string, role: ChallengeOrganizerRefRole, title?: string, details?: string, track?: string, attached_at?: string }[]}
 */
export function listChallengeOrganizerRefsFromMeta(meta) {
	const arr = meta?.challenge_organizer_refs;
	if (!Array.isArray(arr)) return [];
	const out = [];
	for (const raw of arr) {
		if (!raw || typeof raw !== 'object') continue;
		const challengeId = raw.challenge_id != null ? String(raw.challenge_id).trim() : '';
		const roleRaw = typeof raw.role === 'string' ? raw.role.trim().toLowerCase() : '';
		/** @type {ChallengeOrganizerRefRole|null} */
		let role = null;
		if (roleRaw === 'hero' || roleRaw === 'results' || roleRaw === 'topic_vote') role = roleRaw;
		if (!challengeId || !role) continue;
		const title = typeof raw.title === 'string' ? raw.title.trim() : '';
		const details = typeof raw.details === 'string' ? raw.details.trim() : '';
		const trackRaw = raw.track != null ? String(raw.track).trim().toLowerCase() : '';
		const track =
			trackRaw === 'weekly' || trackRaw === 'suno' || trackRaw === 'monthly' ? trackRaw : '';
		out.push({
			challenge_id: challengeId,
			role,
			title: title || undefined,
			details: details || undefined,
			track: track || undefined,
			attached_at: typeof raw.attached_at === 'string' ? raw.attached_at : undefined
		});
	}
	return out;
}

/**
 * @param {unknown} meta
 */
export function creationMetaHasChallengeOrganizerRef(meta) {
	return listChallengeOrganizerRefsFromMeta(meta).length > 0;
}

/**
 * True when this creation is still attached as challenge results/highlights media.
 * Used for lasting unpublished view access after the winners pin window ends.
 * @param {unknown} meta
 */
export function creationMetaHasChallengeResultsOrganizerRef(meta) {
	return listChallengeOrganizerRefsFromMeta(meta).some((r) => r.role === 'results');
}

/**
 * Challenge display title from organizer-ref stamps (hero / results / topic_vote).
 * @param {unknown} meta
 * @returns {string}
 */
export function pickChallengeTitleFromOrganizerRefs(meta) {
	for (const ref of listChallengeOrganizerRefsFromMeta(meta)) {
		if (ref.title) return ref.title;
	}
	return '';
}

/**
 * @param {object|null|undefined} meta
 * @param {{
 *   challenge_id: string,
 *   role: ChallengeOrganizerRefRole,
 *   title?: string|null,
 *   details?: string|null,
 *   track?: string|null
 * }} ref
 * @returns {object}
 */
export function upsertChallengeOrganizerRefInMeta(meta, ref) {
	const base = meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {};
	const challengeId = ref?.challenge_id != null ? String(ref.challenge_id).trim() : '';
	const role = ref?.role;
	if (!challengeId || (role !== 'hero' && role !== 'results' && role !== 'topic_vote')) {
		return base;
	}
	const prev = Array.isArray(base.challenge_organizer_refs) ? [...base.challenge_organizer_refs] : [];
	const prevRow = prev.find((row) => {
		if (!row || typeof row !== 'object') return false;
		return (
			String(row.challenge_id || '').trim() === challengeId &&
			String(row.role || '').trim().toLowerCase() === role
		);
	});
	const filtered = prev.filter((row) => {
		if (!row || typeof row !== 'object') return false;
		const cid = String(row.challenge_id || '').trim();
		const r = String(row.role || '').trim().toLowerCase();
		return !(cid === challengeId && r === role);
	});
	const title =
		typeof ref.title === 'string' && ref.title.trim()
			? ref.title.trim().slice(0, 200)
			: typeof prevRow?.title === 'string'
				? prevRow.title.trim()
				: '';
	const details =
		typeof ref.details === 'string' && ref.details.trim()
			? ref.details.trim().slice(0, 4000)
			: typeof prevRow?.details === 'string'
				? prevRow.details.trim()
				: '';
	const trackRaw =
		ref.track != null
			? String(ref.track).trim().toLowerCase()
			: typeof prevRow?.track === 'string'
				? prevRow.track.trim().toLowerCase()
				: '';
	const track =
		trackRaw === 'weekly' || trackRaw === 'suno' || trackRaw === 'monthly' ? trackRaw : '';
	/** @type {Record<string, string>} */
	const next = {
		challenge_id: challengeId,
		role,
		attached_at: new Date().toISOString()
	};
	if (title) next.title = title;
	if (details) next.details = details;
	if (track) next.track = track;
	filtered.push(next);
	base.challenge_organizer_refs = filtered;
	return base;
}

/**
 * @param {object|null|undefined} meta
 * @param {{ challenge_id: string, role?: ChallengeOrganizerRefRole }} args
 *  When role omitted, removes all roles for that challenge_id.
 * @returns {object}
 */
export function removeChallengeOrganizerRefFromMeta(meta, args) {
	const base = meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {};
	const challengeId = args?.challenge_id != null ? String(args.challenge_id).trim() : '';
	if (!challengeId || !Array.isArray(base.challenge_organizer_refs)) return base;
	const role = args?.role;
	base.challenge_organizer_refs = base.challenge_organizer_refs.filter((row) => {
		if (!row || typeof row !== 'object') return false;
		const cid = String(row.challenge_id || '').trim();
		if (cid !== challengeId) return true;
		if (!role) return false;
		return String(row.role || '').trim().toLowerCase() !== role;
	});
	if (base.challenge_organizer_refs.length === 0) {
		delete base.challenge_organizer_refs;
	}
	return base;
}

/**
 * Human label for organizer-ref role (creation detail chip / banner).
 * @param {ChallengeOrganizerRefRole|string} role
 */
export function challengeOrganizerRefRoleLabel(role) {
	if (role === 'hero') return 'Challenge hero';
	if (role === 'results') return 'Challenge results';
	if (role === 'topic_vote') return 'Theme vote';
	return 'Challenge media';
}
