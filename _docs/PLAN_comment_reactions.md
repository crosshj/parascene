# Plan: Comment reactions

MVP: allow users to add/remove emoji reactions on comments. Reactions are read everywhere comments appear; add/remove (read/write) is on the creation detail page only for MVP.

---

## 1. Where comments appear in the app

Use this list to ensure reactions are at least **read** everywhere comments are shown, and to scope **write** (add/remove) to creation detail for MVP.

### 1.1 Creation detail page (read + write for MVP)

- **File:** `public/pages/creation-detail.js`
- **Data:** `GET /api/created-images/:id/activity` → `items` (comments + tips interleaved). Each comment has `id`, `user_id`, `created_image_id`, `text`, `created_at`, profile fields.
- **UI:** Comment list (`[data-comment-list]`), `renderComments()`: each item is either `type: 'comment'` or `type: 'tip'`. Comment items use `.comment-item` (avatar, author, `.comment-text`, `.comment-time-row`). Tips use `.comment-item-tip` and do not get reactions.
- **Write:** Comment input (`[data-comment-input]`), `postCreatedImageComment()` from `public/shared/comments.js` → `POST /api/created-images/:id/comments`.
- **Reactions:** Add reaction row under each **comment** (not tip). Allow add/remove reaction here (primary R/W surface for MVP).

### 1.2 User profile – Comments tab (read-only for MVP)

- **File:** `public/pages/user-profile.js`
- **Data:** `GET /api/users/:id/comments` or `GET /api/users/by-username/:username/comments` → `comments` (list with creation context: `created_image_id`, `created_image_title`, creator/commenter profiles, `text`, `created_at`). Pagination via `limit`/`offset`, `has_more`.
- **UI:** Tab `data-id="comments"`, content in `[data-profile-comments]`. `renderCommentsList()` / `appendCommentsListItems()` build `.user-profile-comment-block` (thumb, creation title, creator, comment text, commenter + date). No per-comment `id` in the DOM today; API returns comment rows that can include `id` if we extend the response.
- **Reactions:** Show reaction counts (and optionally viewer’s reactions) on each comment block. No add/remove on profile for MVP (or link “View on creation” to do it there).

### 1.3 Connect (Servers) – Latest comments (read-only for MVP)

- **File:** `public/components/routes/servers.js`
- **Data:** `fetchLatestComments()` → `GET /api/comments/latest` → `comments` (each has `id`, `user_id`, `created_image_id`, `text`, `created_at`, profile and creation context including `created_image_title`, thumb, etc.).
- **UI:** `renderLatestComments(comments, container)`: each comment is a row (thumb, creation title, creator block, comment text, footer with commenter + time). No reaction UI today.
- **Reactions:** Show reaction counts (and optionally viewer’s reactions) on each comment row. No add/remove on Connect for MVP.

### 1.4 Notifications (read-only, no comment body)

- **Files:** `api_routes/utils/notificationResolver.js`, `api_routes/utils/notificationCollapse.js`, `public/components/modals/notifications.js`
- **Data:** Notifications of type `comment` / `comment_thread` (and creation activity). Resolved to a message and link (e.g. to creation); no comment body or reaction data in notification payload.
- **Reactions:** No change for MVP. Notifications continue to link to the creation; user sees reactions on the creation detail page.

### 1.5 Feed / explore / other (comment count only)

- **Files:** `api_routes/feed.js`, `api_routes/explore.js`, `api_routes/creations.js`, etc.
- **Data:** Creations list with `comment_count`; no per-comment data.
- **Reactions:** No change for MVP.

### 1.6 Create route – “Recent comments” (data only)

- **File:** `public/components/routes/create.js`, `api_routes/create.js`
- **Data:** “Recent comments” is an advanced option; comments are used as context for creation, not rendered as a list.
- **Reactions:** No change.

### 1.7 Admin / email / search

- Comments appear in admin templates, highlight emails, and search blobs (e.g. explore). No per-comment reaction UI needed for MVP.

---

## 2. Summary: read vs write

| Location                    | Comments shown?        | Show reactions (read)? | Add/remove reaction (write)? |
|----------------------------|------------------------|------------------------|-------------------------------|
| Creation detail            | Yes (list + post new)  | Yes                   | **Yes (MVP)**                 |
| User profile – Comments tab| Yes (list)             | Yes (MVP goal)        | No (MVP)                      |
| Connect – Latest comments  | Yes (list)             | Yes (MVP goal)        | No (MVP)                      |
| Notifications              | No (link only)         | No                    | No                            |
| Feed / explore / creations | Count only             | No                    | No                            |

