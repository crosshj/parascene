const TABLE = "prsn_unhandled_requests";
const FLUSH_MS = 5_000;
const RETRY_MS = 60_000;
const MAX_PENDING = 200;

function rowKey(row) {
	return [row.method, row.path_key, row.host, row.app_version].join("\n");
}

function isDuplicate(error) {
	return error?.code === "23505" || /duplicate key/i.test(error?.message || "");
}

async function upsertRow(client, row, allowRetry) {
	const existing = await client
		.from(TABLE)
		.select("id,hit_count")
		.eq("method", row.method)
		.eq("path_key", row.path_key)
		.eq("host", row.host)
		.eq("app_version", row.app_version)
		.maybeSingle();
	if (existing.error) throw existing.error;
	if (existing.data) {
		const updated = await client
			.from(TABLE)
			.update({
				hit_count: Number(existing.data.hit_count || 0) + row.hit_count,
				last_seen_at: row.last_seen_at,
				query_keys: row.query_keys,
				user_agent: row.user_agent
			})
			.eq("id", existing.data.id);
		if (updated.error) throw updated.error;
		return;
	}
	const inserted = await client.from(TABLE).insert(row);
	if (inserted.error) {
		if (allowRetry && isDuplicate(inserted.error)) return upsertRow(client, row, false);
		throw inserted.error;
	}
}

/** Coalesce route misses in memory, then add them to the existing row for that path. */
export function createUnhandledRequestLog({ client, flushIntervalMs = FLUSH_MS, now = () => new Date() } = {}) {
	const pending = new Map();
	let timer = null;
	let flushing = null;
	let warned = false;

	function merge(row) {
		const key = rowKey(row);
		const current = pending.get(key);
		if (!current) {
			pending.set(key, { ...row });
			return;
		}
		current.hit_count += row.hit_count;
		current.last_seen_at = row.last_seen_at;
		current.query_keys = row.query_keys;
		current.user_agent = row.user_agent;
	}

	function arm(delay) {
		if (timer) return;
		timer = setTimeout(() => {
			timer = null;
			void flush();
		}, delay);
		if (typeof timer.unref === "function") timer.unref();
	}

	function record(entry) {
		const seenAt = now().toISOString();
		merge({
			...entry,
			hit_count: 1,
			first_seen_at: seenAt,
			last_seen_at: seenAt
		});
		if (pending.size >= MAX_PENDING) {
			void flush();
			return;
		}
		arm(flushIntervalMs);
	}

	async function write(rows) {
		for (let index = 0; index < rows.length; index += 1) {
			try {
				await upsertRow(client, rows[index], true);
			} catch (error) {
				for (const row of rows.slice(index)) merge(row);
				if (!warned) {
					warned = true;
					console.error("[unhandled] could not record request", error?.message || error);
				}
				arm(RETRY_MS);
				return;
			}
		}
	}

	function flush() {
		if (flushing) return flushing;
		if (!pending.size || !client) return Promise.resolve();
		const rows = [...pending.values()];
		pending.clear();
		flushing = write(rows).finally(() => {
			flushing = null;
		});
		return flushing;
	}

	return { record, flush };
}
