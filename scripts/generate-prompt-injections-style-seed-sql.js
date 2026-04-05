/**
 * Reads api_routes/utils/createStyles.js and writes db/schemas/supabase_07_seed_prompt_injections_styles.sql
 * Run from repo root: node scripts/generate-prompt-injections-style-seed-sql.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CREATE_STYLES } from "../api_routes/utils/createStyles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "db", "schemas", "supabase_07_seed_prompt_injections_styles.sql");

const OWNER_USER_ID = 4;

function esc(s) {
	return String(s ?? "").replace(/'/g, "''");
}

const lines = [];
lines.push("-- Seed: basic creation style presets → prsn_prompt_injections (source: api_routes/utils/createStyles.js)");
lines.push("-- Run after supabase_05_prompt_injections.sql. Re-run generator after editing createStyles.js.");
lines.push("");
lines.push(`DELETE FROM prsn_prompt_injections WHERE owner_user_id = ${OWNER_USER_ID} AND tag_type = 'style';`);
lines.push("");

const keys = Object.keys(CREATE_STYLES);
for (const key of keys) {
	const row = CREATE_STYLES[key];
	const title = row?.title ?? key;
	const modifiers = typeof row?.modifiers === "string" ? row.modifiers : "";
	lines.push(`INSERT INTO prsn_prompt_injections (`);
	lines.push(`	tag,`);
	lines.push(`	tag_type,`);
	lines.push(`	injection_text,`);
	lines.push(`	title,`);
	lines.push(`	owner_user_id,`);
	lines.push(`	visibility,`);
	lines.push(`	is_active`);
	lines.push(`) VALUES (`);
	lines.push(`	'${esc(key)}',`);
	lines.push(`	'style',`);
	lines.push(`	'${esc(modifiers)}',`);
	lines.push(`	'${esc(title)}',`);
	lines.push(`	${OWNER_USER_ID},`);
	lines.push(`	'public',`);
	lines.push(`	true`);
	lines.push(`);`);
	lines.push("");
}

fs.writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`Wrote ${keys.length} rows to ${OUT}`);
