# Design: api.parascene.com

One process serves `www.parascene.com` and `api.parascene.com`. On the API host, a path is handled only when it starts with `/api`. Anything else redirects to the site origin. The handlers below are the same functions on both hosts. The www app calls them on its own origin. Outside systems that are configured with `https://api.parascene.com` are marked.

`/oauth/authorize`, `/oauth/authorize/continue`, `/oauth/token`, and `/oauth/userinfo` are not API-host handlers. A request for them on `api.parascene.com` redirects to www. File upload and download live on `cdn.parascene.com` (`/api/files`, `/api/images/generic`, `/s/...`), not on this host.

Today the name `api.parascene.com` still resolves to the old Vercel app. This list is the root server that answers the name once DNS moves.

## Addressed at the API host

QStash and Stripe are pointed at this hostname. The routes also exist on www.

- `POST /api/worker/create` and `POST /api/create/worker` — QStash creation callback. Runs the creation, a provider poll, a landscape job, or an audio-cover job. Alias of one handler.
- `POST /api/try/worker` — QStash callback for an anonymous try-page generation.
- `POST /api/worker/jobs` — QStash schedule and on-demand jobs. `embedding` stores a creation vector. `visit_pulse_flush` writes one US East day from Redis into Postgres (05:10 UTC). `feed_beta_catalog_rebuild` refreshes the shared feed snapshot in Redis (every 15 minutes).
- `POST /api/worker/notifications` — Hourly QStash mail cron. Digest, welcome, first-creation nudge, reengagement, and creation highlight. No-ops outside the digest window.
- `POST /api/webhooks/stripe` — Stripe signature check. Grants Founder or credit-pack credits, drops a deleted subscription back to free, and grants renewal credits.

## Shared with www

The site calls these on `www`. API-key clients are told to call the same paths on `https://api.parascene.com`.

### Session and account

- `GET /api/auth/session` — Who is signed in.
- `POST /api/auth/login` — Password sign-in.
- `POST /api/auth/signup` — Create an account.
- `POST /api/auth/logout` — End the session.
- `GET /api/me` — Compact current-user payload.
- `POST /api/auth/supabase-session` — Mint the browser's Supabase Realtime session.
- `GET /api/profile` — Current user, profile, and plan.
- `PUT /api/profile` — Save profile fields. Also finishes welcome.
- `PATCH /api/profile` — Partial profile update.
- `POST /api/profile` — Create the profile row.
- `POST /api/profile/avatar-from-creation` — Use a creation as the avatar.
- `PUT /api/account/email` — Change the account email.
- `POST /api/profile/api-key` — Mint the personal API key. Shown once.
- `DELETE /api/profile/api-key` — Revoke that key.
- `GET /api/profile/comment-stickers` — Sticker set for comments.
- `PUT /api/profile/comment-stickers` — Save that set.
- `PUT /api/profile/vynly-token` — Save the user's Vynly token.
- `PUT /api/profile/plan` — Switch plan. `free` cancels the Stripe subscription.
- `GET /api/users/usernames` — Username availability.
- `GET /api/username-suggest` — Suggest a username.
- `GET /api/users/recent` — Recently active people.

### Credits and billing

- `GET /api/credits` — Balance and claim state.
- `POST /api/credits/claim` — Daily free claim.
- `POST /api/credits/tip` — Send credits to another person.
- `POST /api/credits/checkout` — Stripe Checkout for a credit pack.
- `POST /api/subscription/checkout` — Stripe Checkout for Founder.
- `POST /api/subscription/checkout-return` — Record that the browser came back from Checkout.

### Notifications

- `GET /api/notifications` — Notification list.
- `GET /api/notifications/unread-count` — Badge count.
- `POST /api/notifications/acknowledge` — Mark one read.
- `POST /api/notifications/acknowledge-all` — Mark all read.

### Feed, home, explore

