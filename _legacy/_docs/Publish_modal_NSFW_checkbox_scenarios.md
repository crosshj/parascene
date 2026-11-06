# Publish / Edit modal: NSFW checkbox scenarios

The same modal is used for **Publish** (first-time publish) and **Edit** (change title/description/NSFW). The initial NSFW checkbox state is always set by `defaultNsfwChecked(creation)` in `public/components/modals/publish.js`, using the creation returned from `GET /api/create/images/:id`.

## When the modal opens

1. **Publish** – User clicks the Publish control (e.g. pill with `data-publish-btn` on creation detail). Dispatches `open-publish-modal` → `openPublish(creationId)` fetches the creation and sets the checkbox via `defaultNsfwChecked(creation)`.
2. **Edit** – User clicks Edit (e.g. `data-edit-btn`). Dispatches `open-edit-modal` → `openEdit(creationId)` fetches the creation and sets the checkbox the same way.

So the checkbox state depends only on the **creation state** (API response), not on whether the user opened via Publish or Edit.

## Logic (order of rules in `defaultNsfwChecked`)

1. Creation is already NSFW → **checked**.
2. User previously chose "not NSFW" (published without NSFW, or edited and saved with it unchecked) → **unchecked**.
3. Creation was mutated from an NSFW creation → **checked**.
4. User has "Enable NSFW content" on in profile (`getNsfwContentEnabled()`) → **checked**.
5. Otherwise → **unchecked**.

## Scenarios: checked vs unchecked

| # | Scenario | Box | Why |
|---|----------|-----|-----|
| 1 | **Brand-new creation** (no mutate, never published, no prior edit). User opens **Publish**. | **Checked** if user has NSFW enabled in profile; **unchecked** otherwise. | Not NSFW yet, not previously published, no `meta.nsfw === false`, no `mutate_of_nsfw`. Rule 4 applies: `getNsfwContentEnabled()` decides. |
| 2 | **Mutated from an NSFW creation**, never published, no prior edit. User opens **Publish**. | **Checked**. | API returns `mutate_of_nsfw: true`. Rule 3: mutated from NSFW → checked. |
| 3 | **Mutated from a non-NSFW creation**, never published. User opens **Publish**. | **Checked** if user has NSFW enabled; **unchecked** otherwise. | `mutate_of_nsfw` is false or absent. Same as scenario 1: rule 4 applies. |
| 4 | **Already published with NSFW**. User opens **Edit** (or **Publish** if that path exists). | **Checked**. | Rule 1: `creation.nsfw` / `creation.meta?.nsfw` true → checked. |
| 5 | **Already published without NSFW**. User opens **Edit**. | **Unchecked**. | Rule 2: `wasPreviouslyPublished` true and creation not NSFW → respect prior choice → unchecked. |
| 6 | **Never published**, but user previously opened **Edit** and saved with NSFW **unchecked**. User opens **Edit** again (or **Publish**). | **Unchecked**. | Rule 2: `creation.meta?.nsfw === false` (`explicitNotNsfw`) → respect prior choice → unchecked. |
| 7 | **Never published**, but user previously opened **Edit** and saved with NSFW **checked**. User opens **Edit** or **Publish**. | **Checked**. | Rule 1: creation is now stored as NSFW → checked. |
| 8 | **Mutated from NSFW**, then user opened **Edit** and saved with NSFW **unchecked**. User opens **Edit** again. | **Unchecked**. | Rule 2: `explicitNotNsfw` (meta.nsfw === false) wins over "mutated from NSFW". |
| 9 | **Mutated from NSFW**, never edited. User opens **Publish**. | **Checked**. | Rule 3: `mutate_of_nsfw === true` → checked (even if user doesn't have NSFW enabled in profile). |
| 10 | User **does not** have "Enable NSFW content" in profile. Creation is brand-new (no mutate, never published). User opens **Publish**. | **Unchecked**. | Rules 1–3 don't apply; rule 4 is false → rule 5: unchecked. |
| 11 | User **has** "Enable NSFW content" in profile. Creation is brand-new. User opens **Publish**. | **Checked**. | Rule 4: `getNsfwContentEnabled()` true → checked. |

## Summary

- **Checked** when: creation is already NSFW, or it was mutated from an NSFW creation (and they haven't later saved with NSFW off), or the user has NSFW enabled in profile and there's no prior "not NSFW" choice.
- **Unchecked** when: the user previously published or edited and left NSFW off (`meta.nsfw === false` or published and not NSFW), or none of the "checked" conditions apply (e.g. new creation and NSFW not enabled in profile).
