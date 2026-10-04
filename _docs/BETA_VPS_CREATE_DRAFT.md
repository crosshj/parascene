# Create provider contract

Reference for future editors/composers; remaining work lives in [Create review](BETA_VPS_CREATE_REVIEW.md).

## Ownership

- `providers/create/draft.js`: versioned `create-page-selections`, memory/storage,
  subscriptions, field merge and explicit image actions.
- `providers/create/model.js`: supported mode/field projections and ancestry.
- `providers/create/workflow.js`: edits, modes, uploads, validation, confirmations,
  submission, imports, Recreate and transient creation-under-edit context.
- `providers/create/transport.js`: API submission and pending tracking.
- Views render projections; controllers supply dialogs and mounted lifetime signals.
- Legacy settings/queue are compatibility mirrors, not independent form owners.

## State boundaries

| Action | Effect |
| --- | --- |
| Basic ↔ Advanced | Preserve full images/hidden fields; Basic uses first image |
| Select text-to-image / fresh Create | Clear images and edit context; keep other saved fields |
| Open Mutate | Replace images with resolved source and lineage |
| Pick/remove Basic image | Replace/remove first; retain remaining images |
| Edit Advanced image array | Explicit ordered replacement |
| Close | Keep saved draft; clear edit context |
| Accepted submission | Clear edit context; clear only unchanged submitted prompt |
| Failed/cancelled submission | Retain draft and edit context |
| Recreate | Restore recipe inputs/direct parents; clear old edit context; hand off to Advanced |

- Ordinary field/mode changes preserve omitted values; empty prompt, false and zero are edits.
- Editor mounting is not explicit text-to-image selection.
- Edit context retains exact Mutate URL, including group/source parameters, across editor switches.
- Refresh `/create` starts fresh; a Mutate URL establishes edit context from the route.
- Changed recipe inputs drop recipe ancestry; output is not automatically an input/parent.
- Late uploads/completions cannot overwrite newer selections, prompts or edit contexts.
- Cancellation before POST stops submission; accepted requests finish pending tracking.

Test command: `cd vps && npm run verify:create-draft`.

Architecture: [client contract](BETA_VPS_CLIENT_ARCHITECTURE.md).
Migration/cutover: [canonical guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md).
