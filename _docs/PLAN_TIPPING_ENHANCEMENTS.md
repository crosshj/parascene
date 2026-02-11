## Tipping enhancements plan

This document is the source of truth for the new tipping flow: tracking tips, inline tip activity on creation pages, and UI / API behavior.

### 1. Data model: `tip_activity` table

- **Table name**: `tip_activity`
- **Purpose**: log all tipping activity (from creation detail and admin tools).
- **Columns (logical schema)**:
  - `id` – primary key
  - `from_user_id` – FK → users (tipper)
  - `to_user_id` – FK → users (recipient)
  - `created_image_id` – nullable FK → `created_images`
    - Set for tips made from a creation detail page.
  - `amount` – numeric (1 decimal; use `double precision` / `REAL`)
  - `message` – nullable text (optional tip message, max ~500 chars)
  - `source` – nullable short text, e.g. `'creation' | 'admin'`
  - `meta` – JSON/JSONB (Supabase) or TEXT containing JSON (SQLite)
    - Reserved for future flags (client surface, campaign, experiments, etc.).
  - `created_at` – timestamp (default now)
  - `updated_at` – timestamp (optional, updated on edits if we ever add them)

- **Indexes**:
  - `to_user_id`
  - `created_image_id`
  - `created_at`

- **FKs**:
  - To **users** and **created_images** only.
  - **No FK to `feed_items`**:
    - `feed_items.created_image_id` already ties feed rows to creations.
    - When we need feed context for a tip we can `JOIN feed_items ON feed_items.created_image_id = tip_activity.created_image_id`.
    - Keeps the schema simpler and works even for tips not tied to a feed item (e.g. admin tips).

### 2. Tipping endpoint: `/api/credits/tip`

We extend the existing endpoint in `api_routes/user.js`:

- **Request body**:
  - `toUserId` (number, required)
  - `amount` (number, required)
  - `createdImageId` (number, optional)
  - `message` (string, optional)

- **Validation**:
  - Caller must be authenticated (`req.auth.userId`).
  - `toUserId` must be a positive integer and not equal to `fromUserId`.
  - `amount` must be a positive finite number; round to 1 decimal.
  - If `createdImageId` is provided:
    - Validate it is a positive integer and refers to an existing `created_images` row.
  - `message`:
    - Trimmed string.
    - If present and longer than e.g. 500 chars, reject with 400.

- **Behavior**:
  1. Load sender and recipient via `selectUserById`.
  2. Transfer credits via `queries.transferCredits.run(fromUserId, toUserId, amount)`:
     - Safely handles insufficient credits and “tip yourself” at the DB layer as well.
  3. Insert a row into `tip_activity`:
     - `from_user_id`, `to_user_id`, `created_image_id` (or `null`), `amount`, `message`, `source` (`'creation'` if `createdImageId` present, else `'admin'`), `meta` (optional).
  4. Best-effort notification:
     - Uses `insertNotification.run` if available.
     - Title: `"You received a tip"`.
     - Message: `"${tipperName} tipped you ${amount.toFixed(1)} credits."`.
     - **Link**:
       - If `createdImageId` present: `"/creations/<createdImageId>"`.
       - Otherwise: `null`.
  5. Response JSON:
     - `{ success: true, fromBalance, toBalance }`
       - Balances derived from `transferCredits` result, as today.

### 3. Activity endpoint: `/api/created-images/:id/activity`

We replace the per-creation comments endpoint with an activity endpoint that returns comments and tips in one ordered stream.

- **Route**: `GET /api/created-images/:id/activity` (in `api_routes/comments.js`).
- **Inputs**:
  - `:id` – `created_image_id`.
  - Query:
    - `order=asc|desc` (same semantics as current comments API; default `asc`).

- **Data loading**:
  - Load the creation to determine its owner:
    - e.g. via an existing `selectCreatedImageById` / similar query.
  - Load comments:
    - Use existing `selectCreatedImageComments.all(createdImageId, { order, limit, offset })`.
    - Preserve current comment row shape (including joined `user_profiles` fields).
  - Load tips:
    - New `selectCreatedImageTips.all(createdImageId, { order, limit, offset })` query against `tip_activity`, joining `user_profiles` so we get:
      - `user_id`, `user_name`, `display_name`, `avatar_url`, `created_at`, `amount`, `message`.

- **Visibility rules for tips**:
  - Determine viewer:
    - `viewerId = req.auth?.userId || null`.
    - `viewerRole` via `selectUserById` (or already available user row).
  - Only include a tip row if **any** of:
    - Viewer is the **creation owner**.
    - Viewer is the **tipper** (`from_user_id`).
    - Viewer is an **admin** (role == `'admin'`).

- **Response shape**:
  ```json
  {
    "items": [
      { "type": "comment", ...commentFields },
      { "type": "tip",     ...tipFields }
    ],
    "comment_count": 12
  }
  ```

  - `items` is sorted by `created_at` (ascending or descending based on `order`).
  - `comment_count` counts **only comments**, not tips (keeps semantics for counts stable).

