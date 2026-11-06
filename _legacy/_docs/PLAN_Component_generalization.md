# Component generalization plan

This doc captures duplicated UI logic and a phased plan to generalize components across the app.

---

## 1. Duplication summary

### 1.1 Route media (image tiles)

**What:** Lazy-loading background images for `.route-media` tiles (creation thumbnails in grids).

**Duplicated in:**
- `public/components/routes/creations.js` – `setRouteMediaBackgroundImage`, `scheduleImageWork`
- `public/components/routes/explore.js` – same two functions (near-identical)
- `public/components/routes/feed.js` – `setRouteMediaBackgroundImage`, simpler `scheduleImageWork`
- `public/pages/user-profile.js` – `setRouteMediaBackgroundImage` (no `lowPriority`, no Promise)

**Impact:** Four copies of image-load + error handling; three copies of `scheduleImageWork`. Bug fixes and behavior changes (e.g. fetch priority, visibility) must be done in multiple places.

**Generalization:** ✅ Done. `public/shared/routeMedia.js` exports:
- `setRouteMediaBackgroundImage(mediaEl, url, { lowPriority } = {})`
- `scheduleImageWork(start, { immediate, wakeOnVisible } = {})`

Creations, explore, feed, and user-profile import from it.

---

### 1.2 Creation / image cards (route-card)

**What:** Card DOM structure: `.route-card.route-card-image` with `.route-media` + `.route-details` (title, summary, meta, author, optional badges).

**Duplicated in:**
- `public/components/routes/explore.js` – `appendExploreCards()` (title, summary, meta, author link, tags)
- `public/components/routes/creations.js` – `appendCreationCards()` (pending/creating/failed/completed, published badge, bulk overlay)
- `public/pages/creation-detail.js` – `appendRelatedCards()` (related grid, same shell)
- `public/pages/user-profile.js` – `appendImageGridCards()` (published/user-deleted badges, own IntersectionObserver)

**Impact:** Same DOM contract and CSS, but four separate implementations. Adding a new card state or attribute (e.g. aspect ratio, loading skeleton) requires edits in four places. Published badge markup and behavior repeated.

**Generalization options:**
- **Option A – Shared factory:** `public/shared/creationCard.js` (or `routeCard.js`) that builds one card DOM from a descriptor, e.g. `buildCreationCard({ item, status, showPublishedBadge, showBulkOverlay, onClick, ... })`. Each route calls it and appends; route-specific content (author line, tags, bulk overlay) passed as options or slots.
- **Option B – Shared template only:** One place that returns the HTML string for the card shell (media + details wrapper); callers fill in details content and handle click/observers. Less abstraction than Option A but still one source of structure.

Recommendation: start with Option B (shared template/shell) to avoid a big refactor; later evolve to Option A if more variants appear.

---

### 1.3 Empty states

**What:** `.route-empty` blocks: optional spinner, icon, title, message, and optional CTA button.

**Duplicated in:** Many files – creations, explore, feed, servers, todo, templates, user-profile, creation-detail, creation-edit – each building HTML like:
`<div class="route-empty ..."><div class="route-empty-title">...</div><div class="route-empty-message">...</div><a class="route-empty-button">...</a></div>` or loading variant with spinner.

**Impact:** Copy-paste of structure and class names; small wording or structure changes require many edits.

**Generalization:** One helper in e.g. `public/shared/emptyState.js`:
- `renderEmptyState({ loading, title, message, buttonText, buttonHref, buttonRoute, icon, className })`  
  Returns DOM or HTML string. Callers pass only the content they need.

---

### 1.4 Todo cards

**What:** Todo row DOM: `.todo-card` > `.todo-card-inner` > `.todo-card-header` (star, text, dial), etc.

**Duplicated in:**
- `public/components/routes/todo.js` – `renderTodoRows()` (full structure + star, dial, applyDialStyles)
- `public/pages/admin.js` – `renderTodoRows()` (same structure, no star, same dial)

**Impact:** Two almost-identical implementations; admin is a subset. Changes to todo card layout or behavior must be done twice.

**Generalization:** Shared `public/shared/todoCard.js` (or move into a small `<app-todo-card>` or shared render function) that builds one todo row from `{ item, writable, showStar }`. Both todo route and admin page call it.

---

### 1.5 Published / user-deleted badges

**What:** Small overlay badges on creation cards (globe = published, trash = user-deleted).

**Duplicated in:**
- **Markup:** `creations.js` (published), `user-profile.js` (published + user-deleted with inline SVG).
- **CSS:** `public/pages/creations.css` and `public/pages/user-profile.css` both define `.creation-published-badge` (and user-profile has `.creation-user-deleted-badge`).

