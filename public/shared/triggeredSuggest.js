/**
 * General triggered-suggestion system for text inputs (e.g. @mentions, #tags, styles).
 * Config-driven; attach via attachTriggeredSuggest(textarea, options).
 * Mention preset: attachMentionSuggest(textarea).
 */

const DEBOUNCE_MS = 130;
const POPUP_CLASS = "triggered-suggest-popup";
const ITEM_CLASS = "triggered-suggest-item";
const ITEM_SELECTED_CLASS = "triggered-suggest-item--selected";

let sharedPopup = null;
let activeController = null;
/** Textarea that currently has the popup open; used to reposition on scroll/resize instead of closing. */
let activeTextarea = null;
/** Set when popup is open with items; invoked from document capture Tab handler so we run before any other listener. */
let activeAcceptCallback = null;

const POPUP_ID = "triggered-suggest-listbox";

function getPopup() {
	if (sharedPopup && sharedPopup.parentNode) return sharedPopup;
	sharedPopup = document.createElement("div");
	sharedPopup.id = POPUP_ID;
	sharedPopup.className = POPUP_CLASS;
	sharedPopup.setAttribute("role", "listbox");
	sharedPopup.setAttribute("aria-hidden", "true");
	sharedPopup.style.display = "none";
	document.body.appendChild(sharedPopup);
	return sharedPopup;
}

function hidePopup() {
	const popup = getPopup();
	popup.style.display = "none";
	popup.setAttribute("aria-hidden", "true");
	if (activeTextarea) {
		activeTextarea.setAttribute("aria-expanded", "false");
		activeTextarea.removeAttribute("aria-controls");
		activeTextarea.removeAttribute("aria-activedescendant");
	}
	activeTextarea = null;
	activeAcceptCallback = null;
	if (activeController) {
		activeController.selectedIndex = -1;
		activeController = null;
	}
}

const POPUP_MAX_HEIGHT = 280;
const POPUP_OPEN_ABOVE_THRESHOLD = 240;

function positionPopup(el, popup) {
	const rect = el.getBoundingClientRect();
	const spaceBelow = window.innerHeight - rect.bottom;
	const openAbove = spaceBelow < POPUP_OPEN_ABOVE_THRESHOLD;

	popup.style.position = "fixed";
	popup.style.left = `${rect.left}px`;
	popup.style.minWidth = `${Math.max(rect.width, 220)}px`;

	if (openAbove) {
		popup.style.top = "";
		popup.style.bottom = `${window.innerHeight - rect.top}px`;
	} else {
		popup.style.bottom = "";
		popup.style.top = `${rect.bottom}px`;
	}
}

const SUGGEST_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SUGGEST_CACHE_MAX_ENTRIES = 100;
const suggestCache = new Map();

function defaultGetSuggestions({ source, q, limit }, _signal) {
	const key = `${source}:${String(q).trim().toLowerCase()}:${limit}`;
	const cached = suggestCache.get(key);
	const now = Date.now();
	if (cached && now - cached.ts < SUGGEST_CACHE_TTL_MS) {
		return Promise.resolve(cached.items);
	}
	const params = new URLSearchParams({ source, q: String(q).trim(), limit: String(limit) });
	return fetch(`/api/suggest?${params}`, { credentials: "include" })
		.then((r) => (r.ok ? r.json() : { items: [] }))
		.then((data) => {
			const items = Array.isArray(data?.items) ? data.items : [];
			if (suggestCache.size >= SUGGEST_CACHE_MAX_ENTRIES) {
				const firstKey = suggestCache.keys().next().value;
				if (firstKey != null) suggestCache.delete(firstKey);
			}
			suggestCache.set(key, { items, ts: Date.now() });
			return items;
		})
		.catch(() => []);
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
	const raw = (item.sublabel || item.insert_text || "").replace(/^@/, "").trim();
	return raw.toLowerCase();
}

/** Page users: users visible on the current page (feed authors, creation author, commenters). Seeded on load and updated as content loads. */
const pageUsersMap = new Map();

