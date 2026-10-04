/** Use the same square placeholders and columns as the loaded browse grid. */
export function gridSkeletonMarkup(count = 25) {
 return '<div class="skeleton-grid-tile" aria-hidden="true"></div>'.repeat(count);
}
