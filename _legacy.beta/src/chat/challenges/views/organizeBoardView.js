import { esc } from '../constants.js';
import { deriveChallengePhase } from '../model/phases.js';
import {
	addDaysYmd,
	compareYmd,
	dateToLocalYmd,
	daysInclusive,
	formatYmd,
	parseYmd
} from '../model/dayBounds.js';
import {
	CHALLENGE_TRACK_LABELS,
	CHALLENGE_TRACK_TEMPLATES,
	challengeConfigDayRange,
	getChallengeTrackTemplate,
	normalizeChallengeTrack,
	occupiedRangesForTrack,
	pickChallengeTrack,
	snapRangeAwayFromOccupied
} from '../model/tracks.js';
import {
	CHALLENGE_OPEN_PIN_DAYS,
	CHALLENGE_WINNERS_PIN_DAYS,
	pinWindowsFromChallengeConfig
} from '../model/pinSlots.js';
import {
	mergeFullChallengeConfigForChallenge,
	pickChallengeHeroImageUrl,
	isChallengeListedForUpcoming
} from '../challengeAdmin.js';
import { audioClipMusicIcon, clock3Icon } from '/icons/svg-strings.js';

export {
	CHALLENGE_OPEN_PIN_DAYS,
	CHALLENGE_WINNERS_PIN_DAYS,
	pinWindowsFromChallengeConfig
};

/** @param {string} phase @param {boolean} [listed] */
function organizePhaseLabel(phase, listed = true) {
	if (phase === 'pre_submit') return listed ? 'Upcoming' : 'Draft';
	if (phase === 'submitting') return 'Submissions';
	if (phase === 'submit_and_vote') return 'Live';
	if (phase === 'voting') return 'Voting';
	if (phase === 'between') return 'Between rounds';
	if (phase === 'finalizing') return 'Pending';
	if (phase === 'results') return 'Complete';
	if (phase === 'empty') return 'Draft';
	if (phase === 'deleted') return 'Deleted';
	return '—';
}

/**
 * Which card chrome belongs on this phase.
 * @param {string} phase
 * @param {{ isOceanman?: boolean, listed?: boolean }} [opts]
 */
function organizeActionsForPhase(phase, opts = {}) {
	if (phase === 'deleted') {
		return {
			showStats: false,
			showEdit: false,
			showView: false,
			showRestore: Boolean(opts.isOceanman),
			showPurge: Boolean(opts.isOceanman)
		};
	}
	return {
		showStats: phase !== 'empty',
		showEdit: phase !== 'empty' && phase !== 'results',
		showView: phase === 'results',
		showRestore: false,
		showPurge: false
	};
}

/**
 * Month/day label with year in a span so small screens can hide it.
 * @param {Date} date
 * @param {boolean} includeYear
 */
function formatOrganizeDateLabel(date, includeYear) {
	const md = esc(
		date.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		})
	);
	if (!includeYear) return md;
	return `${md}<span class="challenges-organize-card-meta-year">, ${date.getFullYear()}</span>`;
}

/**
 * @param {string} startYmd
 * @param {string} endYmd
 */
function formatOrganizeDateRange(startYmd, endYmd) {
	const a = parseYmd(startYmd);
	const b = parseYmd(endYmd);
	if (!a || !b) return 'No dates set';
	const startDate = new Date(a.y, a.m - 1, a.d);
	const endDate = new Date(b.y, b.m - 1, b.d);
	const sameYear = a.y === b.y;
	const startLabel = formatOrganizeDateLabel(startDate, !sameYear);
	const endLabel = formatOrganizeDateLabel(endDate, true);
	const n = daysInclusive(startYmd, endYmd);
	const daysBlurb = `<span class="challenges-organize-card-meta-days"> · ${n} day${n === 1 ? '' : 's'}</span>`;
	return `${startLabel} – ${endLabel}${daysBlurb}`;
}

/** Monthly calendar glyph (no shared calendar icon in svg-strings). */
function monthlyCalendarIconSvg() {
	return `<svg class="challenges-organize-track-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<rect x="3" y="5" width="18" height="16" rx="2"></rect>
		<path d="M3 10h18"></path>
		<path d="M8 3v4"></path>
		<path d="M16 3v4"></path>
	</svg>`;
}

