import { esc } from '../constants.js';

/**
 * @param {{ ranked: object[] }} vm
 */
export function renderResultsSection(vm) {
	if (!vm.ranked.length) return '';

	return `<section class="challenge-pane-section challenge-pane-results"><h3 class="challenge-pane-section-label">Results</h3>
			<p class="challenge-pane-muted">Winners are chosen by the challenge runner and announced separately.</p>
		</section>`;
}
