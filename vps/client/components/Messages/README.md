# Shared thread messages

Channel and DirectMessage each mount a controller and the same Messages component.
ConversationController resolves an existing thread from the inbox, acquires its
message query, and releases the lease when the route unmounts. Rendering and scroll
position belong to Messages; the threads provider owns API calls and query state.

Reference: the active WWW `src/chat/chatPage.js` message row builders, grouping
window, pagination, and bottom-following behavior. `MessageRow.js` ports the active
WWW builders, including their nested metadata, bubble, footer, and sibling hover
toolbar. The stream is the same `div.chat-page-messages[data-chat-messages]` with
direct message rows, history sentinel, empty hint, and loading skeleton. The stream
itself owns scrolling; there is no extra list wrapper.

Fixed markup lives beside its owner in `Messages.html`, `MessageRow.html`,
`Reactions.html`, and `Composer.html`. Their native templates are parsed once per
document and cloned per instance through `createTemplateFactory`. Template IDs
stay in the detached template collection and are absent from mounted messages.
JavaScript binds data, conditional controls, sanitized message content, and
events. Realtime updates retain existing rows and patch reaction footers rather
than cloning the entire stream.

`Messages.css` retains all 601 relevant rules from `public/global.css`,
`public/pages/chat.css`, and `public/pages/chat-hotfix.css`, in that cascade order,
including media queries, markdown lists, rich embeds, replies, reactions, unread
bands, and animation keyframes. `MessagesLayout.css` adapts the viewport to the
beta header and composer; route chrome remains owned by the beta layout.
Row resize observation preserves the scroll anchor as media loads. History uses
the WWW sentinel and preload distance. Reply selection and unread clearing use
the WWW classes, and floating reaction tooltips release their listeners on teardown.

The current checkpoint loads existing conversations and older history, sends
text messages with pending/failed rows and retries, and acknowledges the visible
latest message. Both route controllers use the shared shell composer binding.
Private sends encrypt their body before posting. The backend broadcasts room and
inbox invalidation hints; the provider subscribes through a private Supabase
session bridged from cookie authentication. User subscriptions last for the
provider lifetime; room subscriptions are shared by message-query leases and
removed on the final release. Reconnects, network recovery, and returning to the
tab refetch authoritative data while retaining loaded history and scroll state.
Inline editing uses the shared message component and threads provider, preserves
the draft during realtime updates, and displays save errors without discarding
text. The backend requires membership and sender/admin permission, records edit
metadata, and broadcasts invalidation. Private edits encrypt before posting;
special challenge, canvas, and system messages require their dedicated editors.
Replies use the existing shared compact citation builder and a dismissible
composer strip. The controller retains reply metadata through optimistic sends
and retries. The backend validates the same-thread parent and stamps author and
preview fields from stored data (including decrypted private bodies). History
checks whether referenced parents still exist. Clicking a citation loads older
pages as needed and jumps to the original; unmount aborts this history work.
Both loaded and newly fetched reply targets use the shared scroll controller.
It pauses anchor restoration during the jump, adopts the destination after
scrolling settles, and then highlights the target. Reader input cancels the
jump; unmount cancels its frames, timers, and listeners.
The composer reports its height so the latest message remains above the reply
strip and growing textarea. The pure preview formatter is shared by client and
server under `vps/shared/`.
Reactions share WWW icon keys, pill markup, and picker layout. The picker supports
keyboard navigation, Escape, and outside dismissal, and is removed on unmount.
Counts, voter name previews, and the viewer's selection come from the API. Pending
requests disable repeated clicks; failures display beside the reaction pills.
The API checks membership and uses a JSON comparison with bounded retries so
concurrent voters cannot overwrite each other. Profile reads happen before the
write, and room invalidation follows a successful write. Challenge reaction
writes remain with their dedicated domain controls; their counts stay anonymous.
Reaction-only changes patch the footer, preserving embeds and inline edit drafts.
Realtime refreshes fetch the currently loaded history range, so reactions and
edits on older pages also update. This can require multiple page requests after
loading a long history; room invalidations remain debounced and serialized.
The hover toolbar supports copying and authorized deletion; deletion broadcasts
invalidation and marks references to removed parents unavailable. The shared
composer supports replies, pasted or selected file attachments, upload previews,
and optimistic text-plus-attachment sends. Pins, dedicated canvas and invitation
controls remain part of the larger threads port. Missing conversations are
shown explicitly until thread creation is ported. The existing mock server roster
is excluded from the real inbox until the server directory is ported.

Realtime requires `SUPABASE_ANON_KEY` in the VPS environment, alongside the
existing Supabase URL, service key, and session secret. The deployment workflow
accepts the anon key as a repository secret or variable. No credentials are
included in the browser build; the authenticated session endpoint supplies the
public SDK configuration and the viewer's session tokens.

## Presentation verification

Run `npm run verify:messages` from `vps/` in the full repository checkout. This
development check compares 19 message DOM fixtures against the current WWW
builders, checks mounted stream structure and interaction wiring, and compares
every retained CSS rule, declaration, and media condition in source order. It uses
the same message body formatter as WWW and checks full animation declarations,
text whitespace, and independent template clones. It uses
Node VM modules and the development dependencies jsdom, acorn, and postcss. These
reference reads are confined to verification; production remains self-contained
under `vps/`. The check establishes source and DOM parity, not screenshot parity.

## Rich message hydration

The shared WWW `hydrateRichUserTextEmbeds` pass runs on mounted message rows,
including replacements after inline edit cancellation. It retains image loading
states, consecutive media groups, YouTube and Suno players, creation previews,
inline video controls, and asynchronous link metadata. VPS owns the matching
YouTube, Suno, and X metadata routes and the Suno/audio iframe card documents.
Reaction updates retain hydrated bodies. Verification covers asynchronous rich
DOM against the WWW builder, image grouping/loading, and edit restoration.

Unpublished creation share-token access is still missing from the VPS creation
API; ordinary viewer-accessible creation previews work, but token-only shares
cannot yet be considered WWW parity. Browser appearance still requires visual
verification.
