/**
 * Challenge-related creation meta helpers (submissions + feed pins + organizer refs).
 * Submissions: meta.challenge_submissions
 * Feed pins (promo/winners): meta.challenge_feed_pins — stamped when organizers pin.
 * Organizer media: meta.challenge_organizer_refs — hero / results / topic_vote URLs.
 */

import { creationMetaHasChallengeOrganizerRef } from './challengeOrganizerRefMeta.js';

/**
 * True when this creation has been submitted to at least one challenge (see meta.challenge_submissions).
 * @param {unknown} meta
 */
export function creationMetaHasChallengeSubmission(meta) {
	return Array.isArray(meta?.challenge_submissions) && meta.challenge_submissions.length > 0;
}

/**
 * @param {unknown} meta
 * @param {number} [nowMs]
 * @returns {{ pin_id: string, challenge_id: string, kind: string, until: string|null, starts_at: string|null, title: string, details: string }[]}
 */
export function listActiveChallengeFeedPinsFromMeta(meta, nowMs = Date.now()) {
	const arr = meta?.challenge_feed_pins;
	if (!Array.isArray(arr)) return [];
	const now = typeof nowMs === 'number' ? nowMs : Date.now();
	const out = [];
	for (const raw of arr) {
		if (!raw || typeof raw !== 'object') continue;
		const pinId = raw.pin_id != null ? String(raw.pin_id).trim() : '';
		if (!pinId) continue;
		const startsAt =
			typeof raw.starts_at === 'string' && raw.starts_at.trim() ? raw.starts_at.trim() : null;
		const until = typeof raw.until === 'string' && raw.until.trim() ? raw.until.trim() : null;
		const startMs = startsAt ? Date.parse(startsAt) : NaN;
		if (Number.isFinite(startMs) && now < startMs) continue;
		const untilMs = until ? Date.parse(until) : NaN;
		if (Number.isFinite(untilMs) && now > untilMs) continue;
		const kindRaw = typeof raw.kind === 'string' ? raw.kind.trim().toLowerCase() : '';
		const kind =
			kindRaw === 'winners' || kindRaw === 'open' || kindRaw === 'topic_vote' ? kindRaw : 'other';
		const challengeId =
			raw.challenge_id != null ? String(raw.challenge_id).trim() : '';
		out.push({
			pin_id: pinId,
			challenge_id: challengeId,
			kind,
			until,
			starts_at: startsAt,
			title: typeof raw.title === 'string' ? raw.title.trim() : '',
			details: typeof raw.details === 'string' ? raw.details.trim() : '',
			track:
				raw.track != null
					? String(raw.track).trim().toLowerCase()
					: ''
		});
	}
	return out;
}

/**
 * True while an organizer feed pin (promo/winners) is still in its active window.
 * @param {unknown} meta
 * @param {number} [nowMs]
 */
export function creationMetaHasActiveChallengeFeedPin(meta, nowMs = Date.now()) {
	return listActiveChallengeFeedPinsFromMeta(meta, nowMs).length > 0;
}

/**
 * Library / detail annotation: challenge entry, feed pin, or organizer-attached media.
 * @param {unknown} meta
 * @param {number} [nowMs]
 */
export function creationMetaHasChallengeAnnotation(meta, nowMs = Date.now()) {
	return (
		creationMetaHasChallengeSubmission(meta) ||
		creationMetaHasActiveChallengeFeedPin(meta, nowMs) ||
		creationMetaHasChallengeOrganizerRef(meta)
	);
}

/**
 * True when archiving (group/party/delete) would hide a creation that is still
 * tied to a challenge as an entry, active feed pin, or organizer media.
 * @param {unknown} meta
 * @param {number} [nowMs]
 * @returns {{ blocked: boolean, kind: 'submission' | 'organizer' | null }}
 */
export function creationArchiveBlockedByChallenge(meta, nowMs = Date.now()) {
	if (creationMetaHasChallengeSubmission(meta)) {
		return { blocked: true, kind: 'submission' };
	}
	if (creationMetaHasChallengeOrganizerRef(meta) || creationMetaHasActiveChallengeFeedPin(meta, nowMs)) {
		return { blocked: true, kind: 'organizer' };
	}
	return { blocked: false, kind: null };
}

/**
 * @param {'submission' | 'organizer' | string | null | undefined} kind
 * @param {string} [actionWord] e.g. "grouping", "deleting"
 * @returns {string | null}
 */
export function challengeArchiveBlockMessageForKind(kind, actionWord) {
	const verb =
		typeof actionWord === 'string' && actionWord.trim() ? actionWord.trim() : 'changing it';
	if (kind === 'submission') {
		return `This creation is entered in a challenge. Remove it from the challenge before ${verb}.`;
	}
	if (kind === 'organizer') {
		return `This creation is used by a challenge (hero, results, theme vote, or feed pin). Clear that use before ${verb}.`;
	}
	return null;
}

