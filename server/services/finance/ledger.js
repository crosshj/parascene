import fs from "node:fs/promises";
import path from "node:path";

export const LEDGER_MARKER = "finance_ledger_v1";

export function starterLedger(env = process.env) {
	return {
		kind: LEDGER_MARKER,
		version: 2,
		currency: "USD",
		inceptionDate: String(env.FINANCE_INCEPTION_DATE || "2026-01-22"),
		accounts: [
			{ id: "business-checking", name: "Business checking", notes: "Rename or remove" },
			{ id: "business-card", name: "Business card", notes: "Rename or remove" }
		],
		categories: [
			"hosting", "database", "ai-api", "email", "payments", "domain",
			"storage", "contractors", "taxes", "revenue", "other"
		],
		recurring: [
			{ id: "cloudflare-domain", sortOrder: 2, name: "Cloudflare Domain", type: "expense", amount: 10.46, cadence: "yearly", startDate: "2026-01-22", nextDue: "", account: "business-card", active: true, estimate: false },
			{ id: "vercel", sortOrder: 3, name: "Vercel", type: "expense", amount: 26, cadence: "monthly", startDate: "2026-01-22", nextDue: "", account: "business-card", active: true, estimate: false },
			{ id: "supabase", sortOrder: 4, name: "Supabase", type: "expense", amount: 30, cadence: "monthly", startDate: "2026-01-22", nextDue: "", account: "business-card", active: true, estimate: false },
			{ id: "resend", sortOrder: 6, name: "Resend", type: "expense", amount: 20, cadence: "monthly", startDate: "2026-01-22", nextDue: "", account: "business-card", active: true, estimate: false }
		],
		transactions: [
			{ id: "stripe-2026-09-21", sortOrder: 1, date: "2026-09-21", type: "income", amount: 218, vendor: "Stripe", account: "business-checking", status: "actual" },
			{ id: "upstash-2026-09-21", sortOrder: 5, date: "2026-09-21", type: "expense", amount: 7.92, vendor: "Upstash", account: "business-card", status: "actual" },
			{ id: "replicate-2026-09-21", sortOrder: 7, date: "2026-09-21", type: "expense", amount: 650, vendor: "Replicate", account: "business-card", status: "actual" }
		],
		notes: [
			"Entries are ordered intentionally; edit amounts and dates as needed.",
			"Stripe is recorded as income; Upstash and Replicate are recorded as transactions."
		],
		updatedAt: new Date().toISOString()
	};
}

export function normalizeLedger(value, env = process.env) {
	const base = starterLedger(env);
	const input = value && typeof value === "object" ? value : {};
	return {
		...base,
		...input,
		kind: LEDGER_MARKER,
		version: 2,
		currency: String(input.currency || base.currency).toUpperCase(),
		inceptionDate: String(input.inceptionDate || base.inceptionDate),
		accounts: Array.isArray(input.accounts) ? input.accounts : base.accounts,
		categories: Array.isArray(input.categories) ? input.categories : base.categories,
		recurring: (Number(input.version || 0) < 2 ? base.recurring : (Array.isArray(input.recurring) ? input.recurring : base.recurring)).filter((entry) => entry?.id !== "stripe-fees").map((entry) => ({ ...entry, startDate: String(entry?.startDate || input.inceptionDate || base.inceptionDate) })),
		transactions: Number(input.version || 0) < 2 ? base.transactions : (Array.isArray(input.transactions) ? input.transactions : []),
		notes: (Array.isArray(input.notes) ? input.notes : []).filter((note) => !String(note).toLowerCase().includes("stripe fees")),
		updatedAt: new Date().toISOString()
	};
}

function parseLedger(body, env) {
	try {
		const parsed = JSON.parse(String(body || ""));
		return parsed?.kind === LEDGER_MARKER ? normalizeLedger(parsed, env) : null;
	} catch {
		return null;
	}
}

function parseRawLedger(body) {
	try {
		const parsed = JSON.parse(String(body || ""));
		return parsed?.kind === LEDGER_MARKER ? parsed : null;
	} catch {
		return null;
	}
}

function dmPairKey(a, b) {
	return [Number(a), Number(b)].sort((x, y) => x - y).join(":");
}

