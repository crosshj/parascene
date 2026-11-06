# C2PA image signing

## What it is

- Coalition for Content Provenance and Authenticity
- Cryptographically signed manifest embedded in image/video file
- Viewers/tools read manifest: creator, edits, model/software, signature validity
- Provenance signal — not DRM; metadata can be stripped

## Current parascene state

- No C2PA implementation in repo today
- Images: `sharp` processing → PNG → `storage.uploadImage()`
- Main hook: `finalizeCreationJob` in `api_routes/utils/creationJob.js` (before upload)
- Share/watermark path: `api_routes/utils/vynlyShareWatermark.js` — sign after watermark if export-only

## Prerequisites

- Signer: cert + private key (prod) or test signer (dev)
- Library options:
  - `@contentauth/c2pa-node` — official CAI bindings (preferred; old `c2pa-node` deprecated)
  - `sign-ai-media` — higher-level wrapper for AI manifests
- Sign **last** — any `sharp` resize/composite/watermark re-encodes and **strips** C2PA

## Minimal flow (Node)

- `createTestSigner()` or prod signer
- `createC2pa({ signer, thumbnail: false })`
- `ManifestBuilder` with `claim_generator`, `format`, `title`, `assertions`
- `c2pa.sign({ asset: { buffer, mimeType }, manifest })`
- Upload `signedAsset.buffer` instead of raw buffer
- In-memory signing: JPEG + PNG only; other formats need file path

## AI-generated content assertions

- Use `c2pa.actions.v2`
- `action: 'c2pa.created'`
- `digitalSourceType`: `http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia`
- Optional in `parameters`: model, prompt, seed, etc.
- `stds.schema-org.CreativeWork` for author/creator name

## Production signing

- Real X.509 cert tied to org (CA / C2PA trust program)
- Private key in KMS/HSM or remote signing — not on disk in app
- `createC2pa({ signer: { type: 'local', certificate, privateKey, algorithm: 'es256', tsaUrl } })` or remote signer
- Trusted “Content Credentials” badge only when cert chains to recognized issuer

## Where to wire in parascene

- **At creation:** sign in `finalizeCreationJob` right before `storage.uploadImage()`
- **On export/share only:** sign after `applyVynlyShareWatermark`
- **On publish:** alternative if not every stored asset needs manifest
- Suggested module: `api_routes/utils/c2paSign.js`
- Env: cert paths / KMS config (`C2PA_CERT_PATH`, etc.)
- Optional: store manifest summary in `created_images.meta` for UI without re-reading file

## Verification (read side)

- `createC2pa()` (no signer needed)
- `c2pa.read({ buffer, mimeType })`
- Check `validation_status` — non-empty = broken/untrusted
- Inspect `active_manifest.assertions` for `c2pa.actions*`

## Caveats

- Sharp re-encode after sign → manifest gone
- Thumbnails (250×250): don’t sign; sign full image only
- JPEG vs PNG: both in-memory; JPEG smaller for signed exports
- Native bindings: prebuilt binaries; serverless may need extra config
- Backend serve path (`/api/images/created/*`) — pass through signed bytes unchanged

## Faster path for AI-only

- `sign-ai-media` CLI/API
- Flags: `--software-agent`, `--model`, `--prompt`, etc.
- Bundled test creds for dev; prod needs real signer

## Open design choice

- When to sign:
  - every stored image at creation
  - on publish only
  - download/share export only
