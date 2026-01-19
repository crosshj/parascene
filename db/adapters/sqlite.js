import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "app.db");

// Dynamically import better-sqlite3 only when needed (not in production/Vercel)
let Database;
async function loadDatabase() {
  if (!Database) {
    Database = (await import("better-sqlite3")).default;
  }
  return Database;
}

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
    CREATE TABLE IF NOT EXISTS creations (
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS created_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      color TEXT,
      status TEXT NOT NULL DEFAULT 'creating',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Add status column to existing tables if it doesn't exist
  try {
    db.exec("ALTER TABLE created_images ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';");
    // Update existing rows without status to 'completed'
    db.exec("UPDATE created_images SET status = 'completed' WHERE status IS NULL;");
  } catch {
    // Column already exists.
  }

  try {
    db.exec(
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'consumer';"
    );
  } catch {
    // Column already exists.
  }

  // Add published fields to created_images table
  try {
    db.exec("ALTER TABLE created_images ADD COLUMN published INTEGER NOT NULL DEFAULT 0;");
  } catch {
    // Column already exists.
  }

  try {
    db.exec("ALTER TABLE created_images ADD COLUMN published_at TEXT;");
  } catch {
    // Column already exists.
  }

  try {
    db.exec("ALTER TABLE created_images ADD COLUMN title TEXT;");
  } catch {
    // Column already exists.
  }

  try {
    db.exec("ALTER TABLE created_images ADD COLUMN description TEXT;");
  } catch {
    // Column already exists.
  }

  // Add created_image_id to feed_items table
  try {
    db.exec("ALTER TABLE feed_items ADD COLUMN created_image_id INTEGER;");
  } catch {
    // Column already exists.
  }
}

