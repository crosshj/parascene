# Plan: Blog analytics + campaign URLs

## Goals

- Admin can see **performance** for blog posts (page loads; scope and counting phases as below).
- **Campaign** traffic is tracked via **path** (no query params), with **short, unobtrusive** campaign ids.
- **Existing blog URLs keep working unchanged** — no breaking change for readers or SEO for normal links.

## Decisions already made

- **Count scope (v1):** Log **public article page loads only** (successful HTML render of a published post).
- **No `/c/` marker:** Campaign is **not** a reserved path segment. **Position + pattern** decide whether the first segment is a campaign id or part of the slug (see below).

## Canonical URLs vs campaign URLs

- **Normal URL (unchanged):** `GET /blog/{post-slug}` — single path segment after `/blog/` (slug may still contain `/` if your router passes a multi-segment path as one slug string — match existing behavior). This remains the **canonical** URL for SEO and default sharing.
- **Tracked URL:** `GET /blog/{campaignId}/{post-slug…}` — **extra** leading segment when the first segment looks like a **safe campaign token** and there is at least one more segment. Same post as `/blog/{post-slug}`, logs `campaignId`, canonical link points to `/blog/{post-slug}`.

**Marketing / outbound** links can stay plain `/blog/{slug}` or use arbitrary campaign tokens. **Source tracking (reserved ids):** use a small set of **reserved campaign ids** (same token rules: `a-z`, `0-9`, 1–12 chars) that mean “where the click was generated,” not a marketing name. Examples to standardize in code + registry:

- **`feed`** — user opened the post from the **in-app feed** (blog card).
- **`idx`** (or `index`) — user opened the post from the **blog index** (`/blog` post list / index page links).

Pre-create these rows in `blog_campaigns` with clear labels (“Feed”, “Blog index”) so reporting buckets them as **known** sources. Wire **href** generation so those surfaces link to `/blog/{sourceId}/{post-slug}` instead of bare `/blog/{slug}` when you want attribution (canonical still strips to `/blog/{slug}` for SEO).

Other internal entry points (e.g. notifications, profile) can get additional reserved ids later the same way.

## Path parsing (no `/c/` — position + safe token)

Split the path after `/blog/` into segments (by `/`).

1. **One segment** — No campaign. **Slug** = that segment (same as today).
2. **Two or more segments** — Let `head` = first segment, `tail` = remaining segments joined with `/`.
   - If `head` matches the **campaign token** rule (short length, safe charset only — e.g. lowercase alphanumeric, capped length), then **campaign** = `head`, **slug** = `tail`.
   - If `head` does **not** match the token rule, **no campaign**; **slug** = all segments joined with `/` (full path), so odd first segments do not hijack real nested slugs.
3. **Ambiguity / resolution:** If rule (2) assigns a campaign but **no published post** exists for `tail`, **fall back**: treat as **no campaign** and slug = full path (all segments joined). That limits breakage for rare slugs where the first piece accidentally looks like a campaign token.

Logged **campaign** on the view row is the token string, or null when no campaign. Unknown tokens stay **permissive** for reporting (registry optional).

## Short, unobtrusive campaign ids

- **Convention:** Prefer **short** tokens (`n`, `tw`, `q4`) so the tracked URL adds little: `/blog/n/my-post` vs `/blog/my-post`.
- **Safe token rule:** Define max length + allowed charset (e.g. `a-z`, `0-9`, length 1–12 — tune in implementation). Anything outside that is **not** a campaign; whole path is slug.
- **Permissive logging:** If the token matches the rule, log it even when not in the registry; admin shows **unknown** for unregistered ids.

## Campaign registry + UI (admin)

Purpose: **organize and name** campaigns and power **copy link** — **not** to gate whether a URL works.

- **Data:** Table or list: `id` (short code), optional `label` (human name: “Newsletter March”), optional `notes`, `created_at`, maybe `active` flag.
- **UI (admin):**
  - List **known** campaigns with aggregate view counts; **unknown** campaign strings appear separately or filtered (whatever rows were logged that don’t match a registry id).
  - **Create / rename / deactivate** known campaigns (id may be immutable after creation to avoid breaking old links).
  - **“Copy tracked link”** for a given post: builds `origin + /blog/{id}/{slug}` (first segment = registered campaign id, rest = post slug per parsing rules above).
- **Who:** Admin-only (same role gate as other blog admin tools).

## Counting model (recommendation)

- **Phase 1 — raw-only:** Store **one database row per page view** (every successful HTML response you choose to log). **No** “count this visitor only once” logic in v1 — if someone loads the post ten times, you get ten rows. That is what **raw** means: the raw event stream, not deduplicated uniques.
- **Phase 2 (optional):** Add **estimated uniques** (e.g. per cookie per day) or **daily rollups** if the table gets large or you want dashboard “unique readers” — separate from raw totals.

## Implementation sketch

- Table `blog_post_views`: `blog_post_id`, `viewed_at`, `campaign_id` (nullable string), `referer`, anon cookie ids, `meta` JSON.
- Route: parse segments after `/blog/` with the rules above; `resolvePublishedPost(slug)`; log on success; **canonical** link on response when campaign present.
- **Reserved source ids:** seed `blog_campaigns` for `feed`, `idx` (names TBD); update **feed blog card** and **blog index** link builders to use `/blog/{id}/{slug}` when source attribution is desired.
- Admin API + UI: stats + campaign CRUD + copy-link helper (see below).

## Where blog tracking appears in the UI (current)

- **Create → Blog tab** (all blog contributors): the post table includes a **Views** column (totals from `view_count` on `GET /api/blog/posts`). This is the only **in-app** analytics surface shipped so far.
- **Not** a separate admin analytics screen yet: **admin-only JSON APIs** exist for dashboards or future UI:
  - `GET /api/blog/analytics/summary` — totals, per-post and per-campaign breakdowns.
  - `GET/POST/PATCH /api/blog/campaigns` — campaign registry.
  - `GET /api/blog/posts/:id/tracked-url?campaign=…` — build a tracked URL.

A dedicated **admin** page (tables/charts for `byCampaign`, unknown campaigns, date range) is still optional follow-up; the plan assumed API-first.

## Resolved

- **Unknown campaign ids:** Permissive — always render the post, log the view with the campaign string as captured; in admin, classify as **unknown** (or show raw) when not in the registry.

## Open choices (small)

- Exact **max length** / charset for the campaign token (fixed in code; keeps paths safe and avoids ambiguity with slug-like first segments).
- Phase 2: whether you want **uniques** and at what granularity.
