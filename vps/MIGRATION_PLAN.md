# VPS Media Upload Migration Plan

## Goal

Move browser media uploads off the Vercel application and onto the VPS behind
`cdn.parascene.com`, while preserving the upload contract already used by the
current frontend.

There will be one active upload path after cutover:

```text
www.parascene.com ──┐
                    ├─> https://cdn.parascene.com/api/images/generic
beta.parascene.com ─┘                         │
                                              ▼
                                     VPS streaming gateway
                                              │
                                              ▼
                                     Supabase Storage
```

Uploads must not pass through the Vercel application after cutover. The old
Vercel route may remain temporarily as a rollback target, but it is not a
second active upload path.

## Existing upload contract

The current browser helpers already centralize the main interactive upload
flows on `POST /api/images/generic`:

- `uploadImageFile()` covers generic and edited-image uploads;
- `uploadChatFile()` covers chat images, videos, and permitted miscellaneous
  files;
- callers send the file as the raw request body;
- `Content-Type`, `X-Upload-Kind`, `X-Upload-Name`, and optional
  `X-Upload-Aspect-Ratio` headers describe the upload;
- the success response contains `ok`, `key`, `max_bytes`, and `url`, with an
  optional `display_as_file` flag.

The first VPS implementation should preserve this request and response shape.
Changing the hostname in the centralized client should be the only required
change for existing upload producers.

The current maximum body size is 50 MiB. This fits within the initial
Cloudflare 100 MB request-body ceiling and should remain the initial VPS limit.

## VPS responsibilities

The VPS owns the complete upload transaction:

- authorize the request using the existing request identity;
- enforce account permissions, upload kinds, quotas, and size limits;
- validate content type and the supplied filename;
- generate safe, collision-resistant storage keys;
- stream the request body without buffering the entire file in memory;
- write the object to the appropriate Supabase Storage bucket;
- perform only transforms that are explicitly part of the existing contract;
- return a response compatible with current callers;
- emit structured logs and useful failure responses without exposing storage
  credentials or internals.

Supabase service credentials remain server-side. Browser clients must never
upload directly with service-role credentials.

## Streaming boundary

The current Vercel handler uses `express.raw()`, which buffers the complete body
before the route runs. The VPS route must instead consume the request as a
stream and apply backpressure through the storage write.

Any upload kind that requires a whole-file transform, such as edited-image
normalization or HEIC/TIFF/JXL conversion, needs an explicit strategy:

1. stream to bounded temporary storage, validate and transform, then upload;
2. move the transform to a separate post-upload step; or
3. keep that upload kind on the rollback route until its VPS implementation is
   ready.

The normal pass-through path must not be downgraded to whole-body buffering for
the convenience of the transform paths.

## Routing and CORS

Cloudflare and nginx route `cdn.parascene.com` to the VPS container. The upload
endpoint must:

- accept credentialed requests only from the approved Parascene origins;
- return the exact requesting approved origin, never `*`, with credentialed
  CORS responses;
- handle preflight requests for the custom upload headers;
- keep proxy and application body limits aligned at 50 MiB;
- use timeouts long enough for slow uploads without leaving unbounded idle
  connections;
- preserve streaming at every proxy layer by disabling request buffering where
  needed.

Media URLs returned by the endpoint should use the canonical CDN hostname or a
stable path that callers can safely resolve against it.

## Suggested implementation shape

```text
vps/
├── routes/
│   ├── uploads.js             Upload HTTP contract and orchestration
│   ├── media.js               Canonical media reads, if moved in this phase
│   ├── middleware/
│   │   ├── uploadCors.js      Approved origins and preflight behavior
│   │   └── uploadLimits.js    Size, timeout, and request guards
│   └── utils/
│       ├── storage.js         Supabase streaming/storage adapter
│       ├── uploadKeys.js      Safe object-key construction
│       └── uploadResponse.js  Compatibility response builder
├── nginx/                     Host, buffering, body-size, and timeout config
└── scripts/                   Upload smoke tests and deployment checks
```

Keep the implementation focused. Do not import the full Vercel application or
duplicate unrelated route trees to obtain upload behavior.

## Migration sequence

1. Freeze the current `/api/images/generic` request, response, permission, key,
   and error contracts with focused tests.
2. Inventory every caller of `uploadImageFile()` and `uploadChatFile()`, plus
   any raw upload routes that need to join this boundary.