/**
 * @param {string} track
 */
function organizeTrackMetaHtml(track) {
	const t = normalizeChallengeTrack(track);
	const label = CHALLENGE_TRACK_LABELS[t] || t;
	let svg = monthlyCalendarIconSvg();
	if (t === 'weekly') svg = clock3Icon('challenges-organize-track-svg');
	else if (t === 'suno') svg = audioClipMusicIcon('challenges-organize-track-svg');
	return `<span class="challenges-organize-track-meta challenges-organize-track-meta--${esc(t)}">
		${svg}
		<span class="challenges-organize-track-meta-label">${esc(label)}</span>
	</span>`;
}

/**
 * Pending thumb wrap — hydrated like Challenges pane history cards
 * (`hydrateChallengeHistoryThumbnails`).
 * @param {object | null | undefined} merged
 * @param {string} challengeId
 * @param {string} [_track]
 */
function organizeHeroThumbHtml(merged, challengeId, _track) {
	const ref = pickChallengeHeroImageUrl(merged);
	const title =
		merged && typeof merged.title === 'string' && merged.title.trim()
			? merged.title.trim()
			: '';
	const letter = (title || challengeId || '?').slice(0, 1).toUpperCase();
	const cid = String(challengeId || '').trim();
	const challengeIdAttr = cid ? ` data-challenge-id="${esc(cid)}"` : '';
	return `<div class="challenges-organize-card-media">
		<div class="challenge-pane-history-card-thumb-wrap challenges-organize-card-thumb-wrap" data-challenge-history-thumb-pending data-challenge-history-thumb-ref="${esc(ref)}"${challengeIdAttr}>
			<img class="challenge-pane-history-card-thumb challenges-organize-card-thumb" alt="" loading="lazy" decoding="async" hidden data-challenge-history-thumb-img />
			<div class="challenge-pane-history-card-thumb-fallback challenges-organize-card-media--placeholder" aria-hidden="true" data-challenge-history-thumb-fallback>
				<span class="challenges-organize-card-letter">${esc(letter)}</span>
			</div>
		</div>
	</div>`;
}

/**
 * @param {number} year
 * @param {number} monthIndex 0-11
 * @returns {{ ymd: string, inMonth: boolean }[]}
 */
function monthMatrix(year, monthIndex) {
	const first = new Date(year, monthIndex, 1);
	const startPad = first.getDay(); // 0 Sun
	const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
	/** @type {{ ymd: string, inMonth: boolean }[]} */
	const cells = [];
	for (let i = 0; i < startPad; i += 1) {
		const date = new Date(year, monthIndex, 1 - (startPad - i));
		cells.push({
			ymd: formatYmd(date.getFullYear(), date.getMonth() + 1, date.getDate()),
			inMonth: false
		});
	}
	for (let d = 1; d <= daysInMonth; d += 1) {
		cells.push({ ymd: formatYmd(year, monthIndex + 1, d), inMonth: true });
	}
	let next = 1;
	while (cells.length % 7 !== 0) {
		const date = new Date(year, monthIndex + 1, next);
		cells.push({
			ymd: formatYmd(date.getFullYear(), date.getMonth() + 1, date.getDate()),
			inMonth: false
		});
		next += 1;
	}
	return cells;
}

/**
 * @param {{ start: string, end: string }[]} occupied
 * @param {string} ymd
 */
function dayIsOccupied(occupied, ymd) {
	for (const row of occupied || []) {
		if (compareYmd(ymd, row.start) >= 0 && compareYmd(ymd, row.end) <= 0) return row;
	}
	return null;
}

/**
 * Month calendar for placing a challenge block (same-track occupied days disabled).
 * @param {{
 *   track: string,
 *   monthYmd?: string,
 *   startYmd?: string,
 *   endYmd?: string,
 *   occupied: { challenge_id: string, title: string, start: string, end: string }[],
 *   readOnly?: boolean,
 *   pinWindows?: { kind: 'open' | 'winners' | 'topic_vote', start: string, end: string }[],
 * }} opts
 */
