# Grouped creations as first-class generation inputs

Status: architecture recommendation and implementation guide, 2026-11-07. An initial vertical slice is implemented in the current workspace; full acceptance remains open.

## Implementation checkpoint

The current workspace has version 3 draft inputs, typed submission bindings, a server resolver for live creation-pointer members, independent `destination_group_id`, stored `meta.input_recipe`, browse carousel selection handoff, drag selection snapshots, typed queue entries, and Recreate restoration for new recipes. Captured video frames retain their uploaded still artifact and validated parent provenance. Archived v1 snapshot members with an available storage artifact are copied to a provider-fetchable edited image after group authorization; missing artifacts fail explicitly. Local v2 pointers remain unsupported. The 76-test Create draft suite, mounted card tests, an HTTP `/api/create` admission test, sessionless share-route byte test, headless Chrome card-selection/drag test, and client build pass.

Release acceptance is **not yet met**. Remaining work includes authenticated browser and real-device checks of detail/composer/mobile selection. The new Create workflow derives submitted lineage only from typed consumed inputs; URL keyed queue and image-source fields remain as compatibility projections for older callers and historical data. Old recipes with one unambiguous parent adapt to typed inputs; an ambiguous multi-parent recipe asks for reselection before editing instead of sending unverifiable ancestry. The audit verification limits at the end of this document describe the earlier planning pass; the checkpoint here describes subsequent implementation work.

The full `test/feed-mounted.test.js` run has one unrelated existing Doom comments CSS assertion failure; the two new grouped-card tests pass in the mounted suite and the headless Chrome fixture. The live authenticated Beta path and a physical mobile device are not available in this workspace. They must be checked before production release; fixture tests do not claim to replace that review.

WWW source mapping for the card slice: `_legacy/public/shared/feedCardBuild.js` builds `.feed-card-image > .feed-card-group-stack > .feed-card-group-img` plus sibling arrow buttons; `_legacy/src/chat/chatPage.js` delegates group-media clicks to detail navigation. `_legacy/public/global.css` owns the stack/nav positioning and mobile touch action. VPS retains that DOM and CSS structure in `client/shared/feedCardBuild.js` and existing feature CSS; the added state is the selected member ID/URL on the card, which is passed through detail navigation and drag. No shell, scroller, or responsive geometry changed. Matching browser screenshots remain outstanding.

## Recommendation

Extend the existing Create provider with **ordered, typed input records that retain the selected group member's identity from selection through job execution and Recreate**. Resolve and authorize each input on the server. Keep source membership, recipe provenance, and output destination separate.

Do this as a bounded change to the existing controller-based SPA and Create workflow. Keep the shared retained draft, explicit image actions, editor projections, router ownership, and pending-job machinery. Replace the URL-based identity and group-context propagation inside those boundaries. Adding another `groupId` fallback to every surface will not close the problem.

The governing rule is:

> The item visibly selected when an action is invoked is the item recorded in the draft, shown in its preview, resolved by the server, supplied to the provider, and recorded in the new creation's input recipe.

Group cover, carousel position, display URL, access context, and output destination are different concepts. None may silently stand in for another.

## Scope and constraints

Cover Mutate/image edit, image-to-video from a still, queue-for-later, Basic/Advanced switches, Advanced generation, the creation composer (including drag/drop, removal and reordering), Recreate of a mutation, and Recreate of a selected grouped output. Include deep links, reload, history, group changes and delayed requests.

