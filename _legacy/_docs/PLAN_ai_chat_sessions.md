# Plan: AI chat sessions

Someday architecture, not a build ticket. One assistant for all users: product help, creation/iteration, and general chat. ChatGPT-like sessions. Multiple images. Full thread persisted.

Job: talk, see attached creations, and later call existing create/mutate APIs. Does not replace human DMs, `/gen` in a group thread, or Blue as the image factory.

## Do not reuse

Human chat (`prsn_chat_threads` / `prsn_chat_messages`, [`src/chat/chatPage.js`](../src/chat/chatPage.js)) is DMs and channels. Images are URLs in body. Realtime is dirty-flag + refetch. `/gen` starts `POST /api/create` and pastes `/creations/:id` into a human thread.

Image/video gen is orchestration in this repo. Worker POSTs to a provider. Replicate here is CLIP embeddings, not chat. No LLM SDK. Blue is server id 6, all `async: true` GPU.

Do not store AI sessions as bot DMs. Do not send LLM tokens through the image provider contract (PNG bytes / 10s poll).

## Product

Workspaces, not a hashtag channel. Home in the chat shell: `/chat/ai`, `/chat/ai/:sessionId`. Sidebar next to DMs: new, search, rename, delete. Not mixed into `#feed`.

- Session: one titled conversation, one owner.
- Thread: `user` / `assistant` / `tool` messages, streamed.
- Images: first-class refs (`prsn_created_images` ids, optional generic uploads). A session can be about a set of stills/videos without stuffing URLs into prose.
- Actions (later): explain creation `meta`, rewrite prompts, start create/mutate on the existing job path, help docs, credits/servers.

Creations stay creations. The session is the durable object. Messages are the log plus structured refs.

## Where inference runs

All users means a cloud model. Browser-side (WebLLM, Chrome Prompt API, Transformers.js) fails that bar: big downloads, weak Safari/mobile, weak vision, weak tools. Optional later for cheap/private rewrite. Never the default.

Blue must not host chat. Tokens would fight Flux/WAN/LTX. Busy video would stall chat and starve gen. A local LLM, if ever, is a different box.

Vercel orchestrates: auth, credits, session CRUD, SSE in `/api/ai/...`. Vercel AI SDK / AI Gateway (or one OpenAI-compatible client) is the practical default. Chat turns usually fit the ~60s API. Image gen stays QStash + `runCreationJob`. The assistant starts a job and keeps talking; client polls like `/gen`. No GPU work inside the chat request.

Replicate LLM is an optional provider behind the same interface (`REPLICATE_API_TOKEN` already exists). Worse default for streaming and tools. Image Replicate stays on parascene-provider.

Default: Vercel routes + hosted chat/vision model. Replicate optional. Blue never. Browser later.

## Data

New tables, not `prsn_chat_*`.

- `prsn_ai_sessions` — `user_id`, title, timestamps, `meta`
- `prsn_ai_messages` — `session_id`, `role`, `body`, `meta` (tools, usage)
- `prsn_ai_session_assets` — `session_id`, `created_image_id` and/or generic path

Reuse `/api/images/created/...`. Persist every turn server-side (refresh, mobile, another device).

Meter chat cheaply (per turn or per 1k tokens). Create/mutate keep existing creation costs and refunds.

## What it enables

- Workbench around a pile of images: pin stills, iterate prompts, pick a hero, mutate without leaving the thread.
- Vision using real `meta` (server, method, args), not a generic chatbot that cannot see your files.
- Talk on Vercel while heavy jobs hit Blue / Replicate providers. In-flight creations show in the thread like the rest of the app.
- In-product help grounded in the account: failed jobs, private channels, credit balance.
- General chat in the same sessions UI when nothing is attached.
- Room to add tools later (search creations, challenge config, canvases) without dumping an agent into human DMs.

## Phases

1. Sessions + cloud text. Sidebar, persist, stream, credits. No tools.
2. Attach creations. Vision. Session asset list. Explain this creation.
3. Tools. `create` / `mutate` via existing APIs. Job status in the thread.
4. Optional local model (browser or non-Blue box). Same session schema.

Constraints: do not send private-channel ciphertext to the model. Do not put other people’s unpublished creations in context. Rate-limit and credit-gate so chat cannot stall QStash or Blue.