- `GET /api/feed` — Ranked home feed.
- `GET /api/feed/version` — Cache-bust token for the feed.
- `GET /api/feed/doom` — Full-height doom-scroll slice.
- `GET /api/feed/challenge-engagement` — Challenge rows for the feed.
- `POST /api/feed/impression` — One feed impression.
- `POST /api/feed/impressions` — A batch of impressions.
- `GET /api/home/latest` — Latest rail.
- `GET /api/home/newbies` — New-member rail.
- `GET /api/explore` — Explore browse.
- `GET /api/explore/search` — Keyword search.
- `GET /api/explore/search/semantic` — Meaning search.
- `GET /api/personalities/:personality/creations` — Creations for a persona.
- `GET /api/tags/:tag/creations` — Creations for a tag.
- `GET /api/embeddings/search` — Nearest creations for a query vector.
- `GET /api/creations/:id/semantic-related` — Nearest creations to one creation.

### Creations

- `GET /api/creations` — Creation catalog page.
- `GET /api/creations/:id` — One creation.
- `GET /api/creations/:id/summary` — Short card payload.
- `GET /api/creations/:id/related` — Related row.
- `GET /api/creations/nsfw-flags` — NSFW flags for a set of ids.
- `POST /api/creations/transitions` — Before/after frames for a set of creations.
- `GET /api/creations/:id/video-frame` — A still from a video creation.
- `GET /api/creations/:id/audio` and `GET /api/create/images/:id/audio` — Audio bytes for a creation.
- `GET /api/creations/media/*` — Creation media by storage path.
- `GET /api/images/created/*` — Created image bytes.
- `GET /api/videos/created/*` — Created video bytes.
- `GET /api/create/images` — The signed-in user's creations.
- `GET /api/create/images/:id` — One owned creation, including drafts.
- `GET /api/create/images/:id/children` — Variations made from this creation.
- `GET /api/create/images/:id/mutate-source` — Source payload for Recreate or Mutate.
- `PUT /api/create/images/:id` — Save title and description. Refreshes the embedding when the creation is published.
- `POST /api/create/images/:id/publish` — Publish and add a feed row. Enqueues an embedding.
- `POST /api/create/images/:id/unpublish` — Pull it from the feed.
- `DELETE /api/create/images/:id` — Owner delete.
- `POST /api/create/images/:id/share` — Mint a share link.
- `POST /api/create/images/:id/retry` — Give up on a stuck job and refund.
- `POST /api/create/images/:id/check` — Read provider status for an in-flight job.
- `POST /api/create/images/:id/fit-thumbnail` — Store the native-aspect thumbnail.
- `POST /api/create/images/:id/adjust` — Save an edited still.
- `POST /api/create/images/:id/share-audio` — Attach share audio taken from a video.
- `POST /api/create/images/:id/landscape` — Start a landscape variant.
- `POST /api/create/landscape/query` — Whether landscape is available and what it costs.
- `DELETE /api/create/images/:id/landscape` — Remove the landscape variant.
- `POST /api/create/images/:id/cover` — Set an audio cover.
- `POST /api/create/images/:id/cover/query` — Cover cost and prompt.
- `POST /api/create/images/:id/video-placeholder` — Hold a video slot before the file exists.
- `POST /api/create/images/group` — Make a group from creations.
- `POST /api/create/group` — Create a group v2.
- `PATCH /api/create/group/:id` — Update a group v2.
- `POST /api/create/images/:id/group-cover` — Set the group cover.
- `POST /api/create/images/:id/group-reorder` — Reorder group members.
- `POST /api/create/images/:id/ungroup` — Break a group apart.
- `POST /api/create/images/:id/challenge-submit` — Enter a creation in a challenge.
- `POST /api/create/images/:id/challenge-withdraw` — Pull that entry.
- `POST /api/create/images/:id/watermarked-video/prepare` — Start a watermarked download.
- `GET /api/create/watermarked-video/:jobId` — Status of that job.
- `GET /api/create/watermarked-video/:jobId/download` — The file.
- `GET /api/share/watermarked-video/:jobId` — Public status for a shared watermark job.
- `POST /api/create/images/repair-group-aspect` — Admin repair of group aspect ratios.
- `POST /api/create/images/repair-fit-thumbnails` — Admin repair of fit thumbnails.
- `POST /api/create/images/:id/admin-add-video` — Admin attaches a video file.
- `POST /api/create/images/:id/admin-provider-video-recovery` — Admin retries a lost provider video.
- `POST /api/create/images/:id/admin-restore-user-delete` — Admin undoes a user delete. Re-enqueues the embedding when it was published.

