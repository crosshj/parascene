/**
 * Lightweight request timing for GET /api/feed (Feed [beta] debugging).
 */

/**
 * @param {{ name: string, ms: number }[]} segments
 * @returns {Record<string, number>}
 */
export function feedTimingSegmentsToObject(segments) {
	const out = {};
	for (let i = 0; i < segments.length; i += 1) {
		const entry = segments[i];
		if (!entry?.name) continue;
		out[`${i + 1}_${entry.name}`] = Math.max(0, Math.round(Number(entry.ms) || 0));
	}
	return out;
}

/**
 * @param {number} [anchorMs] — when timing starts (defaults to now). Use request entry for total_ms.
 * @returns {{
 *   add: (name: string, ms: number, meta?: object) => void,
 *   time: <T>(name: string, fn: () => T) => T,
 *   timeAsync: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>,
 *   finish: (meta?: object) => { total_ms: number, server_handler_ms: number, segments: Record<string, number> }
 * }}
 */
export function createFeedTiming(anchorMs) {
	const segments = [];
	const started = Number.isFinite(anchorMs) ? anchorMs : performance.now();

	return {
		add(name, ms, meta) {
			const entry = { name, ms: Math.max(0, Math.round(ms)) };
			if (meta && typeof meta === 'object') {
				for (const [key, value] of Object.entries(meta)) {
					if (value !== undefined) entry[key] = value;
				}
			}
			segments.push(entry);
		},
		time(name, fn) {
			const t0 = performance.now();
			try {
				return fn();
			} finally {
				this.add(name, performance.now() - t0);
			}
		},
		async timeAsync(name, fn) {
			const t0 = performance.now();
			try {
				return await fn();
			} finally {
				this.add(name, performance.now() - t0);
			}
		},
		finish(meta) {
			const totalMs = Math.max(0, Math.round(performance.now() - started));
			const out = {
				total_ms: totalMs,
				server_handler_ms: totalMs,
				segments: feedTimingSegmentsToObject(segments)
			};
			if (meta && typeof meta === 'object') {
				for (const [key, value] of Object.entries(meta)) {
					if (value !== undefined) out[key] = value;
				}
			}
			return out;
		}
	};
}

/**
 * @param {ReturnType<createFeedTiming>|null|undefined} timing
 * @param {string} name
 * @param {Promise<T>} promise
 * @returns {Promise<T>}
 * @template T
 */
export function wrapTimedPromise(timing, name, promise) {
	if (!timing) return promise;
	const t0 = performance.now();
	return Promise.resolve(promise).then(
		(value) => {
			timing.add(name, performance.now() - t0);
			return value;
		},
		(err) => {
			timing.add(name, performance.now() - t0);
			throw err;
		}
	);
}
