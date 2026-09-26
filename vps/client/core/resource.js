function safeRead(cache) {
	try { return cache?.read?.() ?? null; } catch { return null; }
}

export function createResource({ key, load, cache, initialData, maxAge = 60_000 } = {}) {
	if (typeof load !== 'function') throw new TypeError('A resource requires a load function');
	const cached = initialData === undefined ? safeRead(cache) : null;
	let data = initialData !== undefined ? initialData : cached?.data;
	let error = null;
	let updatedAt = cached?.updatedAt || 0;
	let status = data === undefined ? 'idle' : (Date.now() - updatedAt > maxAge ? 'stale' : 'ready');
	let generation = 0;
	let controller = null;
	const subscribers = new Set();
	function snapshot() { return { key, status, data, error, updatedAt, isLoading: status === 'loading', isRefreshing: status === 'refreshing' }; }
	function notify(subscriber, value) {
		try { subscriber(value); } catch (reason) { console.error('[resource] subscriber failed', reason); }
	}
	function publish() { const value = snapshot(); for (const subscriber of subscribers) notify(subscriber, value); }
	function setData(next, { persist = true, updated = Date.now() } = {}) {
		data = next;
		error = null;
		updatedAt = updated;
		status = 'ready';
		if (persist) { try { cache?.write?.({ data, updatedAt }); } catch { /* Cache failure must never break UI state. */ } }
		publish();
		return data;
	}
	async function refresh({ force = false } = {}) {
		if (controller && !force) return controller.promise;
		if (controller) controller.abort();
		const requestId = ++generation;
		const nextController = new AbortController();
		controller = nextController;
		status = data === undefined ? 'loading' : 'refreshing';
		error = null;
		publish();
		const promise = Promise.resolve().then(() => load({ signal: nextController.signal, current: data }));
		nextController.promise = promise;
		try {
			const result = await promise;
			if (requestId !== generation) return data;
			setData(result);
			return data;
		} catch (reason) {
			if (reason?.name === 'AbortError' || requestId !== generation) return data;
			error = reason;
			status = data === undefined ? 'error' : 'stale-error';
			publish();
			throw reason;
		} finally {
			if (requestId === generation) controller = null;
		}
	}
	return {
		getSnapshot: snapshot,
		get data() { return data; },
		get status() { return status; },
		get error() { return error; },
		isStale() { return !updatedAt || Date.now() - updatedAt > maxAge; },
		loadIfNeeded() { return status === 'idle' || status === 'stale' || status === 'stale-error' ? refresh() : Promise.resolve(data); },
		refresh,
		setData,
		update(updater, options) { return setData(updater(data), options); },
		subscribe(subscriber, { immediate = true } = {}) { subscribers.add(subscriber); if (immediate) notify(subscriber, snapshot()); return () => subscribers.delete(subscriber); },
		destroy() { generation++; controller?.abort(); controller = null; subscribers.clear(); }
	};
}