### Generation

- `POST /api/create/preview` — Price and preview a generation before paying.
- `POST /api/create/query` — Which server and method can run this prompt.
- `POST /api/create/validate` — Check the request before it spends credits.
- `POST /api/create` — Start a generation.
- `GET /api/create/import-suno/preview` — Preview a Suno import.
- `POST /api/create/import-suno` — Import a Suno track.
- `GET /api/create/import-youtube/preview` — Preview a YouTube import.
- `POST /api/create/import-youtube` — Import a YouTube video.
- `POST /api/create/import-audio/start` — Begin an audio-file import.
- `POST /api/create/import-audio/finalize` — Finish that import.
- `POST /api/create/ephemeral-still/start` — Start a temporary still used as generation input.
- `POST /api/create/ephemeral-still/finalize` — Keep that still.
- `GET /api/create/ephemeral-still/:token` — Read it back.
- `POST /api/try/create` — Anonymous try-page generation.
- `GET /api/try/list` — That browser's try results.
- `POST /api/try/discard` — Drop them.
- `GET /api/try/images/:filename` — Bytes for a try image.

### Share links

These are fetched without a session when the token matches. www and the API host both serve them. Share pages themselves are on `sh.parascene.com`.

- `GET /api/share/:version/:token/image` — Shared image.
- `GET /api/share/:version/:token/video` — Shared video.
- `GET /api/share/:version/:token/audio` — Shared audio.
- `GET /api/share/:version/:token/clip-audio` — Shared clip audio.
- `GET /api/share/:version/:token/cdn-audio` — Audio redirected through the CDN.

### People, follows, comments, presence

- `GET /api/users/:id/profile` and `GET /api/users/by-username/:username/profile` — Public profile.
- `GET /api/users/:id/created-images` and `GET /api/users/by-username/:username/created-images` — Their published work.
- `GET /api/users/:id/liked-creations` and `GET /api/users/by-username/:username/liked-creations` — What they liked.
- `GET /api/users/:id/comments` and `GET /api/users/by-username/:username/comments` — Their comments.
- `POST /api/users/:id/follow` and `POST /api/users/by-username/:username/follow` — Follow.
- `DELETE` on those same paths — Unfollow.
- `GET …/followers` and `GET …/following` — The two lists. Same id or username bases.
- `GET /api/created-images/:id/like` — Like state for the viewer.
- `POST /api/created-images/:id/like` — Like.
- `DELETE /api/created-images/:id/like` — Unlike.
- `GET /api/created-images/:id/activity` — Comments and likes on a creation.
- `POST /api/created-images/:id/comments` — Add a comment.
- `PATCH /api/comments/:id` — Edit a comment.
- `DELETE /api/comments/:id` — Delete a comment.
- `POST /api/comments/:id/reactions` — React to a comment.
- `GET /api/comments/latest` — Newest comments.
- `GET /api/presence/online` — Who is online.
- `POST /api/presence/heartbeat` — Still here.
- `POST /api/presence/away` — Mark away.
- `POST /api/presence/last-active` — Record last activity.
- `PATCH /api/presence/settings` — Appear-offline and related switches.

### Chat

