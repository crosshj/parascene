/**
 * Display helpers for challenge editorial media in public streams (#comments).
 */

import { CHALLENGE_TRACK_LABELS, normalizeChallengeTrack } from '../../src/chat/challenges/model/tracks.js';
import { creationMetaHasChallengeOrganizerRef } from '../../src/shared/challengeOrganizerRefMeta.js';
import { creationMetaHasActiveChallengeFeedPin } from '../../src/shared/challengeSubmitMeta.js';

/**
 * True when this creation is challenge promo/results/theme media (not a normal published post).
 * @param {unknown} meta
 * @param {number} [nowMs]
 */
export function creationMetaIsChallengeEditorialMedia(meta, nowMs = Date.now()) {
	if (creationMetaHasChallengeOrganizerRef(meta)) return true;
	if (creationMetaHasActiveChallengeFeedPin(meta, nowMs)) return true;
	// Expired pin stamps still mark challenge media for comments history.
	if (Array.isArray(meta?.challenge_feed_pins) && meta.challenge_feed_pins.length > 0) return true;
	return false;
}

/**
 * Track stamped on feed pins / organizer refs, else inferred from challenge_id prefix patterns.
 * @param {unknown} meta
 * @returns {'monthly'|'weekly'|'suno'}
 */
export function pickChallengeTrackFromCreationMeta(meta) {
	const pins = Array.isArray(meta?.challenge_feed_pins) ? meta.challenge_feed_pins : [];
	for (const raw of pins) {
		if (!raw || typeof raw !== 'object') continue;
		if (raw.track != null) return normalizeChallengeTrack(raw.track);
	}
	const refs = Array.isArray(meta?.challenge_organizer_refs) ? meta.challenge_organizer_refs : [];
	for (const raw of refs) {
		if (!raw || typeof raw !== 'object') continue;
		if (raw.track != null) return normalizeChallengeTrack(raw.track);
	}
	return 'monthly';
}

/**
 * "Monthly Challenge: Summer" — avoids double-prefixing if already formatted.
 * @param {string} title
 * @param {unknown} [track]
 * @returns {string}
 */
export function formatChallengeStreamTitle(title, track) {
	const name = typeof title === 'string' ? title.trim() : '';
	if (!name) return '';
	if (/^(monthly|weekly|music)\s+challenge\s*:/i.test(name)) return name;
	const key = normalizeChallengeTrack(track);
	const label = CHALLENGE_TRACK_LABELS[key] || 'Monthly';
	return `${label} Challenge: ${name}`;
}
