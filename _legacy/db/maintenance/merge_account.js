import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { openDb } from "../index.js";
import { getSupabaseServiceClient } from "../../api_routes/utils/supabaseService.js";

/**
 * Account takeover / merge maintenance tool.
 *
 * Use case: a user lost access to their OLD account (old email inbox gone,
 * forgot old username/password) and made a NEW account. We want them to log in
 * with the NEW credentials but land in the OLD account, and the NEW account
 * (and its posts) to be gone.
 *
 * Strategy ("credential takeover"): move the NEW account's email + password
 * hash onto the OLD account, then hard-delete the NEW account. Emails and
 * usernames are UNIQUE, so the NEW account must be deleted BEFORE the OLD
 * account's email is set to the new value.
 *
 * A full JSON backup of BOTH accounts is written before anything destructive
 * happens. `restore` can re-apply the OLD account's original email + password
 * from that backup (the NEW account's deleted content/storage cannot be
 * restored).
 *
 * Identifiers accepted anywhere <account> is expected:
 *   @username | username | user@email.com | 123 (numeric id)
 *
 * Commands:
 *   inspect  <account>
 *   takeover --old <account> --new <account> [--yes] [--dry-run]
 *   restore  <backupFile> [--yes]
 *
 * Examples:
 *   node db/maintenance/merge_account.js inspect @ndrelloso12
 *   node db/maintenance/merge_account.js takeover --old @ndrelloso12 --new @ndrelloso12_1 --dry-run
 *   node db/maintenance/merge_account.js takeover --old @ndrelloso12 --new @ndrelloso12_1 --yes
 *   node db/maintenance/merge_account.js restore db/maintenance/backups/merge_XXX.json --yes
 *
 * Nothing here is exposed to end users; run manually with production env vars
 * (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUP_DIR = path.join(__dirname, "backups");

// Every table that references a user, with the column(s) that hold a user id.
// Used only for the JSON backup snapshot (best-effort; unknown tables are skipped).
const USER_REF_TABLES = [
	["prsn_user_profiles", ["user_id"]],
	["prsn_sessions", ["user_id"]],
	["prsn_servers", ["user_id"]],
	["prsn_server_members", ["user_id"]],
	["prsn_notifications", ["user_id", "actor_user_id"]],
	["prsn_email_sends", ["user_id"]],
	["prsn_email_user_campaign_state", ["user_id"]],
	["prsn_email_link_clicks", ["user_id"]],
	["prsn_creations", ["user_id"]],
	["prsn_created_images", ["user_id"]],
	["prsn_user_credits", ["user_id"]],
	["prsn_tip_activity", ["from_user_id", "to_user_id"]],
	["prsn_user_follows", ["follower_id", "following_id"]],
	["prsn_likes_created_image", ["user_id"]],
	["prsn_comments_created_image", ["user_id"]],
	["prsn_comment_reactions", ["user_id"]],
	["prsn_chat_members", ["user_id"]],
	["prsn_chat_messages", ["sender_id"]],
	["prsn_prompt_injections", ["owner_user_id"]],
	["prsn_oauth_clients", ["owner_user_id"]],
	["prsn_oauth_authorization_codes", ["user_id"]],
	["prsn_oauth_grants", ["user_id"]],
	["prsn_share_page_views", ["sharer_user_id", "created_by_user_id"]],
	["prsn_blog_posts", ["author_user_id", "updated_by_user_id"]],
	["prsn_google_photos", ["user_id"]]
];

function log(...args) {
	console.log(...args);
}

function fail(message) {
	console.error(`\nError: ${message}\n`);
	process.exitCode = 1;
}

function parseFlags(argv) {
	const flags = {};
	const positionals = [];
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token.startsWith("--")) {
			const key = token.slice(2);
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("--")) {
				flags[key] = true;
			} else {
				flags[key] = next;
				i++;
			}
		} else {
			positionals.push(token);
		}
	}
	return { flags, positionals };
}

/** Recreate the admin.js generic-image key extraction (avatar/cover storage keys). */
function extractGenericKey(url) {
	const raw = typeof url === "string" ? url.trim() : "";
	if (!raw || !raw.startsWith("/api/images/generic/")) return null;
	const tail = raw.slice("/api/images/generic/".length);
	if (!tail) return null;
	return tail
		.split("/")
		.filter(Boolean)
		.map((seg) => {
			try {
				return decodeURIComponent(seg);
			} catch {
				return seg;
			}
		})
		.join("/");
}

