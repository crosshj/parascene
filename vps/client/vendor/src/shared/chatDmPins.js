/**
 * Client-only ordering: pinned DMs appear directly under notes-to-self (see sortDmsWithPinnedOrder).
 */

export const CHAT_DM_PINS_STORAGE_KEY = 'prsn-chat-dm-pins-v1';

const MAX_PINS = 40;

export function readDmPinKeysOrdered() {
	try {
		const raw = window.localStorage?.getItem(CHAT_DM_PINS_STORAGE_KEY);
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return [];
		return arr.filter((x) => typeof x === 'string' && x.length > 0).slice(0, MAX_PINS);
	} catch {
		return [];
	}
}

export function writeDmPinKeysOrdered(keys) {
	try {
		const next = keys.filter((x) => typeof x === 'string' && x.length > 0).slice(0, MAX_PINS);
		window.localStorage?.setItem(CHAT_DM_PINS_STORAGE_KEY, JSON.stringify(next));
	} catch {
		// ignore
	}
}

export function isDmPinKeyActive(key) {
	if (!key) return false;
	return readDmPinKeysOrdered().includes(key);
}

export function pinDmKey(key) {
	if (!key) return;
	const cur = readDmPinKeysOrdered().filter((k) => k !== key);
	cur.unshift(key);
	writeDmPinKeysOrdered(cur);
}

export function unpinDmKey(key) {
	if (!key) return;
	writeDmPinKeysOrdered(readDmPinKeysOrdered().filter((k) => k !== key));
}
