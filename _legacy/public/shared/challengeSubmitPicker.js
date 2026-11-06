/**
 * Challenge submit target picker helpers (creation-detail confirm modal).
 * Keeps picker markup/logic out of the large creation-detail page module.
 */

/**
 * @typedef {{ challenge_id: string, title: string, details?: string, ends_at?: string }} ChallengeSubmitOption
 */

/**
 * Resolve which challenges the confirm modal should offer.
 * Prefers API `challenges[]`; falls back to single `challenge` object.
 *
 * @param {object | null | undefined} challengeSubmit — creation.challenge_submit
 * @returns {ChallengeSubmitOption[]}
 */
export function listChallengeSubmitOptions(challengeSubmit) {
	const cs = challengeSubmit && typeof challengeSubmit === 'object' ? challengeSubmit : null;
	if (!cs || cs.eligible !== true) return [];
	if (Array.isArray(cs.challenges) && cs.challenges.length) {
		return cs.challenges
			.map((ch) => {
				const id = ch?.challenge_id != null ? String(ch.challenge_id).trim() : '';
				if (!id) return null;
				const title =
					typeof ch.title === 'string' && ch.title.trim() ? ch.title.trim() : `Challenge: ${id}`;
				const details = typeof ch.details === 'string' ? ch.details.trim() : '';
				const ends_at = typeof ch.ends_at === 'string' ? ch.ends_at.trim() : '';
				return { challenge_id: id, title, details, ends_at };
			})
			.filter(Boolean);
	}
	const single = cs.challenge && typeof cs.challenge === 'object' ? cs.challenge : null;
	const id = single?.challenge_id != null ? String(single.challenge_id).trim() : '';
	if (!id) return [];
	return [
		{
			challenge_id: id,
			title:
				typeof single.title === 'string' && single.title.trim()
					? single.title.trim()
					: `Challenge: ${id}`,
			details: typeof single.details === 'string' ? single.details.trim() : '',
			ends_at: typeof single.ends_at === 'string' ? single.ends_at.trim() : ''
		}
	];
}

/**
 * Pick initial selection: stored context if still eligible, else sole option, else first.
 *
 * @param {ChallengeSubmitOption[]} options
 * @param {string | null | undefined} contextChallengeId
 * @returns {string}
 */
export function resolveChallengeSubmitSelection(options, contextChallengeId) {
	const list = Array.isArray(options) ? options : [];
	if (!list.length) return '';
	const want = contextChallengeId != null ? String(contextChallengeId).trim() : '';
	if (want && list.some((o) => o.challenge_id === want)) return want;
	return list[0].challenge_id;
}

/**
 * Escape text for HTML attribute/text content.
 * @param {unknown} s
 */
function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Render radio list HTML when multiple options; empty string for a single target.
 *
 * @param {ChallengeSubmitOption[]} options
 * @param {string} selectedId
 * @returns {string}
 */
export function renderChallengeSubmitPickerHtml(options, selectedId) {
	const list = Array.isArray(options) ? options : [];
	if (list.length <= 1) return '';
	const sel = String(selectedId || '').trim() || list[0].challenge_id;
	const radios = list
		.map((o) => {
			const id = o.challenge_id;
			const checked = id === sel ? ' checked' : '';
			const inputId = `challenge-submit-opt-${esc(id).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
			return `<label class="creation-detail-challenge-submit-picker-option" for="${inputId}">
				<input type="radio" name="challenge_submit_target" id="${inputId}" value="${esc(id)}"${checked} data-challenge-submit-picker-radio />
				<span class="creation-detail-challenge-submit-picker-label">${esc(o.title)}</span>
			</label>`;
		})
		.join('');
	return `<fieldset class="creation-detail-challenge-submit-picker" data-challenge-submit-picker>
		<legend class="creation-detail-challenge-submit-picker-legend">Choose a challenge</legend>
		${radios}
	</fieldset>`;
}

/**
 * @param {ChallengeSubmitOption[]} options
 * @param {string} selectedId
 * @returns {ChallengeSubmitOption | null}
 */
export function findChallengeSubmitOption(options, selectedId) {
	const list = Array.isArray(options) ? options : [];
	const id = String(selectedId || '').trim();
	return list.find((o) => o.challenge_id === id) || list[0] || null;
}
