# Plan: Get ahead on video

Three needs are tangled:

1. Users should get cheap video — Parascene Blue, not expensive cloud.
2. You personally want to see what’s possible — try Replicate and other cloud models freely.
3. Blue needs to move fast — work on Blue directly, not wait on Parascene product work.

Blue already has MiniMax H3 and the main video-to-video / reference-to-video modes. What’s missing is not access to the tech. What’s missing is finished clips and a thin way for people to use what works.

Feeling behind is mostly output and product access — not a missing model.

Rule for this push: footage first, product second. Do not redesign Parascene until you have a handful of clips you’d be willing to show.

Phase 1 — Make clips on Blue

- Work via Desktop Direct to Blue (Project → Generate), not the web create flow.
- Refs attachment and form shape: `parascene-desktop/docs/PLAN-refs-to-video.md`.
- Focus on reference-to-video (H3) and video-to-video first.
- Keep only the strong results. A few great clips beat a long experiment log.
- Fix only what blocks getting a clip out. No new R&D rabbit hole.

Done when: a small set of keepers, and a clear sense of which Blue modes feel real.

Phase 2 — Taste the cloud (side track)

- Short, bounded time trying newer Replicate (or similar) video models.
- Compare against Blue. Note what cloud still wins at, if anything.
- Do not block Phase 1. Do not make expensive cloud the default for users.

Done when: you know whether Blue covers the must-have feel, or one cloud capability is still worth chasing later.

Phase 3 — Open Blue to users (thin)

- After keepers exist, surface those Blue modes in Parascene.
- First surface can be small (power users / advanced is fine).
- Ship only what survived Phase 1. Leave weak or unfinished modes off.

Done when: someone else can make a video-to-video or reference-to-video clip on Blue through Parascene without you running Blue by hand.

Not this push

- Big product direction rewrite
- Making every Blue mode available at once
- Using Replicate as the cheap path for users
- Building more layers between Parascene and Blue
- Long-horizon video research until the clip set exists

Ahead means

1. Real clips that show video-to-video and reference-to-video.
2. Knowing which Blue modes to stand behind.
3. Users can reach those modes cheaply on Parascene.