/** Normalize raw user shape to suggest item. Accepts { user_id, user_name, display_name, avatar_url } or full suggest item. */
function toMentionItem(raw) {
	if (raw?.type === "user" && raw?.id != null) {
		return {
			type: "user",
			id: String(raw.id),
			label: raw.label ?? "",
			sublabel: raw.sublabel ?? (raw.insert_text ? raw.insert_text.replace(/\s+$/, "").trim() : undefined),
			icon_url: raw.icon_url,
			insert_text: raw.insert_text ?? (raw.sublabel ? `${raw.sublabel} ` : undefined)
		};
	}
	const id = raw?.user_id ?? raw?.id;
	if (id == null) return null;
	const user_name = (raw?.user_name != null ? String(raw.user_name).trim() : "") || "";
	const display_name = (raw?.display_name != null ? String(raw.display_name).trim() : "") || "";
	const label = display_name || user_name || "User";
	const sublabel = user_name ? `@${user_name}` : "";
	const insert_text = user_name ? `@${user_name} ` : "";
	return {
		type: "user",
		id: String(id),
		label,
		sublabel: sublabel || undefined,
		icon_url: raw?.avatar_url != null ? String(raw.avatar_url).trim() || undefined : undefined,
		insert_text: insert_text || undefined
	};
}

/** Add users visible on the page so they appear in @mention suggestions (prefix-first, then substring). Call when feed/creation/comments load. */
export function addPageUsers(items) {
	if (!Array.isArray(items)) return;
	for (const raw of items) {
		const item = toMentionItem(raw);
		if (item?.id) pageUsersMap.set(item.id, item);
	}
}

/** Clear page users (e.g. when navigating to a new creation or feed). Call at start of load when context changes. */
export function clearPageUsers() {
	pageUsersMap.clear();
}

/** Filter and sort items by query: prefix matches first, then substring; same order as API. */
function filterAndSortMentionItems(items, qLower) {
	if (!qLower) return items.slice();
	const withHandle = items.map((item) => ({ item, handle: itemHandle(item) }));
	const matching = withHandle.filter(({ handle }) => handle.includes(qLower));
	matching.sort((a, b) => {
		const aPrefix = a.handle.startsWith(qLower) ? 0 : 1;
		const bPrefix = b.handle.startsWith(qLower) ? 0 : 1;
		if (aPrefix !== bPrefix) return aPrefix - bPrefix;
		return a.handle.localeCompare(b.handle);
	});
	return matching.map(({ item }) => item);
}

/** getSuggestions for users: merge page users (filtered, prefix-first) with API results; page users first, then API, deduped by id. */
function getMentionSuggestions({ source, q, limit }) {
	const qLower = String(q).trim().toLowerCase();
	const pageList = filterAndSortMentionItems(Array.from(pageUsersMap.values()), qLower);
	const pageIds = new Set(pageList.map((i) => i.id));
	const limitNum = Math.min(Math.max(1, Number(limit) || 10), 20);

	const key = `${source}:${qLower}:${limitNum}`;
	const cached = suggestCache.get(key);
	const now = Date.now();
	const useCache = cached && now - cached.ts < SUGGEST_CACHE_TTL_MS;

	const apiPromise = useCache
		? Promise.resolve(cached.items)
		: fetch(`/api/suggest?source=users&q=${encodeURIComponent(String(q).trim())}&limit=${limitNum}`, { credentials: "include" })
			.then((r) => (r.ok ? r.json() : { items: [] }))
			.then((data) => {
				const items = Array.isArray(data?.items) ? data.items : [];
				if (suggestCache.size >= SUGGEST_CACHE_MAX_ENTRIES) {
					const firstKey = suggestCache.keys().next().value;
					if (firstKey != null) suggestCache.delete(firstKey);
				}
				suggestCache.set(key, { items, ts: Date.now() });
				return items;
			})
			.catch(() => []);

	return apiPromise.then((apiItems) => {
		const merged = [...pageList];
		for (const r of apiItems) {
			if (merged.length >= limitNum) break;
			if (r?.id && !pageIds.has(String(r.id))) merged.push(r);
		}
		return merged.slice(0, limitNum);
	});
}

