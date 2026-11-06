# Plan: aspect ratios — remaining work

Create/advanced already pass `meta.args.aspect_ratio` (MVP four), client `public/shared/aspectRatio.js`, create composer chip, advanced-create picker, localStorage remember, and creation detail hero uses `--hero-aspect-*` + SSR hints. Job still ends with real `width` / `height` from output.

Everything below is still open.

## Backend

- Shared server module: aspect key → target WxH per method/model (long edge policy TBD); reuse from placeholder + upload + validation — today only the browser module exists.
- `insertCreatedImage` in `api_routes/create.js`: initial row still 1024×1024 regardless of `meta.args.aspect_ratio`.
- `creationJob`: placeholder buffers still default 1024²; no read of args/map for pending dimensions.
- Multipart upload in `api_routes/create.js`: still resize to 1024² cover when not already 1024² — no branch for chosen ratio / target box.
- `images.js` (and any other upload entry): same blind 1024² behavior if still present.

## Display (still square or not driven by row/meta)

- `public/global.css`: `.feed-card-image`, `.route-card-image`, `.skeleton-feed-card-image` still `aspect-ratio: 1 / 1` — wanted intrinsic box from `width` / `height` or pending `meta.args.aspect_ratio`.
- Feed card JS (`public/shared/feedCardBuild.js`, `src/shared/feedCardBuild.js`): no style/data hook setting container aspect from item fields while processing.
- Modals — details, publish, share: confirm tiles still 1:1 where they should follow media.
- Creation edit preview (non-advanced): if any preview is still fixed square, align with ratio.
- Chat route embeds — check `.connect-chat-creation-embed-inner` / route chrome vs doom-scroll (doom already letterboxes video).

## `source` + edit / video

- `source` key: match reference image dimensions on edit / i2v; no square crop on that path — not in presets; parse + product rules missing.
- Mutate / i2v: explicitly pass and honor aspect (including `source`); thumbnails follow source where relevant.
- Retest watermark, share pipeline, NSFW blur for non-1:1 and `source` paths.

## Provider / inventory (if still unclear)

- Text-to-image / edit / video matrix: which methods accept which keys; WAN / LTX output vs input; gate or error on 1:1-only models (partially handled in UI for one path — confirm server-side).

## Deferred / later surfaces

- `/gen`, try, landing grid, admin, OG/unfurl, email, Vynly export.
- Extra presets (3:4, 2:3, 4:3, 3:2, 5:4, 21:9) when providers allow.
- `landscapeUrl` (outpaint) vs primary 16:9 create — one row, two concepts; reconcile or document.
- Route card factory — `PLAN_Component_generalization.md` if still four implementations.

## Create UX polish (not required for ratio plumbing)

- Mocks: `_docs/PLAN_aspect_ratios_create_ui.png`, `PLAN_aspect_ratios_create_ui_attached.png`.
- Model sheet, composer collapse, overflow `⋮`, style picker placement, video toggle on basic create + lock to source when attach present.

## Open

- Long edge ~1024 vs native provider sizes.
- Feed/explore grid: uniform row height + crop vs variable aspect rows.
- Embeddings impact (likely none) — verify if touched.
