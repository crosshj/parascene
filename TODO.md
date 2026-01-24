# TODO

here are notes about how to handle TODO.json, you will edit TODO.json when user mentions there are TODO changes.  You will not change this markdown file when the previously mentioned file changes.  You do not need to track items that are done.

## Cost

`cost` reflects expected effort and complexity to deliver the item. Higher cost means more engineering time, more moving parts, or greater risk of hidden work.

## Impact

`impact` reflects the expected user or business value once the item ships. Higher impact means it materially improves outcomes, adoption, or retention.


## Rebalance

When I ask for a "rebalance" of TODO `cost` and `impact` values, I mean:

- Recalculate the numeric scores across the current list so they are comparable to each other.
- Use the full 1-100 scale for each metric.
- The highest `cost` item should be 100, and the lowest `cost` item should be 1.
- The highest `impact` item should be 100, and the lowest `impact` item should be 1.
- Preserve relative ordering between items (if A > B before, A should stay > B after).
- Use a linear rescale across the remaining items.


## Remove / Add

If an item is removed or added, rerun the rebalance so the scores stay aligned to the new set.
