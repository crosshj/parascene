# Supabase Setup Guide

This guide explains how to set up Supabase for the Parascene application, including the database schema and image storage.

## Apply Database Schema

**IMPORTANT**: Before using the Supabase adapter, you must apply the database schema to your Supabase project.

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Open the file `db/schemas/supabase_01.sql` from this repository
4. Copy the entire contents of the file
5. Paste it into the SQL Editor in Supabase
6. Click **Run** to execute the schema

This will create all required tables with the `prsn_` prefix. The schema includes:
- `prsn_users` - User accounts
- `prsn_sessions` - User sessions
- `prsn_notifications` - User notifications (requires `user_id` and `role` columns)
- `prsn_creations` - User creations
- `prsn_created_images` - Generated images
- And other required tables

**Note**: If you see errors about missing columns (like `user_id` in `prsn_notifications`), it means the schema hasn't been applied. Run the SQL schema file to fix this.

## Create Storage Bucket

1. Go to **Storage** in your Supabase dashboard
2. Click **New bucket**
3. Create a bucket named: `prsn_created-images` (must match exactly, including the `prsn_` prefix)
4. **Important**: Set it as **Private bucket** (images are served through the backend API, not via public URLs)
5. Optionally configure:
   - **File size limit**: Set appropriate limit (e.g., 5MB for images)
   - **Allowed MIME types**: `image/png`, `image/jpeg`, `image/webp` (or leave empty for all)

## Storage Access

Since the bucket is **private** and images are served through the backend API, you don't need to configure RLS policies for storage. The backend uses the `SUPABASE_SERVICE_ROLE_KEY` to access images, which bypasses RLS.

**Note**: Images are accessed through `/api/images/created/:filename` route, which:
- Checks if the user owns the image OR if the image is published
- Fetches the image from Supabase Storage using the service role key
- Serves it to the client

This provides better security and access control than public URLs.

## Required Environment Variables

Make sure these environment variables are set in your `.env` file:

- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anonymous/public key
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (**required** for backend operations)
- `DB_ADAPTER=supabase` - Set this to use the Supabase adapter (or it will default to SQLite)

**Important**: The `SUPABASE_SERVICE_ROLE_KEY` is **required** for:
- Storage operations (image uploads and serving)
- Notification operations (bypasses Row Level Security to access `user_id` column)
- Other backend operations that need full database access

Without the service role key, you may see errors like "column does not exist" even when the column exists - this is because Row Level Security (RLS) is blocking access to certain columns when using the anon key.

## Troubleshooting

### "Failed to upload image to Supabase Storage"
- Check that the `prsn_created-images` bucket exists
- Verify the bucket is set to **Private**
- Ensure `SUPABASE_SERVICE_ROLE_KEY` is set in your `.env` file
- Check that the service role key is correct

### "Failed to clear images from Supabase Storage"
- Ensure `SUPABASE_SERVICE_ROLE_KEY` is set
- Verify the bucket exists

### "Bucket not found"
- Create the `prsn_created-images` bucket in Storage
- Ensure the bucket name matches exactly (case-sensitive, including the `prsn_` prefix)

### "column prsn_notifications.user_id does not exist" or similar schema errors
- **This is usually a Row Level Security (RLS) issue, not a missing column**
- The column exists, but RLS is blocking access when using the anon key
- **Solution**: Make sure `SUPABASE_SERVICE_ROLE_KEY` is set in your `.env` file
- The backend uses the service role key to bypass RLS for notification operations
- If you still see this error after setting the service role key:
  1. Verify the service role key is correct in your `.env` file
  2. Restart your development server
  3. If the error persists, check that RLS policies allow the service role to access the table