- **Legacy `/comments` endpoint**:
  - The frontend will be updated to call `/activity` directly.
  - We can:
    - Either keep `/comments` as a thin wrapper, or
    - Remove it entirely once everything is migrated.

### 4. Frontend: creation detail page activity

File: `public/pages/creation-detail.js` (+ styles in `public/pages/creations.css`).

- **Data loading**:
  - Replace the existing comments fetch with:
    - `GET /api/created-images/:id/activity?order=asc|desc`.
  - Store the result in a state object, e.g.:
    - `activity: []`
    - `commentCount: number`

- **Rendering**:
  - Replace `renderComments()` with a renderer that iterates `activity` and switches on `item.type`:
    - `type === 'comment'`:
      - Render exactly as today (author avatar, name, handle, processed text, time-ago).
    - `type === 'tip'`:
      - Render a **tip activity row**:
        - Container: `.comment-item.comment-item-tip`.
        - Show:
          - Tipper avatar + name/handle.
          - A line like `"Tipped X.Y credits"`.
          - Optional message (processed via `processUserText`).
          - Time-ago row like comments.
      - These rows are visually distinct (background / label) but aligned with comment layout.
  - When `activity` is empty:
    - Show the existing “No comments yet” empty state (can be left as-is; activity will be empty when no comments and no visible tips).

- **Styling** (`creations.css`):
  - Add tip-specific variants:
    - `.comment-item-tip` – base styling for tip rows.
    - Optionally, elements like `.comment-tip-header`, `.comment-tip-amount`, `.comment-tip-message`.
  - Keep alignment and typography in the same family as comments so the list feels cohesive.

### 5. Frontend: Tip Creator button + modal

#### Button visibility (creation detail page)

- Show the **Tip Creator** button only when **all** are true:
  - Viewer is signed in.
  - Viewer is **not** the creator of the creation.
  - Creation is not a private share (current `shareMountedPrivate` logic).
  - Viewer’s credits are at or above a minimum threshold.

- Constants (defined at the top of the relevant JS file(s)):
  - `const TIP_MIN_VISIBLE_BALANCE = 10.0;`
    - If `currentUser.credits < TIP_MIN_VISIBLE_BALANCE`, do not render the tip button at all.
  - `const TIP_LARGE_AMOUNT_WARNING = 5.0;`
    - When the entered tip amount is `>= TIP_LARGE_AMOUNT_WARNING`, show a non-blocking warning in the modal.

- The creation detail page already loads the current user via `/api/profile`, which returns `credits`. Use this value for the visibility checks.

#### Modal: `app-modal-tip-creator`

- UI (in `public/components/modals/tip-creator.js`):
  - Title: **Tip Creator**
  - Body:
    - Recipient line: `"Send credits to <creator name/handle>"`
    - Amount input:
      - `type="number"`, `min="0.1"`, `step="0.1"`, required.
    - Optional **message textarea**:
      - Reasonable max length (client-side) matching backend limit.
      - Placeholder like `"Optional note to the creator (visible to them)"`.
    - Error area for validation / server errors.
  - Footer:
    - Cancel button.
    - Primary **Tip** button with loading state.

- Client-side logic:
  - When opened:
    - Modal receives `{ userId, userName }` and the current `createdImageId`.
    - Resets form, fills hidden `toUserId`, shows recipient name.
  - As the user types amount:
    - Show a hint like `"You’ll have X.Y credits left"` (using the locally known balance).
    - If `amount >= TIP_LARGE_AMOUNT_WARNING`, display a warning text (e.g. `"This is a large tip. Please confirm you're sure."`) but keep the Tip button enabled.
    - Disable the Tip button when:
      - Amount is invalid (empty, NaN, <= 0), or
      - Amount is greater than the viewer’s current credits (to avoid obvious failures).
  - On submit:
    - POST to `/api/credits/tip` with `{ toUserId, amount, message, createdImageId }`.
    - On success:
      - Close the modal.
      - Use `fromBalance` from the response to:
        - Dispatch `credits-updated` with `{ count: fromBalance }`.
        - Update `localStorage['credits-balance']` to keep nav / credits UI in sync.

### 6. Additional considerations

- **Rate limiting / safeguards** (future):
  - We can later add soft per-day or per-hour limits (e.g. total tips per day) on top of the existing balance-based protection.
  - This might be enforced in the `/api/credits/tip` route or in DB-level logic.

- **Analytics / reporting** (future):
  - With `tip_activity` in place, we can build:
    - Per-creation tip totals.
    - Per-user received/given totals.
    - Time-based aggregates.

- **Privacy options** (future):
  - Current plan: tip rows (including message) are visible in `/activity` only to the creator, the tipper, and admins.
  - We can later add user-level or creation-level settings to change how visible tip messages are (e.g. creator-only vs also visible to others).\n
