#!/usr/bin/env node
/**
 * Local-only finance ledger.
 *
 * Storage is deliberately implemented using the existing notes-to-self DM:
 * one marked chat message contains the JSON document. This server binds only
 * to loopback and is never mounted in the application API.
 *
 * Usage: node scripts/finance/server.js
 * Optional env:
 *   FINANCE_USER_ID       your prsn_users.id
 *   FINANCE_EMAIL         your account email (used when ID is absent)
 *   FINANCE_USERNAME      your profile handle, e.g. awesome
 *   FINANCE_PORT          default 2391
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { REPO_ROOT, loadEnv } from "../repo-root.cjs";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = __dirname;
const BACKUP_DIR = path.join(REPO_ROOT, ".output", "finance", "backups");
const PORT = Number(process.env.FINANCE_PORT || 2391);
const LEDGER_MARKER = "finance_ledger_v1";

function requiredEnv(name) {
	const value = String(process.env[name] || "").trim();
	if (!value) throw new Error(`Missing ${name}`);
	return value;
}

function dmPairKey(a, b) {
	return [Number(a), Number(b)].sort((x, y) => x - y).join(":");
}

function starterLedger() {
	return {
		kind: LEDGER_MARKER,
		version: 2,
		currency: "USD",
		inceptionDate: String(process.env.FINANCE_INCEPTION_DATE || "2026-01-22"),
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

function normalizeLedger(value) {
	const base = starterLedger();
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

function parseLedger(body) {
	try {
		const parsed = JSON.parse(String(body || ""));
		return parsed?.kind === LEDGER_MARKER ? normalizeLedger(parsed) : null;
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

async function resolveUser(sb) {
	const id = Number(process.env.FINANCE_USER_ID || 0);
	if (Number.isInteger(id) && id > 0) {
		const { data, error } = await sb.from("prsn_users").select("id,email").eq("id", id).maybeSingle();
		if (error) throw error;
		if (data) return data;
	}
	const username = String(process.env.FINANCE_USERNAME || "").trim().replace(/^@/, "");
	if (username) {
		const profile = await sb.from("prsn_user_profiles").select("user_id").ilike("user_name", username).maybeSingle();
		if (profile.error) throw profile.error;
		if (profile.data?.user_id) {
			const found = await sb.from("prsn_users").select("id,email").eq("id", profile.data.user_id).maybeSingle();
			if (found.error) throw found.error;
			if (found.data) return found.data;
		}
	}
	const email = String(process.env.FINANCE_EMAIL || "").trim().toLowerCase();
	if (!email) throw new Error("Set FINANCE_USER_ID or FINANCE_EMAIL in .env");
	const { data, error } = await sb.from("prsn_users").select("id,email").ilike("email", email).maybeSingle();
	if (error) throw error;
	if (!data) throw new Error(`No user found for FINANCE_EMAIL=${email}`);
	return data;
}

async function loadLedger(sb, user) {
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
	const found = (messages.data || []).find((row) => row.meta?.finance_ledger === LEDGER_MARKER || parseLedger(row.body));
	if (found) {
		const rawLedger = parseRawLedger(found.body);
		const ledger = normalizeLedger(rawLedger || starterLedger());
		if (rawLedger && Number(rawLedger.version || 0) < 2) {
			const updated = await sb.from("prsn_chat_messages").update({ body: JSON.stringify(ledger, null, 2), meta: { finance_ledger: LEDGER_MARKER, title: "Parascene finance ledger", edited_at: new Date().toISOString() } }).eq("id", found.id);
			if (updated.error) throw updated.error;
		}
		return { threadId: Number(thread.id), messageId: Number(found.id), ledger, createdAt: found.created_at };
	}
	const ledger = starterLedger();
	const inserted = await sb.from("prsn_chat_messages").insert({
		thread_id: thread.id,
		sender_id: user.id,
		body: JSON.stringify(ledger, null, 2),
		meta: { finance_ledger: LEDGER_MARKER, title: "Parascene finance ledger" }
	}).select("id,created_at").single();
	if (inserted.error) throw inserted.error;
	return { threadId: Number(thread.id), messageId: Number(inserted.data.id), ledger, createdAt: inserted.data.created_at };
}

async function saveLedger(sb, state, value) {
	const ledger = normalizeLedger(value);
	await fs.mkdir(BACKUP_DIR, { recursive: true });
	await fs.writeFile(path.join(BACKUP_DIR, `${new Date().toISOString().replaceAll(":", "-")}.json`), JSON.stringify(state.ledger, null, 2));
	const result = await sb.from("prsn_chat_messages").update({ body: JSON.stringify(ledger, null, 2), meta: { finance_ledger: LEDGER_MARKER, title: "Parascene finance ledger", edited_at: new Date().toISOString() } }).eq("id", state.messageId);
	if (result.error) throw result.error;
	return { ...state, ledger };
}

const sb = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const user = await resolveUser(sb);
let state = await loadLedger(sb, user);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR, { index: "index.html" }));
app.get("/api/ledger", (_req, res) => res.json({ ...state.ledger, storage: { threadId: state.threadId, messageId: state.messageId, userEmail: user.email } }));
app.put("/api/ledger", async (req, res) => {
	try {
		state = await saveLedger(sb, state, req.body);
		res.json(state.ledger);
	} catch (error) {
		console.error("[finance] save failed", error);
		res.status(500).json({ error: error?.message || "Could not save ledger" });
	}
});
app.listen(PORT, "127.0.0.1", () => {
	console.log(`[finance] http://127.0.0.1:${PORT}`);
	console.log(`[finance] self-DM message ${state.messageId}; backups: ${BACKUP_DIR}`);
});
