/**
 * Triggered suggestions for textarea controls, e.g. @mentions.
 *
 * Public API preserved:
 * - addPageUsers(items)
 * - clearPageUsers()
 * - attachTriggeredSuggest(textarea, options)
 * - attachMentionSuggest(textarea)
 */

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
	if (suggestCache.size < SUGGEST_CACHE_MAX_ENTRIES) return;
	const firstKey = suggestCache.keys().next().value;
	if (firstKey != null) suggestCache.delete(firstKey);
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

function defaultGetSuggestions({ source, q, limit }, signal) {
	const query = String(q).trim();
	const key = `${source}:${query.toLowerCase()}:${limit}`;
	const cached = cacheGet(key);
	if (cached) return Promise.resolve(cached);

	const params = new URLSearchParams({
		source,
		q: query,
		limit: String(limit)
	});

	return fetch(`/api/suggest?${params}`, {
		credentials: "include",
		signal
	})
		.then((r) => (r.ok ? r.json() : { items: [] }))
		.then((data) => {
			const items = Array.isArray(data?.items) ? data.items : [];
			cacheSet(key, items);
			return items;
		})
		.catch((err) => {
			if (err?.name === "AbortError") return [];
			return [];
		});
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

function getMentionSuggestions({ source, q, limit }, signal) {
	const qTrimmed = String(q).trim();
	const qLower = qTrimmed.toLowerCase();
	const limitNum = Math.min(Math.max(1, Number(limit) || 10), 20);

	const pageList = filterAndSortMentionItems(Array.from(pageUsersMap.values()), qLower);
	const pageIds = new Set(pageList.map((item) => String(item.id)));

	const key = `${source}:${qLower}:${limitNum}`;
	const cached = cacheGet(key);
	const apiPromise = cached
		? Promise.resolve(cached)
		: fetch(`/api/suggest?source=users&q=${encodeURIComponent(qTrimmed)}&limit=${limitNum}`, {
			credentials: "include",
			signal
		})
			.then((r) => (r.ok ? r.json() : { items: [] }))
			.then((data) => {
				const items = Array.isArray(data?.items) ? data.items : [];
				cacheSet(key, items);
				return items;
			})
			.catch((err) => {
				if (err?.name === "AbortError") return [];
				return [];
			});

	return apiPromise.then((apiItems) => {
		const merged = [...pageList];
		for (const item of apiItems) {
			if (merged.length >= limitNum) break;
			const id = item?.id != null ? String(item.id) : "";
			if (!id || pageIds.has(id)) continue;
			merged.push(item);
		}
		return merged.slice(0, limitNum);
	});
}

function attachWindowListeners() {
	if (windowListenersAttached) return;
	windowListenersAttached = true;

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
	} else {
		popup.style.bottom = "";
		popup.style.top = `${Math.max(0, rect.bottom)}px`;
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
	if (state.requestController) {
		state.requestController.abort();
		state.requestController = null;
	}

	state.isOpen = false;
	state.items = [];
	state.selectedIndex = -1;
	state.currentTrigger = null;
	state.triggerStart = -1;
	state.requestToken += 1;

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
	popup.style.display = "block";
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

function requestSuggestions(textarea, ctx) {
	const state = stateByTextarea.get(textarea);
	if (!state) return;

	if (state.requestController) state.requestController.abort();
	state.requestController = new AbortController();
	state.requestToken += 1;
	const token = state.requestToken;

	state.triggerStart = ctx.start;
	state.currentTrigger = ctx.trigger;

	const requestedQuery = ctx.query;
	const qLower = requestedQuery.toLowerCase();
	const filtered = applyLocalFilter(ctx.trigger.source, state.items, qLower);
	if (filtered.length > 0) {
		state.items = filtered;
		state.selectedIndex = 0;
		renderPopup(textarea);
	} else {
		state.items = [];
		state.selectedIndex = -1;
		renderPopup(textarea, "loading");
	}

	state.getSuggestions({
		source: ctx.trigger.source,
		q: requestedQuery,
		limit: 10
	}, state.requestController.signal).then((items) => {
		const current = stateByTextarea.get(textarea);
		if (!current || token !== current.requestToken) return;
		if (document.activeElement !== textarea) return;

		const nowCtx = getTriggerContext(textarea, current.triggers);
		if (!nowCtx || nowCtx.trigger.char !== ctx.trigger.char) {
			closePopupFor(textarea);
			return;
		}

		const nowLower = nowCtx.query.toLowerCase();
		const nextItems = nowCtx.query === requestedQuery
			? items
			: applyLocalFilter(nowCtx.trigger.source, items, nowLower);

		current.triggerStart = nowCtx.start;
		current.currentTrigger = nowCtx.trigger;
		current.items = nextItems;
		current.selectedIndex = nextItems.length > 0 ? 0 : -1;
		renderPopup(textarea, nextItems.length > 0 ? undefined : "empty");
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
		isOpen: false
	};
	stateByTextarea.set(textarea, state);

	function scheduleRefresh() {
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
			requestSuggestions(textarea, ctx);
		}, DEBOUNCE_MS);
	}

	function refreshImmediately() {
		const current = stateByTextarea.get(textarea);
		if (!current) return;
		if (current.debounceTimer) {
			clearTimeout(current.debounceTimer);
			current.debounceTimer = null;
		}

		const ctx = getTriggerContext(textarea, current.triggers);
		if (!ctx) {
			closePopupFor(textarea);
			return;
		}
		requestSuggestions(textarea, ctx);
	}

	function onInput() {
		scheduleRefresh();
	}

	function onFocus() {
		const ctx = getTriggerContext(textarea, triggers);
		if (!ctx) return;
		refreshImmediately();
	}

	function onBlur() {
		setTimeout(() => {
			if (document.activeElement === textarea) return;
			const popup = getPopup();
			if (popup.contains(document.activeElement)) return;
			closePopupFor(textarea);
		}, 0);
	}

	function onKeydown(e) {
		const current = stateByTextarea.get(textarea);
		if (!current) return;

		const popupOpen = isPopupOpenFor(textarea);
		const hasSelection = current.selectedIndex >= 0 && !!current.items[current.selectedIndex];

		if (e.key === "Escape") {
			if (!popupOpen) return;
			e.preventDefault();
			closePopupFor(textarea);
			return;
		}

		if (!popupOpen) return;

		if (e.key === "ArrowDown") {
			e.preventDefault();
			updateSelection(textarea, current.selectedIndex < 0 ? 0 : current.selectedIndex + 1);
			return;
		}

		if (e.key === "ArrowUp") {
			e.preventDefault();
			updateSelection(textarea, current.selectedIndex <= 0 ? 0 : current.selectedIndex - 1);
			return;
		}

		if (e.key === "Home") {
			e.preventDefault();
			updateSelection(textarea, 0);
			return;
		}

		if (e.key === "End") {
			e.preventDefault();
			updateSelection(textarea, current.items.length - 1);
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
	textarea.addEventListener("keydown", onKeydown);
}

export function attachMentionSuggest(textarea) {
	attachTriggeredSuggest(textarea, {
		triggers: [{ char: "@", minChars: 1, source: "users" }],
		getSuggestions: getMentionSuggestions
	});
}
