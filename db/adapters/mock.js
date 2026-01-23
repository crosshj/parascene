import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const users = [];
const moderation_queue = [];
const servers = [];
const policy_knobs = [];
const notifications = [];
const feed_items = [];
const explore_items = [];
const creations = [];
const templates = [];

const created_images = [];
const sessions = [];

// On Vercel, use /tmp directory which is writable
// Otherwise use the local data directory
const dataDir = process.env.VERCEL 
  ? "/tmp/parascene-data"
  : path.join(__dirname, "..", "data");
const imagesDir = path.join(dataDir, "images", "created");

function ensureImagesDir() {
  try {
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }
  } catch (error) {
    // If directory creation fails (e.g., on Vercel without /tmp access),
    // log a warning but don't throw - images will be stored in memory only
    console.warn(`Warning: Could not create images directory: ${error.message}`);
    console.warn("Images will not be persisted to disk. Consider using Supabase adapter on Vercel.");
  }
}

const TABLE_TIMESTAMP_FIELDS = {
  users: ["created_at"],
  moderation_queue: ["created_at"],
  servers: ["created_at", "updated_at", "status_date"],
  policy_knobs: ["updated_at"],
  notifications: ["created_at"],
  feed_items: ["created_at"],
  explore_items: ["created_at"],
  creations: ["created_at"],
  templates: ["created_at"],
  created_images: ["created_at"]
};

