import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { openMockDb } from "./mockDb.js";

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS moderation_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_type TEXT NOT NULL,
      content_id TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      region TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_name TEXT NOT NULL,
      status TEXT NOT NULL,
      region TEXT NOT NULL,
      uptime_pct REAL NOT NULL,
      capacity_pct REAL NOT NULL,
      last_check_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      unit TEXT,
      change TEXT,
      period TEXT,
      description TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sponsor TEXT NOT NULL,
      amount TEXT NOT NULL,
      status TEXT NOT NULL,
      next_report TEXT,
      awarded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      version TEXT NOT NULL,
      deployments INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS policy_knobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      description TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      role TEXT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      acknowledged_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      author TEXT NOT NULL,
      tags TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS explore_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      status TEXT NOT NULL,
      members_count INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
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
  if (process.env.VERCEL) {
    console.log("Using mock database for Vercel deployment.");
    return openMockDb();
  }

  ensureDataDir();
  const db = new Database(dbPath);
  initSchema(db);

  const queries = {
    selectUserByEmail: db.prepare(
      "SELECT id, email, password_hash, role FROM users WHERE email = ?"
    ),
    selectUserById: db.prepare(
      "SELECT id, email, role, created_at FROM users WHERE id = ?"
    ),
    insertUser: db.prepare(
      "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)"
    ),
    selectUsers: db.prepare(
      "SELECT id, email, role, created_at FROM users ORDER BY id ASC"
    ),
    selectModerationQueue: db.prepare(
      `SELECT id, content_type, content_id, status, reason, created_at
       FROM moderation_queue
       ORDER BY created_at DESC`
    ),
    selectProviders: db.prepare(
      `SELECT id, name, status, region, contact_email, created_at
       FROM provider_registry
       ORDER BY name ASC`
    ),
    selectProviderStatuses: db.prepare(
      `SELECT id, provider_name, status, region, uptime_pct, capacity_pct, last_check_at
       FROM provider_statuses
       ORDER BY provider_name ASC`
    ),
    selectProviderMetrics: db.prepare(
      `SELECT id, name, value, unit, change, period, description, updated_at
       FROM provider_metrics
       ORDER BY id ASC`
    ),
    selectProviderGrants: db.prepare(
      `SELECT id, name, sponsor, amount, status, next_report, awarded_at
       FROM provider_grants
       ORDER BY awarded_at DESC`
    ),
    selectProviderTemplates: db.prepare(
      `SELECT id, name, category, version, deployments, updated_at
       FROM provider_templates
       ORDER BY name ASC`
    ),
    selectPolicies: db.prepare(
      `SELECT id, key, value, description, updated_at
       FROM policy_knobs
       ORDER BY key ASC`
    ),
    selectNotificationsForUser: db.prepare(
      `SELECT id, title, message, link, created_at, acknowledged_at
       FROM notifications
       WHERE (user_id = ? OR role = ?)
       ORDER BY created_at DESC`
    ),
    selectUnreadNotificationCount: db.prepare(
      `SELECT COUNT(*) AS count
       FROM notifications
       WHERE acknowledged_at IS NULL
       AND (user_id = ? OR role = ?)`
    ),
    acknowledgeNotificationById: db.prepare(
      `UPDATE notifications
       SET acknowledged_at = datetime('now')
       WHERE id = ?
       AND acknowledged_at IS NULL
       AND (user_id = ? OR role = ?)`
    ),
    selectFeedItems: db.prepare(
      `SELECT id, title, summary, author, tags, created_at
       FROM feed_items
       ORDER BY created_at DESC`
    ),
    selectExploreItems: db.prepare(
      `SELECT id, title, summary, category, created_at
       FROM explore_items
       ORDER BY created_at DESC`
    ),
    selectPostsForUser: db.prepare(
      `SELECT id, title, body, status, created_at
       FROM posts
       WHERE user_id = ?
       ORDER BY created_at DESC`
    ),
    selectServers: db.prepare(
      `SELECT id, name, region, status, members_count, description, created_at
       FROM servers
       ORDER BY name ASC`
    ),
    selectTemplates: db.prepare(
      `SELECT id, name, category, description, created_at
       FROM templates
       ORDER BY name ASC`
    )
  };

  return { db, queries };
}

export { dbPath, openDb };