Implementation belongs in `client/`, `server/`, `shared/`, and `test/`. No writes to `_legacy`, no runtime imports from it, and no legacy improvements. This audit used current root code and local Git history; inspecting `_legacy` was unnecessary. Before a later UI port, map the active WWW SPA references read-only as required by the [migration guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md). Follow the [client architecture](BETA_VPS_CLIENT_ARCHITECTURE.md), [Create draft contract](BETA_VPS_CLIENT_DATA_AND_STATE.md#create-provider-draft-contract), and [mobile contract](BETA_VPS_MOBILE_PARITY.md). This plan does not authorize a shell or desktop scrolling redesign.

## What the current code establishes

Recent commits `30b90630` ("issues with mutate from grouped image") and `44bdded2` ("grouped image mutate issues") spread group context across model, queue, sync, composer, drag, Mutate, detail and transport. These are useful repairs, but their breadth reflects a missing shared input contract.

| Evidence in current code | Finding and consequence |
| --- | --- |
| [Detail selection and actions](../client/views/CreationDetail/CreationDetailView.js): `setActiveGroupSource`, `getGroupActionTarget`, Mutate click handler | Detail arrows/thumbs update `lastGroupSelectedSourceId`; Mutate reads it and opens `/creations/{group}/mutate?source_id={member}`. This path is already group-aware. Do not claim it always uses the cover. Selection is nevertheless split between local selection, module state, source maps and cached seeds, without an end-to-end assertion. |
| [Browse carousel](../client/shared/feedCardBuild.js): `setupFeedCardGroupCarousel`; [drag](../client/shared/creationComposerDrag.js): `attachFeedCardCreationDragSource` | Browse carousel changes `.is-active` locally; it exposes no selected-member contract. Drag captures `creationId` and `imageUrl` before `dragstart`, from card attributes. It cannot reliably represent a newly selected member. |
| [Detail initialization](../client/views/CreationDetail/CreationDetailView.js): cover-first source ordering and `setActiveGroupSource(groupSources[0].id, ...)` | Detail initializes from the cover. Browse-to-detail selection needs an explicit handoff if the user is to continue working on the image they just selected. |
| [Seed conversion](../client/shared/creationDetailSeed.js): `seedToMutateCreation`; [Mutate loading](../client/views/Create/MutateCreate.js) | Matching `mutate_source_id` protects against some wrong-member seeds. But the conversion substitutes the member ID/URL while retaining group seed metadata, geometry, title and status. A seed can satisfy Mutate loading without a source API read. Fast preview and authoritative source resolution need separate contracts. |
| [Draft/model](../client/providers/create/draft.js), [lineage](../client/providers/create/model.js): `createSourceChange`, `deriveCreateLineage` | Inputs are URL strings; provenance is a map keyed by URL. Multiple group contexts collapse into one `mutateGroupId` only if exactly one unique group exists. This cannot express authorization per input across groups or distinguish two identities sharing a URL. |
| [Composer](../client/components/CreateComposer/CreateComposer.js): `attachmentItems`, `attachmentMutateSourceIds`, `attachmentMutateGroupIds`, `getMutateLineageForSubmit` | Identity is maintained in parallel arrays, queue hydration and editor-specific lineage. Correctness depends on every mutation keeping those structures aligned. |
| [Workflow](../client/providers/create/workflow.js): `run`; [queue sync](../client/shared/mutateQueueSync.js) | The shared workflow is a good foundation, including immutable submission snapshots and stale-completion protection. But lineage can come from queue URL matching, draft derivation and explicit intent fields; intent is spread after derived lineage. The same fact has multiple writers. |
| [Recreate](../client/views/CreationDetail/CreationDetailView.js): `handleRecreateInAdvanced`; [recipe restoration](../client/shared/mutateQueueSync.js): `syncCreationDetailToAdvancedCreate` | Recreate correctly restores recipe inputs rather than attaching the output. However, group context is taken from the grouped output currently viewed, not from each recipe input. Missing selected-member metadata can leave group metadata as the fallback recipe. |
| [Lineage derivation](../client/providers/create/model.js): `deriveCreateLineage` | Recipe parent IDs are gated on matching the recipe image set; recipe group IDs are added independently of that match. Partial recipe edits therefore need explicit provenance handling, not another URL comparison. |
| [Create route](../server/routes/create.js): `POST /api/create`; [group operations](../server/services/create/groupV2Ops.js): `resolveOwnedGroupV2Id` | The same request `group_id` is checked as an owned v2 output destination, used later as source-access fallback, and used to append the result. A foreign published v2 source group can fail the destination ownership check before source resolution. An owned v2 source group can cause output insertion just because source context was forwarded. These are code-path consequences; live incidence was not measured. |
| [Source resolver](../server/routes/create.js): `buildGroupMutateSourcePayload`, single/multi-parent branches, URL rewrites | Source resolution blends snapshots and live rows; different branches have different group-access behavior. Multiple parent IDs are merged into lineage without resolving each through the same authorization procedure. There is no binding from each provider field/slot to its authorized source record. |
| [Group v2](../server/services/create/groupV2.js): `normalizeItem`, `costumeGroupV2Meta` | Native items already have IDs and creation/local pointers. The compatibility projection emits `group_creations` snapshots for creation pointers and omits local pointers. Build adapters around native identities; do not make this display projection the new generation authority. Preserve capability restrictions, especially projects with remix disabled. |

These are static findings. They justify the architecture change; they do not establish that every reported symptom has one cause.

Existing tests cover grouped handoff and retention, including `test/create-draft-editors.test.js` and `test/create-draft-transport.test.js`. They do not establish carousel → selected identity → server authorization → provider bytes. The transport test explicitly expects `group_id`, so a passing test currently preserves the overloaded contract.

## Alternatives considered

| Option | Benefit | Cost/risk | Decision |
| --- | --- | --- | --- |
| A. Continue propagating `groupId` through existing URL/queue structures | Small immediate diffs | Every new surface or provider can lose context again; mixed groups and recipe replay remain ambiguous | Only suitable for a contained urgent fix backed by a failing regression test |
| B. Typed inputs in the existing Create domain, one server resolver and durable input recipes | Fits existing architecture; fixes identity, authorization, ordering and replay together; can ship incrementally | Requires versioned draft/API/recipe migration and mounted/browser tests | **Recommended** |
| C. Normalize all groups, assets and recipes into new relational tables first | Strong long-term constraints and asset revision history | Broad data migration and cutover; delays this repair and still requires selection/UI work | Revisit if asset lifecycle or query needs justify it; not a prerequisite |

Option B should use durable media identifiers where available. It must not invent permanent blob IDs before auditing storage identity. Start with a versioned metadata recipe and current creation/group pointers; add tables later without changing the input semantics.

## Proposed domain contract

Define serializable schemas and pure validation in `shared/creationInputs.js` (proposed). Client and server may both import `shared/`; the server must never import `client/`.

An input attachment is one record. Sketch, not finalized API syntax:

```js
{
  id: 'draft-attachment-uuid',
  source: {
    kind: 'group-member',
    groupId: 72,
    member: { kind: 'creation', creationId: 91 },
    itemId: 'creation:91' // native v2 item ID when available
  },
  media: { kind: 'image', revision: 'server-defined-revision' },
  preview: { url: '/display-only-url', width: 1024, height: 768 }
}
```

Source variants: `creation`, `group-member`, `upload`, `external-image`, and a derived still/frame referencing its uploaded artifact plus provenance. A frame is the artifact consumed, not its parent's default image. For native local pointers, preserve `{ libraryId, assetId }`; enable them only when server resolution and group capabilities support them. Otherwise return an explicit unsupported-source state. Old `group_creations` members adapt to `{ groupId, creationId }` without fabricating v2 item IDs.

The preview is disposable presentation data. A thumbnail, blur URL, CDN host, share token, index or group cover is never the identity. Resolve known internal URLs through a compatibility adapter, not as arbitrary external sources that bypass access checks.

The retained draft owns `inputs: InputAttachment[]`, a schema version, and provider field bindings such as:

```js
inputBindings: [
  { field: 'input_images', attachmentIds: ['attachment-a', 'attachment-b'] }
]
```

The binding list preserves field and slot order. Scalar image fields bind exactly one attachment. Different image fields may intentionally bind different inputs. Provider schema projection determines which bindings are consumed; a hidden retained input is not automatically submitted or credited as a parent. Basic consumes the first compatible input while preserving the rest, as the current draft contract requires.

Also distinguish:

| Concept | Meaning |
| --- | --- |
| `source.groupId` on each input | Container through which this member was selected and may be authorized |
| `recreateOf` | Output/member whose recipe was copied; informational provenance, not automatically a direct parent |
| `destinationGroupId` | Explicit request to insert the new output into an owned, supported group |
| Validated direct parents | Creation sources of the inputs actually consumed by this submission |

Source selection must never set `destinationGroupId` as a side effect. Preserve a destination explicitly chosen by an existing project workflow, but show it separately and validate its write permission independently.

## Selection and visible confidence

1. Each mounted card/detail controller owns a selected member identity. The carousel emits/selects that identity; the controller renders both media and action state from it. Ordinal position is derived presentation only.
2. Arrows, thumbnails, keyboard navigation, swipe/playlist changes and browse-to-detail navigation use the same selection action. Group reorder/cover changes retain the selected identity if still present. Removal invalidates the selection; it never silently selects another image for an in-progress action.
3. Mutate, Queue, drag and Recreate take an immutable selection snapshot at action start. Drag constructs its payload at `dragstart`. Detail navigation passes member identity independently of the preview seed.
4. Route decoding centrally adapts current `/creations/{group}/mutate?source_id={member}` and old `group_of` URLs to the same source reference. New group selection links use an explicit member. Missing member selection can default to the cover only on initial generic detail browsing; a group Mutate route without a member must require selection rather than treating the group as an image.
5. Keep current mutate URLs for creation-pointer members. Before enabling local-pointer mutation, define an explicit encoded member route; never squeeze a local pointer into a numeric `source_id`. Router alone writes history. A reload must resolve the same member without cache or queue state.
6. Show the selected source preview in Mutate and composer attachments, with group/member context (for example, “Image 3 of 5 · Group title”). The ordinal helps recognition but does not identify the input. Recreate previews the original recipe inputs, separately labeled from the output whose recipe was copied.
7. During source changes/loading, prevent submission against stale visible media. Either show the newly selected member's loading state and disable actions, or retain the previous committed selection until the new one is ready. Recommended: select the new identity immediately and disable until its preview/resolution is ready. Commit only responses matching the current selection revision and mounted lifetime.
8. No silent substitution of a cover, sibling, output, thumbnail or default parent image when resolution fails. Offer retry, explicit reselection or removal with a useful explanation.

The preview/context treatment and removal behavior above are proposed product decisions. Resolve them before a UI port, and record the active SPA DOM/style mapping and matching screenshots. This document does not mark mobile parity complete.

## One server resolution and admission path

Extract a service such as `server/services/create/resolveCreationInputs.js`. Source preview APIs, submission, Recreate hydration and retry must use its rules rather than implementing their own membership checks.

For each consumed attachment:

1. Validate the discriminated source reference and field binding against the selected method schema. Reject malformed IDs, missing/duplicate attachment references and incompatible media. Never trust browser `published`, status, capability flags or preview URLs.
2. Load the authoritative container/member or artifact. Enforce group membership, view/remix capability, visibility, moderation/unavailability, readiness and media compatibility. Preserve current product access rules through explicit tests; published group access does not grant write access to that group.
3. Resolve a stable media revision. Prefer authoritative live media/recipe data. For archived snapshot-backed groups, define a deliberate snapshot adapter with validity checks. Do not combine an old snapshot URL with unrelated current metadata by incidental fallback order. Missing/deleted/inaccessible sources fail explicitly.
4. Create a provider-fetchable URL for that exact authorized media artifact. Display URLs and temporary share URLs are transport outputs, not persisted source identities. Prove that the provider can fetch a grouped unpublished member without a browser session; token minting alone is insufficient.
5. Construct provider arguments from validated field bindings. Resolve every slot, preserving order across multiple groups, uploads and frame artifacts. For internal inputs, reject conflicting raw image arguments; the server's resolved binding wins. Continue external URL/upload policy without using external classification to evade internal checks.
6. Derive direct parents from consumed inputs and preserve group context per input in recipe metadata. Use `mutate_of_id` as a compatibility projection only when there is exactly one direct creation parent. Keep existing ancestor/history display behavior, with deterministic deduplication. Never accept an arbitrary browser parent-ID list as authoritative lineage.
7. Validate optional destination write permission independently. Resolve all inputs before debiting credits or scheduling a job; integrate into existing admission/refund/idempotency behavior. Revalidate membership/revision at admission and bind the admitted job to the resolved artifact so later cover changes cannot redirect it.

Proposed request fields are `input_contract_version`, `inputs`, `input_bindings`, `recreate_of`, and `destination_group_id`, alongside existing server/method/non-image args and creation token. Proposed failures include `source_unavailable`, `member_not_in_group`, `source_changed`, `source_not_ready`, `source_kind_unsupported` and `destination_forbidden`, mapped to consistent 400/403-or-404/409 responses without leaking private existence. Failures keep the draft; require explicit correction when the selected revision changed.

Keep old URL/lineage payload support in a single request adapter during cutover. For old `group_id`, distinguish source context from an actual destination using existing caller contracts; reject ambiguous combinations or require explicit reselection rather than guessing. Audit all callers, including desktop/project clients, before deprecation. JSON and multipart must normalize through the same adapter (current multipart reconstruction does not preserve `group_id`).

## Durable recipes and Recreate

Persist a versioned generation recipe on each new output containing the original user prompt, method/model/settings, ordered resolved input references and field bindings, input media revisions, validated direct parents, and optional `recreateOf`. Existing `meta.args` may continue to record executed provider arguments for diagnostics, but temporary provider URLs must not be the sole replay recipe. Persist references sufficient to mint new fetch URLs later; do not persist authorization credentials in the recipe.

Example: B was generated from group G's member A, and B is later placed in group H. Recreate B must restore A through its original valid source/access context, plus B's recipe settings. H identifies the output being inspected; it cannot authorize A by implication. The recreated output has A as a direct parent, with B recorded as `recreateOf`. Mutate B instead consumes B and records B as its direct parent.

Recreating a selected group member first resolves that member's recipe. Missing recipe data is an explicit unsupported/unavailable result, never a fallback to the group's recipe. Replacing/removing an input updates provenance per attachment: retain valid unchanged inputs; remove the replaced input's parent/context; compute lineage from the final consumed bindings. Do not carry a global recipe group list across edits.

Older recipes need an explicit read adapter: recover unambiguous creation/share references server-side, authorize them today, and turn them into typed inputs. A previously valid recipe does not grant permanent access. If inputs cannot be recovered, show which source needs reselection while retaining usable settings. Do not backfill identity from filenames, visual similarity or the containing output group. Historical reconstruction may be impossible; make that limitation visible rather than claiming exact replay.

## Ownership and implementation sequence

| Step | Work and owners | Exit evidence |
| --- | --- | --- |
| 1. Lock down failures | Add deterministic fixtures and regression cases for browse-selected drag, detail-selected Mutate, Recreate across G/H, two source groups, and source/destination conflation. Inventory JSON/multipart/console/desktop callers and group kinds/capabilities. | A failing assertion for each confirmed defect; precise classification of unverified reports. No dependency on production data. |
| 2. Establish input contracts | `shared/creationInputs.js`; versioned `providers/create/draft.js` migration; `model.js` projections and per-field bindings. Preserve retained hidden settings and current explicit image semantics. | Round-trip, reorder, replace, remove, duplicate-URL and projection tests. Migration does not invent group membership or destroy old saved data. |
| 3. Build server vertical slice | Resolver service, versioned request adapter in `routes/create.js`, provider URL materialization, destination separation, durable recipe write/read. Start with one non-cover group member through real admission and a fake provider. | Selected member resolves to expected bytes and lineage; foreign published group can be an authorized source without becoming a destination. Invalid source fails before debit/schedule. |
| 4. Connect selection | Detail controller and browse carousel expose one member-selection contract; routes carry selection; drag snapshots at invocation. Seeds paint only previews and are keyed by source identity/revision. | Real mounted/browser carousel → Mutate and drag tests; cold and seeded route behavior agree; slow A cannot replace B. |
| 5. Convert every editor | `workflow.js` owns inputs and submission lineage; `transport.js` serializes the new contract. Basic, Mutate, Advanced, ProviderFields, composer and queue call draft actions. | All surfaces send equivalent source references/bindings for equivalent inputs. No editor computes authoritative lineage from URLs or parallel arrays. |
| 6. Convert Recreate/retry | Restore durable recipe inputs through resolver; add old-recipe adapter and partial-edit semantics. Retry uses admitted recipe identity subject to retry access policy. | Recreate mutation B restores A, selected grouped output restores its own recipe, expired fetch URLs are reminted, unavailable inputs never substitute. |
| 7. Remove competing ownership | Queue remains a distinct saved-for-later list of typed source records. Adding/consuming queue entries explicitly edits the draft. Compatibility settings mirror draft state; remove URL lineage fallbacks and redundant group propagation after caller migration. | One writer for active draft/lineage; repeated overlay/editor transitions do not duplicate subscriptions or overwrite newer selections. |
| 8. Release and retire adapters | Add safe diagnostics, compare typed resolution against expected fixtures, enable by coherent API capability/cohort, then remove old client writes after consumer inventory passes. | Matrix below passes; build/boundary check passes; no legacy import or write. Rollback preserves new recipes/drafts for forward recovery. |

Ship coherent slices: do not expose a new typed client to a server that discards its source references. Server-first additive support and version negotiation allow rollout without a second permanent pipeline. Retain old recipe readers; removing old client writers does not mean deleting historical recipe support. An old client cannot represent all new inputs: on rollback, reject or require reselection for unsupported drafts rather than projecting away identity. Preserve new metadata even if a feature is disabled.

## Verification and acceptance

Use deliberately different fixture images A/B/C (distinct colors, geometry and byte hashes); make C the cover, then select B. A successful HTTP response or correct-looking preview alone does not prove correctness. Capture the action snapshot, persisted draft, request bindings, server resolution, fake-provider fetch bytes, stored recipe and Recreate result.

| Scenario | Required result |
| --- | --- |
| Detail arrows/thumbs/keyboard select B → Mutate → submit | Preview, source reference, fetched bytes and direct parent all identify B; never C |
| Browse carousel selects B → detail → Mutate; browse B → drag to composer | Selection survives both paths; drag payload is built at invocation and contains B's membership |
| Queue B, reload, consume queue, Basic ↔ Advanced ↔ composer | Identity/group access context and full retained input order survive; Basic consumes only first bound image |
| Same group A+B; different groups G:A and H:B; plus upload/frame | Every bound input is independently authorized/materialized; order retained; no single global group requirement |
| Provider has multiple scalar/array image fields; some hidden | Each visible supported field receives its own bound inputs; hidden retained inputs add no provider args or direct parents |
| Same URL under two source identities; URL host/token changes | Attachment identity/provenance does not merge or disappear because of URL equality/inequality |
| Recreate mutate B-from-A; later group B in H | Restore A's input reference/settings and valid source context; B is recipe provenance; H is not a source authorization shortcut |
| Recreate then replace/remove/reorder one input | Remaining consumed inputs retain only their own provenance; removed inputs and stale recipe groups disappear |
| Own/private, other's published group with archived private members, inaccessible group, project remix disabled | Applicable read/remix permissions honored independently of destination write permissions; private members never leak through forged references |
| v1 snapshot group, v2 creation pointer, local pointer, mixed media | Explicit adapter/capability outcome per kind; unsupported local/media inputs fail clearly rather than vanishing or becoming a cover |
| Group changes cover/order during editing; member removed/deleted; recipe/source becomes unavailable | Stable member stays selected across cover/order changes; invalidated member/access/revision fails without substitution or debit |
| Slow response A after selecting B; dismiss/reopen; Back/Forward; cold deep link | Latest selection and mounted lifetime win; same source without seeds; background/scroll/controllers retained correctly |
| Provider fetch without session; expired share URL; altered IDs, wrong group membership, conflicting raw args | Fresh authorized transport URLs retrieve the exact artifact; tampering rejected; frame upload never replaced by parent still |
| No destination versus explicit owned destination versus foreign destination | No incidental append; explicit authorized append once; foreign destination rejected; refund/idempotency behavior preserved on failure |

Automate pure reducer/schema tests, mounted selection/editor tests, API tests with controlled DB/storage doubles and a fake provider that fetches and hashes each input. Add real browser tests for actual carousel interaction, visible preview, navigation and payload capture; include mobile touch plus desktop keyboard/drag. Run focused checks, relevant server suites, `npm run check:client-boundary`, and `npm run build`. Follow mobile source mapping and device verification requirements for any UI changes; do not label desktop emulation as real-device verification.

Diagnostics should correlate creation token/request ID, draft revision, attachment ID, selected group/member, field/slot and resolved artifact revision through admission/job completion. Never log signed URLs, share tokens, private prompts or secrets. Log structured mismatch/failure reasons; count source failures and unintended destination attempts. This makes future regressions traceable without exposing user media.

Acceptance requires the whole chain to agree for every supported surface. Helper tests that merely preserve `groupId`, a successful build, or a preview screenshot do not satisfy it. The new input record must be the only source of submitted identity; destination must be explicit; Recreate must use durable input recipes; old data must either resolve correctly or request explicit repair.

## Audit verification limits

Attempted `npm run verify:create-draft` in this checkout: 14 tests passed and four test files failed to load. Three failed because `jsdom` is not installed; the workflow file failed on a Node `.css` import (`gpuOccupancy.css`). The suite is not green, and these loader/dependency failures do not establish a grouped-flow regression. Restore the intended test dependencies/harness before using that command as a release gate.

No authenticated browser/provider flow was exercised, no runtime code was changed, and no dependencies were installed for this document. The implementation must start by turning the findings above into reproducible regressions. The highest-priority slice is selected non-cover member → typed input → independent server resolution → exact provider bytes, with source/destination separation included from the start.