---

## 3. Data model

### 3.1 New table: comment_reactions

- **Purpose:** One row per (comment, user, emoji_key). A user can add at most one reaction per emoji type per comment.
- **Columns (conceptual):**
  - `comment_id` (FK → `comments_created_image.id`)
  - `user_id` (FK → `users.id`)
  - `emoji_key` (e.g. `thumbsUp`, `heart`, `fire` — matches `REACTION_ICONS` in `public/icons/svg-strings.js`)
- **Unique constraint:** `(comment_id, user_id, emoji_key)` so one reaction per user per emoji per comment.
- **Indexes:** By `comment_id` (for aggregating counts and “viewer’s reactions” per comment). Optionally by `user_id` if we ever need “all reactions by user”.

### 3.2 Where comments come from (for joining reactions)

- **Activity (creation detail):** `selectCreatedImageComments.all(createdImageId, { order, limit, offset })` returns comments with `id`. Same query (or a wrapper) can be extended to include reaction aggregates and optionally viewer’s reactions.
- **Profile comments:** `selectCommentsByUser.all(userId, { limit, offset })` — ensure response includes comment `id` so we can attach reaction counts.
- **Latest comments:** `selectLatestCreatedImageComments.all({ limit })` — already returns comment `id`; can attach reaction counts in API.

---

## 4. API

### 4.1 Reaction endpoints

- **Add (or toggle) reaction:**  
  `POST /api/comments/:commentId/reactions`  
  Body: `{ "emoji_key": "thumbsUp" }`.  
  Ensure the comment exists and belongs to a creation the user can access (reuse same access as for comments: requireCreatedImageAccess via comment’s `created_image_id`). Idempotent: if already present, return success (or 200 with current state).
- **Remove reaction:**  
  `DELETE /api/comments/:commentId/reactions/:emojiKey`  
  Same access check. Return 204 or 200.

Alternatively, a single **toggle** endpoint: `POST /api/comments/:commentId/reactions` with `emoji_key`; if current user has that reaction, remove it; otherwise add it. Response body can include `{ added: true|false, count: N }` for the emoji on that comment.

### 4.2 Exposing reactions in existing comment payloads

- **GET /api/created-images/:id/activity**  
  For each item with `type: 'comment'`, include:
  - `reaction_counts`: `{ thumbsUp: 3, heart: 1, ... }` (all emoji keys with count &gt; 0, or all keys with 0).
  - Optionally `viewer_reactions`: `['thumbsUp']` so the UI can highlight “you reacted with …”.
- **GET /api/comments/latest**  
  Add the same `reaction_counts` (and optionally `viewer_reactions`) per comment.
- **GET /api/users/:id/comments** (and by-username variant)  
  Add `reaction_counts` (and optionally `viewer_reactions`) per comment. Ensure each comment in the response has `id` for consistency.

Implementation options: (1) extend the existing comment queries with JOINs/aggregates, or (2) run a separate “reactions for these comment ids” query and merge in the API layer. The latter is often easier and avoids heavy JOINs.

---

## 5. Frontend (creation detail – R/W)

- **Reaction bar:** Use a single row for timestamp + reactions (e.g. `.comment-meta-row` wrapping the time and the reaction strip). The timestamp stays as is; reactions sit in the same row (e.g. `.comment-reactions`), so the bar is not a separate block below. If the row wraps on narrow screens, the reactions can wrap as described in §5.1.
  - For each emoji in `REACTION_ICONS`, show the icon (from `public/icons/svg-strings.js`) and the count. If count is 0, still show the icon (and “0” or leave empty) so the user can add the first reaction.
  - On click: call add/remove (or toggle) API, then refresh activity or update local state so counts and “viewer reacted” state stay in sync.
- **State:** Keep `commentsState.activity` as source of truth; after a reaction API call, either refetch activity or patch the specific comment’s `reaction_counts` and `viewer_reactions` in memory and re-run `renderComments()`.
- **Tips:** Do not render reaction UI for items with `type: 'tip'`; only for `type: 'comment'`.
- **Accessibility:** Buttons/labels for “Add reaction thumbs up” / “Remove reaction thumbs up”, and show count to screen readers.