- `GET /api/chat/threads` — Inbox.
- `GET /api/chat/unread-summary` — Unread counts.
- `GET /api/chat/channel-slugs` — Hashtag channel names.
- `GET /api/chat/hashtag-channel-exists/:rawSlug` — Whether a channel slug is taken.
- `POST /api/chat/dm` — Open a DM.
- `POST /api/chat/channels` — Open a hashtag channel.
- `POST /api/chat/invites` — Invite someone to a thread.
- `POST /api/chat/invites/accept` — Accept an invite.
- `POST /api/chat/invites/dm` — Invite into a DM.
- `GET /api/chat/threads/:threadId` — One thread.
- `GET /api/chat/threads/:threadId/messages` — Message page.
- `POST /api/chat/threads/:threadId/messages` — Send a message.
- `PATCH /api/chat/messages/:messageId` — Edit a message.
- `DELETE /api/chat/messages/:messageId` — Delete a message.
- `POST /api/chat/messages/:messageId/reactions` — React to a message.
- `PUT /api/chat/messages/:messageId/challenge-vote` — Vote on a challenge entry.
- `POST /api/chat/threads/:threadId/read` — Mark the thread read.
- `POST /api/chat/threads/:threadId/leave` — Leave.
- `POST /api/chat/threads/:threadId/hide` — Hide it from the inbox.
- `GET /api/chat/threads/:threadId/member-status` — Who is in it.
- `GET /api/chat/threads/:threadId/private-key` — Key material for a private thread.
- `GET /api/chat/threads/:threadId/canvases` — Canvases in the thread.
- `POST /api/chat/threads/:threadId/canvases` — Add one.
- `POST /api/chat/threads/:threadId/pinned-canvas` — Pin a canvas.
- `POST /api/chat/threads/:threadId/pinned-message` — Pin a message.
- `POST /api/chat/normalize-body` — Normalize message text before send.
- `POST /api/chat/challenges/organize/pins` — Pin challenge entries while organizing.
- `GET /api/chat/challenges/organize/assignable` — Creations that can be assigned.
- `POST /api/chat/challenges/organize/assign-creation` — Assign one.
- `GET /api/chat/threads/:threadId/challenges/:challengeId/stats` — Challenge totals.
- `POST /api/chat/challenges/:threadId/entry-creations` — Creations entered in the challenge.
- `POST /api/chat/challenges/organize/:threadId/:challengeId/publish-results` — Publish the outcome.
- `POST /api/chat/challenges/organize/:threadId/:challengeId/finalize-results` — Close it out.
- `POST /api/chat/challenges/organize/:threadId/:challengeId/retry-unpaid` — Retry unpaid result work.

### Library, styles, audio

- `GET /api/library/folders` — Desktop library folders.
- `POST /api/library/folders/mutate` — Apply a folder change from the desktop client.
- `GET /api/styles/names` — Style names for the picker.
- `GET /api/styles/new` — Styles the viewer has not saved.
- `POST /api/styles` — Save a style.
- `GET /api/styles/:slug` — One style.
- `PATCH /api/styles/:slug` — Update it.
- `DELETE /api/styles/:slug` — Delete it.
- `GET /api/prompt-injections` — Prompt injections in the library.
- `GET /api/prompt-injections/personas/promote-eligibility` — Whether a persona can be promoted.
- `GET /api/prompt-injections/personas/in-library` — Personas already saved.
- `POST /api/prompt-injections/personas/promote` — Promote a persona.
- `POST /api/prompt-injections/personas/:tag/catalog` — Put a persona in the catalog.
- `GET /api/suggest` — Suggestion chips.
- `GET /api/audio-clips` — The viewer's audio clips.
- `GET /api/audio-clips/:id` — One clip.
- `GET /api/audio-clips/:id/creations` — Creations that use it.
- `POST /api/audio-clips/record` — Save a recording.
- `PATCH /api/audio-clips/:id` — Rename or edit a clip.
- `POST /api/audio-clips/:id/thumb` — Set clip art.
- `DELETE /api/audio-clips/:id` — Delete a clip.