export function renderOrganizeCalendarHtml(opts) {
	const track = normalizeChallengeTrack(opts.track);
	const readOnly = Boolean(opts.readOnly);
	const anchor = parseYmd(opts.monthYmd || dateToLocalYmd()) || parseYmd(dateToLocalYmd());
	const year = anchor.y;
	const monthIndex = anchor.m - 1;
	const monthLabel = new Date(year, monthIndex, 1).toLocaleString(undefined, {
		month: 'long',
		year: 'numeric'
	});
	const prevMonth = addDaysYmd(formatYmd(year, monthIndex + 1, 1), -1);
	const nextMonth = addDaysYmd(formatYmd(year, monthIndex + 1, 28), 5);
	const nextMonthStart = (() => {
		const p = parseYmd(nextMonth);
		return p ? formatYmd(p.y, p.m, 1) : nextMonth;
	})();
	const prevMonthStart = (() => {
		const p = parseYmd(prevMonth);
		return p ? formatYmd(p.y, p.m, 1) : prevMonth;
	})();

	const startYmd = opts.startYmd || '';
	const endYmd = opts.endYmd || '';
	const occupied = opts.occupied || [];
	const pinWindows = Array.isArray(opts.pinWindows) ? opts.pinWindows : [];
	/** @param {string} kind */
	const pinKindLabel = (kind) => {
		if (kind === 'winners') return 'winners';
		if (kind === 'topic_vote') return 'theme vote';
		return 'open';
	};
	const pinKindsForDay = (ymd) => {
		const kinds = [];
		for (const w of pinWindows) {
			if (
				w?.start &&
				w?.end &&
				compareYmd(ymd, w.start) >= 0 &&
				compareYmd(ymd, w.end) <= 0 &&
				!kinds.includes(w.kind)
			) {
				kinds.push(w.kind);
			}
		}
		return kinds;
	};
	const cells = monthMatrix(year, monthIndex);
	const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

	const head = weekdays
		.map((d) => `<span class="challenges-organize-cal-dow">${esc(d)}</span>`)
		.join('');

	const body = cells
		.map((cell) => {
			const dayNum = Number(cell.ymd.slice(-2));
			const pinKinds = pinKindsForDay(cell.ymd);
			const pinDots = pinKinds
				.map(
					(k) =>
						`<span class="challenges-organize-cal-pin-dot challenges-organize-cal-pin-dot--${esc(k)}" aria-hidden="true"></span>`
				)
				.join('');
			const pinDotsHtml = pinDots
				? `<span class="challenges-organize-cal-pin-dots">${pinDots}</span>`
				: '';
			if (!cell.inMonth) {
				const outsideSelected =
					Boolean(startYmd) &&
					Boolean(endYmd) &&
					compareYmd(cell.ymd, startYmd) >= 0 &&
					compareYmd(cell.ymd, endYmd) <= 0;
				const outsideClasses = [
					'challenges-organize-cal-day',
					'is-outside',
					outsideSelected ? 'is-selected' : '',
					pinKinds.length ? 'has-feed-pin' : ''
				]
					.filter(Boolean)
					.join(' ');
				return `<span class="${outsideClasses}" aria-hidden="true"><span class="challenges-organize-cal-day-num">${dayNum}</span>${pinDotsHtml}</span>`;
			}
			const block = dayIsOccupied(occupied, cell.ymd);
			const selected =
				startYmd &&
				endYmd &&
				compareYmd(cell.ymd, startYmd) >= 0 &&
				compareYmd(cell.ymd, endYmd) <= 0;
			const isStart = startYmd && cell.ymd === startYmd;
			const isEnd = endYmd && cell.ymd === endYmd;
			const classes = [
				'challenges-organize-cal-day',
				block ? 'is-occupied' : '',
				selected ? 'is-selected' : '',
				isStart ? 'is-range-start' : '',
				isEnd ? 'is-range-end' : '',
				pinKinds.length ? 'has-feed-pin' : '',
				readOnly ? 'is-readonly' : ''
			]
				.filter(Boolean)
				.join(' ');
			const pinLabel = pinKinds.length
				? ` · Feed pin: ${pinKinds.map((k) => pinKindLabel(k)).join(' + ')}`
				: '';
			const title =
				(readOnly
					? selected
						? `Scheduled ${cell.ymd}`
						: block
							? `Taken by ${block.title}`
							: cell.ymd
					: block
						? `Taken by ${block.title}`
						: `Select ${cell.ymd}`) + pinLabel;
			const disabled = readOnly || block ? ' disabled' : '';
			return `<button type="button" class="${classes}" data-organize-cal-day="${esc(cell.ymd)}" title="${esc(title)}"${disabled}>${dayNum}${pinDotsHtml}</button>`;
		})
		.join('');

	const hint = readOnly
		? `Scheduled range for this ${esc(CHALLENGE_TRACK_LABELS[track] || track)} challenge.`
		: `Click a start day, then an end day. Occupied ${esc(CHALLENGE_TRACK_LABELS[track] || track)} days are blocked.`;
	const hasOpenPin = pinWindows.some((w) => w?.kind === 'open');
	const hasTopicVotePin = pinWindows.some((w) => w?.kind === 'topic_vote');
	const hasWinnersPin = pinWindows.some((w) => w?.kind === 'winners');
	const pinLegendParts = [];
	if (hasOpenPin) {
		pinLegendParts.push(
			`<span class="challenges-organize-cal-pin-dot challenges-organize-cal-pin-dot--open" aria-hidden="true"></span> open (${CHALLENGE_OPEN_PIN_DAYS}d)`
		);
	}
	if (hasTopicVotePin) {
		pinLegendParts.push(
			`<span class="challenges-organize-cal-pin-dot challenges-organize-cal-pin-dot--topic_vote" aria-hidden="true"></span> theme vote (${CHALLENGE_OPEN_PIN_DAYS}d)`
		);
	}
	if (hasWinnersPin) {
		pinLegendParts.push(
			`<span class="challenges-organize-cal-pin-dot challenges-organize-cal-pin-dot--winners" aria-hidden="true"></span> winners (${CHALLENGE_WINNERS_PIN_DAYS}d)`
		);
	}
	const pinLegend = pinLegendParts.length
		? `<p class="challenge-pane-muted challenges-organize-cal-hint challenges-organize-cal-pin-legend">Feed pin: ${pinLegendParts.join(' · ')}</p>`
		: '';

	return `<div class="challenges-organize-cal${readOnly ? ' is-readonly' : ''}" data-organize-calendar data-organize-cal-track="${esc(track)}"${readOnly ? ' data-organize-calendar-readonly' : ''}>
		<div class="challenges-organize-cal-nav">
			<button type="button" class="challenges-organize-cal-nav-btn" data-organize-cal-month="${esc(prevMonthStart)}" aria-label="Previous month">‹</button>
			<span class="challenges-organize-cal-month-label">${esc(monthLabel)}</span>
			<button type="button" class="challenges-organize-cal-nav-btn" data-organize-cal-month="${esc(nextMonthStart)}" aria-label="Next month">›</button>
		</div>
		<div class="challenges-organize-cal-grid" role="grid" aria-label="${readOnly ? 'Challenge schedule (read-only)' : 'Challenge calendar'}">
			${head}
			${body}
		</div>
		<p class="challenge-pane-muted challenges-organize-cal-hint">${hint}</p>
		${pinLegend}
	</div>`;
}

