-- Optional meta on OAuth codes/grants for forward-compatible extensions.
-- Safe if supabase_08_oauth.sql was already applied without these columns.

ALTER TABLE prsn_oauth_authorization_codes ADD COLUMN IF NOT EXISTS meta jsonb;

ALTER TABLE prsn_oauth_grants ADD COLUMN IF NOT EXISTS meta jsonb;
