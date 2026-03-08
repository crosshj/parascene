/**
 * Triggered suggestions for textarea controls, e.g. @mentions.
 *
 * Public API preserved:
 * - addPageUsers(items)
 * - clearPageUsers()
 * - attachTriggeredSuggest(textarea, options)
 * - attachMentionSuggest(textarea)
 */

import { getAvatarColor } from './avatar.js';

const DEBOUNCE_MS = 130;
const POPUP_ID = "triggered-suggest-listbox";
const POPUP_CLASS = "triggered-suggest-popup";
const ITEM_CLASS = "triggered-suggest-item";
const ITEM_SELECTED_CLASS = "triggered-suggest-item--selected";
const ATTR_ATTACHED = "data-triggered-suggest-attached";

const POPUP_MAX_HEIGHT = 280;
const POPUP_OPEN_ABOVE_THRESHOLD = 240;

const SUGGEST_CACHE_TTL_MS = 5 * 60 * 1000;
const SUGGEST_CACHE_MAX_ENTRIES = 100;
const suggestCache = new Map();
/** In-flight requests by cache key so we can wait for a parent query instead of starting a new one. */
const pendingByKey = new Map();

const pageUsersMap = new Map();
const stateByTextarea = new WeakMap();

let sharedPopup = null;
let popupOwner = null;
let windowListenersAttached = false;

function getPopup() {
	if (sharedPopup && sharedPopup.parentNode) return sharedPopup;
	sharedPopup = document.createElement("div");
	sharedPopup.id = POPUP_ID;
	sharedPopup.className = POPUP_CLASS;
	sharedPopup.setAttribute("role", "listbox");
	sharedPopup.setAttribute("aria-hidden", "true");
	sharedPopup.style.display = "none";
	sharedPopup.style.maxHeight = `${POPUP_MAX_HEIGHT}px`;
	document.body.appendChild(sharedPopup);
	return sharedPopup;
}

function evictSuggestCacheIfNeeded() {
	while (suggestCache.size >= SUGGEST_CACHE_MAX_ENTRIES) {
		const firstKey = suggestCache.keys().next().value;
		if (firstKey == null) return;
		suggestCache.delete(firstKey);
	}
}

function cacheGet(key) {
	const entry = suggestCache.get(key);
	if (!entry) return null;
	if (Date.now() - entry.ts >= SUGGEST_CACHE_TTL_MS) {
		suggestCache.delete(key);
		return null;
	}
	return entry.items;
}

function cacheSet(key, items) {
	evictSuggestCacheIfNeeded();
	suggestCache.set(key, { items, ts: Date.now() });
}

const capForLimit = (limit) => Math.min(Math.max(1, Number(limit) || 10), 20);

function filterItemsByQuery(items, queryLower) {
	const q = queryLower;
	const matches = (item) => {
		const handle = itemHandle(item);
		const label = (item?.label ?? "").toLowerCase();
		return handle.includes(q) || label.includes(q);
	};
	return items.filter(matches);
}

/** If a shorter query (prefix of current) returned fewer than limit, the longer query cannot have more results — filter parent cache and skip the API. */
function cacheGetByParent(source, queryLower, limit) {
	const cap = capForLimit(limit);
	for (let len = queryLower.length - 1; len >= 1; len--) {
		const prefix = queryLower.slice(0, len);
		const parentKey = `${source}:${prefix}:${cap}`;
		const parentItems = cacheGet(parentKey);
		if (!parentItems || parentItems.length >= cap) continue;
		return filterItemsByQuery(parentItems, queryLower);
	}
	return null;
}

/** Longest prefix of queryLower that has an in-flight request, or null. */
function getPendingParentKey(source, queryLower, limit) {
	const cap = capForLimit(limit);
	for (let len = queryLower.length - 1; len >= 1; len--) {
		const prefix = queryLower.slice(0, len);
		const parentKey = `${source}:${prefix}:${cap}`;
		if (pendingByKey.has(parentKey)) return parentKey;
	}
	return null;
}

function isAbortError(err) {
	return err?.name === "AbortError";
}