### 5.1 Alignment, responsiveness, and overflow

**Placement and alignment**

- Comment layout today: `.comment-item` is a grid `32px 1fr` (avatar | body). `.comment-body` holds author, text, and a row for time (`.comment-time-row`). Put the reaction bar **in the same horizontal row as the timestamp**: use a wrapper (e.g. `.comment-meta-row`) that contains both the time and `.comment-reactions`, so they sit on one line when space allows (time left, reactions after it, or time and reactions in a flex row). This keeps the “add reaction” control and existing reactions in the same visual band as the time. Left-align the row with the comment text; no extra indent.

**Responsiveness**

- The reaction row is a horizontal strip of N emoji (e.g. 15). Each item: icon (20px) + optional count + gap. At ~24–28px per item, 15 items ≈ 360–420px.
- **Narrow viewports (e.g. &lt; 400px comment-body width):** Allow the row to **wrap** with `flex-wrap: wrap` and a consistent gap (e.g. 4–6px). That way all emoji stay visible without horizontal scroll, and the bar grows downward slightly on small screens. Alternative: horizontal scroll (`overflow-x: auto`, `overflow-y: hidden`) with a subtle end fade to hint more content; wrap is usually simpler and avoids scroll confusion.
- **Recommendation:** Use `display: flex; flex-wrap: wrap; gap: 6px` (or 8px) on `.comment-reactions`. No `overflow: hidden` so a second row appears naturally when needed. Align wrapped rows to the start (`align-content: flex-start`) so the block doesn’t stretch vertically more than needed.

**Overflow situations**

- **Many emoji types:** With a fixed set (e.g. 15), wrap handles it. If the set grew, consider showing only emoji with `count > 0` first, then a “+” control to reveal the rest; for MVP, fixed set + wrap is enough.
- **Large counts:** Cap display so the bar doesn’t get huge (e.g. show “99+” or “999+” when count &gt; 99 or 999). Use a small, muted font for the count and keep the number element narrow so long counts don’t push the layout.
- **Many reactions on one comment:** If several emoji have high counts, the bar may wrap to two (or more) lines; that’s acceptable. Avoid horizontal scroll of the whole comment body; confine scroll (if any) to the reaction row only so the comment text doesn’t scroll sideways.
- **Read-only (profile / Connect):** Same alignment and wrap rules. If space is very tight (e.g. compact card), a single line with `overflow-x: auto` and a small scroll hint is an option, but wrap is still the preferred default so nothing is hidden.

**Mobile / limited horizontal space**

On narrow viewports (e.g. mobile), the comment body can be ~280px or less after the avatar column, so 15 emoji in one row won’t fit. Strategy:

1. **Default (MVP):** Use **wrap** as above. With ~24–28px per reaction chip (icon + gap), 5–7 emoji fit per line; 15 items become 2–3 lines. That’s acceptable: the meta row grows slightly and stays left-aligned. No content is hidden.
2. **Refinement if 3+ lines feel cramped:** Prefer **“compact first row”** on small screens only (e.g. `max-width: 480px` or 360px):
   - **First row:** Show only reaction types that have `count > 0` (so the bar is short when few types are used), plus the **“add reaction” smiley button** at the end. Order: timestamp, then used reactions (by fixed emoji order or by count desc), then smiley. That keeps the common case to a single row.
   - **Remaining emoji:** Either (a) wrap to a second line as today, or (b) hide zero-count emoji in the inline strip and show them only when the user taps the smiley (e.g. small popover/picker with all 15). Option (b) keeps the default to one row but adds one tap to reach unused emoji.
3. **Alternative:** One **scrollable row** (`overflow-x: auto`, `overflow-y: hidden`) with a subtle fade at the end so users know there’s more. Saves vertical space but hides emoji until scroll. Use only if wrap or the compact-first-row approach still feels too tall.

**Recommendation:** Ship MVP with wrap (1). If feedback says the reaction block is too tall on mobile, add the compact-first-row behavior (2) so the first line shows timestamp + used reactions + add button, with the rest wrapping or behind the smiley picker.

**Reaction order in the row**

- Use a **single fixed order** everywhere (creation detail, profile, Connect) so the bar is predictable and muscle-memory friendly.
- **Default order:** Match the key order in `REACTION_ICONS` (or define an explicit array, e.g. `REACTION_ORDER`, and iterate that when rendering). Recommended display order:  
  `thumbsUp`, `thumbsDown`, `heart`, `joy`, `grin`, `openMouth`, `sad`, `angry`, `clap`, `hundred`, `fire`, `thinking`, `eyes`, `rocket`, `pray`.
