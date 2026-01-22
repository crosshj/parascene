import { createClient } from "@supabase/supabase-js";
import path from "path";
import sharp from "sharp";

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
  
  // Use service role key for storage operations and backend operations (bypasses RLS)
  // This is needed for admin operations and operations that need to access all columns
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const serviceClient = serviceRoleKey 
    ? createClient(supabaseUrl, serviceRoleKey)
    : supabase;
  const storageClient = serviceClient;

  const queries = {
    selectUserByEmail: {
      get: async (email) => {
        // Use serviceClient to bypass RLS for authentication
        const { data, error } = await serviceClient
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
        // Use serviceClient to bypass RLS for authentication
        const { data, error } = await serviceClient
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
        // Use serviceClient to bypass RLS for authentication
        const { data, error } = await serviceClient
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
        // Use serviceClient to bypass RLS for authentication
        const { data, error } = await serviceClient
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
        // Use serviceClient to bypass RLS for authentication
        const { data, error } = await serviceClient
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
        // Use serviceClient to bypass RLS for authentication
        const { data, error } = await serviceClient
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
        // Use serviceClient to bypass RLS for authentication
        let query = serviceClient.from(prefixedTable("sessions")).delete();
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
        // Use serviceClient to bypass RLS for authentication
        const { data, error } = await serviceClient
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
        // Use serviceClient to bypass RLS for admin operations
        const { data, error } = await serviceClient
          .from(prefixedTable("users"))
          .select("id, email, role, created_at")
          .order("id", { ascending: true });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectModerationQueue: {
      all: async () => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
          .from(prefixedTable("moderation_queue"))
          .select("id, content_type, content_id, status, reason, created_at")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectProviders: {
      all: async () => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
          .from(prefixedTable("servers"))
          .select(`
            id,
            user_id,
            name,
            status,
            server_url,
            status_date,
            description,
            members_count,
            server_config,
            created_at,
            updated_at,
            prsn_users(email)
          `)
          .order("name", { ascending: true });
        if (error) throw error;
        // Transform the data to flatten the user email
        return (data ?? []).map(provider => {
          const { prsn_users, ...rest } = provider;
          return {
            ...rest,
            owner_email: prsn_users?.email || null
          };
        });
      }
    },
    insertProvider: {
      run: async (userId, name, status, serverUrl) => {
        const { data, error } = await serviceClient
          .from(prefixedTable("servers"))
          .insert({
            user_id: userId,
            name,
            status,
            server_url: serverUrl
          })
          .select("id")
          .single();
        if (error) throw error;
        return { 
          insertId: data.id,
          changes: 1 
        };
      }
    },
    selectPolicies: {
      all: async () => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
          .from(prefixedTable("policy_knobs"))
          .select("id, key, value, description, updated_at")
          .order("key", { ascending: true });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectNotificationsForUser: {
      all: async (userId, role) => {
        // Use service client to bypass RLS for backend operations
        let query = serviceClient
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
        if (error) {
          if (error.code === '42703' && error.message?.includes('user_id')) {
            throw new Error(
              `Database schema error: The ${prefixedTable("notifications")} table is missing the 'user_id' column. ` +
              `Please apply the schema from db/schemas/supabase_01.sql to your Supabase database. ` +
              `Original error: ${error.message}`
            );
          }
          throw error;
        }
        return data ?? [];
      }
    },
    selectUnreadNotificationCount: {
      get: async (userId, role) => {
        // Use service client to bypass RLS for backend operations
        let query = serviceClient
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
        if (error) {
          if (error.code === '42703' && error.message?.includes('user_id')) {
            throw new Error(
              `Database schema error: The ${prefixedTable("notifications")} table is missing the 'user_id' column. ` +
              `Please apply the schema from db/schemas/supabase_01.sql to your Supabase database. ` +
              `Original error: ${error.message}`
            );
          }
          throw error;
        }
        return { count: count ?? 0 };
      }
    },
    acknowledgeNotificationById: {
      run: async (id, userId, role) => {
        const hasUserId = userId !== null && userId !== undefined;
        const hasRole = role !== null && role !== undefined;
        
        if (!hasUserId && !hasRole) {
          return { changes: 0 };
        }
        
        // PostgREST doesn't support .or() in UPDATE queries the same way as SELECT
        // Try each condition separately - return on first match
        // Must create a fresh query for each attempt (can't reuse query builders)
        
        // Try with user_id first if provided
        if (hasUserId) {
          const { data, error } = await serviceClient
            .from(prefixedTable("notifications"))
            .update({ acknowledged_at: new Date().toISOString() })
            .eq("id", id)
            .is("acknowledged_at", null)
            .eq("user_id", userId)
            .select("id");
          
          if (error) throw error;
          if (data && data.length > 0) {
            return { changes: data.length };
          }
        }
        
        // If user_id didn't match, try with role
        if (hasRole) {
          const { data, error } = await serviceClient
            .from(prefixedTable("notifications"))
            .update({ acknowledged_at: new Date().toISOString() })
            .eq("id", id)
            .is("acknowledged_at", null)
            .eq("role", role)
            .select("id");
          
          if (error) throw error;
          if (data && data.length > 0) {
            return { changes: data.length };
          }
        }
        
        return { changes: 0 };
      }
    },
    selectFeedItems: {
      all: async (excludeUserId) => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
          .from(prefixedTable("feed_items"))
          .select(
            "id, title, summary, author, tags, created_at, created_image_id, prsn_created_images(filename, file_path, user_id)"
          )
          .order("created_at", { ascending: false });
        if (error) throw error;
        const items = (data ?? []).map((item) => {
          const { prsn_created_images, ...rest } = item;
          const filename = prsn_created_images?.filename ?? null;
          const file_path = prsn_created_images?.file_path ?? null;
          const user_id = prsn_created_images?.user_id ?? null;
          return {
            ...rest,
            filename,
            user_id,
            // Use file_path (which contains the URL) or fall back to constructing from filename
            url: file_path || (filename ? `/api/images/created/${filename}` : null)
          };
        });
        if (!excludeUserId) {
          return items;
        }
        return items.filter((item) => item.user_id !== excludeUserId);
      }
    },
    selectExploreItems: {
      all: async () => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
          .from(prefixedTable("explore_items"))
          .select("id, title, summary, category, created_at")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data ?? [];
      }
    },
    selectCreationsForUser: {
      all: async (userId) => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
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
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
          .from(prefixedTable("servers"))
          .select(`
            id,
            name,
            status,
            members_count,
            description,
            created_at,
            server_url,
            status_date,
            server_config,
            prsn_users(email)
          `)
          .order("name", { ascending: true });
        if (error) throw error;
        // Transform the data to flatten the user email
        return (data ?? []).map(server => {
          const { prsn_users, ...rest } = server;
          return {
            ...rest,
            owner_email: prsn_users?.email || null
          };
        });
      }
    },
    selectServerById: {
      get: async (serverId) => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
          .from(prefixedTable("servers"))
          .select(`
            id,
            user_id,
            name,
            status,
            members_count,
            description,
            created_at,
            server_url,
            status_date,
            server_config,
            prsn_users(email)
          `)
          .eq("id", serverId)
          .single();
        if (error) {
          if (error.code === 'PGRST116') return null; // Not found
          throw error;
        }
        if (!data) return null;
        
        // Transform the data to flatten the user email
        const { prsn_users, ...rest } = data;
        return {
          ...rest,
          owner_email: prsn_users?.email || null
        };
      }
    },
    selectTemplates: {
      all: async () => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
          .from(prefixedTable("templates"))
          .select("id, name, category, description, created_at")
          .order("name", { ascending: true });
        if (error) throw error;
        return data ?? [];
      }
    },
    insertCreatedImage: {
      run: async (userId, filename, filePath, width, height, color, status = "creating") => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
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
        // Use serviceClient to bypass RLS for backend operations
        const updateFields = { status };
        if (color) {
          updateFields.color = color;
        }
        const { data, error } = await serviceClient
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
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
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
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
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
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
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
    selectCreatedImageByFilename: {
      get: async (filename) => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
          .from(prefixedTable("created_images"))
          .select(
            "id, filename, file_path, width, height, color, status, created_at, published, published_at, title, description, user_id"
          )
          .eq("filename", filename)
          .maybeSingle();
        if (error) throw error;
        return data ?? undefined;
      }
    },
    publishCreatedImage: {
      run: async (id, userId, title, description) => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
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
    deleteCreatedImageById: {
      run: async (id, userId) => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
          .from(prefixedTable("created_images"))
          .delete()
          .eq("id", id)
          .eq("user_id", userId)
          .select("id");
        if (error) throw error;
        return { changes: data?.length ?? 0 };
      }
    },
    insertFeedItem: {
      run: async (title, summary, author, tags, createdImageId) => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
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
    },
    selectUserCredits: {
      get: async (userId) => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
          .from(prefixedTable("user_credits"))
          .select("id, user_id, balance, last_daily_claim_at, created_at, updated_at")
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw error;
        return data ?? undefined;
      }
    },
    insertUserCredits: {
      run: async (userId, balance, lastDailyClaimAt) => {
        // Use serviceClient to bypass RLS for backend operations
        const { data, error } = await serviceClient
          .from(prefixedTable("user_credits"))
          .insert({
            user_id: userId,
            balance,
            last_daily_claim_at: lastDailyClaimAt || null
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
    updateUserCreditsBalance: {
      run: async (userId, amount) => {
        // Use serviceClient to bypass RLS for backend operations
        // First get current balance
        const { data: current, error: selectError } = await serviceClient
          .from(prefixedTable("user_credits"))
          .select("balance")
          .eq("user_id", userId)
          .single();
        
        if (selectError && selectError.code !== 'PGRST116') throw selectError;
        
        const newBalance = (current?.balance ?? 0) + amount;
        
        // Prevent negative credits - ensure balance never goes below 0
        const finalBalance = Math.max(0, newBalance);
        
        const { data, error } = await serviceClient
          .from(prefixedTable("user_credits"))
          .update({
            balance: finalBalance,
            updated_at: new Date().toISOString()
          })
          .eq("user_id", userId)
          .select("id");
        
        if (error) throw error;
        return { changes: data?.length ?? 0 };
      }
    },
    claimDailyCredits: {
      run: async (userId, amount = 10) => {
        // Use serviceClient to bypass RLS for backend operations
        // Get current credits record
        const { data: credits, error: selectError } = await serviceClient
          .from(prefixedTable("user_credits"))
          .select("id, balance, last_daily_claim_at")
          .eq("user_id", userId)
          .maybeSingle();
        
        if (selectError) throw selectError;
        
        if (!credits) {
          // No credits record exists, create one with the daily amount
          const { data: newCredits, error: insertError } = await serviceClient
            .from(prefixedTable("user_credits"))
            .insert({
              user_id: userId,
              balance: amount,
              last_daily_claim_at: new Date().toISOString()
            })
            .select("balance")
            .single();
          
          if (insertError) throw insertError;
          return {
            success: true,
            balance: newCredits.balance,
            changes: 1
          };
        }
        
        // Check if already claimed today (UTC)
        const now = new Date();
        const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        
        if (credits.last_daily_claim_at) {
          const lastClaimDate = new Date(credits.last_daily_claim_at);
          const lastClaimUTC = new Date(Date.UTC(lastClaimDate.getUTCFullYear(), lastClaimDate.getUTCMonth(), lastClaimDate.getUTCDate()));
          
          if (lastClaimUTC.getTime() >= todayUTC.getTime()) {
            // Already claimed today
            return {
              success: false,
              balance: credits.balance,
              changes: 0,
              message: 'Daily credits already claimed today'
            };
          }
        }
        
        // Update balance and last claim date
        const newBalance = credits.balance + amount;
        const { data: updated, error: updateError } = await serviceClient
          .from(prefixedTable("user_credits"))
          .update({
            balance: newBalance,
            last_daily_claim_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("user_id", userId)
          .select("balance")
          .single();
        
        if (updateError) throw updateError;
        
        return {
          success: true,
          balance: updated.balance,
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
        // Use serviceClient to bypass RLS for backend operations
        const { count, error } = await serviceClient
          .from(table)
          .select("id", { count: "exact", head: true });
        if (error) throw error;
        if (count && count > 0) return;
      }
    }

    const transformedItems = transform ? items.map(transform) : items;
    // Use serviceClient to bypass RLS for backend operations
    const { error } = await serviceClient.from(table).insert(transformedItems);
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
      // Use serviceClient to bypass RLS for backend operations
      // Delete all rows - using a condition that should match all rows
      const { error } = await serviceClient.from(table).delete().gte("id", 0);
      if (error) {
        // If delete fails, try alternative approach
        const { error: error2 } = await serviceClient.from(table).delete().neq("id", -1);
        if (error2) throw error2;
      }
    }
  }

  // Storage interface for images using Supabase Storage
  // Images are stored in a private bucket and served through the backend
  const STORAGE_BUCKET = process.env.SUPABASE_IMAGE_BUCKET || "prsn_created-images";
  const STORAGE_THUMBNAIL_BUCKET =
    process.env.SUPABASE_THUMBNAIL_BUCKET || "prsn_created-images-thumbnails";
  
  function getThumbnailFilename(filename) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    return `${base}_th${ext || ""}`;
  }

  const storage = {
    uploadImage: async (buffer, filename) => {
      // Use storage client (service role if available) for uploads to private bucket
      const { data, error } = await storageClient.storage
        .from(STORAGE_BUCKET)
        .upload(filename, buffer, {
          contentType: "image/png",
          upsert: true
        });
      
      if (error) {
        throw new Error(`Failed to upload image to Supabase Storage: ${error.message}`);
      }

      const thumbnailBuffer = await sharp(buffer)
        .resize(250, 250, { fit: "cover" })
        .png()
        .toBuffer();
      const { error: thumbnailError } = await storageClient.storage
        .from(STORAGE_THUMBNAIL_BUCKET)
        .upload(filename, thumbnailBuffer, {
          contentType: "image/png",
          upsert: true
        });
      if (thumbnailError) {
        throw new Error(`Failed to upload thumbnail to Supabase Storage: ${thumbnailError.message}`);
      }
      
      // Return backend route URL instead of public Supabase URL
      // Images will be served through /api/images/created/:filename
      return `/api/images/created/${filename}`;
    },
    
    getImageUrl: (filename) => {
      // Return backend route URL - images are served through the backend
      return `/api/images/created/${filename}`;
    },
    
    getImageBuffer: async (filename, options = {}) => {
      const isThumbnail = options?.variant === "thumbnail";
      const bucket = isThumbnail ? STORAGE_THUMBNAIL_BUCKET : STORAGE_BUCKET;
      // Fetch image from Supabase Storage and return as buffer
      // Uses storage client (service role if available) to access private bucket
      const { data, error } = await storageClient.storage
        .from(bucket)
        .download(filename);

      if (error) {
        console.error("Supabase image fetch failed, serving fallback image.", {
          bucket,
          filename,
          variant: options?.variant ?? null,
          error: error?.message ?? error
        });
        return sharp({
          create: {
            width: 250,
            height: 250,
            channels: 3,
            background: "#b0b0b0"
          }
        })
          .png()
          .toBuffer();
      }
      
      // Convert blob to buffer
      const arrayBuffer = await data.arrayBuffer();
      return Buffer.from(arrayBuffer);
    },
    
    deleteImage: async (filename) => {
      // Use storage client (service role if available) for deletes
      const { error } = await storageClient.storage
        .from(STORAGE_BUCKET)
        .remove([filename]);
      
      if (error) {
        // Don't throw if file doesn't exist
        if (error.message && !error.message.includes("not found")) {
          throw new Error(`Failed to delete image from Supabase Storage: ${error.message}`);
        }
      }
    },
    
    clearAll: async () => {
      // Use storage client (service role if available) for admin operations
      // List all files in the bucket
      const { data: files, error: listError } = await storageClient.storage
        .from(STORAGE_BUCKET)
        .list();
      
      if (listError) {
        // If bucket doesn't exist, that's okay - nothing to clear
        if (listError.message && listError.message.includes("not found")) {
          return;
        }
        throw new Error(`Failed to list images in Supabase Storage: ${listError.message}`);
      }
      
      if (files && files.length > 0) {
        const fileNames = files.map(file => file.name);
        const { error: deleteError } = await storageClient.storage
          .from(STORAGE_BUCKET)
          .remove(fileNames);
        
        if (deleteError) {
          throw new Error(`Failed to clear images from Supabase Storage: ${deleteError.message}`);
        }
      }
    }
  };

  return { db, queries, seed, reset, storage };
}
