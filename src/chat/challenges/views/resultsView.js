import { esc } from '../constants.js';

/**
 * @param {{ ranked: object[] }} vm
 */
export function renderResultsSection(vm) {
	if (!vm.ranked.length) return '';

	const top = vm.ranked[0];
	const cid = top.creationId;
	return `<section class="challenge-pane-section challenge-pane-results"><h3 class="challenge-pane-section-label">Results</h3>
			<p>Top entry: ${cid ? `<a href="/creations/${cid}">Creation #${cid}</a>` : '—'} (score ${esc(String(top.score))})</p>
		</section>`;
}