**Impact:** Same badge look and behavior; CSS and SVG duplicated. Comment in user-profile says “shared with creations page” but code is not shared.

**Generalization:**
- Move `.creation-published-badge` and `.creation-user-deleted-badge` to `global.css` (used on multiple pages).
- Export small helpers or constants from e.g. `public/icons/svg-strings.js` or `public/shared/creationBadges.js`: `publishedBadgeHtml()`, `userDeletedBadgeHtml()` (or use existing icon helpers), and have creations + user-profile (and any future card) use them.

---

### 1.6 Comment / avatar blocks

**What:** Comment item layout: avatar (img or initial fallback with color) + user link + body + time.

**Duplicated in:**
- `public/pages/creation-detail.js` – comment and tip DOM with `.comment-avatar`, `.comment-item`
- `public/pages/user-profile.js` – `.user-profile-comment-avatar`, `.user-profile-comment-user-info`, etc.
- `public/components/routes/servers.js` – comment blocks with same avatar + link pattern

**Impact:** Same “avatar + name + content” pattern with slight class and structure differences. Avatar color/initial logic exists in shared `avatar.js` (getAvatarColor) but “render one comment row” or “render avatar DOM” is not shared.

**Generalization:** Optional shared helper, e.g. `renderCommentAvatar({ avatarUrl, displayName, color, href, ariaLabel })` returning DOM or HTML, and/or `renderCommentItem({ ... })` for the full row. Unify on one set of classes (e.g. `.comment-avatar`, `.comment-item`) and one CSS block in global.css.

---

### 1.7 User cards and list rows

**What:** User card (avatar + name + meta) and list row (avatar + name + optional follow/unfollow).

**Current:** `users.js` has `createUserAvatar()` and `renderUserCard()`. User-profile has `appendUserListItems()` with its own avatar + list markup (`.user-profile-list-avatar`, etc.). Admin may have similar patterns.

**Impact:** Two different “user row” UIs; avatar presentation and list styling could be unified so “user list” looks consistent (e.g. in Connect vs profile follows/following).

**Generalization:** Shared “user row” or “user card” builder that accepts user object + options (show follow button, link target, etc.) and uses shared avatar helper. Prefer one list style (e.g. `.user-list`, `.user-list-item`) in global.css and reuse on users route and user-profile.

---

## 2. Phased plan

| Phase | Scope | Deliverable |
|-------|--------|-------------|
| **1** | Route media | `shared/routeMedia.js`: `setRouteMediaBackgroundImage`, `scheduleImageWork`. Replace usages in creations, explore, feed, user-profile. |
| **2** | Empty states | `shared/emptyState.js`: `renderEmptyState({ loading, title, message, buttonText, buttonHref, ... })`. Replace inline empty HTML in routes and pages. |
| **3** | Badges + CSS | Published/user-deleted badge HTML helpers; move badge CSS to global.css; use helpers in creations + user-profile. |
| **4** | Creation card shell | `shared/creationCard.js` (or similar): build one card DOM/HTML from descriptor (item, status, options). Refactor explore, creations, creation-detail, user-profile to use it. |
| **5** | Todo card | Shared todo row builder; used by app-route-todo and admin. |
| **6** | Comments / avatars | Optional: shared comment-avatar and comment-item helpers; unify classes and CSS. |
| **7** | User list/card | Optional: shared user row/card builder; unify users route and user-profile (and admin if applicable). |

Phases 1–3 are low-risk and remove clear duplication. Phases 4–7 are larger refactors and can be done incrementally (e.g. one route at a time).

---

## 3. Principles

- **Single source of truth:** Each UI pattern (route media, empty state, creation card, todo row, badge) lives in one shared module or component; callers only pass data and options.
- **Consistent naming:** Prefer one set of class names and one place for their CSS (global.css for shared patterns; page CSS only for page-specific overrides).
- **Incremental adoption:** New shared modules should be used by new code first; existing call sites can be migrated route-by-route.
- **No big-bang rewrite:** Prefer small PRs: e.g. “add routeMedia.js and switch feed + user-profile,” then “switch creations,” then “switch explore.”

---

## 4. File layout (after generalization)

```
public/
  shared/
    routeMedia.js      # setRouteMediaBackgroundImage, scheduleImageWork
    emptyState.js      # renderEmptyState
    creationCard.js    # buildCreationCard (phase 4)
    creationBadges.js  # publishedBadgeHtml, userDeletedBadgeHtml (or in icons)
    todoCard.js        # buildTodoRow (phase 5)
    commentItem.js     # optional (phase 6)
    userCard.js        # optional (phase 7)
  ...
```

CSS: badge and any shared card/empty/list styles in `global.css`; page-specific overrides stay in page CSS.
