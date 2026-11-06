/**
 * Which unpublished creations may appear in GET /api/comments/latest
 * (and Data Builder recent_comments) without leaking private drafts.
 */

import {
	creationMetaHasActiveChallengeFeedPin,
	listActiveChallengeFeedPinsFromMeta
} from '../../src/shared/challengeSubmitMeta.js';
import {
	creationMetaHasChallengeResultsOrganizerRef,
	pickChallengeTitleFromOrganizerRefs
} from '../../src/shared/challengeOrganizerRefMeta.js';
import { challengeIdsFromCreationMeta } from './challengeTitleLookup.js';
import {
	creationMetaIsChallengeEditorialMedia,
	formatChallengeStreamTitle,
	pickChallengeTrackFromCreationMeta
} from './challengeStreamDisplay.js';

/**
 * @param {unknown} published
 */
export function isCreationPublishedFlag(published) {
	return published === true || published === 1;
}

/**
 * Challenge title stamped on feed-pin meta when the creation itself has no title.
 * Prefers an active pin; otherwise any stamped pin title (e.g. results after pin expiry).
 * Falls back to organizer-ref title stamps (hero / results / topic_vote).
 * @param {unknown} meta
 * @param {number} [nowMs]
 * @returns {string}
 */
export function pickChallengeTitleFromCreationMeta(meta, nowMs = Date.now()) {
	const active = listActiveChallengeFeedPinsFromMeta(meta, nowMs);
	for (const pin of active) {
		if (pin.title) return pin.title;
	}
	const arr = meta?.challenge_feed_pins;
	if (Array.isArray(arr)) {
		for (const raw of arr) {
			if (!raw || typeof raw !== 'object') continue;
			const title = typeof raw.title === 'string' ? raw.title.trim() : '';
			if (title) return title;
		}
	}
	return pickChallengeTitleFromOrganizerRefs(meta);
}

/**
 * Display title for comments-stream cards: creation title, else challenge name.
 * Challenge editorial media is prefixed: "Monthly Challenge: Summer".
 * @param {{ id?: unknown, title?: unknown, meta?: unknown } | null | undefined} image
 * @param {{
 *   nowMs?: number,
 *   challengeTitleById?: Map<string, string> | null,
 *   titleByCreationId?: Map<number, string> | null,
 * }} [opts]
 * @returns {string}
 */
export function resolveCreationTitleForLatestComments(image, opts = {}) {
	const nowMs = Number(opts?.nowMs) || Date.now();
	const isChallengeMedia = creationMetaIsChallengeEditorialMedia(image?.meta, nowMs);
	const track = pickChallengeTrackFromCreationMeta(image?.meta);

	const ownTitle = typeof image?.title === 'string' ? image.title.trim() : '';
	if (ownTitle && !isChallengeMedia) return ownTitle;

	let challengeName = '';
	if (isChallengeMedia) {
		challengeName = pickChallengeTitleFromCreationMeta(image?.meta, nowMs);
		if (!challengeName && ownTitle) challengeName = ownTitle;
	} else {
		challengeName = pickChallengeTitleFromCreationMeta(image?.meta, nowMs);
	}

	if (!challengeName) {
		const byChallenge = opts?.challengeTitleById;
		if (byChallenge instanceof Map) {
			for (const challengeId of challengeIdsFromCreationMeta(image?.meta)) {
				const t = byChallenge.get(challengeId);
				if (typeof t === 'string' && t.trim()) {
					challengeName = t.trim();
					break;
				}
			}
		}
	}

	if (!challengeName) {
		const cid = Number(image?.id);
		const byCreation = opts?.titleByCreationId;
		if (byCreation instanceof Map && Number.isFinite(cid) && cid > 0) {
			const t = byCreation.get(cid);
			if (typeof t === 'string' && t.trim()) challengeName = t.trim();
		}
	}

	if (challengeName && isChallengeMedia) {
		return formatChallengeStreamTitle(challengeName, track);
	}
	if (challengeName) return challengeName;

	const cid = Number(image?.id);
	if (Number.isFinite(cid) && cid > 0) return `Creation ${cid}`;
	return 'Creation';
}

export { creationMetaIsChallengeEditorialMedia, formatChallengeStreamTitle };

/**
 * @param {{
 *   id?: unknown,
 *   published?: unknown,
 *   meta?: unknown,
 *   unavailable_at?: unknown,
 * } | null | undefined} image
 * @param {{
 *   nowMs?: number,
 *   activeEditorialPinCreationIds?: Set<number> | null,
 * }} [opts]
 * @returns {boolean}
 */
export function creationEligibleForLatestCommentsStream(image, opts = {}) {
	if (!image) return false;
	if (image.unavailable_at != null && image.unavailable_at !== '') return false;
	if (isCreationPublishedFlag(image.published)) return true;

	const nowMs = Number(opts?.nowMs) || Date.now();
	if (creationMetaHasActiveChallengeFeedPin(image.meta, nowMs)) return true;
	if (creationMetaHasChallengeResultsOrganizerRef(image.meta)) return true;

	const cid = Number(image.id);
	const pinIds = opts?.activeEditorialPinCreationIds;
	if (pinIds instanceof Set && Number.isFinite(cid) && cid > 0 && pinIds.has(cid)) {
		return true;
	}
	return false;
}