/** Window capture listener for Tab so we run first and fully consume the event (no bubble, no other listeners). */
function onWindowKeydownCapture(e) {
	if (e.key !== "Tab") return;
	if (!activeTextarea || document.activeElement !== activeTextarea) return;
	const popup = getPopup();
	if (popup.style.display !== "block" || typeof activeAcceptCallback !== "function") return;
	const c = activeController;
	if (!c?.items?.length || c.selectedIndex < 0 || !c.items[c.selectedIndex]) return;
	e.preventDefault();
	e.stopPropagation();
	e.stopImmediatePropagation();
	activeAcceptCallback(e.shiftKey);
}

/** Focusable elements in document order (for Tab/Shift+Tab after accept). */
const FOCUSABLE_SELECTOR = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";

function getFocusables() {
	return Array.from(document.body.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
		return el.offsetParent !== null && !el.hasAttribute("hidden") && (el.getAttribute("aria-hidden") !== "true");
	});
}

function focusNextFocusable(fromEl, backward = false) {
	const list = getFocusables();
	const i = list.indexOf(fromEl);
	if (i === -1) return false;
	const next = backward ? list[i - 1] : list[i + 1];
	if (next) {
		next.focus();
		return true;
	}
	return false;
}

/**
 * @param {HTMLTextAreaElement} textarea
 * @param {{
 *   triggers: Array<{ char: string, minChars: number, source: string }>;
 *   getSuggestions?: (opts: { source: string, q: string, limit: number }) => Promise<Array<object>>;
 *   getInsertText?: (item: object, trigger: { char: string, source: string }) => string;
 * }} options
 */
const ATTR_ATTACHED = "data-triggered-suggest-attached";
let windowCaptureAttached = false;
/** True after first keydown/mousedown/touchstart so we don't show popup on load when a field is pre-filled with an incomplete mention. */
let userHasInteracted = false;

function setUserHasInteracted() {
	userHasInteracted = true;
}

function ensureWindowCapture() {
	if (windowCaptureAttached) return;
	windowCaptureAttached = true;
	window.addEventListener("keydown", onWindowKeydownCapture, true);
	window.addEventListener("keydown", setUserHasInteracted, true);
	window.addEventListener("mousedown", setUserHasInteracted, true);
	window.addEventListener("touchstart", setUserHasInteracted, true);
}