/** Resolve @username | username | email | numeric id -> full prsn_users row (or null). */
async function resolveAccount(queries, sb, identifier) {
	const raw = String(identifier || "").trim();
	if (!raw) return null;

	let userId = null;

	if (raw.startsWith("@")) {
		const profile = await queries.selectUserProfileByUsername.get(raw.slice(1).toLowerCase());
		userId = profile?.user_id ?? null;
	} else if (/^\d+$/.test(raw)) {
		userId = Number(raw);
	} else if (raw.includes("@")) {
		const user = await queries.selectUserByEmail.get(raw.toLowerCase());
		userId = user?.id ?? null;
	} else {
		const profile = await queries.selectUserProfileByUsername.get(raw.toLowerCase());
		userId = profile?.user_id ?? null;
	}

	if (userId == null) return null;

	const { data, error } = await sb
		.from("prsn_users")
		.select("id, email, password_hash, role, created_at, last_active_at, meta")
		.eq("id", userId)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;

	const profileRow = await queries.selectUserProfileByUserId?.get?.(data.id).catch(() => null);
	return { ...data, profile: profileRow ?? null };
}

async function accountSummary(queries, sb, account) {
	const id = account.id;
	const [allImgs, pubImgs, credits] = await Promise.all([
		queries.selectAllCreatedImageCountForUser?.get?.(id).catch(() => null),
		queries.selectPublishedCreatedImageCountForUser?.get?.(id).catch(() => null),
		queries.selectUserCredits?.get?.(id).catch(() => null)
	]);
	return {
		id,
		email: account.email,
		username: account.profile?.user_name ?? null,
		role: account.role,
		suspended: account?.meta?.suspended === true,
		created_at: account.created_at,
		creations_total: Number(allImgs?.count ?? 0),
		creations_published: Number(pubImgs?.count ?? 0),
		credits: credits?.balance ?? 0
	};
}

async function snapshotUserRows(sb, userId) {
	const tables = {};
	for (const [table, columns] of USER_REF_TABLES) {
		const merged = new Map();
		let sawTable = false;
		for (const column of columns) {
			try {
				const { data, error } = await sb.from(table).select("*").eq(column, userId);
				if (error) throw error;
				sawTable = true;
				for (const row of data ?? []) {
					const key = row.id != null ? `id:${row.id}` : JSON.stringify(row);
					merged.set(key, row);
				}
			} catch {
				// table or column may not exist in this deployment; skip
			}
		}
		if (sawTable) tables[table] = [...merged.values()];
	}
	return tables;
}

async function buildBackup(sb, oldAccount, newAccount) {
	const [oldTables, newTables] = await Promise.all([
		snapshotUserRows(sb, oldAccount.id),
		snapshotUserRows(sb, newAccount.id)
	]);
	return {
		generatedAt: new Date().toISOString(),
		operation: "takeover",
		plan: {
			old_user_id: oldAccount.id,
			new_user_id: newAccount.id,
			old_original_email: oldAccount.email,
			old_original_password_hash: oldAccount.password_hash,
			new_email: newAccount.email,
			new_password_hash: newAccount.password_hash
		},
		old_account: { user_row: oldAccount, tables: oldTables },
		new_account: { user_row: newAccount, tables: newTables }
	};
}

function writeBackup(backup) {
	if (!fs.existsSync(BACKUP_DIR)) {
		fs.mkdirSync(BACKUP_DIR, { recursive: true });
	}
	const ts = backup.generatedAt.replace(/[:.]/g, "-");
	const file = path.join(
		BACKUP_DIR,
		`merge_old-${backup.plan.old_user_id}_from-${backup.plan.new_user_id}_${ts}.json`
	);
	fs.writeFileSync(file, JSON.stringify(backup, null, 2), "utf8");
	return file;
}

/**
 * Remove references to a user that `deleteUserAndCleanup` does not handle and
 * that lack ON DELETE CASCADE, so the final `DELETE FROM prsn_users` can't fail
 * on a foreign key. All of these rows are already captured in the backup.
 */
async function preCleanupForDelete(sb, userId) {
	const results = {};
	// Notifications where this user is the ACTOR (recipient rows are handled by deleteUserAndCleanup).
	try {
		const { data, error } = await sb
			.from("prsn_notifications")
			.delete()
			.eq("actor_user_id", userId)
			.select("id");
		if (error) throw error;
		results.notifications_as_actor = data?.length ?? 0;
	} catch (err) {
		results.notifications_as_actor = `skip (${err?.message || err})`;
	}
	// Share page views referencing this user as sharer or creator (NOT NULL FKs, no cascade).
	for (const column of ["sharer_user_id", "created_by_user_id"]) {
		try {
			const { data, error } = await sb
				.from("prsn_share_page_views")
				.delete()
				.eq(column, userId)
				.select("id");
			if (error) throw error;
			results[`share_page_views_${column}`] = data?.length ?? 0;
		} catch (err) {
			results[`share_page_views_${column}`] = `skip (${err?.message || err})`;
		}
	}
	return results;
}

