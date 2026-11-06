# Suggest API: All Situations (cache, pending, wait-for-parent, errors)

This describes every situation the suggest layer can be in when we need results for a query (e.g. `"evan"`), so you can verify behavior and error handling.

---

## 1. Exact cache hit

**Situation:** We already have a cached result for this exact key (e.g. `users:evan:10`).

**Flow:** `cacheGet(key)` returns an array. We return `Promise.resolve(cached)` (default) or merge with local and return (mentions).

**No API call.** No pending lookup. No parent logic.

---

## 2. Parent cache hit (shorter query already resolved with &lt; limit)

**Situation:** We don’t have cache for `"evan"`, but we have cache for a shorter prefix (e.g. `"eva"`) and that cached result had **fewer than `limit`** items (e.g. 1 &lt; 10).

**Flow:** `cacheGetByParent(source, qLower, limit)` finds that parent cache, filters parent items by current query, returns the filtered list. We `cacheSet(key, filtered)` and return it (or merge with local for mentions).

**No API call.** We know the longer query cannot have more results than the parent.

---

## 3. Same-key pending (dedupe)

**Situation:** We don’t have cache for `"evan"`, but we already have an **in-flight request** for the same key (e.g. two quick calls for `"evan"`).

**Flow:** `pendingByKey.get(key)` returns that promise. We return that same promise (default) or `.then(items => merge with local)` (mentions). Caller gets the same result when the single request completes.

**No extra API call.** When the in-flight request completes it will `pendingByKey.delete(key)` in `finally`.

---

## 4. Parent pending – we wait, parent resolves with &lt; limit items

**Situation:** No cache for `"evan"`, no same-key pending, but there is an **in-flight request** for a shorter query (e.g. `"eva"`). We choose to wait for that parent. The parent later **resolves** with an array of length **&lt; limit** (e.g. 1 item).

**Flow:**

- We get `parentPendingKey` (e.g. `users:eva:10`) and `parentPromise = pendingByKey.get(parentPendingKey)`.
- We return `parentPromise.then((parentItems) => { ... })`.
- When parent resolves with e.g. 1 item: `parentItems.length >= cap` is false, so we **don’t** call `doFetchDefault()`.
- We `filterItemsByQuery(parentItems, qLower)`, `cacheSet(key, filtered)`, and return `filtered` (or merge with local for mentions).

**No API call for current query.** We reuse the parent’s result and treat it as the full set for the shorter query, so the longer query is a subset.

---

## 5. Parent pending – we wait, parent resolves with ≥ limit items

**Situation:** Same as 4, but the parent **resolves** with **≥ limit** items (e.g. 10). We can’t deduce the result for the longer query from that.

**Flow:**

- We’re in the same `parentPromise.then((parentItems) => { ... })`.
- `parentItems.length >= cap` is true, so we **do** call `doFetchDefault()` (or `doFetchMention()`).
- We start a **new** request for the current query and return that promise. That request registers in `pendingByKey.set(key, promise)` and cleans up in `finally`.

**One API call for current query** after waiting for the parent (which already completed with a full page).

---

## 6. Parent pending – we wait; two distinct parent outcomes

We **do not** conflate "server returned empty list" with "server/request failed". The fetch chain **rejects** on failure (non-2xx or network error) and **resolves with []** only when the server returns 200 with `{ items: [] }` or when the request is aborted.

**6(a) Parent promise rejects (server failed, network error, 5xx, etc.)**

**Flow:** We have `.catch(() => doFetchDefault())` / `.catch(() => doFetchMention())` on the "wait for parent" chain. So we **fall back** to starting our own request for the current query. No unhandled rejection; the current query gets a chance to succeed.

**6(b) Parent promise resolves with [] (server returned 200 with empty list, or request was aborted)**

**Flow:** We're in `.then((parentItems) => ...)` with `parentItems === []`. Then `parentItems.length >= cap` is false, so we **don't** call `doFetch`. We filter and return `[]`. So we return empty and do not retry. That's correct: empty list means "no matches", not "error".