export function attachTriggeredSuggest(textarea, options) {
	if (!textarea || !(textarea instanceof HTMLTextAreaElement)) return;
	if (textarea.getAttribute(ATTR_ATTACHED) === "true") return;

	const triggers = Array.isArray(options?.triggers) ? options.triggers : [];
	if (triggers.length === 0) return;
	ensureWindowCapture();
	textarea.setAttribute(ATTR_ATTACHED, "true");
	textarea.setAttribute("aria-haspopup", "listbox");
	textarea.setAttribute("aria-autocomplete", "list");

	const getSuggestions = typeof options?.getSuggestions === "function"
		? options.getSuggestions
		: defaultGetSuggestions;
	const getInsertText = typeof options?.getInsertText === "function"
		? options.getInsertText
		: defaultGetInsertText;

	let debounceTimer = null;
	let selectedIndex = -1;
	let currentItems = [];
	let currentTrigger = null;
	let triggerStart = -1;

	function getTriggerAndQuery() {
		const value = textarea.value;
		let pos = textarea.selectionStart;
		if (pos == null || pos < 0) pos = value.length;
		if (pos <= 0) return null;
		for (const t of triggers) {
			const char = t.char;
			const idx = value.lastIndexOf(char, pos - 1);
			if (idx === -1) continue;
			const after = value.slice(idx + 1, pos);
			const invalidChar = /[\s\n\r]/.test(after);
			if (invalidChar) continue;
			const query = after.trim();
			if (query.length >= (t.minChars ?? 1)) {
				return { trigger: t, query, start: idx, end: pos };
			}
		}
		return null;
	}

	function renderPopup(items, trigger, state) {
		const popup = getPopup();
		popup.innerHTML = "";
		// state: "loading" | "empty" | "list"
		const showEmpty = state === "empty" || (state !== "loading" && items.length === 0);
		const showLoading = state === "loading";
		if (showLoading) {
			const row = document.createElement("div");
			row.className = ITEM_CLASS + " triggered-suggest-item--loading";
			row.textContent = "Loading…";
			popup.appendChild(row);
		} else if (showEmpty) {
			const row = document.createElement("div");
			row.className = ITEM_CLASS + " triggered-suggest-item--empty";
			row.textContent = "No users found";
			popup.appendChild(row);
		} else if (items.length === 0) {
			popup.style.display = "none";
			return;
		}
		if (items.length === 0) {
		positionPopup(textarea, popup);
		popup.style.display = "block";
		popup.setAttribute("aria-hidden", "false");
		activeTextarea = textarea;
		textarea.setAttribute("aria-expanded", "true");
		textarea.setAttribute("aria-controls", POPUP_ID);
		return;
	}
		activeTextarea = textarea;
		textarea.setAttribute("aria-expanded", "true");
		textarea.setAttribute("aria-controls", POPUP_ID);
		items.forEach((item, i) => {
			const el = document.createElement("div");
			el.id = `triggered-suggest-option-${i}`;
			el.className = ITEM_CLASS + (i === selectedIndex ? ` ${ITEM_SELECTED_CLASS}` : "");
			el.setAttribute("role", "option");
			el.setAttribute("aria-selected", i === selectedIndex ? "true" : "false");
			el.setAttribute("data-index", String(i));

			const icon = document.createElement("div");
			icon.className = "triggered-suggest-item-icon";
			if (item.icon_url) {
				const img = document.createElement("img");
				img.src = item.icon_url;
				img.alt = "";
				img.className = "triggered-suggest-item-avatar";
				icon.appendChild(img);
			} else {
				const initial = (item.label || "?").charAt(0).toUpperCase();
				icon.textContent = initial;
			}

			const text = document.createElement("div");
			text.className = "triggered-suggest-item-text";
			const labelEl = document.createElement("div");
			labelEl.className = "triggered-suggest-item-label";
			labelEl.textContent = item.label ?? "";
			text.appendChild(labelEl);
			if (item.sublabel) {
				const sub = document.createElement("div");
				sub.className = "triggered-suggest-item-sublabel";
				sub.textContent = item.sublabel;
				text.appendChild(sub);
			}

			el.appendChild(icon);
			el.appendChild(text);
			if (item.badge) {
				const badge = document.createElement("span");
				badge.className = "triggered-suggest-item-badge";
				badge.textContent = item.badge;
				el.appendChild(badge);
			}

			el.addEventListener("click", (e) => {
				e.preventDefault();
				selectItem(i);
			});
			popup.appendChild(el);
		});

		positionPopup(textarea, popup);
		popup.style.display = "block";
		popup.setAttribute("aria-hidden", "false");
		if (selectedIndex >= 0) {
			textarea.setAttribute("aria-activedescendant", `triggered-suggest-option-${selectedIndex}`);
		}

		const sel = popup.querySelector(`.${ITEM_SELECTED_CLASS}`);
		if (sel) sel.scrollIntoView({ block: "nearest" });
	}

	function selectItem(index) {
		const item = currentItems[index];
		const trigger = currentTrigger;
		if (!item || !trigger) return;
		const insertText = getInsertText(item, trigger);
		if (triggerStart < 0 || insertText === "") {
			hidePopup();
			return;
		}
		const end = textarea.selectionStart;
		const value = textarea.value;
		const before = value.slice(0, triggerStart);
		const after = value.slice(end);
		textarea.value = before + insertText + after;
		textarea.selectionStart = textarea.selectionEnd = before.length + insertText.length;
		textarea.focus();
		hidePopup();
		currentItems = [];
		currentTrigger = null;
		triggerStart = -1;
		selectedIndex = -1;
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
	}

	function updateSelection() {
		const popup = getPopup();
		popup.querySelectorAll(`.${ITEM_CLASS}`).forEach((el, i) => {
			el.classList.toggle(ITEM_SELECTED_CLASS, i === selectedIndex);
			el.setAttribute("aria-selected", i === selectedIndex ? "true" : "false");
		});
		if (activeTextarea) {
			if (selectedIndex >= 0) {
				activeTextarea.setAttribute("aria-activedescendant", `triggered-suggest-option-${selectedIndex}`);
			} else {
				activeTextarea.removeAttribute("aria-activedescendant");
			}
		}
		const sel = popup.querySelector(`.${ITEM_SELECTED_CLASS}`);
		if (sel) sel.scrollIntoView({ block: "nearest" });
	}

	function onInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		const ctx = getTriggerAndQuery();
		if (!ctx) {
			hidePopup();
			currentItems = [];
			currentTrigger = null;
			triggerStart = -1;
			return;
		}
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			if (!userHasInteracted) return;
			triggerStart = ctx.start;
			currentTrigger = ctx.trigger;
			selectedIndex = 0;
			activeController = { selectedIndex: 0, items: [], trigger: ctx.trigger };

			const requestedQuery = ctx.query;
			const qLower = requestedQuery.toLowerCase();

			// Use previous results if they still match the new query (filter existing list); only show loading when we have nothing to show
			const filteredFromCache = ctx.trigger.source === "users"
				? filterAndSortMentionItems(currentItems, qLower)
				: currentItems.filter((item) => itemHandle(item).startsWith(qLower));

			if (filteredFromCache.length > 0) {
				currentItems = filteredFromCache;
				activeController.items = filteredFromCache;
				selectedIndex = 0;
				activeController.selectedIndex = 0;
				activeAcceptCallback = (shiftKey) => {
					selectItem(selectedIndex);
					setTimeout(() => focusNextFocusable(textarea, shiftKey), 0);
				};
				renderPopup(filteredFromCache, ctx.trigger, undefined);
			} else {
				activeAcceptCallback = null;
				renderPopup([], ctx.trigger, "loading");
			}

			getSuggestions({
				source: ctx.trigger.source,
				q: requestedQuery,
				limit: 10
			}).then((items) => {
				const nowCtx = getTriggerAndQuery();
				if (!nowCtx) return;
				if (nowCtx.query === requestedQuery) {
					currentItems = items;
					activeController.items = items;
					selectedIndex = items.length > 0 ? Math.min(selectedIndex, items.length - 1) : -1;
					activeController.selectedIndex = selectedIndex;
					activeAcceptCallback = items.length > 0 ? (shiftKey) => {
						selectItem(selectedIndex);
						setTimeout(() => focusNextFocusable(textarea, shiftKey), 0);
					} : null;
					renderPopup(items, ctx.trigger, items.length === 0 ? "empty" : undefined);
					return;
				}
				if (nowCtx.query.startsWith(requestedQuery)) {
					const nowLower = nowCtx.query.toLowerCase();
					const filtered = nowCtx.trigger.source === "users"
						? filterAndSortMentionItems(items, nowLower)
						: items.filter((item) => itemHandle(item).startsWith(nowLower));
					currentItems = filtered;
					activeController.items = filtered;
					selectedIndex = filtered.length > 0 ? 0 : -1;
					activeController.selectedIndex = selectedIndex;
					activeAcceptCallback = filtered.length > 0 ? (shiftKey) => {
						selectItem(selectedIndex);
						setTimeout(() => focusNextFocusable(textarea, shiftKey), 0);
					} : null;
					renderPopup(filtered, nowCtx.trigger, filtered.length === 0 ? "empty" : undefined);
				}
			});
		}, DEBOUNCE_MS);
	}

	function onKeydown(e) {
		const popupOpen = getPopup().style.display === "block";

		if (e.key === "Escape") {
			if (popupOpen) {
				e.preventDefault();
				hidePopup();
				currentItems = [];
				currentTrigger = null;
				triggerStart = -1;
				selectedIndex = -1;
			}
			return;
		}

		if (!popupOpen || currentItems.length === 0) return;

		// Listbox-style keyboard: only handle when we have items and a valid selection for "accept" keys
		const canAccept = selectedIndex >= 0 && currentItems[selectedIndex];

		if (e.key === "Tab") {
			if (canAccept) {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				selectItem(selectedIndex);
				setTimeout(() => focusNextFocusable(textarea, e.shiftKey), 0);
			}
			return;
		}

		if (e.key === "Enter" && canAccept) {
			e.preventDefault();
			selectItem(selectedIndex);
			return;
		}

		if (e.key === "ArrowDown") {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, currentItems.length - 1);
			if (activeController) activeController.selectedIndex = selectedIndex;
			updateSelection();
			return;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
			if (activeController) activeController.selectedIndex = selectedIndex;
			updateSelection();
			return;
		}
		if (e.key === "Home") {
			e.preventDefault();
			selectedIndex = 0;
			if (activeController) activeController.selectedIndex = selectedIndex;
			updateSelection();
			return;
		}
		if (e.key === "End") {
			e.preventDefault();
			selectedIndex = currentItems.length - 1;
			if (activeController) activeController.selectedIndex = selectedIndex;
			updateSelection();
			return;
		}
	}

	function onBlur() {
		// Defer so a click on a suggestion can run first; then hide only if field still doesn't have focus
		const popup = getPopup();
		setTimeout(() => {
			if (popup.style.display !== "block") return;
			if (activeTextarea && document.activeElement === activeTextarea) return;
			hidePopup();
		}, 150);
	}

	function onFocus() {
		if (!userHasInteracted) return;
		const ctx = getTriggerAndQuery();
		if (!ctx) return;
		activeTextarea = textarea;
		triggerStart = ctx.start;
		currentTrigger = ctx.trigger;
		selectedIndex = 0;
		const qLower = ctx.query.toLowerCase();
		const filtered = ctx.trigger.source === "users"
			? filterAndSortMentionItems(currentItems, qLower)
			: currentItems.filter((item) => itemHandle(item).startsWith(qLower));
		activeController = { selectedIndex: 0, items: filtered.length > 0 ? filtered : [], trigger: ctx.trigger };
		if (filtered.length > 0) {
			currentItems = filtered;
			activeController.items = filtered;
			activeAcceptCallback = (shiftKey) => {
				selectItem(selectedIndex);
				setTimeout(() => focusNextFocusable(textarea, shiftKey), 0);
			};
			renderPopup(filtered, ctx.trigger, undefined);
		} else {
			activeAcceptCallback = null;
			renderPopup([], ctx.trigger, "loading");
			getSuggestions({ source: ctx.trigger.source, q: ctx.query, limit: 10 }).then((items) => {
				const nowCtx = getTriggerAndQuery();
				if (!nowCtx || nowCtx.query !== ctx.query) return;
				currentItems = items;
				activeController.items = items;
				selectedIndex = items.length > 0 ? Math.min(selectedIndex, items.length - 1) : -1;
				activeController.selectedIndex = selectedIndex;
				activeAcceptCallback = items.length > 0 ? (shiftKey) => {
					selectItem(selectedIndex);
					setTimeout(() => focusNextFocusable(textarea, shiftKey), 0);
				} : null;
				renderPopup(items, ctx.trigger, items.length === 0 ? "empty" : undefined);
			});
		}
	}

	textarea.addEventListener("input", onInput);
	textarea.addEventListener("keydown", onKeydown, true);
	textarea.addEventListener("blur", onBlur);
	textarea.addEventListener("focus", onFocus);

	// Reposition popup on scroll/resize so it stays aligned with the input (don't close)
	function repositionIfOpen() {
		const popup = getPopup();
		if (activeTextarea && popup.style.display === "block") {
			positionPopup(activeTextarea, popup);
		}
	}
	window.addEventListener("scroll", repositionIfOpen);
	window.addEventListener("resize", repositionIfOpen);
}

/** Mention preset: @ trigger, source users; uses page users (feed/creation/comment authors) first, then API. */
export function attachMentionSuggest(textarea) {
	attachTriggeredSuggest(textarea, {
		triggers: [{ char: "@", minChars: 1, source: "users" }],
		getSuggestions: getMentionSuggestions
	});
}