3. Add the VPS storage adapter and streaming pass-through upload route.
4. Add limits, authorization, upload-kind handling, CORS, and structured
   logging.
5. Implement or explicitly defer the upload kinds that require transforms.
6. Add an end-to-end smoke test that uploads through the public
   `cdn.parascene.com` path and verifies the returned media URL.
7. Change the centralized frontend upload client to target the CDN hostname.
8. Verify generic images, edited images, chat images, video/file attachments,
   and all other inventoried producers.
9. Observe errors, latency, memory, bandwidth, and storage results during a
   limited rollout, then make the CDN route canonical.

## Acceptance criteria

- all inventoried browser upload producers use `cdn.parascene.com`;
- no active browser upload sends its body through Vercel;
- ordinary uploads are streamed end to end without whole-file memory buffers;
- the 50 MiB limit is enforced consistently by Cloudflare, nginx, and the app;
- current clients continue to understand successful and failed responses;
- permissions and storage-key ownership match current behavior;
- credentialed cross-origin requests work from approved Parascene hosts only;
- uploaded objects can be retrieved through their returned canonical URLs;
- logs make failed uploads diagnosable without recording secrets or file
  contents;
- rollback to the old endpoint is documented and tested before cutover.

## Deferred work

- resumable or multipart uploads above the initial proxy limit;
- background workers and durable media-processing jobs;
- migration of unrelated application routes to the VPS;
- broader CDN/share-host consolidation that is not required for upload
  correctness.

## Beta-first rollout

The rollout has two deliberate stages:

1. Build an authenticated upload workbench at
   `beta.parascene.com/upload-lab`.
2. Have that page upload directly to `https://cdn.parascene.com`, not to a
   beta-relative endpoint. This proves the real DNS, TLS, nginx, CORS, shared
   request identity, VPS streaming, Supabase Storage, retrieval, and deletion
   path.
3. Prove that an unchanged file larger than Vercel's request limit can complete
   through the CDN path.
4. Only after the beta path passes its cutover gates, repoint the centralized
   upload helpers used by `www.parascene.com`.

The beta workbench is not a disposable mock. Its upload request should exercise
the same public contract that `www` will eventually use.

## Upload discoverability and ownership

Generic uploads are currently storage objects plus returned URLs, not
first-class user-library records. Ownership is inferred from object keys such
as `profile/{userId}/generic_*`, and the object normally becomes discoverable
only when another record retains its URL. Examples include chat messages,
creation inputs, comments, and profile fields.

There is no application endpoint that lists all generic uploads belonging to a
user. Supabase can list objects under a prefix, but an object listing does not
provide the product metadata needed to answer whether an upload is ready,
attached, abandoned, retained, or safe to delete. Generic images and
miscellaneous files may also live in different buckets.

A standalone uploader must therefore not be fire-and-forget. Before enabling
it, add a minimal upload ledger, such as `prsn_media_uploads`, with fields
approximately like these:

- `id`;
- `user_id`;
- `bucket` and `object_key`;
- `original_name`;
- declared and detected content types;
- byte size and optional SHA-256;
- upload kind;
- lifecycle status such as `uploading`, `ready`, `failed`, `attached`, and
  `deleted`;
- source, such as `beta_upload_lab`;
- `created_at`, `updated_at`, and optional `expires_at`;
- optional attachment type and attachment ID.

The ledger, rather than a live Storage prefix scan, should become the
authoritative index for new uploads. A Storage scan can later backfill legacy
objects, but objects whose references cannot be reconstructed should be marked
with an unknown reference state rather than assumed to be either attached or
orphaned.

The upload lifecycle should be recoverable across the database and object
store boundary:

1. create an `uploading` ledger row before the transfer;
2. stream the object to Storage under a server-generated immutable key;
3. mark the row `ready` only after Storage confirms success;
4. compensate by deleting the object when finalization fails;
5. retain failed state long enough to diagnose it;
6. periodically reconcile incomplete rows and abandoned multipart uploads;
7. associate ready uploads with a chat message, creation, profile field, or
   other owning record when that record is committed.

For the beta workbench, uploads should either be explicitly temporary with a
documented expiration or remain visible until the user deletes them. They must
not disappear from the UI while silently continuing to consume storage.

## Beta upload workbench

The initial workbench should support:

- selecting a file without applying the current client-side image shrinker;
- displaying the exact target hostname and request metadata;
- upload progress and a request ID;
- recent-upload listing for the authenticated user;
- filename, size, type, status, creation time, and source display;
- preview or download through the CDN hostname;
- explicit deletion with confirmation;
- clear distinction between temporary, unattached, and attached objects;
- useful error details without exposing credentials or internal Storage
  responses.

The supporting API can retain the existing upload contract while adding
non-breaking metadata:

```text
POST   https://cdn.parascene.com/api/images/generic
GET    https://cdn.parascene.com/api/uploads
DELETE https://cdn.parascene.com/api/uploads/:id
GET    https://cdn.parascene.com/api/images/generic/:key
```

The upload response may preserve `ok`, `key`, `max_bytes`, `url`, and
`display_as_file` while adding `upload_id`, `cdn_url`, byte size, checksum, and
request ID.

Do not immediately replace the existing relative `url` with an absolute CDN
URL. Some current consumers parse `/api/images/generic/...` and reconstruct
relative delete requests. During beta, return both the compatibility path and
an absolute `cdn_url`; use the CDN URL in the workbench and audit every
consumer before changing the value used by `www`.

## Vercel-limit proof

The current browser helper recompresses supported raster images toward 3 MiB
before upload specifically to stay below edge limits. The beta workbench must
not call that preparation path for the proof, because doing so would hide the
behavior being tested.

Use a generated or otherwise non-sensitive 8–20 MiB JPEG or PNG for the first
controlled test. Send the same raw request shape to each target:

1. confirm that the equivalent `www` request is rejected with Vercel's expected
   `413` response;
2. confirm that the `cdn` request succeeds;
3. confirm that the ledger row reaches `ready`;
4. retrieve the object through the CDN hostname;
5. compare the returned byte count and SHA-256 with the original for a
   pass-through upload;
6. refresh or sign back in and confirm that the upload remains listed;
7. delete it and confirm that both the ledger and Storage object reflect the
   deletion.

Vercel currently documents a 4.5 MB request/response payload limit for
Functions:

`https://vercel.com/docs/functions/limitations`

Cloudflare currently documents a 100 MB maximum request body for Free and Pro
zones:

`https://developers.cloudflare.com/cache/concepts/default-cache-behavior/`

Do not begin with a file near every configured ceiling. A modest file above the
Vercel limit proves the routing objective while leaving headroom for proxy,
Storage, and timeout investigation.

## Infrastructure gates

The current environment already serves both `beta.parascene.com` and
`cdn.parascene.com` successfully through Cloudflare Full (strict), establishing
the DNS, TLS, and nginx path. Preserve these properties during deployment:

- TLS covers `cdn.parascene.com`;
- nginx has a matching `server_name` and routes the hostname to the container;
- Cloudflare proxying is in the intended mode;
- the public CDN hostname has an independent health check;
- deployment verification tests the CDN host as well as
  `beta.parascene.com`;
- nginx and the application enforce aligned byte limits;
- proxy request buffering is disabled for the streaming upload route;
- timeouts allow slow legitimate uploads without permitting unbounded idle
  connections.

The beta page must make a cross-origin request to the CDN hostname. A request
to `/api/...` on the beta origin would not prove the eventual CORS or hostname
routing behavior.

Because the upload uses custom headers, browsers will send a CORS preflight.
The CDN endpoint must return the exact approved requesting origin, allow
credentials, enumerate the accepted methods and headers, and never combine
credentialed requests with `Access-Control-Allow-Origin: *`. Mutating routes
must validate `Origin` independently of CORS response headers.

## Storage and streaming gates

The beta profile-file adapter passes the incoming Node stream to the Supabase
Storage client with half-duplex streaming enabled; Express does not parse or
buffer the file body. The live proof must still measure container memory while
the upload is in flight and verify that resident memory does not grow in
proportion to the file size.

Use a genuinely streaming Storage REST or S3-compatible implementation for
the pass-through path. Supabase recommends resumable uploads for files above
6 MB and documents S3 uploads as appropriate for server-side transfers where
speed is preferred over resumability:

- `https://supabase.com/docs/guides/storage/uploads/standard-uploads`
- `https://supabase.com/docs/guides/storage/uploads/s3-uploads`

