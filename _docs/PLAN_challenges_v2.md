# Challenges v2 — remaining work

The organizer console, multi-track challenge views, voting, challenge-targeted submission, tip payouts, and `accepted_media` filtering are implemented. Music entries can be imported through the general media flow and played in voting. The remaining gap is the challenge-card entry point described in the original Music-track plan.

## Open

- [ ] Add an **Import a song** action to an open Music challenge card. Reuse the existing Suno import flow; after a successful import, open the standard submission confirmation with that challenge already selected. Preserve the existing eligibility checks and confirmation step.

## Completion checks

- Import a Suno link directly from an open Music challenge card.
- On successful import, the new creation is selected for that challenge in the normal submit confirmation.
- The user can review and confirm before submission; failures leave the challenge card and imported-media flow recoverable.

The old optional remix-source proposal is not committed work. Phase 10's cleanup list targeted the retired WWW tree and is not work for the root app.
