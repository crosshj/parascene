# Plan: Blog in the SPA

Public posts already render, but not inside the app. `GET /blog` and `GET /blog/*` in `server/routes/blog.js` return their own HTML document, with markdown turned into HTML on the server. The SPA route table in `client/app.js` has no blog path, so Home Articles and feed cards leave the shell.

The editor never shipped here. Create has a Blog tab in `client/views/Create/AdvancedCreate.js`, and the call that would show it is commented out. The old editor page, `/create/blog/:id`, is not a route on this server. The admin APIs in `server/routes/blogAdmin.js` are already mounted: list, create, update, delete, publish, archive, unpublish, campaigns, tracked URLs, author options.

Reading stays on the same URLs. `/blog/{slug}` stays the canonical post. `/blog/{campaign}/{slug}` stays the tracked form. Reserved campaign ids stay `n` and `i`. Home and the feed already build those paths with `client/shared/blogCampaignPath.js`.

- Add a blog view and register `/blog` and `/blog/*` beside the other routes in `client/app.js`. Match the server path split: one segment is the slug, a short first segment plus more path is a campaign.
- Give the view JSON. The index can use `GET /api/blog/published`. A single post needs the title, description, body, date, and status, including `?preview=1` for an admin or the author. Today that body only exists inside the HTML page.
- Render the markdown in the view. Keep the server HTML response for a direct load so a share and a crawler still get the title, description, and canonical URL. In-app clicks use the SPA route instead of loading that document.
- Record a view when a published post is shown. The HTML handler writes `prsn_blog_post_views` today. A JSON read has to do the same write, once, with the campaign id from the path. Preview does not count.
- Point Home Articles and feed blog cards at the SPA route.

Editing is its own screen, not a tab on Create. Create is the compose overlay and is locked to the advanced form.

- Add a page for admins and founders, with the post list, new draft, and the campaign link dialog. The fields are the ones the old editor had: title, slug, description, markdown body, status, and author for an admin.
- Call the blog admin APIs that are already mounted. Publish, archive, unpublish, and delete are separate actions from save.
- Open a draft from the list into that same screen. Do not send people to `/create/blog/:id`.
- Hide the screen from everyone else. The API already returns 403.

Done when an admin can draft and publish without leaving the shell, a reader can open `/blog` and a post from Home or the feed without a full document load, and a direct visit to `/blog/{slug}` or `/blog/{campaign}/{slug}` still shows the post with the same canonical URL.
