import { challengePhaseDisplayLabel } from '../model/phases.js';
import { esc } from '../constants.js';
import { peopleOutlined, pictureIcon, thumbsUpStrokeIcon } from '/icons/svg-strings.js';

/**
 * @param {{ title: string, phase: string, countdownHtml?: string, stats?: { key?: string, label: string, value: string }[] }} vm
 */
export function renderHeroSection(vm) {
	const phaseLabel = esc(challengePhaseDisplayLabel(vm.phase));
	const countdown =
		typeof vm.countdownHtml === 'string' && vm.countdownHtml.trim()
			? vm.countdownHtml
			: '';
	const statsList = Array.isArray(vm.stats) ? vm.stats : [];
	const statsHtml = statsList.length
		? `<div class="challenge-pane-hero-stats" aria-label="Challenge stats">${statsList
			.map((row) => `<div class="challenge-pane-hero-stat">${heroStatIconSvg(row?.key)}<span class="challenge-pane-hero-stat-copy"><span class="challenge-pane-hero-stat-value">${esc(row?.value ?? '—')}</span><span class="challenge-pane-hero-stat-label">${esc(row?.label ?? '')}</span></span></div>`)
			.join('')}</div>`
		: '';
	return `<section class="challenge-pane-hero">
		<h2 class="challenge-pane-title">${esc(vm.title)}</h2>
		<div class="challenge-pane-hero-meta">
			<p class="challenge-pane-phase challenge-pane-phase--${esc(vm.phase)}"><span class="challenge-pane-phase-label">${phaseLabel}</span></p>
			${countdown}
		</div>
		${statsHtml}
	</section>`;
}

const HERO_STAT_ICON_CLASS = 'challenge-pane-hero-stat-svg';

function heroStatIconSvg(key) {
	const wrap = (inner) => `<span class="challenge-pane-hero-stat-icon" aria-hidden="true">${inner}</span>`;
	if (key === 'creators') {
		return wrap(peopleOutlined(HERO_STAT_ICON_CLASS));
	}
	if (key === 'votes') {
		return wrap(thumbsUpStrokeIcon(HERO_STAT_ICON_CLASS));
	}
	return wrap(pictureIcon(HERO_STAT_ICON_CLASS));
}