/**
 * Card list: active (incl. results-pending), then upcoming, deleted, past (complete only).
 * @param {{
 *   rows: { challenge_id: string, title: string, configMessageId?: number, latest?: object }[],
 *   configEntries: { msg: object, payload: object }[],
 *   statsIconSvg?: string,
 *   contentIconSvg?: string,
 *   viewIconSvg?: string,
 *   scheduleIconSvg?: string,
 *   prizesIconSvg?: string,
 *   settingsIconSvg?: string,
 *   nowMs?: number,
 *   isOceanman?: boolean,
 * }} vm
 */
export function renderOrganizeBoardHtml(vm) {
	const nowMs = typeof vm.nowMs === 'number' ? vm.nowMs : Date.now();
	const isOceanman = Boolean(vm.isOceanman);
	/** @type {{ challenge_id: string, title?: string, merged: object | null, phase: string, range: { start: string, end: string } | null, track: string }[]} */
	const cards = [];
	for (const row of vm.rows || []) {
		const merged = mergeFullChallengeConfigForChallenge(vm.configEntries, row.challenge_id);
		const phase = deriveChallengePhase(merged, nowMs);
		if (phase === 'purged') continue;
		const track = pickChallengeTrack(merged);
		const range = challengeConfigDayRange(merged);
		cards.push({
			...row,
			merged,
			phase,
			range,
			track
		});
	}

	/** @param {typeof cards} list @param {'desc' | 'asc'} startOrder */
	const sortByStart = (list, startOrder) => {
		list.sort((a, b) => {
			const aStart = a.range?.start || '';
			const bStart = b.range?.start || '';
			if (!aStart && !bStart) {
				return String(b.challenge_id).localeCompare(String(a.challenge_id));
			}
			if (!aStart) return 1;
			if (!bStart) return -1;
			const byStart =
				startOrder === 'asc' ? compareYmd(aStart, bStart) : compareYmd(bStart, aStart);
			if (byStart !== 0) return byStart;
			const byEnd =
				startOrder === 'asc'
					? compareYmd(a.range?.end || '', b.range?.end || '')
					: compareYmd(b.range?.end || '', a.range?.end || '');
			if (byEnd !== 0) return byEnd;
			return String(b.challenge_id).localeCompare(String(a.challenge_id));
		});
	};

	const deletedCards = cards.filter((c) => c.phase === 'deleted');
	const liveCards = cards.filter((c) => c.phase !== 'deleted');
	const pastCards = liveCards.filter((c) => c.phase === 'results');
	const preSubmitCards = liveCards.filter((c) => c.phase === 'pre_submit');
	const draftCards = preSubmitCards.filter((c) => !isChallengeListedForUpcoming(c.merged));
	const upcomingCards = preSubmitCards.filter((c) => isChallengeListedForUpcoming(c.merged));
	const currentCards = liveCards.filter(
		(c) => c.phase !== 'pre_submit' && c.phase !== 'results'
	);
	sortByStart(currentCards, 'desc');
	sortByStart(draftCards, 'asc');
	sortByStart(upcomingCards, 'asc');
	sortByStart(deletedCards, 'desc');
	sortByStart(pastCards, 'desc');

	const ghostAddRow = `<button type="button" class="challenges-organize-card challenges-organize-card--ghost-add" data-organize-new-track="monthly" aria-label="Add a challenge">
		<span class="challenges-organize-ghost-add-label">Add a challenge</span>
	</button>`;

	const renderList = (list) =>
		`<div class="challenges-organize-card-list">${list.map((c) => renderOrganizeCardHtml(c, vm)).join('')}</div>`;

	const mainListHtml = `<section class="challenges-organize-current" aria-labelledby="challenges-organize-current-title">
		<h3 id="challenges-organize-current-title" class="challenges-organize-section-title">Current</h3>
		<div class="challenges-organize-card-list challenges-organize-card-list--main">
			${currentCards.map((c) => renderOrganizeCardHtml(c, vm)).join('')}
			${ghostAddRow}
		</div>
	</section>`;

	let listsHtml = mainListHtml;
	if (draftCards.length > 0) {
		listsHtml += `<section class="challenges-organize-draft" aria-labelledby="challenges-organize-draft-title">
			<h3 id="challenges-organize-draft-title" class="challenges-organize-section-title">Draft</h3>
			${renderList(draftCards)}
		</section>`;
	}
	if (upcomingCards.length > 0) {
		listsHtml += `<section class="challenges-organize-upcoming" aria-labelledby="challenges-organize-upcoming-title">
			<h3 id="challenges-organize-upcoming-title" class="challenges-organize-section-title">Upcoming</h3>
			${renderList(upcomingCards)}
		</section>`;
	}
	if (deletedCards.length > 0) {
		listsHtml += `<section class="challenges-organize-deleted" aria-labelledby="challenges-organize-deleted-title">
			<h3 id="challenges-organize-deleted-title" class="challenges-organize-section-title">Deleted</h3>
			${renderList(deletedCards)}
		</section>`;
	}
	if (pastCards.length > 0) {
		listsHtml += `<section class="challenges-organize-past" aria-labelledby="challenges-organize-past-title">
			<h3 id="challenges-organize-past-title" class="challenges-organize-section-title">Past</h3>
			${renderList(pastCards)}
		</section>`;
	}

	return `<div class="challenges-organize-board" data-organize-board data-organize-oceanman="${isOceanman ? '1' : '0'}">
		${listsHtml}
	</div>`;
}

