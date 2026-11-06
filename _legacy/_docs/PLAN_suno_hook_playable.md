# Plan: playable Suno hooks

Goal: native in-app playback for Suno hook links. v1 is an OG card (`.connect-chat-suno-preview--hook`, 9:16, 260px chat / 250px comments). This phase swaps the poster for `<video>` when hydration includes a video URL.

Not in this phase: HLS.js, video-byte proxy, import-as-creation, engagement counts, playlists.

## Why not iframe

Suno sets `frame-ancestors 'none'` / `X-Frame-Options: SAMEORIGIN`. Hook pages cannot be embedded.

## Resolve

`GET https://studio-api.prod.suno.com/api/video/hooks/{hookId}` is unauthenticated today. Verified against `40df9183-e44a-4ca9-b2dd-d75862bbb21a`. Returns MP4 (`rendered_video_url`), HLS 360/720/1080 (`video_streaming_resolutions`), thumbnail, clip title, creator/handle, duration.

Fetch JSON **server-side** (API CORS blocks the browser). `/s/{slug}` already 307s to `/hook/{id}`; follow that first.

Do not call this from the client. If the endpoint 404s or changes, keep the OG card.

## Playback

App has no HLS.js. First slice: native `<video playsinline>` + `rendered_video_url`. CDN currently allows cross-origin playback. HLS only if MP4 fails.

Proxy metadata through `/api/suno/resolve` (or a hook route). Do not proxy video bytes unless CDN hotlink/CORS breaks.

Keep the v1 card shell and size (9:16, `object-fit: cover`). If `videoUrl` is present, replace the poster `<img>` with `<video poster={posterUrl} src={videoUrl}>`. Same box so chat scroll does not jump.

## Cache

Cache static hydration (urls, title, poster, duration). Do not store like/view counts in the same blob if they are shown later.

## Caveat

Undocumented internal API. Can vanish. Official Suno docs do not cover external hook embedding.
