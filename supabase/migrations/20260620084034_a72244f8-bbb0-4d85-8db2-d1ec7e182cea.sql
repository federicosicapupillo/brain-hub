
ALTER TABLE public.gmail_connection_settings
  ADD COLUMN IF NOT EXISTS refresh_token text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error_code text,
  ADD COLUMN IF NOT EXISTS sync_lock_until timestamptz,
  ADD COLUMN IF NOT EXISTS sync_status text;
