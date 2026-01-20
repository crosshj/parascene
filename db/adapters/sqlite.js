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
  const schemaPath = path.join(__dirname, "..", "schemas", "sqlite_01.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  db.exec(schemaSql);
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
    selectSessionByTokenHash: {
      get: async (tokenHash, userId) => {
        const stmt = db.prepare(
          `SELECT id, user_id, token_hash, expires_at
           FROM sessions
           WHERE token_hash = ? AND user_id = ?`
        );
        return Promise.resolve(stmt.get(tokenHash, userId));
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
    insertSession: {
      run: async (userId, tokenHash, expiresAt) => {
        const stmt = db.prepare(
          `INSERT INTO sessions (user_id, token_hash, expires_at)
           VALUES (?, ?, ?)`
        );
        const result = stmt.run(userId, tokenHash, expiresAt);
        return Promise.resolve({
          insertId: result.lastInsertRowid,
          lastInsertRowid: result.lastInsertRowid,
          changes: result.changes
        });
      }
    },
    refreshSessionExpiry: {
      run: async (id, expiresAt) => {
        const stmt = db.prepare(
          `UPDATE sessions
           SET expires_at = ?
           WHERE id = ?`
        );
        const result = stmt.run(expiresAt, id);
        return Promise.resolve({ changes: result.changes });
      }
    },
    deleteSessionByTokenHash: {
      run: async (tokenHash, userId) => {
        if (userId) {
          const stmt = db.prepare(
            `DELETE FROM sessions
             WHERE token_hash = ? AND user_id = ?`
          );
          const result = stmt.run(tokenHash, userId);
          return Promise.resolve({ changes: result.changes });
        }
        const stmt = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
        const result = stmt.run(tokenHash);
        return Promise.resolve({ changes: result.changes });
      }
    },
    deleteExpiredSessions: {
      run: async (nowIso) => {
        const stmt = db.prepare(
          `DELETE FROM sessions
           WHERE expires_at <= ?`
        );
        const result = stmt.run(nowIso);
        return Promise.resolve({ changes: result.changes });
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
      all: async (excludeUserId) => {
        const stmt = db.prepare(
          `SELECT fi.id, fi.title, fi.summary, fi.author, fi.tags, fi.created_at, 
                  fi.created_image_id, ci.filename, ci.file_path, ci.user_id,
                  COALESCE(ci.file_path, CASE WHEN ci.filename IS NOT NULL THEN '/api/images/created/' || ci.filename ELSE NULL END) as url
           FROM feed_items fi
           LEFT JOIN created_images ci ON fi.created_image_id = ci.id
           WHERE ? IS NULL OR ci.user_id IS NULL OR ci.user_id != ?
           ORDER BY fi.created_at DESC`
        );
        return Promise.resolve(stmt.all(excludeUserId ?? null, excludeUserId ?? null));
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
    selectCreatedImageByFilename: {
      get: async (filename) => {
        const stmt = db.prepare(
          `SELECT id, filename, file_path, width, height, color, status, created_at,
                  published, published_at, title, description, user_id
           FROM created_images
           WHERE filename = ?`
        );
        return Promise.resolve(stmt.get(filename));
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

  // Storage interface for images
  const imagesDir = path.join(dataDir, "images", "created");
  
  function ensureImagesDir() {
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }
  }

  const storage = {
    uploadImage: async (buffer, filename) => {
      ensureImagesDir();
      const filePath = path.join(imagesDir, filename);
      fs.writeFileSync(filePath, buffer);
      return `/images/created/${filename}`;
    },
    
    getImageUrl: (filename) => {
      return `/images/created/${filename}`;
    },
    
    getImageBuffer: async (filename) => {
      const filePath = path.join(imagesDir, filename);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Image not found: ${filename}`);
      }
      return fs.readFileSync(filePath);
    },
    
    deleteImage: async (filename) => {
      const filePath = path.join(imagesDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    },
    
    clearAll: async () => {
      if (fs.existsSync(imagesDir)) {
        const files = fs.readdirSync(imagesDir);
        for (const file of files) {
          const filePath = path.join(imagesDir, file);
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            fs.unlinkSync(filePath);
          }
        }
      }
    }
  };

  return { db, queries, seed, reset, storage };
}
