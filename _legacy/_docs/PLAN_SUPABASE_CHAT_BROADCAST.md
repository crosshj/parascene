# Plan: Supabase chat broadcast (remaining)

Phases 1–4 are done. Background: [`supabase-chat-broadcast-guide.md`](./supabase-chat-broadcast-guide.md).

---

## Phase 5 — Delta fetch (optional)

Extend `GET /api/chat/threads/:threadId/messages` with `after` / `since` (or cursor) so `dirty` can trigger a **small** fetch instead of a full thread reload. Merge by message id so replays and debounce stay idempotent.

**Validate:** No duplicate rows if events replay; new messages appear without reloading the whole list.

---

## Sign-off

- [ ] **Realtime (Supabase dashboard):** “Allow public access” off; authenticated clients can subscribe, anon cannot.
- [ ] **Payloads:** Broadcast events never carry full message body; API + `prsn_chat_*` remain source of truth.
