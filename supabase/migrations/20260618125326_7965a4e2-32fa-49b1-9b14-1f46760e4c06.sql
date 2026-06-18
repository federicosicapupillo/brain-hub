
-- ============================================================
-- Brain Hub v3.8 — Gmail / Email connector (read-only)
-- ============================================================
-- Non-destructive. No tokens persisted anywhere.
-- ============================================================

-- 1) gmail_connection_settings
CREATE TABLE IF NOT EXISTS public.gmail_connection_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id uuid NULL,
  google_email text NULL,
  google_user_id text NULL,
  status text NOT NULL DEFAULT 'not_connected',
  scopes text[] NOT NULL DEFAULT '{}',
  connected_at timestamptz NULL,
  disconnected_at timestamptz NULL,
  last_sync_at timestamptz NULL,
  last_sync_status text NULL,
  last_sync_error text NULL,
  message_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gmail_connection_settings TO authenticated;
GRANT ALL ON public.gmail_connection_settings TO service_role;
ALTER TABLE public.gmail_connection_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gmail_connection_settings_owner_all"
  ON public.gmail_connection_settings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS gmail_connection_settings_user_idx ON public.gmail_connection_settings(user_id);
CREATE INDEX IF NOT EXISTS gmail_connection_settings_brain_idx ON public.gmail_connection_settings(brain_id);
CREATE TRIGGER set_updated_at_gmail_connection_settings
  BEFORE UPDATE ON public.gmail_connection_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) gmail_oauth_states
CREATE TABLE IF NOT EXISTS public.gmail_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id uuid NULL,
  connection_id uuid NULL REFERENCES public.gmail_connection_settings(id) ON DELETE CASCADE,
  state_token text NOT NULL UNIQUE,
  redirect_path text NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  consumed_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gmail_oauth_states TO authenticated;
GRANT ALL ON public.gmail_oauth_states TO service_role;
ALTER TABLE public.gmail_oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gmail_oauth_states_owner_all"
  ON public.gmail_oauth_states
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS gmail_oauth_states_user_idx ON public.gmail_oauth_states(user_id);
CREATE INDEX IF NOT EXISTS gmail_oauth_states_token_idx ON public.gmail_oauth_states(state_token);
CREATE INDEX IF NOT EXISTS gmail_oauth_states_expires_idx ON public.gmail_oauth_states(expires_at);

-- 3) gmail_message_map
CREATE TABLE IF NOT EXISTS public.gmail_message_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id uuid NULL,
  connection_id uuid NULL REFERENCES public.gmail_connection_settings(id) ON DELETE SET NULL,
  gmail_message_id text NOT NULL,
  gmail_thread_id text NULL,
  internal_date timestamptz NULL,
  from_email text NULL,
  from_name text NULL,
  to_emails text[] NOT NULL DEFAULT '{}',
  cc_emails text[] NOT NULL DEFAULT '{}',
  subject text NULL,
  snippet text NULL,
  body_preview text NULL,
  label_ids text[] NOT NULL DEFAULT '{}',
  is_unread boolean NOT NULL DEFAULT false,
  is_important boolean NOT NULL DEFAULT false,
  has_attachments boolean NOT NULL DEFAULT false,
  detected_category text NULL,
  detected_priority text NULL,
  suggested_action_type text NULL,
  linked_action_id uuid NULL,
  source_query text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gmail_message_map TO authenticated;
GRANT ALL ON public.gmail_message_map TO service_role;
ALTER TABLE public.gmail_message_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gmail_message_map_owner_all"
  ON public.gmail_message_map
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE UNIQUE INDEX IF NOT EXISTS gmail_message_map_unique_msg
  ON public.gmail_message_map(user_id, connection_id, gmail_message_id);
CREATE INDEX IF NOT EXISTS gmail_message_map_user_idx ON public.gmail_message_map(user_id);
CREATE INDEX IF NOT EXISTS gmail_message_map_brain_idx ON public.gmail_message_map(brain_id);
CREATE INDEX IF NOT EXISTS gmail_message_map_connection_idx ON public.gmail_message_map(connection_id);
CREATE INDEX IF NOT EXISTS gmail_message_map_thread_idx ON public.gmail_message_map(gmail_thread_id);
CREATE INDEX IF NOT EXISTS gmail_message_map_internal_date_idx ON public.gmail_message_map(internal_date DESC);
CREATE INDEX IF NOT EXISTS gmail_message_map_priority_idx ON public.gmail_message_map(detected_priority);
CREATE INDEX IF NOT EXISTS gmail_message_map_linked_action_idx ON public.gmail_message_map(linked_action_id);
CREATE TRIGGER set_updated_at_gmail_message_map
  BEFORE UPDATE ON public.gmail_message_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
