# Create — remaining tests and deferrals

2026-10-03 · User has tested most functionality. Completed port work and broad UI checklist removed.

## Targeted tests remaining

- **Ancestry:** Recreate image edits with one/multiple parents; inspect persisted
  direct parents/history. Changed inputs must not inherit unrelated recipe parents.
- **Groups:** Mutate a selected member; correct source, group and result membership.
- **Accounting:** provider failure/refund, insufficient credits and concurrent balance
  changes; inspect persisted charges/refunds and final UI balance.
- **Recovery:** restart during initial provider dispatch and during provider polling;
  accepted jobs recover without duplicate generation or charges.

## Deferred

- Hidden Blog/campaign HTTP APIs; retained client code is not API support.
- Reusable composers: [composer plan](BETA_VPS_COMPOSERS_PLAN.md).
- Party Mode: separate work.

Migration/cutover requirements: [canonical guidance](BETA_VPS_SPA_MIGRATION_SOURCE_OF_TRUTH.md).