### Servers and providers

- `GET /api/servers` — Generation servers the user can use.
- `GET /api/servers/:id` — One server.
- `PUT /api/servers/:id` — Update a server the user owns.
- `POST /api/servers/:id/join` — Join a server.
- `POST /api/servers/:id/leave` — Leave it.
- `POST /api/servers/:id/test` — Probe the server.
- `POST /api/servers/:id/refresh` — Reload its capabilities.
- `GET /api/provider/status` — Provider status list. Currently empty.
- `GET /api/provider/metrics` — Provider metrics list. Currently empty.
- `GET /api/provider/grants` — Provider grants. Currently empty.
- `GET /api/provider/templates-hosted` — Hosted templates. Currently empty.
- `POST /api/provider/register` — Register a provider server. Admin or provider role.
- `POST /api/provider/test` — Call a provider URL and read its methods.
- `GET /api/templates` — Public template list.

### Integrations, Vynly, Google Photos

- `GET /api/integration/apps` — Apps the user has registered.
- `POST /api/integration/apps` — Register an app for Log in with Parascene.
- `PATCH /api/integration/apps/:clientId` — Change name, redirects, or client type.
- `DELETE /api/integration/apps/:clientId` — Remove the app.
- `GET /api/profile/integration-grants` — Apps the user has approved.
- `DELETE /api/profile/integration-grants/:grantId` — Revoke one.
- `GET /api/vynly/status` — Whether Vynly is connected.
- `GET /api/vynly/posts` — The user's Vynly posts.
- `GET /api/vynly/sparks` — Sparks.
- `GET /api/vynly/search` — Search Vynly.
- `POST /api/vynly/posts` — Create a post.
- `POST /api/vynly/sparks` — Create a spark.
- `POST /api/vynly/share-from-creation` — Post a creation to Vynly.
- `DELETE /api/vynly/creations/:creationId/posts` — Remove the Vynly post for a creation.
- `GET /api/google-photos/status` — Whether Google Photos is connected.
- `GET /api/google-photos/connect` — Start the OAuth redirect.
- `GET /api/google-photos/callback` — OAuth return.
- `POST /api/google-photos/disconnect` — Disconnect.
- `POST /api/google-photos/upload` — Upload a photo.
- `POST /api/google-photos/sync-party` — Sync a party album.
- `POST /api/google-photos/remove` — Remove a photo from the album.

### Party, kiosk, policy, support

- `GET /api/party/groups` — Party groups.
- `DELETE /api/party/groups/:id` — Delete one.
- `POST /api/create/images/:id/party-settings` — Party settings on a creation.
- `POST /api/create/images/:id/party-remove-source` — Drop a party source.
- `GET /api/kiosk/:slug/viewers` — Who is watching a kiosk.
- `GET /api/kiosk/:slug/shares` — Shares on that kiosk.
- `GET /api/kiosk/:slug/latest-share` — Newest share.
- `GET /api/policy` — Whether this browser has seen the current policy.
- `POST /api/policy/seen` — Mark it seen. Sets the client id cookie.
- `POST /api/support-report` — Send a support report.
- `POST /api/feature-requests` — File a feature request.
- `POST /api/landing/event` — Landing-page analytics event.
- `GET /api/qr` — QR image for a URL.
- `GET /api/help` — Help index.
- `GET /api/help/search` — Help search.
- `GET /api/youtube/oembed` — YouTube oEmbed for a chat embed.
- `GET /api/x/oembed` — X oEmbed for a chat embed.
- `GET /api/suno/resolve` — Resolve a Suno link for chat.
- `GET /api/blog/published` — Published posts for the public blog.

### Blog admin

Contributor session. Same handlers on www.