/** Local ledger owner: the awesome account. */
export const FINANCE_USER_ID = 219;

export async function resolveFinanceUser(sb, env = process.env) {
	const id = Number(env.FINANCE_USER_ID || FINANCE_USER_ID);
	const { data, error } = await sb.from("prsn_users").select("id,email").eq("id", id).maybeSingle();
	if (error) throw error;
	if (!data) throw new Error(`No finance user found for id ${id}`);
	return data;
}

export async function loadFinanceLedger(sb, user, env = process.env) {
	const pairKey = dmPairKey(user.id, user.id);
	let { data: thread, error } = await sb.from("prsn_chat_threads").select("id").eq("type", "dm").eq("dm_pair_key", pairKey).maybeSingle();
	if (error) throw error;
	if (!thread) {
		const created = await sb.from("prsn_chat_threads").insert({ type: "dm", dm_pair_key: pairKey, channel_slug: null }).select("id").single();
		if (created.error) throw created.error;
		thread = created.data;
		const member = await sb.from("prsn_chat_members").insert({ thread_id: thread.id, user_id: user.id });
		if (member.error) throw member.error;
	}
	const messages = await sb.from("prsn_chat_messages").select("id,body,created_at,meta").eq("thread_id", thread.id).order("created_at", { ascending: false }).limit(50);
	if (messages.error) throw messages.error;
	const found = (messages.data || []).find((row) => row.meta?.finance_ledger === LEDGER_MARKER || parseLedger(row.body, env));
	if (found) {
		const rawLedger = parseRawLedger(found.body);
		const ledger = normalizeLedger(rawLedger || starterLedger(env), env);
		if (rawLedger && Number(rawLedger.version || 0) < 2) {
			const updated = await sb.from("prsn_chat_messages").update({ body: JSON.stringify(ledger, null, 2), meta: { finance_ledger: LEDGER_MARKER, title: "Parascene finance ledger", edited_at: new Date().toISOString() } }).eq("id", found.id);
			if (updated.error) throw updated.error;
		}
		return { threadId: Number(thread.id), messageId: Number(found.id), ledger, createdAt: found.created_at };
	}
	const ledger = starterLedger(env);
	const inserted = await sb.from("prsn_chat_messages").insert({
		thread_id: thread.id,
		sender_id: user.id,
		body: JSON.stringify(ledger, null, 2),
		meta: { finance_ledger: LEDGER_MARKER, title: "Parascene finance ledger" }
	}).select("id,created_at").single();
	if (inserted.error) throw inserted.error;
	return { threadId: Number(thread.id), messageId: Number(inserted.data.id), ledger, createdAt: inserted.data.created_at };
}

export async function saveFinanceLedger(sb, state, value, { backupDir, env = process.env } = {}) {
	const ledger = normalizeLedger(value, env);
	await fs.mkdir(backupDir, { recursive: true });
	await fs.writeFile(path.join(backupDir, `${new Date().toISOString().replaceAll(":", "-")}.json`), JSON.stringify(state.ledger, null, 2));
	const result = await sb.from("prsn_chat_messages").update({ body: JSON.stringify(ledger, null, 2), meta: { finance_ledger: LEDGER_MARKER, title: "Parascene finance ledger", edited_at: new Date().toISOString() } }).eq("id", state.messageId);
	if (result.error) throw result.error;
	return { ...state, ledger };
}

/**
 * Process-local ledger. The first read resolves the finance user and the
 * notes-to-self message; later reads reuse that message.
 */
export function createFinanceLedger({ client, backupDir, env = process.env } = {}) {
	let state = null;
	let user = null;
	return {
		async read() {
			if (!client) throw new Error("Finance ledger storage is not configured");
			if (!state) {
				user = await resolveFinanceUser(client, env);
				state = await loadFinanceLedger(client, user, env);
			}
			return {
				...state.ledger,
				storage: {
					threadId: state.threadId,
					messageId: state.messageId,
					userEmail: user.email
				}
			};
		},
		async write(value) {
			if (!state) await this.read();
			state = await saveFinanceLedger(client, state, value, { backupDir, env });
			return state.ledger;
		}
	};
}
