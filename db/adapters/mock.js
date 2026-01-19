import bcrypt from "bcryptjs";

const now = new Date().toISOString();

const users = [
  {
    id: 1,
    email: "consumer@example.com",
    password_hash: bcrypt.hashSync("p123@#", 12),
    role: "consumer",
    created_at: now
  },
  {
    id: 2,
    email: "creator@example.com",
    password_hash: bcrypt.hashSync("p123@#", 12),
    role: "creator",
    created_at: now
  },
  {
    id: 3,
    email: "provider@example.com",
    password_hash: bcrypt.hashSync("p123@#", 12),
    role: "provider",
    created_at: now
  },
  {
    id: 4,
    email: "admin@example.com",
    password_hash: bcrypt.hashSync("p123@#", 12),
    role: "admin",
    created_at: now
  }
];

const moderation_queue = [
  {
    id: 1,
    content_type: "creation",
    content_id: "post_1042",
    status: "pending",
    reason: "Possible spam links",
    created_at: now
  },
  {
    id: 2,
    content_type: "comment",
    content_id: "comment_221",
    status: "review",
    reason: "Reported for harassment",
    created_at: now
  }
];

const provider_registry = [
  {
    id: 1,
    name: "Aurora Streaming",
    status: "active",
    region: "NA",
    contact_email: "ops@aurorastreaming.example.com",
    created_at: now
  },
  {
    id: 2,
    name: "Nimbus Render",
    status: "pending",
    region: "EU",
    contact_email: "support@nimbusrender.example.com",
    created_at: now
  }
];

const provider_statuses = [
  {
    id: 1,
    provider_name: "Aurora Streaming",
    status: "operational",
    region: "NA",
    uptime_pct: 99.98,
    capacity_pct: 72,
    last_check_at: now
  },
  {
    id: 2,
    provider_name: "Nimbus Render",
    status: "degraded",
    region: "EU",
    uptime_pct: 98.62,
    capacity_pct: 91,
    last_check_at: now
  }
];

const provider_metrics = [
  {
    id: 1,
    name: "Jobs processed",
    value: "12,480",
    unit: "jobs",
    change: "+4.2%",
    period: "Last 7 days",
    description: "Completed renders across all regions.",
    updated_at: now
  },
  {
    id: 2,
    name: "Average queue time",
    value: "3.6",
    unit: "min",
    change: "-12%",
    period: "Last 24 hours",
    description: "Median time from submission to start.",
    updated_at: now
  }
];

const provider_grants = [
  {
    id: 1,
    name: "Render Efficiency Initiative",
    sponsor: "Aurora Labs",
    amount: "$120k",
    status: "active",
    next_report: "2026-03-15",
    awarded_at: now
  }
];

const provider_templates = [
  {
    id: 1,
    name: "Moodboard Starter",
    category: "Pre-production",
    version: "1.2",
    deployments: 38,
    updated_at: now
  }
];

const policy_knobs = [
  {
    id: 1,
    key: "auto_moderation",
    value: "enabled",
    description: "Toggle auto-queueing for flagged content.",
    updated_at: now
  },
  {
    id: 2,
    key: "provider_review_window_days",
    value: "14",
    description: "Days between provider reviews.",
    updated_at: now
  }
];

const notifications = [
  {
    id: 1,
    user_id: 1,
    role: null,
    title: "Welcome to Parascene",
    message: "Your account is ready. Explore the latest feed items.",
    link: "/feed",
    created_at: now,
    acknowledged_at: null
  },
  {
    id: 2,
    user_id: null,
    role: "provider",
    title: "Provider status update",
    message: "New uptime checks are available.",
    link: "/provider/status",
    created_at: now,
    acknowledged_at: null
  }
];

const feed_items = [
  {
    id: 1,
    title: "Render Week Highlights",
    summary: "Top community renders and pipeline insights.",
    author: "Parascene Team",
    tags: "community,render",
    created_at: now
  },
  {
    id: 2,
    title: "Creator Spotlight: Nimbus",
    summary: "A deep dive into last month's leading creator workflows.",
    author: "Parascene Team",
    tags: "creator,workflow",
    created_at: now
  }
];

const explore_items = [
  {
    id: 1,
    title: "Starter Kit",
    summary: "Jump-start your next scene with curated templates.",
    category: "Templates",
    created_at: now
  }
];

const creations = [
  {
    id: 1,
    user_id: 1,
    title: "First draft",
    body: "Draft notes for the next scene.",
    status: "draft",
    created_at: now
  }
];

const servers = [
  {
    id: 1,
    name: "Aurora Prime",
    region: "NA",
    status: "online",
    members_count: 128,
    description: "Primary NA rendering cluster.",
    created_at: now
  }
];

const templates = [
  {
    id: 1,
    name: "Shot Breakdown",
    category: "Production",
    description: "Track shots, frame ranges, and dependencies.",
    created_at: now
  }
];

const created_images = [];
const sessions = [];

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
      all: async () => [...provider_registry]
    },
    selectProviderStatuses: {
      all: async () => [...provider_statuses]
    },
    selectProviderMetrics: {
      all: async () => [...provider_metrics]
    },
    selectProviderGrants: {
      all: async () => [...provider_grants]
    },
    selectProviderTemplates: {
      all: async () => [...provider_templates]
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
      all: async () => [...feed_items]
    },
    selectExploreItems: {
      all: async () => [...explore_items]
    },
    selectCreationsForUser: {
      all: async (userId) => creations.filter((creation) => creation.user_id === Number(userId))
    },
    selectServers: {
      all: async () => [...servers]
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
      case "provider_registry":
        targetArray = provider_registry;
        break;
      case "provider_statuses":
        targetArray = provider_statuses;
        break;
      case "provider_metrics":
        targetArray = provider_metrics;
        break;
      case "provider_grants":
        targetArray = provider_grants;
        break;
      case "provider_templates":
        targetArray = provider_templates;
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
      case "servers":
        targetArray = servers;
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
      targetArray.push(newItem);
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
    servers.length = 0;
    templates.length = 0;
    created_images.length = 0;
    sessions.length = 0;
    // Reset ID counters
    nextUserId = 1;
    nextNotificationId = 1;
  }

  return { db, queries, seed, reset };
}