/**
 * @param {{
 *   challenge_id: string,
 *   title?: string,
 *   phase: string,
 *   range: { start: string, end: string } | null,
 *   track: string,
 *   merged: object | null,
 * }} c
 * @param {{
 *   statsIconSvg?: string,
 *   contentIconSvg?: string,
 *   viewIconSvg?: string,
 *   scheduleIconSvg?: string,
 *   prizesIconSvg?: string,
 *   isOceanman?: boolean,
 * }} vm
 */
function renderOrganizeCardHtml(c, vm) {
	const cid = String(c.challenge_id || '').trim();
	const mergedTitle =
		c.merged && typeof c.merged.title === 'string' ? c.merged.title.trim() : '';
	const rowTitle = c.title && String(c.title).trim() ? String(c.title).trim() : '';
	const titleRaw = mergedTitle || rowTitle || cid;
	const title = esc(titleRaw);
	const phase = c.phase || 'unknown';
	const listed = phase === 'pre_submit' ? isChallengeListedForUpcoming(c.merged) : true;
	const actions = organizeActionsForPhase(phase, {
		isOceanman: Boolean(vm.isOceanman)
	});
	const track = normalizeChallengeTrack(c.track || pickChallengeTrack(c.merged));
	const meta = c.range
		? formatOrganizeDateRange(c.range.start, c.range.end)
		: 'No dates set';
	/* Icon+type first on the date line (mobile hides year + day count). */
	const metaLead = `<span class="challenges-organize-card-meta-lead">${organizeTrackMetaHtml(track)}<span class="challenges-organize-card-meta-sep" aria-hidden="true"> · </span></span>`;
	const isComplete = phase === 'results';
	const needsAction = phase === 'finalizing';
	const isLive =
		phase === 'submitting' ||
		phase === 'voting' ||
		phase === 'submit_and_vote' ||
		phase === 'between';
	const isDeleted = phase === 'deleted';
	const isDraft = phase === 'pre_submit' && !listed;

	const statsBtn = actions.showStats
		? `<button type="button" class="challenges-organize-card-action challenges-organize-card-action--ghost" data-challenges-organizer-stats="${esc(cid)}" aria-label="View results for ${title}">
			${vm.statsIconSvg || ''}
			<span>Results</span>
		</button>`
		: '';

	const primaryActionBtn = actions.showView
		? `<button type="button" class="challenges-organize-card-action challenges-organize-card-action--ghost" data-challenges-organizer-view="${esc(cid)}" aria-label="View ${title}">
			${vm.viewIconSvg || vm.contentIconSvg || ''}
			<span>View</span>
		</button>`
		: actions.showEdit
			? `<button type="button" class="challenges-organize-card-action challenges-organize-card-action--ghost" data-challenges-organizer-edit="${esc(cid)}" aria-label="Manage ${title}">
			${vm.contentIconSvg || ''}
			<span>Manage</span>
		</button>`
			: '';

	const restoreBtn = actions.showRestore
		? `<button type="button" class="challenges-organize-card-action challenges-organize-card-action--ghost" data-organize-restore="${esc(cid)}">Restore</button>`
		: '';
	const purgeBtn = actions.showPurge
		? `<button type="button" class="challenges-organize-card-action challenges-organize-card-action--danger-ghost" data-organize-purge="${esc(cid)}">Delete forever</button>`
		: '';

	const footer = `<div class="challenges-organize-card-footer">
		<div class="challenges-organize-card-footer-actions">
			${primaryActionBtn}
			${statsBtn}
			${restoreBtn}
			${purgeBtn}
		</div>
	</div>`;

	const chipPhase = isDraft ? 'empty' : phase;
	const cardMods = [
		isComplete ? 'is-complete' : '',
		needsAction ? 'is-needs-action' : '',
		isLive ? 'is-live' : '',
		phase === 'pre_submit' && listed ? 'is-upcoming' : '',
		isDraft ? 'is-draft' : '',
		isDeleted ? 'is-deleted' : ''
	]
		.filter(Boolean)
		.join(' ');

	return `<article class="challenges-organize-card ${cardMods}" data-organize-card="${esc(cid)}" data-organize-track="${esc(track)}" data-organize-phase="${esc(phase)}" data-organize-listed="${listed ? '1' : '0'}">
		${organizeHeroThumbHtml(c.merged, cid, track)}
		<div class="challenges-organize-card-main">
			<div class="challenges-organize-card-header">
				<h4 class="challenges-organize-card-title">${title}</h4>
				<span class="challenges-organize-phase-chip challenges-organize-phase-chip--${esc(chipPhase)}">${esc(organizePhaseLabel(phase, listed))}</span>
				<p class="challenges-organize-card-meta">${metaLead}${meta}</p>
			</div>
			${footer}
		</div>
	</article>`;
}