async function deleteAccountStorage(queries, storage, userId) {
	if (!storage) return;
	let createdImages = [];
	try {
		createdImages = (await queries.selectCreatedImagesForUser?.all?.(userId, {
			includeUnavailable: true,
			limit: 1000
		})) ?? [];
	} catch {
		createdImages = [];
	}
	let profileRow = null;
	try {
		profileRow = await queries.selectUserProfileByUserId?.get?.(userId);
	} catch {
		profileRow = null;
	}
	const filenames = (Array.isArray(createdImages) ? createdImages : [])
		.map((img) => String(img?.filename || "").trim())
		.filter(Boolean);
	if (storage.deleteImage) {
		for (const filename of filenames) {
			try {
				await storage.deleteImage(filename);
			} catch {
				// best-effort
			}
		}
	}
	const keys = [extractGenericKey(profileRow?.avatar_url), extractGenericKey(profileRow?.cover_image_url)].filter(Boolean);
	if (storage.deleteGenericImage) {
		for (const key of keys) {
			try {
				await storage.deleteGenericImage(key);
			} catch {
				// best-effort
			}
		}
	}
}

async function cmdInspect(queries, sb, positionals) {
	const identifier = positionals[0];
	if (!identifier) {
		fail("Usage: inspect <@username|username|email|id>");
		return;
	}
	const account = await resolveAccount(queries, sb, identifier);
	if (!account) {
		fail(`Account not found: ${identifier}`);
		return;
	}
	const summary = await accountSummary(queries, sb, account);
	log("\nAccount:");
	log(JSON.stringify(summary, null, 2));
	log("");
}

async function cmdTakeover(queries, storage, sb, flags) {
	const oldId = flags.old;
	const newId = flags.new;
	if (!oldId || !newId) {
		fail("Usage: takeover --old <account> --new <account> [--yes] [--dry-run]");
		return;
	}

	const oldAccount = await resolveAccount(queries, sb, oldId);
	const newAccount = await resolveAccount(queries, sb, newId);
	if (!oldAccount) return fail(`OLD account not found: ${oldId}`);
	if (!newAccount) return fail(`NEW account not found: ${newId}`);
	if (Number(oldAccount.id) === Number(newAccount.id)) {
		return fail("OLD and NEW resolve to the same account.");
	}
	if (!newAccount.password_hash) {
		return fail("NEW account has no password_hash; cannot move credentials.");
	}
	if (oldAccount.role === "admin" || newAccount.role === "admin") {
		return fail("Refusing to operate on an admin account.");
	}

	const oldSummary = await accountSummary(queries, sb, oldAccount);
	const newSummary = await accountSummary(queries, sb, newAccount);

	log("\n=== Account Takeover Plan ===");
	log("\nKEEP (old account):");
	log(JSON.stringify(oldSummary, null, 2));
	log("\nDELETE (new account, credentials moved to old):");
	log(JSON.stringify(newSummary, null, 2));
	log("\nAfter takeover:");
	log(`  - user #${oldAccount.id} (@${oldSummary.username ?? "?"}) email  -> ${newAccount.email}`);
	log(`  - user #${oldAccount.id} password -> new account's password`);
	log(`  - user #${newAccount.id} (@${newSummary.username ?? "?"}) and its posts -> DELETED`);
	log(`  - old account's active sessions -> cleared (fresh login required)`);

	log("\nWriting backup snapshot...");
	const backup = await buildBackup(sb, oldAccount, newAccount);
	const backupFile = writeBackup(backup);
	log(`Backup written: ${backupFile}`);

	if (flags["dry-run"]) {
		log("\n[dry-run] No changes made. Re-run with --yes to execute.\n");
		return;
	}
	if (!flags.yes) {
		log("\nRefusing to execute without --yes. Re-run with --yes to proceed.\n");
		return;
	}

	const newEmail = newAccount.email;
	const newPasswordHash = newAccount.password_hash;

	// 1) Hard-delete NEW account (frees email + username, removes its posts).
	log(`\nDeleting NEW account #${newAccount.id} ...`);
	await deleteAccountStorage(queries, storage, newAccount.id);
	const preClean = await preCleanupForDelete(sb, newAccount.id);
	log("Pre-clean (non-cascading references):");
	log(JSON.stringify(preClean, null, 2));
	const cleanup = await queries.deleteUserAndCleanup.run(newAccount.id);
	log("Deleted new account. Row changes:");
	log(JSON.stringify(cleanup?.changes ?? cleanup ?? null, null, 2));

	// 2) Move credentials onto OLD account.
	log(`\nApplying new email to OLD account #${oldAccount.id} ...`);
	const emailResult = await queries.updateUserEmail.run(oldAccount.id, newEmail);
	if (!emailResult || emailResult.changes === 0) {
		return fail(
			`Failed to set email on old account (changes=0). New account was deleted; ` +
				`restore from backup: ${backupFile}`
		);
	}
	await queries.updateUserPassword.run(oldAccount.id, newPasswordHash);
	log("Email + password updated on old account.");

	// 3) Clear OLD account sessions so the user logs in fresh.
	log("Clearing old account sessions ...");
	try {
		const { error } = await sb.from("prsn_sessions").delete().eq("user_id", oldAccount.id);
		if (error) throw error;
	} catch (err) {
		log(`Warning: could not clear sessions: ${err?.message || err}`);
	}

	// 4) Verify.
	const check = await queries.selectUserByEmail.get(newEmail);
	log("\n=== Result ===");
	if (check && Number(check.id) === Number(oldAccount.id)) {
		log(`Success: logging in with ${newEmail} now reaches old account #${oldAccount.id} (@${oldSummary.username ?? "?"}).`);
	} else {
		log(`Warning: verification lookup returned user #${check?.id ?? "none"} (expected #${oldAccount.id}). Inspect manually.`);
	}
	log(`Backup: ${backupFile}`);
	log("");
}

