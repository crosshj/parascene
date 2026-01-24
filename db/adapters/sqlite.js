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

  const transferCreditsTxn = db.transaction((fromUserId, toUserId, amount) => {
    const ensureCreditsRowStmt = db.prepare(
      `INSERT OR IGNORE INTO user_credits (user_id, balance, last_daily_claim_at)
       VALUES (?, 0, NULL)`
    );
    const selectBalanceStmt = db.prepare(
      `SELECT balance FROM user_credits WHERE user_id = ?`
    );
    const debitStmt = db.prepare(
      `UPDATE user_credits
       SET balance = balance - ?, updated_at = datetime('now')
       WHERE user_id = ?`
    );
    const creditStmt = db.prepare(
      `UPDATE user_credits
       SET balance = balance + ?, updated_at = datetime('now')
       WHERE user_id = ?`
    );

    ensureCreditsRowStmt.run(fromUserId);
    ensureCreditsRowStmt.run(toUserId);

    const fromRow = selectBalanceStmt.get(fromUserId);
    const toRow = selectBalanceStmt.get(toUserId);
    const fromBalance = Number(fromRow?.balance ?? 0);
    const toBalance = Number(toRow?.balance ?? 0);

    if (!Number.isFinite(fromBalance) || !Number.isFinite(toBalance)) {
      const err = new Error("Invalid credits balance");
      err.code = "INVALID_BALANCE";
      throw err;
    }

    if (fromBalance < amount) {
      const err = new Error("Insufficient credits");
      err.code = "INSUFFICIENT_CREDITS";
      throw err;
    }

    debitStmt.run(amount, fromUserId);
    creditStmt.run(amount, toUserId);

    const nextFrom = selectBalanceStmt.get(fromUserId);
    const nextTo = selectBalanceStmt.get(toUserId);
    return {
      fromBalance: Number(nextFrom?.balance ?? 0),
      toBalance: Number(nextTo?.balance ?? 0)
    };
  });

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
          `SELECT 
            ps.id, 
            ps.user_id, 
            ps.name, 
            ps.status, 
            ps.server_url,
            ps.status_date,
            ps.description,
            ps.members_count,
            ps.server_config,
            ps.created_at,
            ps.updated_at,
            u.email as owner_email
           FROM servers ps
           LEFT JOIN users u ON ps.user_id = u.id
           ORDER BY ps.name ASC`
        );
        const results = stmt.all();
        // Parse JSON for server_config in SQLite
        return results.map(row => {
          let serverConfig = null;
          if (row.server_config) {
            try {
              serverConfig = JSON.parse(row.server_config);
            } catch (e) {
              console.warn(`Failed to parse server_config for server ${row.id}:`, e);
              serverConfig = null;
            }
          }
          return {
            ...row,
            server_config: serverConfig
          };
        });
      }
    },
    insertProvider: {
      run: async (userId, name, status, serverUrl, serverConfig = null) => {
        const stmt = db.prepare(
          `INSERT INTO servers (user_id, name, status, server_url, server_config)
           VALUES (?, ?, ?, ?, ?)`
        );
        const configJson = serverConfig ? JSON.stringify(serverConfig) : null;
        const result = stmt.run(userId, name, status, serverUrl, configJson);
        return Promise.resolve({ 
          insertId: result.lastInsertRowid,
          changes: result.changes 
        });
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
    insertNotification: {
      run: async (userId, role, title, message, link) => {
        const stmt = db.prepare(
          `INSERT INTO notifications (user_id, role, title, message, link)
           VALUES (?, ?, ?, ?, ?)`
        );
        const result = stmt.run(
          userId ?? null,
          role ?? null,
          title,
          message,
          link ?? null
        );
        return Promise.resolve({
          insertId: result.lastInsertRowid,
          lastInsertRowid: result.lastInsertRowid,
          changes: result.changes
        });
      }
    },
    selectFeedItems: {
      all: async (excludeUserId) => {
        const viewerId = excludeUserId ?? null;
        const stmt = db.prepare(
          `SELECT fi.id, fi.title, fi.summary, fi.author, fi.tags, fi.created_at, 
                  fi.created_image_id, ci.filename, ci.file_path, ci.user_id,
                  COALESCE(ci.file_path, CASE WHEN ci.filename IS NOT NULL THEN '/api/images/created/' || ci.filename ELSE NULL END) as url,
                  COALESCE(lc.like_count, 0) AS like_count,
                  CASE WHEN ? IS NOT NULL AND vl.user_id IS NOT NULL THEN 1 ELSE 0 END AS viewer_liked
           FROM feed_items fi
           LEFT JOIN created_images ci ON fi.created_image_id = ci.id
           LEFT JOIN (
             SELECT created_image_id, COUNT(*) AS like_count
             FROM likes_created_image
             GROUP BY created_image_id
           ) lc ON lc.created_image_id = fi.created_image_id
           LEFT JOIN likes_created_image vl
             ON vl.created_image_id = fi.created_image_id
            AND vl.user_id = ?
           WHERE ? IS NULL OR ci.user_id IS NULL OR ci.user_id != ?
           ORDER BY fi.created_at DESC`
        );
        return Promise.resolve(stmt.all(viewerId, viewerId, excludeUserId ?? null, excludeUserId ?? null));
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
          `SELECT 
            ps.id, 
            ps.name, 
            ps.status, 
            ps.members_count, 
            ps.description, 
            ps.created_at,
            ps.server_url,
            ps.status_date,
            ps.server_config,
            u.email as owner_email
           FROM servers ps
           LEFT JOIN users u ON ps.user_id = u.id
           ORDER BY ps.name ASC`
        );
        const results = stmt.all();
        // Parse JSON for server_config in SQLite
        return results.map(row => {
          let serverConfig = null;
          if (row.server_config) {
            try {
              serverConfig = JSON.parse(row.server_config);
            } catch (e) {
              console.warn(`Failed to parse server_config for server ${row.id}:`, e);
              serverConfig = null;
            }
          }
          return {
            ...row,
            server_config: serverConfig
          };
        });
      }
    },
    selectServerById: {
      get: async (serverId) => {
        const stmt = db.prepare(
          `SELECT 
            ps.id, 
            ps.user_id,
            ps.name, 
            ps.status, 
            ps.members_count, 
            ps.description, 
            ps.created_at,
            ps.server_url,
            ps.status_date,
            ps.server_config,
            u.email as owner_email
           FROM servers ps
           LEFT JOIN users u ON ps.user_id = u.id
           WHERE ps.id = ?`
        );
        const row = stmt.get(serverId);
        if (!row) return null;
        
        // Parse JSON for server_config in SQLite
        let serverConfig = null;
        if (row.server_config) {
          try {
            serverConfig = JSON.parse(row.server_config);
          } catch (e) {
            console.warn(`Failed to parse server_config for server ${row.id}:`, e);
            serverConfig = null;
          }
        }
        return {
          ...row,
          server_config: serverConfig
        };
      }
    },
    updateServerConfig: {
      run: async (serverId, serverConfig) => {
        const stmt = db.prepare(
          `UPDATE servers 
           SET server_config = ?, updated_at = datetime('now')
           WHERE id = ?`
        );
        const configJson = serverConfig ? JSON.stringify(serverConfig) : null;
        const result = stmt.run(configJson, serverId);
        return Promise.resolve({ 
          changes: result.changes 
        });
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
    insertCreatedImageLike: {
      run: async (userId, createdImageId) => {
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO likes_created_image (user_id, created_image_id)
           VALUES (?, ?)`
        );
        const result = stmt.run(userId, createdImageId);
        return Promise.resolve({ changes: result.changes });
      }
    },
    deleteCreatedImageLike: {
      run: async (userId, createdImageId) => {
        const stmt = db.prepare(
          `DELETE FROM likes_created_image
           WHERE user_id = ? AND created_image_id = ?`
        );
        const result = stmt.run(userId, createdImageId);
        return Promise.resolve({ changes: result.changes });
      }
    },
    selectCreatedImageLikeCount: {
      get: async (createdImageId) => {
        const stmt = db.prepare(
          `SELECT COUNT(*) AS like_count
           FROM likes_created_image
           WHERE created_image_id = ?`
        );
        return Promise.resolve(stmt.get(createdImageId));
      }
    },
    selectCreatedImageViewerLiked: {
      get: async (userId, createdImageId) => {
        const stmt = db.prepare(
          `SELECT 1 AS viewer_liked
           FROM likes_created_image
           WHERE user_id = ? AND created_image_id = ?
           LIMIT 1`
        );
        return Promise.resolve(stmt.get(userId, createdImageId));
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
    deleteCreatedImageById: {
      run: async (id, userId) => {
        const stmt = db.prepare(
          `DELETE FROM created_images
           WHERE id = ? AND user_id = ?`
        );
        const result = stmt.run(id, userId);
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
    },
    selectUserCredits: {
      get: async (userId) => {
        const stmt = db.prepare(
          `SELECT id, user_id, balance, last_daily_claim_at, created_at, updated_at
           FROM user_credits
           WHERE user_id = ?`
        );
        return Promise.resolve(stmt.get(userId));
      }
    },
    insertUserCredits: {
      run: async (userId, balance, lastDailyClaimAt) => {
        const stmt = db.prepare(
          `INSERT INTO user_credits (user_id, balance, last_daily_claim_at)
           VALUES (?, ?, ?)`
        );
        const result = stmt.run(userId, balance, lastDailyClaimAt || null);
        return Promise.resolve({
          insertId: result.lastInsertRowid,
          lastInsertRowid: result.lastInsertRowid,
          changes: result.changes
        });
      }
    },
    updateUserCreditsBalance: {
      run: async (userId, amount) => {
        // First get current balance to prevent negative credits
        const selectStmt = db.prepare(
          `SELECT balance FROM user_credits WHERE user_id = ?`
        );
        const current = selectStmt.get(userId);
        const currentBalance = current?.balance ?? 0;
        const newBalance = currentBalance + amount;
        
        // Prevent negative credits - ensure balance never goes below 0
        const finalBalance = Math.max(0, newBalance);
        
        const stmt = db.prepare(
          `UPDATE user_credits
           SET balance = ?, updated_at = datetime('now')
           WHERE user_id = ?`
        );
        const result = stmt.run(finalBalance, userId);
        return Promise.resolve({ changes: result.changes });
      }
    },
    claimDailyCredits: {
      run: async (userId, amount = 10) => {
        // Check if user can claim (last claim was not today in UTC)
        const checkStmt = db.prepare(
          `SELECT id, balance, last_daily_claim_at
           FROM user_credits
           WHERE user_id = ?`
        );
        const credits = checkStmt.get(userId);
        
        if (!credits) {
          // No credits record exists, create one with the daily amount
          const nowUTC = new Date().toISOString();
          const insertStmt = db.prepare(
            `INSERT INTO user_credits (user_id, balance, last_daily_claim_at, updated_at)
             VALUES (?, ?, ?, ?)`
          );
          insertStmt.run(userId, amount, nowUTC, nowUTC);
          return Promise.resolve({ 
            success: true, 
            balance: amount,
            changes: 1
          });
        }
        
        // Check if already claimed today (UTC)
        const now = new Date();
        const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const todayUTCStr = todayUTC.toISOString().slice(0, 10);
        
        if (credits.last_daily_claim_at) {
          const lastClaimDate = new Date(credits.last_daily_claim_at);
          const lastClaimUTC = new Date(Date.UTC(lastClaimDate.getUTCFullYear(), lastClaimDate.getUTCMonth(), lastClaimDate.getUTCDate()));
          const lastClaimUTCStr = lastClaimUTC.toISOString().slice(0, 10);
          
          if (lastClaimUTCStr >= todayUTCStr) {
            // Already claimed today
            return Promise.resolve({ 
              success: false, 
              balance: credits.balance,
              changes: 0,
              message: 'Daily credits already claimed today'
            });
          }
        }
        
        // Update balance and last claim date (using UTC)
        const nowUTC = new Date().toISOString();
        const updateStmt = db.prepare(
          `UPDATE user_credits
           SET balance = balance + ?, 
               last_daily_claim_at = ?,
               updated_at = ?
           WHERE user_id = ?`
        );
        const result = updateStmt.run(amount, nowUTC, nowUTC, userId);
        
        // Get new balance
        const newBalanceStmt = db.prepare(
          `SELECT balance FROM user_credits WHERE user_id = ?`
        );
        const newCredits = newBalanceStmt.get(userId);
        
        return Promise.resolve({ 
          success: true, 
          balance: newCredits.balance,
          changes: result.changes
        });
      }
    },
    transferCredits: {
      run: async (fromUserId, toUserId, amount) => {
        const result = transferCreditsTxn(Number(fromUserId), Number(toUserId), Number(amount));
        return Promise.resolve(result);
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