**Summary:** Parent **rejects** (failure) → fall back to direct fetch for current query. Parent **resolves with []** (empty list or abort) → use filtered empty, no retry.

---

## 7. No cache, no same-key pending, no parent pending – direct fetch

**Situation:** No cache, no pending for this key, no pending for any parent key. We go straight to `doFetchDefault()` / `doFetchMention()`.

**Flow:** We start the fetch, `pendingByKey.set(key, promise)`, and return the promise.

- **Success (2xx, valid JSON):** We `cacheSet(key, items)` and resolve with items (possibly empty).
- **Abort:** We resolve with `[]` (intentional cancel; not "server failed").
- **Failure (!r.ok or network error):** We **reject** the promise (we no longer resolve with `[]`). The caller (e.g. `requestSuggestions`) has a `.catch` that shows empty UI so the user isn't stuck.

**One API call.** Caller gets resolve(items) on success or reject on failure; caller's `.catch` handles failure.

---

## 8. Same-key pending – that request later fails

**Situation:** We returned `sameKeyPending` (reuse of in-flight request for same key). That request later fails (server/network).

**Flow:** The stored promise **rejects**. The caller (e.g. `requestSuggestions`) receives the rejection in its `.catch` and shows empty. `finally` still runs, so `pendingByKey.delete(key)` happens. So we don't hide failure: caller explicitly handles reject and shows empty UI.

---

## 9. User blurs the field (popup closes, request not aborted)

**Situation:** User blurs the textarea; we call `closePopupFor(textarea)`, which hides the popup and clears UI state but does **not** abort the in-flight request.

**Flow:** We clear debounce timer, set `isOpen = false`, increment `requestToken`, hide the popup, etc. We do **not** call `state.requestController.abort()`. The in-flight fetch continues. When it completes, `getSuggestions` still caches the result; the `.then` in `requestSuggestions` runs but bails out (`token !== current.requestToken` or `document.activeElement !== textarea`), so we don’t re-open the popup. If the user refocuses and types again (or the same trigger is still there), we hit the cache and show results without a new fetch.

---

## 10. Order of checks (both default and mentions)

For every request we do, in order:

1. **Exact cache** – if hit, return immediately.  
2. **Parent cache** – if we can derive from a shorter cached result with &lt; limit items, filter and return.  
3. **Same-key pending** – if there’s already a request for this key, return that promise.  
4. **Parent pending** – if there’s an in-flight request for a parent key, wait on it:
   - **Resolve with &lt; limit:** use filtered result, no new request.  
   - **Resolve with ≥ limit:** call `doFetch` for current query.  
   - **Reject:** `.catch(() => doFetch)` so we start a new request for current query.  
5. **Direct fetch** – register in `pendingByKey`, run request; on success/abort resolve (abort → []); on failure reject; caller's `.catch` handles failure.

---

## Summary table

| Situation                    | API call for current query? | When parent errors (reject)?      | When parent returns []?     |
|-----------------------------|-----------------------------|------------------------------------|-----------------------------|
| Exact cache                 | No                          | N/A                                | N/A                         |
| Parent cache                | No                          | N/A                                | N/A                         |
| Same-key pending            | No (reuse)                  | N/A                                | N/A                         |
| Parent pending, parent &lt; limit | No                          | N/A                                | N/A                         |
| Parent pending, parent ≥ limit | Yes (after wait)            | N/A                                | N/A                         |
| Parent pending, parent rejects | Yes (fallback doFetch)      | Fall back to doFetch               | N/A                         |
| Parent pending, parent resolves [] (empty list) | No                          | N/A                                | Return [] (no retry)        |
| Direct fetch fails                 | N/A                         | Promise rejects; caller .catch     | N/A                         |
| Direct fetch                | Yes                         | N/A                                | N/A                         |

You can use this to walk through each scenario in the code and confirm behavior (including that parent rejection is handled and does not leave the current query stuck or unhandled).
