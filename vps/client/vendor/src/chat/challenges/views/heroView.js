import { challengePhaseDisplayLabel } from '../model/phases.js';
import { esc } from '../constants.js';
import {
	audioClipMusicIcon,
	peopleOutlined,
	pictureIcon,
	thumbsUpStrokeIcon
} from '/icons/svg-strings.js';

/**
 * @param {{
 *   title: string,
 *   phase: string,
 *   countdownHtml?: string,
 *   omitTitle?: boolean
 * }} vm
 */
export function renderHeroSection(vm) {
	const phaseLabel = esc(challengePhaseDisplayLabel(vm.phase));
	const countdown =
		typeof vm.countdownHtml === 'string' && vm.countdownHtml.trim()
			? vm.countdownHtml
			: '';
	const titleHtml = vm.omitTitle
		? ''
		: `<h2 class="challenge-pane-title">${esc(vm.title)}</h2>`;
	const heroCls = vm.omitTitle
		? 'challenge-pane-hero challenge-pane-hero--no-title'
		: 'challenge-pane-hero';
	return `<section class="${heroCls}">
		${titleHtml}
		<div class="challenge-pane-hero-meta">
			<p class="challenge-pane-phase challenge-pane-phase--${esc(vm.phase)}"><span class="challenge-pane-phase-label">${phaseLabel}</span></p>
			${countdown}
		</div>
	</section>`;
}

/**
 * Entries / creators / votes callouts — sit under the hero image, above Vote.
 * @param {{ key?: string, label: string, value: string }[] | undefined} stats
 * @param {string} [track]
 */
export function renderHeroStats(stats, track) {
	const statsList = Array.isArray(stats) ? stats : [];
	if (!statsList.length) return '';
	const t = typeof track === 'string' ? track : '';
	return `<div class="challenge-pane-hero-stats" aria-label="Challenge stats">${statsList
		.map((row) => `<div class="challenge-pane-hero-stat">${heroStatIconSvg(row?.key, t)}<span class="challenge-pane-hero-stat-copy"><span class="challenge-pane-hero-stat-value">${esc(row?.value ?? '—')}</span><span class="challenge-pane-hero-stat-label">${esc(row?.label ?? '')}</span></span></div>`)
		.join('')}</div>`;
}

const HERO_STAT_ICON_CLASS = 'challenge-pane-hero-stat-svg';

/**
 * @param {string | undefined} key
 * @param {string} [track]
 */
function heroStatIconSvg(key, track) {
	const wrap = (inner) => `<span class="challenge-pane-hero-stat-icon" aria-hidden="true">${inner}</span>`;
	if (key === 'creators') {
		return wrap(peopleOutlined(HERO_STAT_ICON_CLASS));
	}
	if (key === 'votes') {
		return wrap(thumbsUpStrokeIcon(HERO_STAT_ICON_CLASS));
	}
	if ((key === 'entries' || key === 'tracks') && track === 'suno') {
		return wrap(audioClipMusicIcon(HERO_STAT_ICON_CLASS));
	}
	return wrap(pictureIcon(HERO_STAT_ICON_CLASS));
}