/**
 * Template picker chips for create modal (or locked display on edit).
 * @param {string} [activeTrack]
 * @param {{ locked?: boolean, allowedTracks?: string[] | null, coerceActive?: boolean }} [opts]
 */
export function renderOrganizeTemplatePickerHtml(activeTrack = 'monthly', opts = {}) {
	const locked = Boolean(opts?.locked);
	const allowedRaw = opts?.allowedTracks;
	const allowedSet = Array.isArray(allowedRaw)
		? new Set(allowedRaw.map((t) => normalizeChallengeTrack(t)))
		: null;
	let active = normalizeChallengeTrack(activeTrack);
	if (
		!locked &&
		allowedSet &&
		allowedSet.size > 0 &&
		!allowedSet.has(active) &&
		opts?.coerceActive !== false
	) {
		active = normalizeChallengeTrack([...allowedSet][0]);
	}
	return `<div class="challenges-organize-templates${locked ? ' is-locked' : ''}" role="group" aria-label="${locked ? 'Challenge type (locked)' : 'Challenge template'}"${locked ? ' aria-disabled="true"' : ''}>
		${CHALLENGE_TRACK_TEMPLATES.map((t) => {
			const on = t.track === active ? ' is-active' : '';
			const allowed = !allowedSet || allowedSet.has(t.track);
			if (locked || !allowed) {
				const title =
					!locked && !allowed ? 'You are not an organizer for this type' : '';
				return `<button type="button" class="challenges-organize-template-btn${on}" disabled aria-disabled="true"${title ? ` title="${esc(title)}"` : ''}>${esc(t.label)}</button>`;
			}
			return `<button type="button" class="challenges-organize-template-btn${on}" data-organize-template="${esc(t.track)}">${esc(t.label)}</button>`;
		}).join('')}
	</div>`;
}

