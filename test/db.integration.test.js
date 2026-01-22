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
  'prsn_feed_items'
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
});
