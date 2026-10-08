import { esc } from '../../shared/challenges/constants.js';
import { challengesDetailsHref } from '../../shared/challenges/model/detailsRoute.js';
import { resolveChallengeAcceptedMedia } from '../../shared/challenges/model/tracks.js';
import {
	audioClipMusicIcon,
	infoIcon,
	peopleOutlined,
	pictureIcon,
	thumbsUpStrokeIcon
} from '../../icons/svg-strings.js';

function boardStatIcon(key, track) {
	const cls = 'challenge-board-stat-svg';
	if (key === 'creators') return peopleOutlined(cls);
	if (key === 'votes') return thumbsUpStrokeIcon(cls);
	if ((key === 'entries' || key === 'tracks') && track === 'suno') return audioClipMusicIcon(cls);
	return pictureIcon(cls);
}

function challengeMediaIsAudio(cfg, track) {
	if (track === 'suno') return true;
	const media = resolveChallengeAcceptedMedia(cfg, { track });
	return media.length > 0 && media.every((kind) => kind === 'audio');
}

/**
 * Creator, entry, and vote counts, plus info. Shared by the card footer and the entries bar.
 * @param {{
 *   challengeId: string,
 *   cfg: object,
 *   track: string,
 *   stats: { key?: string, label: string, value: string }[],
 *   showInfo?: boolean,
 *   linkToDetail?: boolean,
 * }} vm
 */
export function renderChallengeBoardMeta(vm) {
	const challengeId = String(vm.challengeId || '').trim();
	const href = challengeId && vm.linkToDetail !== false ? challengesDetailsHref(challengeId) : '';
	const audio = challengeMediaIsAudio(vm.cfg, vm.track);
	const byKey = new Map((Array.isArray(vm.stats) ? vm.stats : []).map((row) => [row.key, row]));
	const stats = ['creators', 'entries', 'votes']
		.map((key) => {
			const row = byKey.get(key);
			if (!row) return '';
			const iconTrack = key === 'entries' && audio ? 'suno' : vm.track;
			const body = `${boardStatIcon(key, iconTrack)}<span class="challenge-pane-hero-stat-value">${esc(row.value ?? '0')}</span>`;
			if (!href) return `<span class="challenge-board-stat" aria-label="${esc(row.label)}">${body}</span>`;
			return `<a class="challenge-board-stat challenge-board-link" href="${esc(href)}" data-spa-link aria-label="${esc(row.label)}">${body}</a>`;
		})
		.join('');
	const info = challengeId && vm.showInfo !== false
		? `<button type="button" class="challenge-board-info" data-challenge-about-open data-challenge-id="${esc(challengeId)}">${infoIcon('challenge-board-stat-svg')}<span class="challenge-pane-hero-stat-value">info</span></button>`
		: '';
	return `${stats}${info}`;
}

/**
 * Shared challenge card: title, image, time left, compact counts, then Vote.
 * @param {{
 *   challengeId: string,
 *   title: string,
 *   cfg: object,
 *   track: string,
 *   imageHtml: string,
 *   countdownHtml: string,
 *   stats: { key?: string, label: string, value: string }[],
 *   voteHtml: string,
 *   showInfo?: boolean,
 *   omitTitle?: boolean,
 *   omitImage?: boolean,
 *   omitMeta?: boolean,
 *   linkToDetail?: boolean,
 * }} vm
 */
export function renderChallengeCard(vm) {
	const challengeId = String(vm.challengeId || '').trim();
	const href = challengeId && vm.linkToDetail !== false ? challengesDetailsHref(challengeId) : '';
	const linked = (className, inner) => {
		if (!href || !inner) return inner || '';
		return `<a class="challenge-board-link ${className}" href="${esc(href)}" data-spa-link>${inner}</a>`;
	};
	const meta = vm.omitMeta ? '' : `<div class="challenge-board-meta">${renderChallengeBoardMeta(vm)}</div>`;
	const time = typeof vm.countdownHtml === 'string' ? vm.countdownHtml : '';
	const title = vm.omitTitle
		? ''
		: `<header class="challenge-board-head"><h2 class="challenge-pane-title">${esc(vm.title)}</h2></header>`;
	const image = vm.omitImage ? '' : linked('challenge-board-hero-link', vm.imageHtml || '');
	return `<article class="challenge-board challenge-pane-active-card" data-challenge-id="${esc(challengeId)}">
		${title}
		${image}
		<footer class="challenge-board-foot">
			<div class="challenge-board-time">${linked('challenge-board-time-link', time)}</div>
			${meta}
		</footer>
		${vm.voteHtml || ''}
	</article>`;
}