function defaultGetSuggestions({ source, q, limit }, signal) {
	const query = String(q).trim();
	const qLower = query.toLowerCase();
	const cap = capForLimit(limit);
	const key = `${source}:${qLower}:${cap}`;
	const cached = cacheGet(key);
	if (cached) return Promise.resolve(cached);

	const fromParent = cacheGetByParent(source, qLower, limit);
	if (fromParent !== null) {
		cacheSet(key, fromParent);
		return Promise.resolve(fromParent);
	}

	const sameKeyPending = pendingByKey.get(key);
	if (sameKeyPending) return sameKeyPending;

	const parentPendingKey = getPendingParentKey(source, qLower, limit);
	if (parentPendingKey) {
		const parentPromise = pendingByKey.get(parentPendingKey);
		return parentPromise
			.then((parentItems) => {
				if (parentItems.length >= cap) return doFetchDefault();
				const filtered = filterItemsByQuery(parentItems, qLower);
				cacheSet(key, filtered);
				return filtered;
			})
			.catch(() => doFetchDefault());
	}

	function doFetchDefault() {
		const params = new URLSearchParams({ source, q: query, limit: String(limit) });
		const promise = fetch(`/api/suggest?${params}`, { credentials: "include", signal })
			.then((r) => {
				if (!r.ok) throw new Error(`Suggest failed: ${r.status}`);
				return r.json();
			})
			.then((data) => {
				const items = Array.isArray(data?.items) ? data.items : [];
				cacheSet(key, items);
				return items;
			})
			.catch((err) => {
				if (isAbortError(err)) return [];
				throw err;
			})
			.finally(() => {
				pendingByKey.delete(key);
			});
		pendingByKey.set(key, promise);
		return promise;
	}

	return doFetchDefault();
}

function defaultGetInsertText(item, trigger) {
	if (item?.insert_text) return item.insert_text;
	const t = trigger?.char ?? "@";
	if (item?.type === "user" && item?.sublabel) {
		const handle = String(item.sublabel).replace(/^@/, "").trim();
		return handle ? `${t}${handle} ` : "";
	}
	if (item?.label) return `${t}${String(item.label).trim()} `;
	return "";
}

function itemHandle(item) {
	const raw = (item?.sublabel || item?.insert_text || item?.label || "").replace(/^@/, "").trim();
	return raw.toLowerCase();
}

function toMentionItem(raw) {
	if (raw?.type === "user" && raw?.id != null) {
		return {
			type: "user",
			id: String(raw.id),
			label: raw.label ?? "",
			sublabel: raw.sublabel ?? (raw.insert_text ? raw.insert_text.replace(/\s+$/, "").trim() : undefined),
			icon_url: raw.icon_url,
			insert_text: raw.insert_text ?? (raw.sublabel ? `${raw.sublabel} ` : undefined),
			badge: raw.badge
		};
	}

	const id = raw?.user_id ?? raw?.id;
	if (id == null) return null;

	const userName = raw?.user_name != null ? String(raw.user_name).trim() : "";
	const displayName = raw?.display_name != null ? String(raw.display_name).trim() : "";
	const label = displayName || userName || "User";
	const sublabel = userName ? `@${userName}` : "";
	const insertText = userName ? `@${userName} ` : "";

	return {
		type: "user",
		id: String(id),
		label,
		sublabel: sublabel || undefined,
		icon_url: raw?.avatar_url != null ? String(raw.avatar_url).trim() || undefined : undefined,
		insert_text: insertText || undefined
	};
}

export function addPageUsers(items) {
	if (!Array.isArray(items)) return;
	for (const raw of items) {
		const item = toMentionItem(raw);
		if (item?.id) pageUsersMap.set(item.id, item);
	}
}

export function clearPageUsers() {
	pageUsersMap.clear();
}

function filterAndSortMentionItems(items, qLower) {
	if (!qLower) return items.slice();
	const rows = items
		.map((item) => ({ item, handle: itemHandle(item) }))
		.filter(({ handle }) => handle.includes(qLower));

	rows.sort((a, b) => {
		const aPrefix = a.handle.startsWith(qLower) ? 0 : 1;
		const bPrefix = b.handle.startsWith(qLower) ? 0 : 1;
		if (aPrefix !== bPrefix) return aPrefix - bPrefix;
		return a.handle.localeCompare(b.handle);
	});

	return rows.map(({ item }) => item);
}

