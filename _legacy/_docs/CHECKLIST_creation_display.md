# Checklist: creation display surfaces

Run this when changing how creations look anywhere in the app — thumbs, cards, heroes, embeds, video, NSFW, badges, lazy load, or API image fields.

Grouped creations (`meta.group.kind === group_creations`) are the hardest case; most gaps today are route-card grids that only use `url`/`thumbnail_url` and ignore `meta.group`. See also `_docs/PLAN_group_and_video_creations.md`.

## Shared building blocks

Feed cards: `public/shared/feedCardBuild.js` — `createFeedItemCard`, group carousel/playlist helpers.

Route cards: `public/shared/creationCard.js` — `buildCreationCardShell`; caller sets `.route-media` background or content.

Server storage filename (export/share): `api_routes/utils/resolveCreatedImageStorageFilename.js`.

Layout/aspect: `public/shared/aspectRatio.js`.

## What to verify (any creation)

- Thumb or hero loads (not blank, not wrong file)
- Image vs video branch (`media_type`, poster, autoplay rules)
- Pending / creating / failed / moderated states
- NSFW blur and reveal
- Published / challenge / deleted badges where applicable
- Click goes to `/creations/{id}` (parent id for groups, not a source id)
- Lazy load / intersection observer still fires
- `creation_id` on media URLs when delegation applies

## Surfaces — feed cards

`public/components/routes/feed.js` — main feed

`src/chat/feed/doomScrollView.js`, `doomScrollMount.js` — doom scroll

`src/chat/feed/feedChannelView.js` — chat channel feed

`src/chat/chatPage.js` — explore/creations browse (`hideFeedCardMetadata`)

`public/shared/creationComposerDrag.js` — drag-to-composer `imageUrl`

## Surfaces — route cards (grids)

`public/pages/user-profile.js` — Creations, Likes, Mentions tabs (`renderImageGrid`); personality grid; Comments tab thumbs

`public/components/routes/creations.js` — my creations

`public/components/routes/explore.js` — explore search/results

`public/pages/creation-detail.js` — related grid; lineage modal thumbs

Known weak spots: profile and related grid APIs omit or mis-resolve `meta` / cover URL for groups.

## Surfaces — detail and modals

`public/pages/creation-detail.js` — hero, actions, group section, publish flow

`public/components/modals/creation-details.js` — more info (incl. group source context)

`src/chat/challenges/challengeVoteModal.js` — vote media (single creations only; groups blocked at submit)

## Surfaces — chat and social

`public/shared/userText.js` — `hydrateChatCreationEmbeds`

`public/shared/nsfwView.js`, `public/shared/chatInlineImageLightbox.js`

`public/shared/connectCommentCard.js`

`public/components/modals/notifications.js` — links to creations

`public/shared/likes.js` — any inline creation preview

## Surfaces — share and export

`api_routes/pages.js` — share page hero, OG/Twitter meta

`api_routes/share.js` — share image bytes

`api_routes/create.js` — `/image`, `/watermarked` export routes

## Surfaces — party

`pages/party.html` — queue, pushed, cover

`api_routes/create.js` — `/api/party/*`

`api_routes/googlePhotos.js` — party/group export

## API payloads (check when UI looks wrong)

`GET /api/users/.../created-images` — `api_routes/user.js` (no `meta`; group `file_path` often synthetic)

`GET /api/users/.../liked-creations` — same file

`GET /api/create/images` — `api_routes/create.js` (has `meta`; url may still be synthetic for groups)

`GET /api/create/images/:id` — same file

Feed/explore row mappers — `api_routes/feed/transformFeedCreationRow.js`, `api_routes/explore.js`

Related — `api_routes/creations.js` (`mapRelatedItemsToResponse`, no `meta`)

Comments — `api_routes/comments.js` (`created_image_thumbnail_url`)

Server resolver: `api_routes/utils/resolveCreationDisplayMedia.js` (`mapCreatedImageRowMediaFields`).

Route-card client hydrator: `public/shared/routeCardGroupMedia.js` (reuses feed group carousel/playlist).

## Grouped creations (extra checks)

- Cover from `cover_source_id`, else first source
- Multi-image: carousel; nav does not navigate the card
- Multi-video: sequential playlist; poster from cover
- Group badge on tiles that show type hints
- Archived sources load via parent `creation_id`
- Set cover / reorder / ungroup reflected after refresh
- Share page in-page carousel; OG image is cover only (wide crop may clip portraits)

Blocked: challenge submit for group rows (`create.js`).

## Smoke test

Use one regular image, one video, one multi-image group, one multi-video group if your change touches groups.

Walk the surfaces above. Note blank tiles, wrong media, missing badges, broken click targets.

After cover change on detail, reload grids that should show the new cover.

Share link: in-page hero + one unfurl debugger (see `_docs/UNFURL.md`).

Debug: `scripts/compare_grouped_vs_regular_creation.js`.

## New grid or embed

- Feed card or route card?
- Which API feeds it — does payload include `meta` and valid urls?
- Image, video, group, NSFW, pending/failed?
- Add the surface to this file