- **“Add reaction” button:** Place it **after** all emoji in the row (rightmost, or at the end of the first wrap line), so it reads as “add another” rather than interrupting the set.
- **Mobile “used first” refinement:** When showing only emoji with `count > 0` plus the add button, keep the **same fixed order** and simply omit zero-count emoji. So the row is a subset of the full bar in the same order, not re-sorted by count (re-sorting by count would make the bar jump as counts change).

---

## 6. Frontend (profile + Connect – read-only)

- **Profile Comments tab:** When rendering each `.user-profile-comment-block`, if the API includes `reaction_counts` (and optionally `viewer_reactions`), render a small reaction summary (e.g. icons + counts, no click to add). If comment `id` is missing in the current API, add it in the user API response first.
- **Connect latest comments:** Same idea in `renderLatestComments()`: for each comment row, if the payload has `reaction_counts` / `viewer_reactions`, show the same read-only reaction summary.

---

## 7. DB migrations

- **SQLite:** New table `comment_reactions` with `comment_id`, `user_id`, `emoji_key`, unique `(comment_id, user_id, emoji_key)`, index on `comment_id`. Migration file in project’s schema/migration location.
- **Supabase:** Same table (with `prsn_` prefix if applicable), same constraints and indexes. RLS: same as comments (no direct access; API uses service role).

---

## 8. Order of work (suggested)

1. **DB:** Add `comment_reactions` table (SQLite + Supabase) and migrations.
2. **API:** Implement add/remove (or toggle) reaction routes; enforce comment access via creation.
3. **API:** Add reaction aggregates (and viewer’s reactions) to activity, latest comments, and profile comments responses.
4. **Frontend – Creation detail:** Add reaction row to each comment in `renderComments()`, wire click to API, refresh or patch state.
5. **Frontend – Profile:** Extend profile comments API usage and render read-only reaction counts.
6. **Frontend – Connect:** Extend latest comments and render read-only reaction counts.

---

## 8b. Implementation notes (enough to implement)

- **API choice:** Implement the **single toggle** endpoint: `POST /api/comments/:commentId/reactions` with body `{ "emoji_key": "thumbsUp" }`. If the user already has that reaction, remove it; otherwise add it. Return e.g. `{ added: true|false, count: N }` for the emoji on that comment. One endpoint keeps the frontend simple (one call per click).
- **Reaction routes:** Add the new routes in the same router as comments: `api_routes/comments.js` (mounted via `createCommentsRoutes` in `api/index.js`).
- **reaction_counts shape:** Return **all** allowed emoji keys in `reaction_counts` every time (value `0` or the count). The frontend always renders the full ordered strip; zeros are fine. Use a shared allowlist (e.g. `REACTION_ORDER`) so the API and frontend stay in sync.
- **Validation:** In the reaction API, validate `emoji_key` against the allowlist and return `400` if invalid.
- **REACTION_ORDER:** Define an explicit array (e.g. in `public/icons/svg-strings.js` or a small shared constants module) with the 15 keys in display order. Use it when rendering the bar and when validating the API. Keeps order and allowlist in one place.
- **DOM (creation detail):** Replace the current standalone `.comment-time-row` with a wrapper: `.comment-meta-row` containing (1) the timestamp (e.g. `<span class="comment-time">` as today) and (2) `<div class="comment-reactions">` with the emoji strip + add-reaction smiley. So for each comment item: `.comment-body` → … → `.comment-meta-row` → time + `.comment-reactions`. Render the meta row even when there’s no timestamp (e.g. empty time + reactions only) so the bar always appears.
- **Shared fetch:** Add a function in `public/shared/comments.js` for the reaction API (e.g. `toggleCommentReaction(commentId, emojiKey)`) that returns the response so creation-detail can call it and then refetch activity or patch state.
- **CSS:** Put `.comment-meta-row`, `.comment-reactions`, and `.comment-reaction-icon` (20×20px) in `public/global.css` so creation detail, profile, and Connect share the same layout and sizing.
- **Add-reaction button:** `smileIcon` is already in `svg-strings.js`; use it for the “add reaction” control at the end of the strip. Style with a rounded background and `color: var(--text-muted)`.
- **Migrations:** Add the new table in the project’s usual place (e.g. `db/schemas/sqlite_02.sql` and Supabase equivalent, or the project’s migrations folder). Include unique `(comment_id, user_id, emoji_key)` and an index on `comment_id`.

