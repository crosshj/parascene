# Correlating Cloudflare with in-house data

When Cloudflare is in front of the app, you can tie what you see in the Cloudflare dashboard to rows in our own DB (share page views, try requests) in these ways.

## 1. Cloudflare Ray ID (exact request match)

We store the **Cf-Ray** header in `share_page_views.meta.cf_ray` and `try_requests.meta.cf_ray` when present. Cloudflare sends this ID to the origin for every request.

- **In admin:** Share views table has a "CF Ray" column; anonymous user detail shows the Ray next to each try request when available.
- **In Cloudflare:** If you have Logpush, Instant Logs, or Log Explorer, you can search by `RayID` (or the Ray ID field) to get the corresponding request in CF (path, status, country, etc.). That’s the same request as the row you’re looking at in admin.

So: **Admin row → copy CF Ray → search in Cloudflare Logs/Log Explorer** to see the same request from CF’s side.

## 2. Time + path + geography (no logs required)

Without CF logs you can still correlate by overlapping dimensions:

| In Cloudflare (dashboard) | In-house (admin / DB) |
|---------------------------|------------------------|
| Time (UTC) of a spike or event | `viewed_at` / `created_at` (UTC) on share_page_views and try_requests |
| Path (e.g. `/share/...`, `/api/try/...`) | Share views are for share pages; try requests are for try flow — filter by time window |
| Country / region | `meta.country`, `meta.region`, `meta.city` on share_page_views (from Vercel geo) |

**Example:** Cloudflare shows a traffic spike to `/share/*` from the US at 14:00–15:00 UTC. In admin, filter share page views by that hour and by `country = US` (or region/city if you have it). The result set is the in-house side of that same traffic.

## 3. IP (when visible in both)

We store the client IP (from `cf-connecting-ip` when CF is in front) in `meta.ip`. If your Cloudflare plan exposes client IP in analytics or logs, you can match that IP to our `meta.ip` to link a CF request to a specific share view or try request row.

## Summary

- **Exact link:** Use **CF Ray** from admin in Cloudflare Logs / Log Explorer when you have access.
- **No logs:** Use **time (UTC)**, **path**, and **country/region/city** to align Cloudflare analytics with in-house share views and try requests.
