# Plan: Hook cutover APIs to the UI

The routes already answer. This is only the screen that calls each one. Copy any page that still lives under `_legacy/` into the app. Do not import that tree.

Already calling, leave them:

- Comment stickers: `client/shared/creationCommentsThread.js` loads and saves `/api/profile/comment-stickers`.
- Support report: `client/views/CreationDetail/CreationDetailView.js` posts `/api/support-report`.
- Landscape: that same detail view queries `/api/create/landscape/query`, starts `/api/create/landscape`, and removes with `DELETE /api/create/images/:id/landscape`.
- Policy write: profile and `server/pages/welcome/welcome.js` post `/api/policy/seen`.
- Policy read on a share: `server/pages/share/share.js` gets `/api/policy` and sends an unseen visitor to `/try`.

Still open:

- Policy read on the main landing. `client/views/Home/HomeView.js` never calls `GET /api/policy`. The old landing did, in `_legacy/public/pages/index.js`: read `seen`, set the CTA line, and send a first create to `/try`. Do that on the current home create form. Share already has the pattern.
- Templates. The only caller is `_legacy/public/components/routes/templates.js` (`GET /api/templates`). There is no templates screen in the current client. Bring that screen over with the same fetch.
- Landing events. The video landing in `_legacy/pages/index-video.html` posts `/api/landing/event` for `video_play`, `video_complete`, and `cta_click`, with utm when present. The current home posts none of these. Put those three posts on the live landing controls. Do not add a video just to have an event.
- Feature requests. Nothing posts `/api/feature-requests`. Help at `server/pages/help/02-connect/04-request-a-feature.md` only tells people to use in-app feedback. Add a short signed-in form on that page that posts the message.
- Party group list. Create links to `/party`, and the list fetch is only in `_legacy/pages/party.html` (`GET /api/party/groups` on load). That page is not in the VPS image. The served `/party` page has to make that call. Other party work stays in `_docs/PLAN_party_mode.md`.
- Kiosk. The only caller is `_legacy/pages/kiosk.html`, which polls `/api/kiosk/:slug/viewers`, `/shares`, and `/latest-share` with the token. Copy that page into the app so those three requests run.
- Provider register and test. Admin Connect tests a saved server with `POST /api/servers/:id/test`. Nothing calls `POST /api/provider/register` or `POST /api/provider/test`. On the Connect server form, an admin or provider role gets those two actions: register the URL, then test it. Leave the existing server test in place.
- Private-channel invite create and accept. `client/components/Messages/MessageRow.js` renders the accept button and the token, and nothing handles the click. `client/shared/triggeredSuggest.js` only inserts `/invite`. Wire accept to `POST /api/chat/invites/accept`. Wire create, from the private-channel members control, to `POST /api/chat/invites`, and use the returned `invite_url`. A `#ci=` landing on chat should accept the same way. The old calls are in `_legacy/src/chat/chatPage.js`.
- Semantic related. Detail related already calls `/api/creations/:id/related`. `/api/creations/:id/semantic-related` is only used by `_legacy/public/test/embed.html`. On the detail related grid, ask semantic-related first. On 404 (no embedding), stay on the current `/related` feed. Page with `limit` and `offset`. Render `items`.
- Embeddings search. Explore semantic search already calls `/api/explore/search/semantic`. `/api/embeddings/search` has no product caller. Point that Explore semantic request at `/api/embeddings/search` only after the item shape matches what `ExploreView` renders. Until the shapes match, keep the current explore path.
- Creation summary. Nothing calls `GET /api/creations/:id/summary`. On creation detail load, request it and show the text it returns. A failed or empty summary leaves the rest of the page as it is.

Done when each path above is requested by a screen this app serves, the four already-wired flows still hit the same URLs, and a click-through covers home policy, stickers, a template list, one landing event, a feature request, the party list, one kiosk poll, provider register then test, invite create then accept, semantic related with and without an embedding, explore semantic search, a creation summary, a support report, and landscape query, start, and remove.
