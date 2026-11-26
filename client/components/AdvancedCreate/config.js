import { requestJson } from '../../core/request.js';

const MAX_AGE_MS = 60_000;

/** In-memory copy. A reload starts empty and fetches again. */
let memory = null;
let pending = null;

function fresh() {
	if (!memory) return null;
	if (Date.now() - memory.updatedAt > MAX_AGE_MS) return null;
	return memory.data;
}

/** Read memory. Fetch when the copy is missing or older than a minute. */
export function loadAdvancedConfig() {
	const cached = fresh();
	if (cached) return Promise.resolve(cached);
	if (pending) return pending;
	pending = requestJson('/api/create/advanced-config')
		.then((data) => {
			memory = { data, updatedAt: Date.now() };
			return data;
		})
		.finally(() => {
			pending = null;
		});
	return pending;
}
