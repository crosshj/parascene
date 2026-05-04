export function renderEmptyParticipantPane() {
	return `<div class="challenge-pane-empty route-empty-image-grid">
			<p class="challenge-pane-lead">No active challenge yet.</p>
			<p class="challenge-pane-muted">When an organizer posts a <code>challenge_config</code> JSON message in this channel, details and timelines appear here.</p>
		</div>`;
}