---

## 9. Icons

Reaction emoji set is in `public/icons/svg-strings.js`: `REACTION_ICONS` (thumbsUp, thumbsDown, heart, joy, grin, openMouth, sad, angry, clap, hundred, fire, thinking, eyes, rocket, pray). Use these for both creation detail (R/W) and read-only surfaces. Test page: `public/test/icons-grid.html` (Reaction emojis section).

**“Add reaction” trigger (Discord-style):** The current set does not include a dedicated “add reaction” button icon (muted smiley in a rounded square). Options: (1) Add a **smiley** or **smile-plus** icon from Lucide or Phosphor to `svg-strings.js` and use it as the control that opens the reaction strip or picker; style the button with a rounded background and `color: var(--text-muted)` (or similar) so it reads as a subtle, inactive-looking trigger in both light and dark. (2) Use a small “+” or “add” icon if you prefer a more generic affordance. Recommendation: add a single smiley (or smile-plus) stroke icon and give the button a rounded-rect background so it visually echoes the Discord pattern without copying it.

---

## 10. Size, theme, and UX

### 10.1 Same size as other icons

- Reaction emojis should match the size of other UI icons across the site so they don’t look out of scale.
- **Reference:** Header and button icons use **20×20px** (e.g. `header .action-item .icon`, `.btn-secondary .icon` in `public/global.css`). Use the same size for reaction icons (e.g. a wrapper with `width: 20px; height: 20px` and `svg { width: 100%; height: 100%; }`).
- Twemoji SVGs use `viewBox="0 0 36 36"`; they scale correctly when the container is 20px. Apply a single class (e.g. `.comment-reaction-icon`) so all reaction emoji containers share the same dimensions in `global.css`, and use it on creation detail, profile, and Connect for consistency.

### 10.2 Light and dark mode

- The app supports `prefers-color-scheme: dark` and uses CSS variables (`--bg`, `--surface`, `--text`, `--text-muted`, `--border`, etc.) in `public/global.css`.
- **Reaction bar chrome:** Use theme-aware tokens for the reaction row (background, border, labels): e.g. `background: var(--surface)` or transparent, `color: var(--text-muted)`, `border-color: var(--border)`. Do not hardcode light-only colors so the bar works in both light and dark.
- **Emoji SVGs:** Twemoji use fixed fills (e.g. `#FFCC4D`, `#DD2E44`). Keep them as-is; full-color emoji read well on both light and dark. If the bar sits on a strong background, ensure sufficient contrast (e.g. avoid low-contrast borders that disappear in dark mode).
- **“You reacted” state:** If we highlight the viewer’s reaction (e.g. outline or background), use a theme-safe color (e.g. `var(--accent)` or a muted variant) so it works in both modes.

### 10.3 Other considerations

- **Emoji order:** Use a fixed order for the reaction strip (e.g. the order in `REACTION_ICONS` or a defined array) so the UI is consistent and predictable. Document in code or plan.
- **Touch targets:** On mobile, reaction buttons should meet a minimum tap size (e.g. 44×44px). Use a larger hit area (padding) with the 20px visual icon centered, so the icon stays consistent with desktop while remaining easy to tap.
- **Tooltips:** On hover/focus, show a short label (e.g. “Thumbs up” / “Add thumbs up” / “You and 2 others reacted with thumbs up”) to clarify meaning and count. Use `title` or a small tooltip component.
- **Keyboard:** Reaction buttons must be focusable and activatable with Enter/Space. Ensure the reaction bar doesn’t trap focus; tab order should be logical (e.g. left-to-right along emoji, then to next comment).
- **Reduce motion:** If the app or OS has `prefers-reduced-motion`, avoid flashy animations on add/remove (e.g. no large scale or long duration). Prefer instant or subtle feedback.
- **RTL:** If the app supports RTL later, the reaction row should flip (e.g. `flex-direction: row-reverse` when `[dir="rtl"]`).
- **Notifications (later):** A future enhancement could notify users when someone reacts to their comment (e.g. “X reacted with fire to your comment”). Not required for MVP; mention in backlog if useful.
