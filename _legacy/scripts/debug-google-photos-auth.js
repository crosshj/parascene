/**
 * Dev helper: simulate stale Google Photos auth for testing UI + status probe.
 *
 * Uses Supabase from .env (SUPABASE_URL) — usually your shared remote project,
 * not a local database. Confirm the target before corrupting.
 *
 * Usage:
 *   node scripts/debug-google-photos-auth.js status --user oceanman
 *   node scripts/debug-google-photos-auth.js corrupt --user oceanman
 *   node scripts/debug-google-photos-auth.js restore --user oceanman
 *
 * corrupt backs up the current row first. restore puts it back (then reconnect in UI if needed).
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { openDb } from "../db/index.js";
import { loadEnv } from "./repo-root.cjs";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, ".local");

function tokenSecret() {
	return String(process.env.GOOGLE_PHOTOS_TOKEN_SECRET || process.env.SESSION_SECRET || "dev-secret-change-me");
}

function encryptWithSecret(plainText, secret) {
	const sec = String(secret || "");
	if (!sec) return null;
	const iv = crypto.randomBytes(12);
	const key = crypto.createHash("sha256").update(sec).digest();
	const enc = crypto.createCipheriv("aes-256-gcm", key, iv);
	const ciphertext = Buffer.concat([enc.update(String(plainText || ""), "utf8"), enc.final()]);
	const tag = enc.getAuthTag();
	const payload = Buffer.concat([ciphertext, tag]);
	return `${iv.toString("base64url")}.${payload.toString("base64url")}`;
}

function parseArgs(argv) {
	const args = { command: "", user: "oceanman", mode: "invalid-grant" };
	const rest = argv.slice(2);
	args.command = rest[0] || "";
	for (let i = 1; i < rest.length; i++) {
		if (rest[i] === "--user" && rest[i + 1]) {
			args.user = rest[++i];
		} else if (rest[i] === "--mode" && rest[i + 1]) {
			args.mode = rest[++i];
		}
	}
	return args;
}

function backupPath(userId) {
	return path.join(BACKUP_DIR, `google-photos-auth-backup-${userId}.json`);
}

function writeBackup(userId, row) {
	fs.mkdirSync(BACKUP_DIR, { recursive: true });
	const file = backupPath(userId);
	if (fs.existsSync(file)) {
		console.log(`Backup already exists: ${file} (not overwriting)`);
		return file;
	}
	fs.writeFileSync(
		file,
		JSON.stringify(
			{
				userId,
				savedAt: new Date().toISOString(),
				row
			},
			null,
			"\t"
		)
	);
	console.log(`Saved backup: ${file}`);
	return file;
}

function readBackup(userId) {
	const file = backupPath(userId);
	if (!fs.existsSync(file)) {
		throw new Error(`No backup found at ${file}. Reconnect Google Photos manually instead.`);
	}
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function resolveUserId(queries, userName) {
	const profile = await queries.selectUserProfileByUsername?.get(userName);
	const userId = Number(profile?.user_id);
	if (!Number.isFinite(userId) || userId <= 0) {
		throw new Error(`User "${userName}" not found`);
	}
	return userId;
}

async function main() {
	const { command, user, mode } = parseArgs(process.argv);
	if (!["status", "corrupt", "restore"].includes(command)) {
		console.error(`Usage:
  node scripts/debug-google-photos-auth.js status --user oceanman
  node scripts/debug-google-photos-auth.js corrupt --user oceanman [--mode invalid-grant|decrypt-fail]
  node scripts/debug-google-photos-auth.js restore --user oceanman`);
		process.exit(1);
	}

	const { queries } = await openDb({ quiet: true });
	const supabaseHost = (() => {
		try {
			return new URL(process.env.SUPABASE_URL || "").host || "(unknown)";
		} catch {
			return "(unknown)";
		}
	})();
	console.log(`Database: ${supabaseHost}`);

	const userId = await resolveUserId(queries, user);
	const row = await queries.selectGooglePhotosConnectionByUserId?.get(userId);

	if (command === "status") {
		console.log(JSON.stringify({ user, userId, connection: row ?? null }, null, 2));
		return;
	}

	if (!row || row.revoked_at) {
		throw new Error(`User "${user}" (${userId}) has no active Google Photos connection to ${command}`);
	}

	if (command === "corrupt") {
		if (process.env.ALLOW_GOOGLE_PHOTOS_AUTH_CORRUPT !== "true") {
			console.error(
				`Refusing to corrupt auth on ${supabaseHost}. Set ALLOW_GOOGLE_PHOTOS_AUTH_CORRUPT=true to confirm.`
			);
			process.exit(1);
		}
		writeBackup(userId, row);

		let refreshTokenEnc;
		if (mode === "decrypt-fail") {
			refreshTokenEnc = "corrupt.corrupt";
		} else {
			// Decrypts fine locally; Google returns invalid_grant on refresh.
			const fakeToken = "1//0-invalid-local-test-refresh-token";
			refreshTokenEnc = encryptWithSecret(fakeToken, tokenSecret());
			if (!refreshTokenEnc) throw new Error("Could not encrypt test token (check SESSION_SECRET)");
		}

		await queries.upsertGooglePhotosConnection.run(userId, {
			refreshTokenEnc,
			scopes: row.scopes || "",
			albumId: row.album_id || undefined,
			albumTitle: row.album_title || undefined,
			revokedAtIso: null
		});

		console.log(`Corrupted Google Photos auth for ${user} (${userId}) using mode "${mode}".`);
		console.log("Test: open Share or Party, or GET /api/google-photos/status while logged in as that user.");
		console.log(`Restore: node scripts/debug-google-photos-auth.js restore --user ${user}`);
		return;
	}

	if (command === "restore") {
		const backup = readBackup(userId);
		const saved = backup?.row;
		if (!saved?.refresh_token_enc) {
			throw new Error("Backup is missing refresh_token_enc");
		}

		await queries.upsertGooglePhotosConnection.run(userId, {
			refreshTokenEnc: saved.refresh_token_enc,
			scopes: saved.scopes || "",
			albumId: saved.album_id || undefined,
			albumTitle: saved.album_title || undefined,
			revokedAtIso: saved.revoked_at || null
		});

		console.log(`Restored Google Photos auth for ${user} (${userId}) from ${backupPath(userId)}.`);
		console.log("If status still shows needsReconnect, reconnect once in Connections.");
	}
}

main().catch((err) => {
	console.error(err?.message || err);
	process.exit(1);
});
