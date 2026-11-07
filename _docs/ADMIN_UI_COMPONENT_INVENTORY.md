# Admin shared components

This inventory covers only UI patterns reused across the legacy admin pages. Use it to standardize the repeated markup and styling while porting page bodies. Keep page-specific visualizations and one-off controls local to their page.

| Shared component | Legacy pages using it | Standardize |
| --- | --- | --- |
| Tabs | Users, Analytics, Jobs, Emails, Algo | Tab labels, selected state, keyboard focus, panel spacing, and URL hash behavior. |
| Data table | Users, Analytics, Jobs, Emails, Algo | Semantic table markup, responsive overflow, sortable headers, paging toolbar, and loading/empty/error states. |
| Record card/list | Todo, Users, Connect | Consistent title, metadata, secondary text, optional status badge, and action placement. |
| Form field/settings row | Users, Emails, Algo, Todo, Connect | Labels, inputs/selects/textareas, help text, grouped settings, switches, and save/action rows. |
| Dialog | Users, Analytics, Emails, Todo, Connect | Native dialog structure, title/close area, content spacing, actions, focus return, and Escape dismissal. |
| Action buttons/status | All seven pages | Primary/secondary/danger actions, disabled/loading states, and inline success/error feedback. |

`admin-tabs` is a light-DOM custom element: pages keep their tab labels and panels in HTML, while one shared script handles selection, keyboard navigation, ARIA state, and optional hash sync. Tables remain native markup; dynamic tables use the shared loader with a column config.

## Page usage

Load `/admin/shared/admin.css` and `/admin/shared/admin.js` from the page shell (the shared admin header already loads these). Tabs use plain HTML:

```html
<admin-tabs class="admin-tabs" sync-hash>
  <div data-admin-tab-list aria-label="User sections">
    <button data-admin-tab="profile">Profile</button>
    <button data-admin-tab="access">Access</button>
  </div>
  <section data-admin-panel="profile">…</section>
  <section data-admin-panel="access">…</section>
</admin-tabs>
```

For server-paged tables, import the small loader and provide only page-specific columns and endpoint:

```js
import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

const table = document.querySelector('[data-admin-table]');
loadAdminDataTable(table, {
  fetchUrl: '/api/admin/users',
  itemsKey: 'users',
  ariaLabel: 'Users',
  columns: [
    { key: 'email', label: 'Email', sortKey: 'email' },
    { key: 'role', label: 'Role' }
  ]
});
```

The loader renders values as text, supports DOM nodes from a column renderer, and exposes `destroyAdminDataTable(container)` for page-owned cleanup. Use the shared CSS classes for cards, fields, buttons, badges, dialogs, and status messages; keep page-specific behavior in that page's folder.

Legacy reference: `_legacy/pages/app-admin.html`, `_legacy/public/pages/admin.js`, `_legacy/public/pages/admin.css`, and `_legacy/public/components/routes/{todo,users,analytics,servers}.js` with the related modal modules.

Implement these as small shared CSS patterns and helpers under `server/pages/admin/shared/`; each page's HTML and behavior stay in its own folder. Prefer native elements and shared classes over a component framework. The existing admin header/menu is already shared and is not part of the page-body component set.
