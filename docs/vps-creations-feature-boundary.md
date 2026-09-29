# VPS creations feature boundary

> # 🚨🔥 DO NOT USE THE DEPRECATED STANDALONE WWW ROUTES AS THE VPS FRONTEND SOURCE OF TRUTH 🔥🚨
>
> **THE ACTIVE WWW SPA IS THE SOURCE OF TRUTH.** We are bringing the SPA over into VPS/Beta. The old standalone/page-oriented WWW implementations are deprecated and must be removed or ignored wherever possible. Do not copy their route shells, card markup, layout rules, breakpoints, or interaction patterns merely because they are nearby or easier to find. Before implementing a VPS feature, identify the corresponding active SPA implementation and port that boundary and its shared behavior. If no SPA equivalent exists, document that exception explicitly before inventing a new pattern.
>
> **VPS IS A SELF-CONTAINED DEPLOYMENT. NEVER IMPORT RUNTIME CODE FROM OUTSIDE `vps/`.** Do not import from `api_routes/`, `public/`, `src/`, or any other legacy/application tree. Inspect those trees as references only; port the required behavior into VPS-owned modules. The Docker image contains `vps/` and nothing else from the repository.

## Purpose

The VPS creations view is a port of the active WWW SPA creations browse behavior. It is not a new approximation of the grid, it is not a port of the deprecated standalone `app-route-creations` page, and it is not a compatibility layer for the abandoned `prsn_creations` table.

The VPS endpoint is the canonical beta contract for the `prsn_created_images` resource. The frontend feature may retain the mature WWW grid behavior where that behavior is still correct, while its network and navigation seams are owned by VPS.

## The cut line

The ported feature owns:

- list loading and offset pagination;
- infinite-scroll sentinel and manual load-more fallback;
- optimistic pending/creating cards and status polling;
- lazy media loading with an eager viewport budget and bounded concurrency;
- image, native video, audio-cover/waveform, and imported-media thumbnail selection;
- grouped creation covers, group badges, carousels, and video playlists;
- published, challenge-locked, NSFW, moderated/error, and processing states;
- skeleton, empty, and error states;
- refresh, filter state, and cache invalidation hooks;
- the card DOM contract and the grid-specific CSS.

The port does not yet own:

- the composer/create flow;
- creation detail rendering or editing;
- WWW route registration, page shells, or standalone-page behavior;
- unrelated feed-card behavior that exists only because WWW shares helpers with the grid.

Those excluded capabilities are exposed as feature hooks. They must not be silently reintroduced by importing the WWW application shell.

## Source-to-VPS mapping

For the active SPA browse surface, the primary source is the chat/pseudo-channel implementation in `src/chat/chatPage.js`, `public/shared/feedCardBuild.js`, and the browse-specific rules in `public/global.css` around `.chat-page--pseudo-browse-view`. The deprecated standalone route in `public/components/routes/creations.js` is not the source of truth for this VPS view. Its shared dependencies are relevant only when they are also used by the active SPA implementation.

The port should copy those feature modules into the VPS client feature directory and replace only these seams:

1. `fetchJsonWithStatusDeduped` → the VPS request/resource client.
2. `/api/create/images` → `/api/creations`.
3. WWW detail/composer navigation → VPS route hooks that currently do nothing or use the beta route when implemented.
4. WWW global CSS → explicit component/feature CSS imported by the VPS view.
5. WWW global event assumptions → a small VPS feature event interface.

The port must not import `public/components/routes/creations.js` directly. That would preserve its dynamic WWW module graph and bring unrelated feed/chat dependencies across the boundary.

## API contract needed by the feature

`GET /api/creations?limit=50&offset=0&challenge_only=0` returns:

```json
{
  "creations": [],
  "has_more": true,
  "limit": 50,
  "offset": 0
}
```

Each creation supplies the media and presentation fields used by the grid: `id`, `filename`, `file_path`, `url`, `thumbnail_url`, `fit_thumbnail_url`, `video_url`, `audio_url`, `media_type`, `width`, `height`, `color`, `status`, `created_at`, `published`, `published_at`, `title`, `description`, `meta`, `nsfw`, and `is_moderated_error`.

The API owns visibility filtering and pagination. The frontend must not fetch a broad list and then paginate it locally.

## Completion criteria

The current simplified `CreationsView` is not considered complete. The feature is complete when its behavior can be checked against WWW for the seven migration risks: loading strategy, pagination, media thumbnail selection, badges/privacy presentation, infinite scrolling, grouped items, and header/empty-state decisions.
