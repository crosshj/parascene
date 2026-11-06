# Parascene intelligence (v0)

Local tool that queries production Supabase and writes a paste-ready Markdown brief for an advanced LLM. The brief compresses **what the community has been trying to make recently** so a stronger model can propose one adjacent prompt without copying examples.

## Quick start

From repo root (requires `.env` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`):

```bash
node intelligence/run-brief.js
```

Default: last **7 days**. Output filename is auto-generated from the window, e.g. `.output/intelligence/parascene-brief-7d-2026-06-19_2026-06-26.md`.

```bash
node intelligence/run-brief.js --days 14
node intelligence/run-brief.js --output intelligence/my-brief.md
```

Each run queries Supabase live. Only the Markdown brief is written to disk.

## What it does

1. **Load** — `prsn_created_images` (published) + like/comment views, share page views, remix lineage
2. **Normalize** — consistent shape with attention metrics
3. **Window** — focus on past N days (default 7); rest is historical comparison
4. **Attention score** — `likes×1 + comments×4 + remixes×7 + shares×8`
5. **Text signals** — stopword-filtered terms and 2-word phrases from real prompts (`lib/text-signals.js`). No pre-labeled “creative moves.”
6. **Analyze** — frequent/rising terms and phrases, co-occurrences, low-engagement filler, example buckets
7. **Brief** — Markdown with LLM instructions + curated examples. The downstream LLM infers intent atoms.

## Inspect and tune

| File | Purpose |
|------|---------|
| `run-brief.js` | CLI entry |
| `lib/text-signals.js` | Term/phrase extraction — tune stopwords here |
| `lib/attention.js` | Engagement weights |
| `lib/analyze.js` | Rising atoms, example selection |
| `lib/render-brief.js` | Markdown template |

v0 is intentionally simple. Swap atom extraction or scoring in one place without touching the rest.

## Central question

> What has Parascene been trying to make over the past week, and what is one new prompt that feels strongly adjacent to that?

Paste the generated brief into your advanced LLM; it should return summary, moves, 15 scored candidates, top 3, and one final prompt (see brief header for full spec).
