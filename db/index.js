import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "app.db");

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'consumer',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  try {
    db.exec(
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'consumer';"
    );
  } catch {
    // Column already exists.
  }
}

function openDb() {
  ensureDataDir();
  const db = new Database(dbPath);
  initSchema(db);

  const queries = {
    selectUserByEmail: db.prepare(
      "SELECT id, email, password_hash, role FROM users WHERE email = ?"
    ),
    selectUserById: db.prepare(
      "SELECT id, email, role FROM users WHERE id = ?"
    ),
    insertUser: db.prepare(
      "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)"
    ),
    selectUsers: db.prepare(
      "SELECT id, email, role, created_at FROM users ORDER BY id ASC"
    )
  };

  return { db, queries };
}

export { dbPath, openDb };