function getCachedEntriesForSource(source) {
	const prefix = `${source}:`;
	const out = [];
	for (const [key, entry] of suggestCache.entries()) {
		if (!key.startsWith(prefix)) continue;
		if (Date.now() - entry.ts >= SUGGEST_CACHE_TTL_MS) {
			suggestCache.delete(key);
			continue;
		}
		out.push(entry.items);
	}
	return out;
}

function mergeUniqueItems(items) {
	const out = [];
	const seen = new Set();
	for (const item of items) {
		if (!item) continue;
		const id = item?.id != null ? `id:${String(item.id)}` : "";
		const handle = itemHandle(item);
		const key = id || `handle:${handle}`;
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}

function getMentionLocalCandidates(qLower) {
	const cachedRemote = getCachedEntriesForSource("users").flat();
	return mergeUniqueItems([
		...filterAndSortMentionItems(Array.from(pageUsersMap.values()), qLower),
		...filterAndSortMentionItems(cachedRemote, qLower)
	]);
}

function getMentionSuggestions({ source, q, limit }, signal) {
	const qTrimmed = String(q).trim();
	const qLower = qTrimmed.toLowerCase();
	const limitNum = capForLimit(limit);
	const key = `${source}:${qLower}:${limitNum}`;
	const exactCached = cacheGet(key);
	const local = getMentionLocalCandidates(qLower).slice(0, limitNum);

	if (exactCached) {
		return Promise.resolve(mergeUniqueItems([...local, ...exactCached]).slice(0, limitNum));
	}

	const fromParent = cacheGetByParent(source, qLower, limitNum);
	if (fromParent !== null) {
		cacheSet(key, fromParent);
		return Promise.resolve(mergeUniqueItems([...local, ...fromParent]).slice(0, limitNum));
	}

	const sameKeyPending = pendingByKey.get(key);
	if (sameKeyPending) {
		return sameKeyPending.then((items) => mergeUniqueItems([...local, ...items]).slice(0, limitNum));
	}

	const parentPendingKey = getPendingParentKey(source, qLower, limitNum);
	if (parentPendingKey) {
		const parentPromise = pendingByKey.get(parentPendingKey);
		return parentPromise
			.then((parentItems) => {
				if (parentItems.length >= limitNum) return doFetchMention();
				const filtered = filterItemsByQuery(parentItems, qLower);
				cacheSet(key, filtered);
				return mergeUniqueItems([...local, ...filtered]).slice(0, limitNum);
			})
			.catch(() => doFetchMention());
	}

	function doFetchMention() {
		const remotePromise = fetch(`/api/suggest?source=users&q=${encodeURIComponent(qTrimmed)}&limit=${limitNum}`, {
			credentials: "include",
			signal
		})
			.then((r) => {
				if (!r.ok) throw new Error(`Suggest failed: ${r.status}`);
				return r.json();
			})
			.then((data) => {
				const items = Array.isArray(data?.items) ? data.items : [];
				cacheSet(key, items);
				return items;
			})
			.catch((err) => {
				if (isAbortError(err)) return [];
				throw err;
			})
			.finally(() => {
				pendingByKey.delete(key);
			});
		pendingByKey.set(key, remotePromise);
		return remotePromise.then((items) => mergeUniqueItems([...local, ...items]).slice(0, limitNum));
	}

	return doFetchMention();
}

function attachWindowListeners() {
	if (windowListenersAttached) return;
	windowListenersAttached = true;
	// Create and append popup once so it is already in the DOM; avoids focus loss when opening (listbox "popping in" coincided with focus loss)
	getPopup();

	const reposition = () => {
		if (!popupOwner) return;
		const state = stateByTextarea.get(popupOwner);
		if (!state?.isOpen) return;
		positionPopup(popupOwner, getPopup());
	};

	window.addEventListener("resize", reposition, { passive: true });
	window.addEventListener("scroll", reposition, { passive: true, capture: true });

	document.addEventListener("mousedown", (e) => {
		if (!popupOwner) return;
		const popup = getPopup();
		if (popup.contains(e.target) || popupOwner.contains(e.target)) return;
		closePopupFor(popupOwner);
	});
}

function positionPopup(textarea, popup) {
	const rect = textarea.getBoundingClientRect();
	const spaceBelow = window.innerHeight - rect.bottom;
	const openAbove = spaceBelow < POPUP_OPEN_ABOVE_THRESHOLD;

	popup.style.position = "fixed";
	popup.style.left = `${Math.max(8, rect.left)}px`;
	popup.style.minWidth = `${Math.max(rect.width, 220)}px`;
	popup.style.maxWidth = `${Math.max(220, Math.min(window.innerWidth - rect.left - 8, 520))}px`;

	if (openAbove) {
		popup.style.top = "";
		popup.style.bottom = `${Math.max(0, window.innerHeight - rect.top)}px`;
		popup.classList.add("triggered-suggest-popup--above");
	} else {
		popup.style.bottom = "";
		popup.style.top = `${Math.max(0, rect.bottom)}px`;
		popup.classList.remove("triggered-suggest-popup--above");
	}
}

function isPopupOpenFor(textarea) {
	const state = stateByTextarea.get(textarea);
	return !!state?.isOpen && popupOwner === textarea;
}

function closePopupFor(textarea) {
	const state = stateByTextarea.get(textarea);
	if (!state) return;

	if (state.debounceTimer) {
		clearTimeout(state.debounceTimer);
		state.debounceTimer = null;
	}
	// Do not abort in-flight request: let it complete and cache so if user refocuses we have results
	// state.requestController is left as-is; request will complete and .then() will no-op (token check)

	state.isOpen = false;
	state.items = [];
	state.selectedIndex = -1;
	state.currentTrigger = null;
	state.triggerStart = -1;
	state.requestToken += 1;
	state.displayedQuery = "";
	state.pendingQuery = "";

	const popup = getPopup();
	if (popupOwner === textarea) {
		popupOwner = null;
		popup.style.display = "none";
		popup.setAttribute("aria-hidden", "true");
		popup.innerHTML = "";
	}

	textarea.setAttribute("aria-expanded", "false");
	textarea.removeAttribute("aria-controls");
	textarea.removeAttribute("aria-activedescendant");
}

function closeAnyOtherPopup(nextOwner) {
	if (!popupOwner || popupOwner === nextOwner) return;
	closePopupFor(popupOwner);
}

function renderPopup(textarea, mode) {
	const state = stateByTextarea.get(textarea);
	if (!state) return;

	const popup = getPopup();
	closeAnyOtherPopup(textarea);
	popupOwner = textarea;
	popup.innerHTML = "";

	const { items, selectedIndex } = state;
	const showLoading = mode === "loading";
	const showEmpty = mode === "empty" || (!showLoading && items.length === 0);

	if (showLoading) {
		const row = document.createElement("div");
		row.className = `${ITEM_CLASS} triggered-suggest-item--loading`;
		row.textContent = "Loading…";
		popup.appendChild(row);
	} else if (showEmpty) {
		const row = document.createElement("div");
		row.className = `${ITEM_CLASS} triggered-suggest-item--empty`;
		row.textContent = "No matches found";
		popup.appendChild(row);
	} else {
		items.forEach((item, i) => {
			const option = document.createElement("div");
			option.id = `triggered-suggest-option-${i}`;
			option.className = ITEM_CLASS + (i === selectedIndex ? ` ${ITEM_SELECTED_CLASS}` : "");
			option.setAttribute("role", "option");
			option.setAttribute("aria-selected", i === selectedIndex ? "true" : "false");
			option.setAttribute("data-index", String(i));

			const icon = document.createElement("div");
			icon.className = "triggered-suggest-item-icon";
			if (item?.icon_url) {
				const img = document.createElement("img");
				img.src = item.icon_url;
				img.alt = "";
				img.className = "triggered-suggest-item-avatar";
				icon.appendChild(img);
			} else {
				const seed = (item?.sublabel || "").replace(/^@/, "").trim() || item?.id || item?.label || "";
				icon.style.background = getAvatarColor(seed);
				icon.textContent = String(item?.label || "?").charAt(0).toUpperCase();
			}

			const text = document.createElement("div");
			text.className = "triggered-suggest-item-text";
			const label = document.createElement("div");
			label.className = "triggered-suggest-item-label";
			label.textContent = item?.label ?? "";
			text.appendChild(label);
			if (item?.sublabel) {
				const sub = document.createElement("div");
				sub.className = "triggered-suggest-item-sublabel";
				sub.textContent = item.sublabel;
				text.appendChild(sub);
			}

			option.appendChild(icon);
			option.appendChild(text);
			if (item?.badge) {
				const badge = document.createElement("span");
				badge.className = "triggered-suggest-item-badge";
				badge.textContent = item.badge;
				option.appendChild(badge);
			}

			option.addEventListener("mousedown", (e) => {
				e.preventDefault();
			});
			option.addEventListener("click", (e) => {
				e.preventDefault();
				acceptSelection(textarea, i);
			});

			popup.appendChild(option);
		});
	}

	positionPopup(textarea, popup);
	popup.style.display = "flex";
	popup.setAttribute("aria-hidden", "false");

	state.isOpen = true;
	textarea.setAttribute("aria-expanded", "true");
	textarea.setAttribute("aria-controls", POPUP_ID);
	if (selectedIndex >= 0 && items[selectedIndex]) {
		textarea.setAttribute("aria-activedescendant", `triggered-suggest-option-${selectedIndex}`);
	} else {
		textarea.removeAttribute("aria-activedescendant");
	}

	const selectedEl = popup.querySelector(`.${ITEM_SELECTED_CLASS}`);
	if (selectedEl) selectedEl.scrollIntoView({ block: "nearest" });

	// Restore focus to textarea after showing popup; appending/displaying the listbox can cause the browser to move focus
	requestAnimationFrame(() => {
		if (stateByTextarea.get(textarea)?.isOpen && document.activeElement !== textarea) {
			textarea.focus();
		}
	});
}

function updateSelection(textarea, nextIndex) {
	const state = stateByTextarea.get(textarea);
	if (!state || state.items.length === 0) return;
	state.selectedIndex = Math.max(0, Math.min(nextIndex, state.items.length - 1));
	if (!isPopupOpenFor(textarea)) return;
	renderPopup(textarea);
}

function replaceRange(value, start, end, insertText) {
	return value.slice(0, start) + insertText + value.slice(end);
}

function acceptSelection(textarea, forcedIndex = null) {
	const state = stateByTextarea.get(textarea);
	if (!state || !state.currentTrigger) return false;

	const index = forcedIndex == null ? state.selectedIndex : forcedIndex;
	const item = state.items[index];
	if (!item || state.triggerStart < 0) return false;

	const insertText = state.getInsertText(item, state.currentTrigger);
	if (!insertText) {
		closePopupFor(textarea);
		return false;
	}

	const caretEnd = textarea.selectionStart ?? textarea.value.length;
	const nextValue = replaceRange(textarea.value, state.triggerStart, caretEnd, insertText);
	const caret = state.triggerStart + insertText.length;

	textarea.value = nextValue;
	textarea.selectionStart = caret;
	textarea.selectionEnd = caret;
	textarea.focus();
	closePopupFor(textarea);
	textarea.dispatchEvent(new Event("input", { bubbles: true }));
	return true;
}

function isBoundaryChar(ch) {
	return !ch || /[\s\n\r\t([{"'`>.,:;!?/\\-]/.test(ch);
}

function getTriggerContext(textarea, triggers) {
	const value = textarea.value;
	let pos = textarea.selectionStart;
	if (pos == null || pos < 0) pos = value.length;
	if (pos <= 0) return null;

	let best = null;
	for (const trigger of triggers) {
		const idx = value.lastIndexOf(trigger.char, pos - 1);
		if (idx === -1) continue;

		const before = value[idx - 1] || "";
		if (!isBoundaryChar(before)) continue;

		const after = value.slice(idx + 1, pos);
		if (!after || /[\s\n\r]/.test(after)) continue;

		const query = after.trim();
		if (query.length < (trigger.minChars ?? 1)) continue;

		if (!best || idx > best.start) {
			best = { trigger, query, start: idx, end: pos };
		}
	}

	return best;
}

function applyLocalFilter(source, items, qLower) {
	if (source === "users") return filterAndSortMentionItems(items, qLower);
	return items.filter((item) => itemHandle(item).startsWith(qLower));
}

function getLocalCandidatesForTrigger(trigger, qLower) {
	if (trigger.source === "users") return getMentionLocalCandidates(qLower);
	return [];
}

function shouldOpenFromEvent(event) {
	if (!event) return false;
	if (typeof event.isTrusted === "boolean") return event.isTrusted;
	return true;
}

function requestSuggestions(textarea, ctx, reason) {
	const state = stateByTextarea.get(textarea);
	if (!state) return;
	if (reason !== "user") return;
	if (!state.hasUserInteracted) return;

	// Do not abort in-flight request: let it complete and cache (upsert) so we keep server results for other queries
	state.requestController = new AbortController();
	state.requestToken += 1;
	const token = state.requestToken;

	state.triggerStart = ctx.start;
	state.currentTrigger = ctx.trigger;
	state.pendingQuery = ctx.query;

	const requestedQuery = ctx.query;
	const qLower = requestedQuery.toLowerCase();
	const localCandidates = getLocalCandidatesForTrigger(ctx.trigger, qLower);
	const localMatches = applyLocalFilter(ctx.trigger.source, localCandidates, qLower).slice(0, 10);

	state.items = localMatches;
	state.selectedIndex = localMatches.length > 0 ? 0 : -1;
	state.displayedQuery = requestedQuery;

	const exactCacheKey = `${ctx.trigger.source}:${qLower}:10`;
	const exactCached = cacheGet(exactCacheKey);
	if (exactCached) {
		const merged = mergeUniqueItems([...localMatches, ...exactCached]).slice(0, 10);
		state.items = merged;
		state.selectedIndex = merged.length > 0 ? 0 : -1;
		renderPopup(textarea, merged.length > 0 ? undefined : "empty");
		return;
	}

	if (localMatches.length > 0) {
		renderPopup(textarea);
	} else {
		renderPopup(textarea, "loading");
	}

	state.getSuggestions({
		source: ctx.trigger.source,
		q: requestedQuery,
		limit: 10
	}, state.requestController.signal)
		.then((items) => {
			const current = stateByTextarea.get(textarea);
			if (!current || token !== current.requestToken) return;
			if (document.activeElement !== textarea) return;

			const nowCtx = getTriggerContext(textarea, current.triggers);
			if (!nowCtx || nowCtx.trigger.char !== ctx.trigger.char) {
				closePopupFor(textarea);
				return;
			}

			const nowLower = nowCtx.query.toLowerCase();
			const base = getLocalCandidatesForTrigger(nowCtx.trigger, nowLower);
			const nextLocal = applyLocalFilter(nowCtx.trigger.source, base, nowLower).slice(0, 10);
			const nextRemote = nowCtx.query === requestedQuery ? items : applyLocalFilter(nowCtx.trigger.source, items, nowLower);
			const nextItems = mergeUniqueItems([...nextLocal, ...nextRemote]).slice(0, 10);

			current.triggerStart = nowCtx.start;
			current.currentTrigger = nowCtx.trigger;
			current.items = nextItems;
			current.selectedIndex = nextItems.length > 0 ? 0 : -1;
			current.displayedQuery = nowCtx.query;
			renderPopup(textarea, nextItems.length > 0 ? undefined : "empty");
		})
		.catch(() => {
			const current = stateByTextarea.get(textarea);
			if (!current || token !== current.requestToken) return;
			// Server/network failed (not "empty list"); show empty so UI doesn't hang
			current.items = [];
			current.selectedIndex = -1;
			renderPopup(textarea, "empty");
		});
}

export function attachTriggeredSuggest(textarea, options) {
	if (!(textarea instanceof HTMLTextAreaElement)) return;
	if (textarea.getAttribute(ATTR_ATTACHED) === "true") return;

	const triggers = Array.isArray(options?.triggers) ? options.triggers.filter((t) => t?.char) : [];
	if (triggers.length === 0) return;

	attachWindowListeners();
	textarea.setAttribute(ATTR_ATTACHED, "true");
	textarea.setAttribute("aria-haspopup", "listbox");
	textarea.setAttribute("aria-autocomplete", "list");
	textarea.setAttribute("aria-expanded", "false");

	const state = {
		triggers,
		getSuggestions: typeof options?.getSuggestions === "function" ? options.getSuggestions : defaultGetSuggestions,
		getInsertText: typeof options?.getInsertText === "function" ? options.getInsertText : defaultGetInsertText,
		debounceTimer: null,
		requestController: null,
		requestToken: 0,
		items: [],
		selectedIndex: -1,
		currentTrigger: null,
		triggerStart: -1,
		isOpen: false,
		hasUserInteracted: false,
		displayedQuery: "",
		pendingQuery: ""
	};
	stateByTextarea.set(textarea, state);

	function scheduleRefresh(reason) {
		const current = stateByTextarea.get(textarea);
		if (!current) return;
		if (current.debounceTimer) clearTimeout(current.debounceTimer);

		const ctx = getTriggerContext(textarea, current.triggers);
		if (!ctx) {
			closePopupFor(textarea);
			return;
		}

		current.debounceTimer = setTimeout(() => {
			current.debounceTimer = null;
			requestSuggestions(textarea, ctx, reason);
		}, DEBOUNCE_MS);
	}

	function markInteracted() {
		const current = stateByTextarea.get(textarea);
		if (!current) return;
		current.hasUserInteracted = true;
	}

	function onInput(e) {
		if (!shouldOpenFromEvent(e)) return;
		markInteracted();
		scheduleRefresh("user");
	}

	function onFocus() {
		// Intentional: focus alone should not resurrect suggestions for restored/programmatic text.
	}

	function onBlur() {
		setTimeout(() => {
			if (document.activeElement === textarea) return;
			const popup = getPopup();
			if (popup.contains(document.activeElement)) return;
			closePopupFor(textarea);
		}, 0);
	}

	function onPointerDown() {
		markInteracted();
	}

	function onKeydown(e) {
		const current = stateByTextarea.get(textarea);
		if (!current) return;

		if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete") {
			markInteracted();
		}

		const popupOpen = isPopupOpenFor(textarea);
		const hasSelection = current.selectedIndex >= 0 && !!current.items[current.selectedIndex];

		if (e.key === "Escape") {
			if (!popupOpen) return;
			e.preventDefault();
			closePopupFor(textarea);
			return;
		}

		if (!popupOpen) return;

		const popup = getPopup();
		const isAbove = popup.classList.contains("triggered-suggest-popup--above");
		const maxIdx = Math.max(0, current.items.length - 1);

		if (e.key === "ArrowDown") {
			e.preventDefault();
			// When popup is above (column-reverse), "down" is toward the input = lower index
			if (current.selectedIndex < 0) {
				updateSelection(textarea, 0);
			} else {
				const next = isAbove ? current.selectedIndex - 1 : current.selectedIndex + 1;
				updateSelection(textarea, Math.max(0, Math.min(next, maxIdx)));
			}
			return;
		}

		if (e.key === "ArrowUp") {
			e.preventDefault();
			// When popup is above (column-reverse), "up" is away from the input = higher index
			if (current.selectedIndex < 0) {
				updateSelection(textarea, maxIdx);
			} else {
				const next = isAbove ? current.selectedIndex + 1 : current.selectedIndex - 1;
				updateSelection(textarea, Math.max(0, Math.min(next, maxIdx)));
			}
			return;
		}

		if (e.key === "Home") {
			e.preventDefault();
			updateSelection(textarea, isAbove ? maxIdx : 0);
			return;
		}

		if (e.key === "End") {
			e.preventDefault();
			updateSelection(textarea, isAbove ? 0 : maxIdx);
			return;
		}

		if (e.key === "Enter") {
			if (!hasSelection) return;
			e.preventDefault();
			acceptSelection(textarea);
			return;
		}

		if (e.key === "Tab") {
			if (!hasSelection) {
				closePopupFor(textarea);
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			acceptSelection(textarea);
			return;
		}
	}

	textarea.addEventListener("input", onInput);
	textarea.addEventListener("focus", onFocus);
	textarea.addEventListener("blur", onBlur);
	textarea.addEventListener("pointerdown", onPointerDown);
	textarea.addEventListener("keydown", onKeydown);
}

export function attachMentionSuggest(textarea) {
	attachTriggeredSuggest(textarea, {
		triggers: [{ char: "@", minChars: 1, source: "users" }],
		getSuggestions: getMentionSuggestions
	});
}
