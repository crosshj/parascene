import { createClient } from "@supabase/supabase-js";

// Note: Supabase schema must be provisioned separately (SQL editor/migrations).
// This adapter expects all tables to be prefixed with "prsn_".

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function applyUserOrRoleFilter(query, userId, role) {
  const hasUserId = userId !== null && userId !== undefined;
  const hasRole = role !== null && role !== undefined;
  if (hasUserId && hasRole) {
    return { query: query.or(`user_id.eq.${userId},role.eq.${role}`), hasFilter: true };
  }
  if (hasUserId) {
    return { query: query.eq("user_id", userId), hasFilter: true };
  }
  if (hasRole) {
    return { query: query.eq("role", role), hasFilter: true };
  }
  return { query, hasFilter: false };
}

function prefixedTable(name) {
  return `prsn_${name}`;
}

export function openDb() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseKey = requireEnv("SUPABASE_ANON_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);

  const queries = {
    selectUserByEmail: {
      get: async (email) => {
        const { data, error } = await supabase
          .from(prefixedTable("users"))
          .select("id, email, password_hash, role")
          .eq("email", email)
          .maybeSingle();
        if (error) throw error;
        return data ?? undefined;
      }
    },
    selectUserById: {
      get: async (id) => {
        const { data, error } = await supabase
          .from(prefixedTable("users"))
          .select("id, email, role, created_at")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        return data ?? undefined;
      }
    },
    selectSessionByTokenHash: {
      get: async (tokenHash, userId) => {
        const { data, error } = await supabase
          .from(prefixedTable("sessions"))
          .select("id, user_id, token_hash, expires_at")
          .eq("token_hash", tokenHash)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw error;
        return data ?? undefined;
      }
    },
    insertUser: {
      run: async (email, password_hash, role) => {
        const { data, error } = await supabase
          .from(prefixedTable("users"))
          .insert({ email, password_hash, role })
          .select("id")
          .single();
        if (error) throw error;
        return {
          insertId: data.id,
          lastInsertRowid: data.id,
          changes: 1
        };
      }
    },
    insertSession: {
      run: async (userId, tokenHash, expiresAt) => {
        const { data, error } = await supabase
          .from(prefixedTable("sessions"))
          .insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt })
          .select("id")
          .single();
        if (error) throw error;
        return {
          insertId: data.id,
          lastInsertRowid: data.id,
          changes: 1
        };
      }
    },
    refreshSessionExpiry: {
      run: async (id, expiresAt) => {
        const { data, error } = await supabase
          .from(prefixedTable("sessions"))
          .update({ expires_at: expiresAt })
          .eq("id", id)
          .select("id");
        if (error) throw error;
        return { changes: data?.length ?? 0 };
      }
    },
    deleteSessionByTokenHash: {
      run: async (tokenHash, userId) => {
        let query = supabase.from(prefixedTable("sessions")).delete();
        query = query.eq("token_hash", tokenHash);
        if (userId) {
          query = query.eq("user_id", userId);
        }
        const { data, error } = await query.select("id");
        if (error) throw error;
        return { changes: data?.length ?? 0 };
      }
    },
    deleteExpiredSessions: {
      run: async (nowIso) => {
        const { data, error } = await supabase
          .from(prefixedTable("sessions"))
          .delete()
          .lte("expires_at", nowIso)
          .select("id");
        if (error) throw error;
        return { changes: data?.length ?? 0 };
      }
    },
    selectUsers: {
      all: async () => {
        const { data, error } = await supabase
          .from(prefixedTable("users"))
          .select("id, email, role, created_at")
          .order("id", { ascending: true });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectModerationQueue: {
      all: async () => {
        const { data, error } = await supabase
          .from(prefixedTable("moderation_queue"))
          .select("id, content_type, content_id, status, reason, created_at")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectProviders: {
      all: async () => {
        const { data, error } = await supabase
          .from(prefixedTable("provider_registry"))
          .select("id, name, status, region, contact_email, created_at")
          .order("name", { ascending: true });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectProviderStatuses: {
      all: async () => {
        const { data, error } = await supabase
          .from(prefixedTable("provider_statuses"))
          .select("id, provider_name, status, region, uptime_pct, capacity_pct, last_check_at")
          .order("provider_name", { ascending: true });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectProviderMetrics: {
      all: async () => {
        const { data, error } = await supabase
          .from(prefixedTable("provider_metrics"))
          .select("id, name, value, unit, change, period, description, updated_at")
          .order("id", { ascending: true });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectProviderGrants: {
      all: async () => {
        const { data, error } = await supabase
          .from(prefixedTable("provider_grants"))
          .select("id, name, sponsor, amount, status, next_report, awarded_at")
          .order("awarded_at", { ascending: false });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectProviderTemplates: {
      all: async () => {
        const { data, error } = await supabase
          .from(prefixedTable("provider_templates"))
          .select("id, name, category, version, deployments, updated_at")
          .order("name", { ascending: true });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectPolicies: {
      all: async () => {
        const { data, error } = await supabase
          .from(prefixedTable("policy_knobs"))
          .select("id, key, value, description, updated_at")
          .order("key", { ascending: true });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectNotificationsForUser: {
      all: async (userId, role) => {
        let query = supabase
          .from(prefixedTable("notifications"))
          .select("id, title, message, link, created_at, acknowledged_at")
          .order("created_at", { ascending: false });
        const { query: filteredQuery, hasFilter } = applyUserOrRoleFilter(
          query,
          userId,
          role
        );
        if (!hasFilter) {
          return [];
        }
        const { data, error } = await filteredQuery;
        if (error) throw error;
        return data ?? [];
      }
    },
    selectUnreadNotificationCount: {
      get: async (userId, role) => {
        let query = supabase
          .from(prefixedTable("notifications"))
          .select("*", { count: "exact", head: true })
          .is("acknowledged_at", null);
        const { query: filteredQuery, hasFilter } = applyUserOrRoleFilter(
          query,
          userId,
          role
        );
        if (!hasFilter) {
          return { count: 0 };
        }
        const { count, error } = await filteredQuery;
        if (error) throw error;
        return { count: count ?? 0 };
      }
    },
    acknowledgeNotificationById: {
      run: async (id, userId, role) => {
        let query = supabase
          .from(prefixedTable("notifications"))
          .update({ acknowledged_at: new Date().toISOString() })
          .eq("id", id)
          .is("acknowledged_at", null);
        const { query: filteredQuery, hasFilter } = applyUserOrRoleFilter(
          query,
          userId,
          role
        );
        if (!hasFilter) {
          return { changes: 0 };
        }
        const { data, error } = await filteredQuery.select("id");
        if (error) throw error;
        return { changes: data?.length ?? 0 };
      }
    },
    selectFeedItems: {
      all: async () => {
        const { data, error } = await supabase
          .from(prefixedTable("feed_items"))
          .select(
            "id, title, summary, author, tags, created_at, created_image_id, prsn_created_images(filename, user_id)"
          )
          .order("created_at", { ascending: false });
        if (error) throw error;
        return (data ?? []).map((item) => {
          const { prsn_created_images, ...rest } = item;
          const filename = prsn_created_images?.filename ?? null;
          const user_id = prsn_created_images?.user_id ?? null;
          return {
            ...rest,
            filename,
            user_id,
            url: filename ? `/images/created/${filename}` : null
          };
        });
      }
    },
    selectExploreItems: {
      all: async () => {
        const { data, error } = await supabase
          .from(prefixedTable("explore_items"))
          .select("id, title, summary, category, created_at")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectCreationsForUser: {
      all: async (userId) => {
        const { data, error } = await supabase
          .from(prefixedTable("creations"))
          .select("id, title, body, status, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectServers: {
      all: async () => {
        const { data, error } = await supabase
          .from(prefixedTable("servers"))
          .select("id, name, region, status, members_count, description, created_at")
          .order("name", { ascending: true });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectTemplates: {
      all: async () => {
        const { data, error } = await supabase
          .from(prefixedTable("templates"))
          .select("id, name, category, description, created_at")
          .order("name", { ascending: true });
        if (error) throw error;
        return data ?? [];
      }
    },
    insertCreatedImage: {
      run: async (userId, filename, filePath, width, height, color, status = "creating") => {
        const { data, error } = await supabase
          .from(prefixedTable("created_images"))
          .insert({
            user_id: userId,
            filename,
            file_path: filePath,
            width,
            height,
            color,
            status
          })
          .select("id")
          .single();
        if (error) throw error;
        return {
          insertId: data.id,
          lastInsertRowid: data.id,
          changes: 1
        };
      }
    },
    updateCreatedImageStatus: {
      run: async (id, userId, status, color = null) => {
        const updateFields = { status };
        if (color) {
          updateFields.color = color;
        }
        const { data, error } = await supabase
          .from(prefixedTable("created_images"))
          .update(updateFields)
          .eq("id", id)
          .eq("user_id", userId)
          .select("id");
        if (error) throw error;
        return { changes: data?.length ?? 0 };
      }
    },
    selectCreatedImagesForUser: {
      all: async (userId) => {
        const { data, error } = await supabase
          .from(prefixedTable("created_images"))
          .select(
            "id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description"
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectCreatedImageById: {
      get: async (id, userId) => {
        const { data, error } = await supabase
          .from(prefixedTable("created_images"))
          .select(
            "id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, user_id"
          )
          .eq("id", id)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw error;
        return data ?? undefined;
      }
    },
    selectCreatedImageByIdAnyUser: {
      get: async (id) => {
        const { data, error } = await supabase
          .from(prefixedTable("created_images"))
          .select(
            "id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, user_id"
          )
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        return data ?? undefined;
      }
    },
    publishCreatedImage: {
      run: async (id, userId, title, description) => {
        const { data, error } = await supabase
          .from(prefixedTable("created_images"))
          .update({
            published: true,
            published_at: new Date().toISOString(),
            title,
            description
          })
          .eq("id", id)
          .eq("user_id", userId)
          .select("id");
        if (error) throw error;
        return { changes: data?.length ?? 0 };
      }
    },
    insertFeedItem: {
      run: async (title, summary, author, tags, createdImageId) => {
        const { data, error } = await supabase
          .from(prefixedTable("feed_items"))
          .insert({
            title,
            summary,
            author,
            tags: tags || null,
            created_image_id: createdImageId || null
          })
          .select("id")
          .single();
        if (error) throw error;
        return {
          insertId: data.id,
          lastInsertRowid: data.id,
          changes: 1
        };
      }
    }
  };

  const db = supabase;

  async function seed(tableName, items, options = {}) {
    if (!items || items.length === 0) return;

    const { skipIfExists = false, transform, checkExists } = options;
    const table = prefixedTable(tableName);

    if (skipIfExists) {
      if (checkExists) {
        const existing = await checkExists();
        if (existing && existing.length > 0) return;
      } else {
        const { count, error } = await supabase
          .from(table)
          .select("id", { count: "exact", head: true });
        if (error) throw error;
        if (count && count > 0) return;
      }
    }

    const transformedItems = transform ? items.map(transform) : items;
    const { error } = await supabase.from(table).insert(transformedItems);
    if (error) throw error;
  }

  async function reset() {
    const tables = [
      "feed_items",
      "created_images",
      "sessions",
      "notifications",
      "creations",
      "moderation_queue",
      "provider_statuses",
      "provider_metrics",
      "provider_grants",
      "provider_templates",
      "policy_knobs",
      "provider_registry",
      "servers",
      "templates",
      "explore_items",
      "users"
    ].map((table) => prefixedTable(table));

    for (const table of tables) {
      const { error } = await supabase.from(table).delete().neq("id", 0);
      if (error) throw error;
    }
  }

  return { db, queries, seed, reset };
}
