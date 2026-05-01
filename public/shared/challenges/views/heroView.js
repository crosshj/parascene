import { challengePhaseDisplayLabel } from '../model/phases.js';
import { esc } from './htmlEscape.js';

/**
 * @param {{ title: string, phase: string, countdownHtml?: string }} vm
 */
export function renderHeroSection(vm) {
	const phaseLabel = esc(challengePhaseDisplayLabel(vm.phase));
	const countdown =
		typeof vm.countdownHtml === 'string' && vm.countdownHtml.trim()
			? vm.countdownHtml
			: '';
	return `<section class="challenge-pane-hero">
		<h2 class="challenge-pane-title">${esc(vm.title)}</h2>
		<div class="challenge-pane-hero-meta">
			<p class="challenge-pane-phase challenge-pane-phase--${esc(vm.phase)}"><span class="challenge-pane-phase-label">${phaseLabel}</span></p>
			${countdown}
		</div>
	</section>`;
}
