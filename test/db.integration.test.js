import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createClient } from '@supabase/supabase-js';
import { openDb } from '../db/index.js';

// Load environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// All tables that should exist according to the schema
const expectedTables = [
  'prsn_users',
  'prsn_sessions',
  'prsn_moderation_queue',
  'prsn_servers',
  'prsn_policy_knobs',
  'prsn_notifications',
  'prsn_explore_items',
  'prsn_creations',
  'prsn_templates',
  'prsn_created_images',
  'prsn_feed_items',
  'prsn_user_credits',
  'prsn_likes_created_image',
  'prsn_related_transitions'
];

describe('Database Integration Tests', () => {
  let supabase;

  beforeAll(() => {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'Missing required environment variables: SUPABASE_URL and/or SUPABASE_ANON_KEY. ' +
        'Please ensure these are set in your .env file.'
      );
    }
    supabase = createClient(supabaseUrl, supabaseKey);
  });

  describe('Table Existence Checks', () => {
    it('should have all required tables created', async () => {
      const missingTables = [];
      const existingTables = [];

      // Check each table by attempting to query it
      for (const tableName of expectedTables) {
        try {
          // Try to select from the table (limit 0 to avoid fetching data)
          const { error } = await supabase
            .from(tableName)
            .select('*', { count: 'exact', head: true });

          if (error) {
            // If we get a specific error about the table not existing, mark it as missing
            if (error.code === 'PGRST116' || error.message?.includes('does not exist')) {
              missingTables.push(tableName);
            } else {
              // Other errors might indicate the table exists but has issues
              // For now, we'll consider it existing if it's not a "does not exist" error
              existingTables.push(tableName);
            }
          } else {
            existingTables.push(tableName);
          }
        } catch (err) {
          // If we get an exception, assume the table doesn't exist
          missingTables.push(tableName);
        }
      }

      // Report results
      if (missingTables.length > 0) {
        console.error('Missing tables:', missingTables);
        console.log('Existing tables:', existingTables);
      }

      expect(missingTables).toHaveLength(0);
      expect(existingTables).toHaveLength(expectedTables.length);
    });

    it('should verify each table individually', async () => {
      for (const tableName of expectedTables) {
        const { error } = await supabase
          .from(tableName)
          .select('*', { count: 'exact', head: true });

        expect(error).toBeNull();
      }
    });
  });

  describe('Notification Acknowledgment', () => {
    let supabaseServiceClient;
    let dbQueries;
    let testUserId;
    let testNotificationIds = [];

    beforeAll(async () => {
      if (!serviceRoleKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for notification tests');
      }
      supabaseServiceClient = createClient(supabaseUrl, serviceRoleKey);

      // Initialize db abstraction with Supabase adapter
      process.env.DB_ADAPTER = 'supabase';
      const db = await openDb({ quiet: true });
      dbQueries = db.queries;

      // Create a test user
      const testEmail = `test-${Date.now()}@example.com`;
      const { data: userData, error: userError } = await supabaseServiceClient
        .from('prsn_users')
        .insert({
          email: testEmail,
          password_hash: 'test_hash',
          role: 'consumer'
        })
        .select('id')
        .single();

      if (userError) {
        throw new Error(`Failed to create test user: ${userError.message}`);
      }
      testUserId = userData.id;
    });

    afterAll(async () => {
      // Clean up all test notifications
      if (testNotificationIds.length > 0) {
        try {
          await supabaseServiceClient
            .from('prsn_notifications')
            .delete()
            .in('id', testNotificationIds);
        } catch (error) {
          console.error('Error cleaning up notifications:', error);
        }
      }
      // Clean up test user
      if (testUserId) {
        try {
          await supabaseServiceClient
            .from('prsn_users')
            .delete()
            .eq('id', testUserId);
        } catch (error) {
          console.error('Error cleaning up test user:', error);
        }
      }
    });

    it('should create and acknowledge a notification', async () => {
      // Create notification directly via Supabase
      const { data: notificationData, error: createError } = await supabaseServiceClient
        .from('prsn_notifications')
        .insert({
          user_id: testUserId,
          role: 'consumer',
          title: 'Test Notification',
          message: 'This is a test',
          acknowledged_at: null
        })
        .select('id, user_id, role, acknowledged_at')
        .single();

      expect(createError).toBeNull();
      expect(notificationData).toBeTruthy();
      expect(notificationData.acknowledged_at).toBeNull();
      
      const notificationId = notificationData.id;
      testNotificationIds.push(notificationId);

      // Acknowledge using the db abstraction
      const result = await dbQueries.acknowledgeNotificationById.run(
        notificationId,
        testUserId,
        'consumer'
      );

      expect(result.changes).toBeGreaterThan(0);

      // Verify it was acknowledged
      const { data: updatedNotification } = await supabaseServiceClient
        .from('prsn_notifications')
        .select('acknowledged_at')
        .eq('id', notificationId)
        .single();

      expect(updatedNotification.acknowledged_at).not.toBeNull();
    });
  });

  describe('Created Image Likes', () => {
    let supabaseServiceClient;
    let dbQueries;
    let ownerUserId;
    let viewerUserId;
    let createdImageId;
    let feedItemId;

    beforeAll(async () => {
      if (!serviceRoleKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for likes tests');
      }
      supabaseServiceClient = createClient(supabaseUrl, serviceRoleKey);

      process.env.DB_ADAPTER = 'supabase';
      const db = await openDb({ quiet: true });
      dbQueries = db.queries;

      const ownerEmail = `likes-owner-${Date.now()}@example.com`;
      const viewerEmail = `likes-viewer-${Date.now()}@example.com`;

      const { data: ownerData, error: ownerError } = await supabaseServiceClient
        .from('prsn_users')
        .insert({ email: ownerEmail, password_hash: 'test_hash', role: 'consumer' })
        .select('id')
        .single();
      if (ownerError) throw new Error(`Failed to create owner user: ${ownerError.message}`);
      ownerUserId = ownerData.id;

      const { data: viewerData, error: viewerError } = await supabaseServiceClient
        .from('prsn_users')
        .insert({ email: viewerEmail, password_hash: 'test_hash', role: 'consumer' })
        .select('id')
        .single();
      if (viewerError) throw new Error(`Failed to create viewer user: ${viewerError.message}`);
      viewerUserId = viewerData.id;

      const filename = `likes_test_${Date.now()}.png`;
      const { data: imageData, error: imageError } = await supabaseServiceClient
        .from('prsn_created_images')
        .insert({
          user_id: ownerUserId,
          filename,
          file_path: `/api/images/created/${filename}`,
          width: 64,
          height: 64,
          color: '#000000',
          status: 'completed',
          published: true,
          title: 'Likes test',
          description: 'Likes test image'
        })
        .select('id')
        .single();
      if (imageError) throw new Error(`Failed to create test image: ${imageError.message}`);
      createdImageId = imageData.id;

      const { data: feedData, error: feedError } = await supabaseServiceClient
        .from('prsn_feed_items')
        .insert({
          title: 'Likes feed item',
          summary: 'Likes feed item summary',
          author: 'likes-test',
          tags: null,
          created_image_id: createdImageId
        })
        .select('id')
        .single();
      if (feedError) throw new Error(`Failed to create feed item: ${feedError.message}`);
      feedItemId = feedData.id;
    });

    afterAll(async () => {
      // Clean up likes first (FK dependency)
      if (createdImageId) {
        try {
          await supabaseServiceClient
            .from('prsn_likes_created_image')
            .delete()
            .eq('created_image_id', createdImageId);
        } catch (error) {
          console.error('Error cleaning up likes:', error);
        }
      }

      if (feedItemId) {
        try {
          await supabaseServiceClient
            .from('prsn_feed_items')
            .delete()
            .eq('id', feedItemId);
        } catch (error) {
          console.error('Error cleaning up feed item:', error);
        }
      }

      if (createdImageId) {
        try {
          await supabaseServiceClient
            .from('prsn_created_images')
            .delete()
            .eq('id', createdImageId);
        } catch (error) {
          console.error('Error cleaning up created image:', error);
        }
      }

      if (ownerUserId) {
        try {
          await supabaseServiceClient.from('prsn_users').delete().eq('id', ownerUserId);
        } catch (error) {
          console.error('Error cleaning up owner user:', error);
        }
      }

      if (viewerUserId) {
        try {
          await supabaseServiceClient.from('prsn_users').delete().eq('id', viewerUserId);
        } catch (error) {
          console.error('Error cleaning up viewer user:', error);
        }
      }
    });

    it('should like/unlike idempotently and expose counts + viewer_liked', async () => {
      // Initially 0
      const initialCount = await dbQueries.selectCreatedImageLikeCount.get(createdImageId);
      expect(Number(initialCount?.like_count ?? 0)).toBe(0);

      const initialLiked = await dbQueries.selectCreatedImageViewerLiked.get(viewerUserId, createdImageId);
      expect(Boolean(initialLiked?.viewer_liked)).toBe(false);

      // Like
      await dbQueries.insertCreatedImageLike.run(viewerUserId, createdImageId);
      const afterLikeCount = await dbQueries.selectCreatedImageLikeCount.get(createdImageId);
      expect(Number(afterLikeCount?.like_count ?? 0)).toBe(1);

      const afterLikeLiked = await dbQueries.selectCreatedImageViewerLiked.get(viewerUserId, createdImageId);
      expect(Boolean(afterLikeLiked?.viewer_liked)).toBe(true);

      // Like again (idempotent)
      await dbQueries.insertCreatedImageLike.run(viewerUserId, createdImageId);
      const afterSecondLikeCount = await dbQueries.selectCreatedImageLikeCount.get(createdImageId);
      expect(Number(afterSecondLikeCount?.like_count ?? 0)).toBe(1);

      // Feed enrichment (viewer excludes self, but owner is different)
      const feed = await dbQueries.selectFeedItems.all(viewerUserId);
      const item = feed.find((x) => String(x.created_image_id) === String(createdImageId));
      expect(item).toBeTruthy();
      expect(Number(item.like_count ?? 0)).toBe(1);
      expect(Boolean(item.viewer_liked)).toBe(true);

      // Unlike
      await dbQueries.deleteCreatedImageLike.run(viewerUserId, createdImageId);
      const afterUnlikeCount = await dbQueries.selectCreatedImageLikeCount.get(createdImageId);
      expect(Number(afterUnlikeCount?.like_count ?? 0)).toBe(0);

      const afterUnlikeLiked = await dbQueries.selectCreatedImageViewerLiked.get(viewerUserId, createdImageId);
      expect(Boolean(afterUnlikeLiked?.viewer_liked)).toBe(false);
    });
  });
});
