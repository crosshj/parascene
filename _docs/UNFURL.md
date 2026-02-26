# Link unfurling and preview debuggers

When someone shares a link (e.g. a Parascene share URL), many apps “unfurl” it into a rich preview: title, description, image. They do this by crawling the page and reading **Open Graph** and **Twitter Card** meta tags from the `<head>`.

This doc lists official tools from major platforms so you can test and fix how our share pages unfurl.

## Parascene share pages

- Share links use the **share subdomain**: `https://sh.parascene.com/s/v1/...`
- Only `/s/*` and `/api/share/*` (and share-page assets) are served on `sh.parascene.com`; other paths redirect to www.
- OG and Twitter meta (title, description, image, url) are set in the share route and use **sh.parascene.com** for canonical URL and image URLs so unfurls point at the share domain.

If a platform returns **403** when unfurling, allowlist their crawler (e.g. Slackbot) at the edge (e.g. Cloudflare) for `/s/*` and `/api/share/*`; the app does not return 403 for those paths.

---

## Official unfurl / preview debuggers

Use these to paste a URL and see how it will look (and refresh cache if needed).

| Platform | Tool | URL |
|----------|------|-----|
| **Slack** | Unfurl Debugger | https://api.slack.com/tools/unfurl-debugger |
| **Meta (Facebook, etc.)** | Sharing Debugger | https://developers.facebook.com/tools/debug/ |
| **X (Twitter)** | Card Validator | https://cards-dev.twitter.com/validator |
| **LinkedIn** | Post Inspector | https://www.linkedin.com/post-inspector/inspect/ |
| **Pinterest** | URL Debugger | https://developers.pinterest.com/tools/url-debugger/ |

### Slack

- [Unfurl Debugger](https://api.slack.com/tools/unfurl-debugger): paste a URL and see how Slack will unfurl it. Use this to confirm share links (e.g. `https://sh.parascene.com/s/v1/...`) return 200 and show the expected title, description, and image.
- [Slack Robots](https://api.slack.com/robots): official list of Slack’s user agents (e.g. `Slackbot-LinkExpanding`, `Slack-ImgProxy`, `Slackbot`). Use this when allowlisting at your edge or debugging 403s — if you see one of these in logs, allow it for `/s/*` and `/api/share/*` on the share host.
- Slack’s crawler often sends a `Slackbot` or `Slack-ImgProxy` User-Agent; if you see 403, allow that at your edge for the share host/paths.

### Meta (Facebook, WhatsApp, etc.)

- [Sharing Debugger](https://developers.facebook.com/tools/debug/): enter URL to preview and to “Scrape Again” to refresh Meta’s cache (cache can last 24–72 hours).

### X (Twitter)

- [Card Validator](https://cards-dev.twitter.com/validator): validates Twitter Card meta and shows a preview. Uses `twitter:card`, `twitter:title`, `twitter:image`, etc. (we set these on the share page).

### LinkedIn

- [Post Inspector](https://www.linkedin.com/post-inspector/inspect/): paste URL to see how the link will appear when shared. LinkedIn caches for around 7 days; the tool can help confirm OG/Twitter tags.

### Pinterest

- [URL Debugger](https://developers.pinterest.com/tools/url-debugger/): validates Rich Pins / meta so pins show the right title, description, and image.

---

## Meta tags we set (share page)

The share route in `api_routes/pages.js` fills the HTML with:

- `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image`, `og:image:secure_url`, `og:image:type`, `og:image:width`, `og:image:height`, `og:image:alt`
- `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`, `twitter:image:alt`

All URLs in these meta tags use the **share subdomain** (`sh.parascene.com`) so unfurls are consistent and point to the share experience.
