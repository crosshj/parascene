# Plan: Mutate queue ↔ create surfaces consistency

Goal: One story for queue-for-later / queue-from-frame across creation composer, basic create, and advanced create. Queue writes always surface in UI; submits use the queued input URL (including generic frame captures), not the parent poster.

## Root cause

- `mutateQueue:v1` and composer attachment storage (`create_page_image_edit_selection`) are separate; queue writes do not update attachments.
- Composer only maps queue → lineage for attachments already in memory; no pull from queue.
- Advanced prefills from queue on field mount only; no live sync.
- API mutate lineage replaces form image URL with parent share URL even when submitter sent a different URL (e.g. generic frame upload).

## Design

Single write path: all queue mutations go through `mutateQueue.js` → persist attachment storage → dispatch `mutate-queue-updated`.

Shared helpers in `mutateQueueSync.js` (client) and `mutateLineageImageUrl.js` (server):

- URL normalization for queue matching
- Lineage from queue URLs (`mutateOfId` / `mutateParentIds`)
- `shouldReplaceMutateInputWithSourceShareUrl` — only swap when submitted URL is the source creation’s own image, never for generic uploads or alternate inputs

Settings sync (separate from queue) in `createSettingsSync.js`:

- Prompt, aspect, model, style in `create_page_*` localStorage keys
- Composer ↔ createAdvanced bidirectional sync; Basic Mode switch does not flush settings
- Queue handles images only; settings sync handles text/aspect/model

Submit semantics (do not rename API fields based on array length):

- **Basic + mutate**: queue head only, existing arg shapes (`image_url`, or `input_images: [url]` where already used)
- **Composer + advanced**: all queue items, existing arg shapes (`input_images`, provider fields, etc.)

Queue sync (single write path — every surface writes `mutateQueue:v1`, all subscribe to `mutate-queue-updated`):

- **Composer**: full strip → `replaceMutateQueueFromImageUrls`
- **Advanced**: `image_url_array` → full list; single `image_url` → `replaceMutateQueueHead`
- **Basic**: image edit change → `replaceMutateQueueHead`; clear → `removeMutateQueueHead`

Surfaces subscribe to `mutate-queue-updated`:

- **Composer**: open queue — full attachment strip from queue; remove attachment removes queue entry; submit all items; `syncFromMutateQueue()`.
- **Basic create**: queue head in image edit UI; submit resolves queue head at click time, then lineage from that URL; falls back to local pick when queue empty.
- **Advanced create**: open queue — sync `fieldValues` + re-render image fields when queue changes; submit all prefilled URLs.
- **Chat overlay dismiss**: `syncFromMutateQueue()` + `syncFromSharedSettings()`.

## Phases

1. Server util + tests — generic URL detection; conditional share-url replacement
2. Client `mutateQueueSync.js` + tests — storage sync, lineage helper, event name
3. `mutateQueue.js` — notify + sync storage on every write
4. `createComposer.js` — event listener, sync API, remove↔queue, simplify drop handler
5. `chatPage.js` — overlay dismiss sync
6. `entry-create.js` — queue listener + submit lineage + queue-head submit
7. `create.js` + `providerFormFields.js` — shared prefill; advanced queue listener
8. `createSettingsSync.js` — composer ↔ createAdvanced settings; tests in `test/createSettingsSync.test.js`

## Done criteria

- Queue from frame → close detail overlay → composer on My Creations shows frame thumbnail
- Advanced shows frame and submit uses frame URL (verify generic URL in job args / meta)
- Basic create image edit prefills from queue; submit uses queue head + lineage
- Removing composer attachment removes queue item
- Prompt/aspect from composer appear on createAdvanced and back
- Unit tests for sync helpers and API replacement guard

## Implemented

- `public/shared/mutateQueueSync.js` — sync storage, events, lineage, URL matching
- `public/shared/mutateQueue.js` — all writes notify + sync; `replaceMutateQueueSingleItem`
- `public/shared/createSettingsSync.js` — shared create settings + session merge
- `api_routes/utils/mutateLineageImageUrl.js` — conditional share-url replacement
- Composer, chat overlay dismiss, basic create, advanced create wired to `mutate-queue-updated`
- Tests: `test/mutateLineageImageUrl.test.js`, `test/mutateQueueSync.test.js`, `test/createSettingsSync.test.js`