/**
 * Resolve a display range after click, enforcing non-overlap.
 * @param {string | null} pendingStart
 * @param {string} clickedYmd
 * @param {{ start: string, end: string }[]} occupied
 * @param {number} defaultLengthDays
 */
export function resolveCalendarClick(pendingStart, clickedYmd, occupied, defaultLengthDays) {
	const ymd = String(clickedYmd || '').trim();
	if (!ymd) return { startYmd: '', endYmd: '', pendingStart: null };

	if (dayIsOccupied(occupied, ymd)) {
		return {
			startYmd: pendingStart || '',
			endYmd: pendingStart ? addDaysYmd(pendingStart, Math.max(0, defaultLengthDays - 1)) : '',
			pendingStart,
			blocked: true
		};
	}

	if (!pendingStart) {
		const end = addDaysYmd(ymd, Math.max(0, (defaultLengthDays || 1) - 1));
		const snapped = snapRangeAwayFromOccupied(ymd, end, occupied);
		return {
			startYmd: snapped?.start || ymd,
			endYmd: snapped?.end || end,
			pendingStart: snapped?.start || ymd,
			selectingEnd: true
		};
	}

	let start = pendingStart;
	let end = ymd;
	if (compareYmd(end, start) < 0) {
		start = ymd;
		end = pendingStart;
	}
	const snapped = snapRangeAwayFromOccupied(start, end, occupied);
	return {
		startYmd: snapped?.start || start,
		endYmd: snapped?.end || end,
		pendingStart: null,
		selectingEnd: false
	};
}

export { occupiedRangesForTrack, getChallengeTrackTemplate, dayIsOccupied };