/**
 * @param {unknown} meta
 * @param {string} [actionWord]
 * @param {number} [nowMs]
 * @returns {string | null}
 */
export function challengeArchiveBlockMessage(meta, actionWord, nowMs = Date.now()) {
	const block = creationArchiveBlockedByChallenge(meta, nowMs);
	if (!block.blocked) return null;
	return challengeArchiveBlockMessageForKind(block.kind, actionWord);
}

/**
 * Drop challenge stamps so a new group row does not inherit entry/pin/organizer state
 * from the first source's meta.
 * @param {unknown} meta
 * @returns {object}
 */
export function stripChallengeStampsFromCreationMeta(meta) {
	const base = meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {};
	delete base.challenge_submissions;
	delete base.challenge_feed_pins;
	delete base.challenge_organizer_refs;
	return base;
}

/**
 * @param {unknown} meta
 * @returns {number[]}
 */
export function groupSourceCreationIdsFromMeta(meta) {
	const group = meta?.group && typeof meta.group === 'object' ? meta.group : null;
	if (!group || group.kind !== 'group_creations') return [];
	const fromIds = Array.isArray(group.source_creation_ids) ? group.source_creation_ids : [];
	const fromSources = Array.isArray(group.source_creations) ? group.source_creations : [];
	const out = [];
	const seen = new Set();
	for (const raw of [...fromIds, ...fromSources.map((s) => s?.id)]) {
		const id = Number(raw);
		if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

/**
 * Upsert one feed-pin stamp onto creation meta (idempotent by pin_id).
 * @param {object|null|undefined} meta
 * @param {{
 *   pin_id: string,
 *   challenge_id?: string,
 *   kind?: string,
 *   until?: string|null,
 *   starts_at?: string|null,
 *   title?: string,
 *   details?: string
 * }} pin
 * @returns {object}
 */
export function upsertChallengeFeedPinInMeta(meta, pin) {
	const base = meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {};
	const pinId = pin?.pin_id != null ? String(pin.pin_id).trim() : '';
	if (!pinId) return base;
	const prev = Array.isArray(base.challenge_feed_pins) ? [...base.challenge_feed_pins] : [];
	const filtered = prev.filter((row) => {
		if (!row || typeof row !== 'object') return false;
		return String(row.pin_id || '').trim() !== pinId;
	});
	const kindRaw = typeof pin.kind === 'string' ? pin.kind.trim().toLowerCase() : '';
	const prevRow = prev.find((row) => row && typeof row === 'object' && String(row.pin_id || '').trim() === pinId);
	const title =
		typeof pin.title === 'string' && pin.title.trim()
			? pin.title.trim()
			: typeof prevRow?.title === 'string'
				? prevRow.title.trim()
				: '';
	const details =
		typeof pin.details === 'string' && pin.details.trim()
			? pin.details.trim()
			: typeof prevRow?.details === 'string'
				? prevRow.details.trim()
				: '';
	const trackRaw =
		pin.track != null
			? String(pin.track).trim().toLowerCase()
			: typeof prevRow?.track === 'string'
				? prevRow.track.trim().toLowerCase()
				: '';
	const track =
		trackRaw === 'weekly' || trackRaw === 'suno' || trackRaw === 'monthly' ? trackRaw : '';
	filtered.push({
		pin_id: pinId,
		challenge_id: pin.challenge_id != null ? String(pin.challenge_id).trim() : '',
		kind: kindRaw === 'winners' || kindRaw === 'open' || kindRaw === 'topic_vote' ? kindRaw : 'other',
		until: typeof pin.until === 'string' && pin.until.trim() ? pin.until.trim() : null,
		starts_at:
			typeof pin.starts_at === 'string' && pin.starts_at.trim() ? pin.starts_at.trim() : null,
		title,
		details,
		...(track ? { track } : {}),
		pinned_at: new Date().toISOString()
	});
	base.challenge_feed_pins = filtered;
	return base;
}

/**
 * Remove one feed-pin stamp by pin_id (after pin clear/expire).
 * @param {object|null|undefined} meta
 * @param {string} pinId
 * @returns {object}
 */
export function removeChallengeFeedPinFromMeta(meta, pinId) {
	const base = meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {};
	const id = pinId != null ? String(pinId).trim() : '';
	if (!id) return base;
	const prev = Array.isArray(base.challenge_feed_pins) ? base.challenge_feed_pins : [];
	base.challenge_feed_pins = prev.filter((row) => {
		if (!row || typeof row !== 'object') return false;
		return String(row.pin_id || '').trim() !== id;
	});
	return base;
}