async function cmdRestore(queries, sb, positionals, flags) {
	const file = positionals[0];
	if (!file) {
		fail("Usage: restore <backupFile> [--yes]");
		return;
	}
	if (!fs.existsSync(file)) {
		fail(`Backup file not found: ${file}`);
		return;
	}
	let backup;
	try {
		backup = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (err) {
		return fail(`Could not parse backup file: ${err?.message || err}`);
	}
	const plan = backup?.plan;
	if (!plan?.old_user_id || !plan?.old_original_email || !plan?.old_original_password_hash) {
		return fail("Backup is missing old account credentials; cannot restore.");
	}

	log("\n=== Restore Plan ===");
	log(`Old account #${plan.old_user_id}: email -> ${plan.old_original_email}, password -> original hash`);
	log("Note: the deleted NEW account's content and storage are NOT restored by this command.");
	log(`      (Full new-account row snapshot is still in the backup file for manual review.)`);

	if (!flags.yes) {
		log("\nRefusing to execute without --yes. Re-run with --yes to proceed.\n");
		return;
	}

	// Free the email if it currently sits on another account (e.g. still on old after a partial run).
	const current = await queries.selectUserByEmail.get(String(plan.old_original_email).toLowerCase());
	if (current && Number(current.id) !== Number(plan.old_user_id)) {
		return fail(
			`Original email ${plan.old_original_email} is currently on user #${current.id}, not #${plan.old_user_id}. Resolve manually.`
		);
	}

	const emailResult = await queries.updateUserEmail.run(plan.old_user_id, plan.old_original_email);
	if (!emailResult || emailResult.changes === 0) {
		return fail("Failed to restore old email (changes=0).");
	}
	await queries.updateUserPassword.run(plan.old_user_id, plan.old_original_password_hash);
	log(`\nRestored old account #${plan.old_user_id} credentials from backup.\n`);
}

async function main() {
	const argv = process.argv.slice(2);
	const command = argv[0];
	const { flags, positionals } = parseFlags(argv.slice(1));

	if (!command || ["help", "-h", "--help"].includes(command)) {
		log(
			[
				"Account takeover / merge tool",
				"",
				"Commands:",
				"  inspect  <@username|username|email|id>",
				"  takeover --old <account> --new <account> [--yes] [--dry-run]",
				"  restore  <backupFile> [--yes]",
				""
			].join("\n")
		);
		return;
	}

	const sb = getSupabaseServiceClient();
	if (!sb) {
		return fail("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.");
	}

	const { queries, storage } = await openDb();

	if (command === "inspect") {
		await cmdInspect(queries, sb, positionals);
	} else if (command === "takeover") {
		await cmdTakeover(queries, storage, sb, flags);
	} else if (command === "restore") {
		await cmdRestore(queries, sb, positionals, flags);
	} else {
		fail(`Unknown command: ${command}. Run with --help.`);
	}
}

main().catch((error) => {
	console.error("\nFatal error:", error?.message || error);
	if (error?.stack) console.error(error.stack);
	process.exitCode = 1;
});