export async function openDb() {
  const DbClass = await loadDatabase();
  ensureDataDir();
  const db = new DbClass(dbPath);
  initSchema(db);

  const queries = {
    selectUserByEmail: {
      get: async (email) => {
        const stmt = db.prepare(
          "SELECT id, email, password_hash, role FROM users WHERE email = ?"
        );
        return Promise.resolve(stmt.get(email));
      }
    },
    selectUserById: {
      get: async (id) => {
        const stmt = db.prepare(
          "SELECT id, email, role, created_at FROM users WHERE id = ?"
        );
        return Promise.resolve(stmt.get(id));
      }
    },
    insertUser: {
      run: async (email, password_hash, role) => {
        const stmt = db.prepare(
          "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)"
        );
        const result = stmt.run(email, password_hash, role);
        // Standardize return value: use insertId (also support lastInsertRowid for backward compat)
        return Promise.resolve({
          insertId: result.lastInsertRowid,
          lastInsertRowid: result.lastInsertRowid,
          changes: result.changes
        });
      }
    },
    selectUsers: {
      all: async () => {
        const stmt = db.prepare(
          "SELECT id, email, role, created_at FROM users ORDER BY id ASC"
        );
        return Promise.resolve(stmt.all());
      }
    },
    selectModerationQueue: {
      all: async () => {
        const stmt = db.prepare(
          `SELECT id, content_type, content_id, status, reason, created_at
           FROM moderation_queue
           ORDER BY created_at DESC`
        );
        return Promise.resolve(stmt.all());
      }
    },
    selectProviders: {
      all: async () => {
        const stmt = db.prepare(
          `SELECT id, name, status, region, contact_email, created_at
           FROM provider_registry
           ORDER BY name ASC`
        );
        return Promise.resolve(stmt.all());
      }
    },
    selectProviderStatuses: {
      all: async () => {
        const stmt = db.prepare(
          `SELECT id, provider_name, status, region, uptime_pct, capacity_pct, last_check_at
           FROM provider_statuses
           ORDER BY provider_name ASC`
        );
        return Promise.resolve(stmt.all());
      }
    },
    selectProviderMetrics: {
      all: async () => {
        const stmt = db.prepare(
          `SELECT id, name, value, unit, change, period, description, updated_at
           FROM provider_metrics
           ORDER BY id ASC`
        );
        return Promise.resolve(stmt.all());
      }
    },
    selectProviderGrants: {
      all: async () => {
        const stmt = db.prepare(
          `SELECT id, name, sponsor, amount, status, next_report, awarded_at
           FROM provider_grants
           ORDER BY awarded_at DESC`
        );
        return Promise.resolve(stmt.all());
      }
    },
    selectProviderTemplates: {
      all: async () => {
        const stmt = db.prepare(
          `SELECT id, name, category, version, deployments, updated_at
           FROM provider_templates
           ORDER BY name ASC`
        );
        return Promise.resolve(stmt.all());
      }
    },
    selectPolicies: {
      all: async () => {
        const stmt = db.prepare(
          `SELECT id, key, value, description, updated_at
           FROM policy_knobs
           ORDER BY key ASC`
        );
        return Promise.resolve(stmt.all());
      }
    },
    selectNotificationsForUser: {
      all: async (userId, role) => {
        const stmt = db.prepare(
          `SELECT id, title, message, link, created_at, acknowledged_at
           FROM notifications
           WHERE (user_id = ? OR role = ?)
           ORDER BY created_at DESC`
        );
        return Promise.resolve(stmt.all(userId, role));
      }
    },
    selectUnreadNotificationCount: {
      get: async (userId, role) => {
        const stmt = db.prepare(
          `SELECT COUNT(*) AS count
           FROM notifications
           WHERE acknowledged_at IS NULL
           AND (user_id = ? OR role = ?)`
        );
        return Promise.resolve(stmt.get(userId, role));
      }
    },
    acknowledgeNotificationById: {
      run: async (id, userId, role) => {
        const stmt = db.prepare(
          `UPDATE notifications
           SET acknowledged_at = datetime('now')
           WHERE id = ?
           AND acknowledged_at IS NULL
           AND (user_id = ? OR role = ?)`
        );
        const result = stmt.run(id, userId, role);
        return Promise.resolve({ changes: result.changes });
      }
    },
    selectFeedItems: {
      all: async () => {
        const stmt = db.prepare(
          `SELECT fi.id, fi.title, fi.summary, fi.author, fi.tags, fi.created_at, 
                  fi.created_image_id, ci.filename, ci.user_id,
                  CASE WHEN ci.filename IS NOT NULL THEN '/images/created/' || ci.filename ELSE NULL END as url
           FROM feed_items fi
           LEFT JOIN created_images ci ON fi.created_image_id = ci.id
           ORDER BY fi.created_at DESC`
        );
        return Promise.resolve(stmt.all());
      }
    },
    selectExploreItems: {
      all: async () => {
        const stmt = db.prepare(
          `SELECT id, title, summary, category, created_at
           FROM explore_items
           ORDER BY created_at DESC`
        );
        return Promise.resolve(stmt.all());
      }
    },
    selectCreationsForUser: {
      all: async (userId) => {
        const stmt = db.prepare(
          `SELECT id, title, body, status, created_at
           FROM creations
           WHERE user_id = ?
           ORDER BY created_at DESC`
        );
        return Promise.resolve(stmt.all(userId));
      }
    },
    selectServers: {
      all: async () => {
        const stmt = db.prepare(
          `SELECT id, name, region, status, members_count, description, created_at
           FROM servers
           ORDER BY name ASC`
        );
        return Promise.resolve(stmt.all());
      }
    },
    selectTemplates: {
      all: async () => {
        const stmt = db.prepare(
          `SELECT id, name, category, description, created_at
           FROM templates
           ORDER BY name ASC`
        );
        return Promise.resolve(stmt.all());
      }
    },
    insertCreatedImage: {
      run: async (userId, filename, filePath, width, height, color, status = 'creating') => {
        const stmt = db.prepare(
          `INSERT INTO created_images (user_id, filename, file_path, width, height, color, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        const result = stmt.run(userId, filename, filePath, width, height, color, status);
        return Promise.resolve({
          insertId: result.lastInsertRowid,
          lastInsertRowid: result.lastInsertRowid,
          changes: result.changes
        });
      }
    },
    updateCreatedImageStatus: {
      run: async (id, userId, status, color = null) => {
        if (color) {
          const stmt = db.prepare(
            `UPDATE created_images
             SET status = ?, color = ?
             WHERE id = ? AND user_id = ?`
          );
          const result = stmt.run(status, color, id, userId);
          return Promise.resolve({ changes: result.changes });
        } else {
          const stmt = db.prepare(
            `UPDATE created_images
             SET status = ?
             WHERE id = ? AND user_id = ?`
          );
          const result = stmt.run(status, id, userId);
          return Promise.resolve({ changes: result.changes });
        }
      }
    },
    selectCreatedImagesForUser: {
      all: async (userId) => {
        const stmt = db.prepare(
          `SELECT id, filename, file_path, width, height, color, status, created_at, 
                  published, published_at, title, description
           FROM created_images
           WHERE user_id = ?
           ORDER BY created_at DESC`
        );
        return Promise.resolve(stmt.all(userId));
      }
    },
    selectCreatedImageById: {
      get: async (id, userId) => {
        const stmt = db.prepare(
          `SELECT id, filename, file_path, width, height, color, status, created_at,
                  published, published_at, title, description, user_id
           FROM created_images
           WHERE id = ? AND user_id = ?`
        );
        return Promise.resolve(stmt.get(id, userId));
      }
    },
    selectCreatedImageByIdAnyUser: {
      get: async (id) => {
        const stmt = db.prepare(
          `SELECT id, filename, file_path, width, height, color, status, created_at,
                  published, published_at, title, description, user_id
           FROM created_images
           WHERE id = ?`
        );
        return Promise.resolve(stmt.get(id));
      }
    },
    publishCreatedImage: {
      run: async (id, userId, title, description) => {
        const stmt = db.prepare(
          `UPDATE created_images
           SET published = 1, published_at = datetime('now'), title = ?, description = ?
           WHERE id = ? AND user_id = ?`
        );
        const result = stmt.run(title, description, id, userId);
        return Promise.resolve({ changes: result.changes });
      }
    },
    insertFeedItem: {
      run: async (title, summary, author, tags, createdImageId) => {
        const stmt = db.prepare(
          `INSERT INTO feed_items (title, summary, author, tags, created_image_id)
           VALUES (?, ?, ?, ?, ?)`
        );
        const result = stmt.run(title, summary, author, tags || null, createdImageId || null);
        return Promise.resolve({
          insertId: result.lastInsertRowid,
          lastInsertRowid: result.lastInsertRowid,
          changes: result.changes
        });
      }
    }
  };

  async function seed(tableName, items, options = {}) {
    if (!items || items.length === 0) return;

    const { skipIfExists = false, transform, checkExists } = options;

    // Check if we should skip seeding
    if (skipIfExists) {
      if (checkExists) {
        // Use custom check function (must be async now)
        const existing = await checkExists();
        if (existing && existing.length > 0) return;
      } else {
        // Default: check if table has any rows
        const count = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
        if (count > 0) return;
      }
    }

    // Get column names from first item
    const firstItem = transform ? transform(items[0]) : items[0];
    const columns = Object.keys(firstItem).filter(key => firstItem[key] !== undefined);
    const placeholders = columns.map(() => "?").join(", ");
    const columnNames = columns.join(", ");

    const stmt = db.prepare(
      `INSERT INTO ${tableName} (${columnNames}) VALUES (${placeholders})`
    );

    // Insert all items
    for (const item of items) {
      const transformedItem = transform ? transform(item) : item;
      const values = columns.map(col => transformedItem[col]);
      stmt.run(...values);
    }
  }

  async function reset() {
    // Close existing connection if open
    if (db) {
      db.close();
    }
    // Delete the database file
    // The database will be recreated on the next openDb() call
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  }

  return { db, queries, seed, reset };
}