export function openDb() {
  let nextUserId = users.length + 1;
  let nextNotificationId = notifications.length + 1;

  const queries = {
    selectUserByEmail: {
      get: async (email) => users.find((user) => user.email === email)
    },
    selectUserById: {
      get: async (id) => {
        const user = users.find((entry) => entry.id === Number(id));
        if (!user) return undefined;
        const { password_hash, ...safeUser } = user;
        return safeUser;
      }
    },
    selectSessionByTokenHash: {
      get: async (tokenHash, userId) =>
        sessions.find(
          (session) =>
            session.token_hash === tokenHash &&
            session.user_id === Number(userId)
        )
    },
    insertUser: {
      run: async (email, password_hash, role) => {
        const user = {
          id: nextUserId++,
          email,
          password_hash,
          role,
          created_at: new Date().toISOString()
        };
        users.push(user);
        // Standardize return value: use insertId (also support lastInsertRowid for backward compat)
        return { insertId: user.id, lastInsertRowid: user.id, changes: 1 };
      }
    },
    insertSession: {
      run: async (userId, tokenHash, expiresAt) => {
        const session = {
          id: sessions.length > 0
            ? Math.max(...sessions.map((s) => s.id || 0)) + 1
            : 1,
          user_id: Number(userId),
          token_hash: tokenHash,
          expires_at: expiresAt,
          created_at: new Date().toISOString()
        };
        sessions.push(session);
        return { insertId: session.id, lastInsertRowid: session.id, changes: 1 };
      }
    },
    refreshSessionExpiry: {
      run: async (id, expiresAt) => {
        const session = sessions.find((entry) => entry.id === Number(id));
        if (!session) {
          return { changes: 0 };
        }
        session.expires_at = expiresAt;
        return { changes: 1 };
      }
    },
    deleteSessionByTokenHash: {
      run: async (tokenHash, userId) => {
        const beforeCount = sessions.length;
        if (userId) {
          for (let i = sessions.length - 1; i >= 0; i -= 1) {
            if (
              sessions[i].token_hash === tokenHash &&
              sessions[i].user_id === Number(userId)
            ) {
              sessions.splice(i, 1);
            }
          }
        } else {
          for (let i = sessions.length - 1; i >= 0; i -= 1) {
            if (sessions[i].token_hash === tokenHash) {
              sessions.splice(i, 1);
            }
          }
        }
        return { changes: beforeCount - sessions.length };
      }
    },
    deleteExpiredSessions: {
      run: async (nowIso) => {
        const beforeCount = sessions.length;
        const nowMs = Date.parse(nowIso);
        for (let i = sessions.length - 1; i >= 0; i -= 1) {
          const expiresAtMs = Date.parse(sessions[i].expires_at);
          if (
            Number.isFinite(nowMs) &&
            Number.isFinite(expiresAtMs) &&
            expiresAtMs <= nowMs
          ) {
            sessions.splice(i, 1);
          }
        }
        return { changes: beforeCount - sessions.length };
      }
    },
    selectUsers: {
      all: async () =>
        users.map(({ password_hash, ...safeUser }) => ({ ...safeUser }))
    },
    selectModerationQueue: {
      all: async () => [...moderation_queue]
    },
    selectProviders: {
      all: async () => {
        // Join with users to get owner email
        return servers.map(provider => {
          const user = users.find(u => u.id === provider.user_id);
          return {
            ...provider,
            owner_email: user?.email || null
          };
        });
      }
    },
    insertProvider: {
      run: async (userId, name, status, serverUrl, serverConfig = null) => {
        const id = servers.length + 1;
        const now = new Date().toISOString();
        servers.push({
          id,
          user_id: userId,
          name,
          status,
          server_url: serverUrl,
          status_date: null,
          description: null,
          members_count: 0,
          server_config: serverConfig,
          created_at: now,
          updated_at: now
        });
        return Promise.resolve({ 
          insertId: id,
          changes: 1 
        });
      }
    },
    selectPolicies: {
      all: async () => [...policy_knobs]
    },
    selectNotificationsForUser: {
      all: async (userId, role) =>
        notifications.filter(
          (note) => note.user_id === userId || note.role === role
        )
    },
    selectUnreadNotificationCount: {
      get: async (userId, role) => ({
        count: notifications.filter(
          (note) =>
            !note.acknowledged_at &&
            (note.user_id === userId || note.role === role)
        ).length
      })
    },
    acknowledgeNotificationById: {
      run: async (id, userId, role) => {
        const notification = notifications.find(
          (note) =>
            note.id === Number(id) &&
            !note.acknowledged_at &&
            (note.user_id === userId || note.role === role)
        );
        if (!notification) {
          return { changes: 0 };
        }
        notification.acknowledged_at = new Date().toISOString();
        return { changes: 1 };
      }
    },
    selectFeedItems: {
      all: async (excludeUserId) =>
        feed_items.filter((item) => item.user_id !== Number(excludeUserId))
    },
    selectExploreItems: {
      all: async () => [...explore_items]
    },
    selectCreationsForUser: {
      all: async (userId) => creations.filter((creation) => creation.user_id === Number(userId))
    },
    selectServers: {
      all: async () => {
        // Join with users to get owner email
        return servers.map(server => {
          const user = users.find(u => u.id === server.user_id);
          return {
            ...server,
            owner_email: user?.email || null
          };
        });
      }
    },
    selectServerById: {
      get: async (serverId) => {
        const server = servers.find(s => s.id === Number(serverId));
        if (!server) return null;
        const user = users.find(u => u.id === server.user_id);
        return {
          ...server,
          owner_email: user?.email || null
        };
      }
    },
    updateServerConfig: {
      run: async (serverId, serverConfig) => {
        const server = servers.find(s => s.id === Number(serverId));
        if (server) {
          server.server_config = serverConfig;
          server.updated_at = new Date().toISOString();
          return { changes: 1 };
        }
        return { changes: 0 };
      }
    },
    selectTemplates: {
      all: async () => [...templates]
    },
    insertCreatedImage: {
      run: async (userId, filename, filePath, width, height, color, status = 'creating') => {
        const image = {
          id: created_images.length > 0 
            ? Math.max(...created_images.map(i => i.id || 0)) + 1
            : 1,
          user_id: userId,
          filename,
          file_path: filePath,
          width,
          height,
          color,
          status,
          created_at: new Date().toISOString()
        };
        created_images.push(image);
        return {
          insertId: image.id,
          lastInsertRowid: image.id,
          changes: 1
        };
      }
    },
    updateCreatedImageStatus: {
      run: async (id, userId, status, color = null) => {
        const image = created_images.find(
          (img) => img.id === Number(id) && img.user_id === Number(userId)
        );
        if (!image) {
          return { changes: 0 };
        }
        image.status = status;
        if (color) {
          image.color = color;
        }
        return { changes: 1 };
      }
    },
    selectCreatedImagesForUser: {
      all: async (userId) => {
        return created_images.filter(
          (img) => img.user_id === Number(userId)
        );
      }
    },
    selectCreatedImageById: {
      get: async (id, userId) => {
        return created_images.find(
          (img) => img.id === Number(id) && img.user_id === Number(userId)
        );
      }
    },
    selectCreatedImageByFilename: {
      get: async (filename) => {
        return created_images.find(
          (img) => img.filename === filename
        );
      }
    },
    publishCreatedImage: {
      run: async (id, userId, title, description) => {
        const image = created_images.find(
          (img) => img.id === Number(id) && img.user_id === Number(userId)
        );
        if (!image) {
          return { changes: 0 };
        }
        image.published = true;
        image.published_at = new Date().toISOString();
        image.title = title;
        image.description = description;
        return { changes: 1 };
      }
    },
    deleteCreatedImageById: {
      run: async (id, userId) => {
        const index = created_images.findIndex(
          (img) => img.id === Number(id) && img.user_id === Number(userId)
        );
        if (index === -1) {
          return { changes: 0 };
        }
        created_images.splice(index, 1);
        return { changes: 1 };
      }
    }
  };

  const db = {
    prepare: () => makeStatement({}),
    exec: () => {}
  };

  async function seed(tableName, items, options = {}) {
    if (!items || items.length === 0) return;

    const { skipIfExists = false, transform, checkExists } = options;

    // Get the appropriate array for this table
    let targetArray;
    switch (tableName) {
      case "users":
        targetArray = users;
        break;
      case "moderation_queue":
        targetArray = moderation_queue;
        break;
      case "servers":
        targetArray = servers;
        break;
      case "policy_knobs":
        targetArray = policy_knobs;
        break;
      case "notifications":
        targetArray = notifications;
        break;
      case "feed_items":
        targetArray = feed_items;
        break;
      case "explore_items":
        targetArray = explore_items;
        break;
      case "creations":
        targetArray = creations;
        break;
      case "templates":
        targetArray = templates;
        break;
      case "created_images":
        targetArray = created_images;
        break;
      default:
        console.warn(`Unknown table: ${tableName}`);
        return;
    }

    // Check if we should skip seeding
    if (skipIfExists) {
      if (checkExists) {
        const existing = await checkExists();
        if (existing && existing.length > 0) return;
      } else {
        if (targetArray.length > 0) return;
      }
    }

    const seededAt = new Date().toISOString();
    const timestampFields = TABLE_TIMESTAMP_FIELDS[tableName] || [];

    // Insert items
    for (const item of items) {
      const transformedItem = transform ? transform(item) : item;
      // Generate ID if needed
      const newItem = { ...transformedItem };
      if (!newItem.id) {
        // Simple ID generation based on array length
        newItem.id = targetArray.length > 0 
          ? Math.max(...targetArray.map(i => i.id || 0)) + 1
          : 1;
      }

      for (const field of timestampFields) {
        if (!newItem[field]) {
          newItem[field] = seededAt;
        }
      }

      targetArray.push(newItem);
    }

    if (tableName === "users") {
      nextUserId = users.length > 0
        ? Math.max(...users.map((user) => user.id || 0)) + 1
        : 1;
    }
  }

  async function reset() {
    // Clear all in-memory data arrays
    users.length = 0;
    moderation_queue.length = 0;
    provider_registry.length = 0;
    provider_statuses.length = 0;
    provider_metrics.length = 0;
    provider_grants.length = 0;
    provider_templates.length = 0;
    policy_knobs.length = 0;
    notifications.length = 0;
    feed_items.length = 0;
    explore_items.length = 0;
    creations.length = 0;
    templates.length = 0;
    created_images.length = 0;
    sessions.length = 0;
    // Reset ID counters
    nextUserId = 1;
    nextNotificationId = 1;
  }

  // Storage interface for images (using filesystem like SQLite)
  const storage = {
    uploadImage: async (buffer, filename) => {
      try {
        ensureImagesDir();
        const filePath = path.join(imagesDir, filename);
        fs.writeFileSync(filePath, buffer);
        return `/images/created/${filename}`;
      } catch (error) {
        // On Vercel or other read-only filesystems, we can't write files
        // Return a URL anyway - the image data is stored in the database record
        // The image won't be accessible via filesystem, but the database entry will exist
        console.warn(`Warning: Could not write image file ${filename}: ${error.message}`);
        console.warn("Image metadata will be stored, but file will not be persisted.");
        console.warn("For production on Vercel, use Supabase adapter with SUPABASE_URL and SUPABASE_ANON_KEY.");
        // Return a URL that indicates the file isn't available
        return `/images/created/${filename}`;
      }
    },
    
    getImageUrl: (filename) => {
      return `/images/created/${filename}`;
    },
    
    getImageBuffer: async (filename) => {
      try {
        const filePath = path.join(imagesDir, filename);
        if (!fs.existsSync(filePath)) {
          throw new Error(`Image not found: ${filename}`);
        }
        return fs.readFileSync(filePath);
      } catch (error) {
        // If file doesn't exist (e.g., on Vercel where files can't be written),
        // throw a clear error
        throw new Error(`Image file not available: ${filename}. This may occur on serverless platforms. Consider using Supabase adapter.`);
      }
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