- `GET /api/blog/author-options` — Who can be listed as author.
- `GET /api/blog/posts` — Drafts and published posts.
- `GET /api/blog/posts/:id` — One post.
- `POST /api/blog/posts` — Create a post.
- `PATCH /api/blog/posts/:id` — Edit it.
- `DELETE /api/blog/posts/:id` — Delete it.
- `POST /api/blog/posts/:id/publish` — Publish.
- `POST /api/blog/posts/:id/unpublish` — Back to draft.
- `POST /api/blog/posts/:id/archive` — Archive.
- `GET /api/blog/posts/:id/tracked-url` — Campaign URL for a post.
- `GET /api/blog/campaigns` — Campaigns.
- `POST /api/blog/campaigns` — Create one.
- `PATCH /api/blog/campaigns/:id` — Edit one.
- `GET /api/blog/analytics/summary` — View totals.

### Admin

Admin session. The HTML admin pages are www-only. These JSON handlers are shared.

- `GET /api/admin/users` — User list.
- `GET /api/admin/users/:id` — One user.
- `PUT /api/admin/users/:id` — Edit a user.
- `DELETE /api/admin/users/:id` — Delete a user.
- `POST /api/admin/users/:id/grant-founder` — Gift Founder.
- `POST /api/admin/users/:id/revoke-founder` — Remove gifted Founder.
- `GET /api/admin/users/settings` — Admin user-list settings.
- `PATCH /api/admin/users/settings` — Save them.
- `GET /api/admin/tips` — Credit tips.
- `GET /api/todo` — Todo list.
- `POST /api/todo` — Add a todo.
- `PUT /api/todo` — Replace todos.
- `PATCH /api/todo` — Update one.
- `DELETE /api/todo` — Delete one.
- `GET /api/admin-tools/jobs` — Job rows.
- `GET /api/admin-tools/unhandled-requests` — API paths that 404, including misses on this host.
- `GET /api/admin-tools/try-failures` — Failed anonymous try rows.
- `GET /api/admin-tools/anonymous-users` — Anonymous client ids.
- `GET /api/admin-tools/anonymous-users/:cid` — One of them.
- `GET /api/admin-tools/transitions` — Creation transitions.
- `GET /api/admin-tools/related-settings` — Related-row settings.
- `PATCH /api/admin-tools/related-settings` — Save them.
- `GET /api/admin-tools/feed-editorial-pins` — Pinned feed items.
- `PATCH /api/admin-tools/feed-editorial-pins` — Edit pins.
- `POST /api/admin-tools/feed-editorial-pins/clear-expired` — Drop expired pins.
- `GET /api/admin-tools/servers` — All generation servers.
- `GET /api/admin-tools/servers/:id` — One server.
- `PUT /api/admin-tools/servers/:id` — Edit it.
- `GET /api/admin-tools/connect-threads` — Connect-channel threads.
- `DELETE /api/admin-tools/connect-threads/:id` — Remove one.
- `GET /api/admin-tools/share-views` — Share page views.
- `GET /api/admin-tools/try-requests` — Try-page requests.
- `GET /api/admin-tools/blog-views` — Blog views.
- `GET /api/admin-tools/email-sends` — Sent campaign mail.
- `GET /api/admin-tools/email-settings` — Digest windows and dry-run flags.
- `PATCH /api/admin-tools/email-settings` — Save them.
- `GET /api/admin-tools/email-recipients` — Who would receive the next send.
- `GET /api/admin-tools/email-templates` — Template names.
- `GET /api/admin-tools/email-templates/:templateName` — One template.
- `POST /api/admin-tools/email-templates/adminBroadcast/preview` — Preview a broadcast.
- `GET /api/admin-tools/broadcast-audience` — Who a broadcast would hit.
- `POST /api/admin-tools/send-test-email` — Send one test.
- `POST /api/admin-tools/send-broadcast` — Send the broadcast.
- `POST /api/admin-tools/run-notifications-cron` — Run the mail cron now, from the admin button. Does not go through QStash.