Verify the actual Supabase project-wide and bucket-specific file limits before
choosing the application limit. Cloudflare, nginx, the application, and
Supabase must agree. In particular, the existing 50 MiB application constant
is 52,428,800 bytes and is not identical to a decimal 50 MB Storage limit.

Enforce limits using both an early `Content-Length` check when present and a
streaming byte counter. Do not trust the declared length, and abort the Storage
write if the observed byte count crosses the limit.

Transforms that require the whole file must remain separate from the ordinary
streaming path. The first proof should use a pass-through format. Edited-image
normalization and HEIC/TIFF/JXL conversion can use bounded temporary storage or
a later processing step, but they must not cause all uploads to be buffered in
memory.

## Retrieval and URL gates

An upload bypass is incomplete if the returned URL sends large downloads back
through Vercel. Relative `/api/images/generic/...` URLs resolve against the
page origin, so a relative URL rendered on `www` still reads through `www`.

The CDN must provide a retrieval route that streams from Storage and supports
HTTP range requests for video and audio. The current generic Storage read
converts the complete object into a buffer; do not carry that behavior into the
large-media CDN route.

During beta, use the absolute `cdn_url` for preview and download while
retaining the compatibility URL separately. Before the `www` cutover, update
URL recognizers, renderers, delete helpers, creation inputs, chat attachments,
comments, and other consumers so that absolute CDN URLs do not break ownership
checks or accidentally route deletions back through `www`.

## Security and product-policy gates

Define object visibility explicitly. Profile media, private chat attachments,
unpublished creation inputs, public creations, and temporary lab uploads do
not necessarily have the same read policy. A hard-to-guess object key is not an
authorization policy.

Do not serve arbitrary active content inline from a cookie-bearing
`*.parascene.com` origin. For the beta proof:

- use a conservative media-type allowlist;
- validate magic bytes rather than trusting only the supplied MIME type and
  extension;
- force risky types to download;
- return `X-Content-Type-Options: nosniff`;
- apply a restrictive Content Security Policy to media responses;
- reject or sanitize active SVG and HTML content;
- keep Supabase credentials server-side;
- generate object keys on the server with overwrite disabled;
- add per-user byte quotas and request rate limits;
- avoid logging file contents, cookies, authorization tokens, or service
  credentials;
- use idempotency keys so a client retry does not create duplicate objects.

The upload ledger should be accessed through the authenticated API and always
filtered by the requesting user. Do not expose service-role access or permit a
client to select an arbitrary bucket, owner prefix, or final object key.

## WWW cutover gate

Do not switch production uploads until a beta user can:

- upload an unchanged file larger than 4.5 MB through
  `cdn.parascene.com`;
- observe flat VPS memory during the transfer;
- see the upload in their list after refreshing or signing back in;
- retrieve it through the CDN without touching Vercel;
- delete it cleanly;
- receive correct behavior for unauthenticated, forbidden-origin, oversized,
  interrupted, retried, and failed-Storage requests.

After those conditions pass, switch the centralized `www` helpers behind a
reversible configuration or feature flag, begin with a limited cohort, and
observe error rate, latency, memory, bandwidth, orphan count, and Storage
results before making the CDN route universal.

## Current narrow beta proof

The immediate beta scope intentionally stops short of the full upload ledger,
media normalization, transcoding, resumable transfer, and `www` cutover:

- `POST /api/files?filename=...` accepts one raw request body, generates the
  final object ID on the server, and streams it into the authenticated user's
  `prsn_misc/profile/{userId}` prefix;
- the application rejects declared or observed bodies above 50 MiB and never
  places Supabase credentials in the browser;
- the original filename is retained as object metadata for display;
- `DELETE /api/files/:fileId` permanently removes only an object inside the
  authenticated user's prefix and is available from the Files page after an
  explicit confirmation;
- the beta UI exposes upload progress, refreshes the owner-scoped listing, and
  permits cleanup during repeated tests;
- CDN CORS permits the beta origin to use `POST` and `DELETE` in addition to
  listing and retrieval.

The live acceptance exercise should use a known-good, fast-start media file
approaching but not exceeding the configured 50 MiB boundary. Confirm upload,
listing after refresh, CDN retrieval/range behavior, container memory, and
hard deletion. The previously examined MP4 with an end-positioned `moov` atom
belongs to the later media-normalization scope and should not be used to judge
this transport proof.
