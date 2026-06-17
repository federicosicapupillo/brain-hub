-- ============ Brain Hub v3.0 — Google Calendar (read-only) ============

-- 1) Connections
CREATE TABLE IF NOT EXISTS public.calendar_connection_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id UUID NULL,
  label TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'google_calendar',
  connection_status TEXT NOT NULL DEFAULT 'not_configured',
  scopes TEXT[] NOT NULL DEFAULT '{}',
  last_sync_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_connection_settings TO authenticated;
GRANT ALL ON public.calendar_connection_settings TO service_role;

ALTER TABLE public.calendar_connection_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own calendar connections"
  ON public.calendar_connection_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_calendar_conn_user ON public.calendar_connection_settings (user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_conn_brain ON public.calendar_connection_settings (brain_id);

CREATE TRIGGER trg_calendar_conn_updated_at
  BEFORE UPDATE ON public.calendar_connection_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Event map (metadata-only)
CREATE TABLE IF NOT EXISTS public.calendar_event_map (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id UUID NULL,
  connection_id UUID NULL REFERENCES public.calendar_connection_settings(id) ON DELETE CASCADE,
  google_calendar_id TEXT NULL,
  google_event_id TEXT NULL,
  calendar_name TEXT NULL,
  title TEXT NOT NULL,
  description TEXT NULL,
  location TEXT NULL,
  start_at TIMESTAMPTZ NULL,
  end_at TIMESTAMPTZ NULL,
  status TEXT NULL,
  event_type TEXT NULL,
  hangout_link TEXT NULL,
  html_link TEXT NULL,
  attendees_count INTEGER NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_event_map TO authenticated;
GRANT ALL ON public.calendar_event_map TO service_role;

ALTER TABLE public.calendar_event_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own calendar events"
  ON public.calendar_event_map
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_event_user_event
  ON public.calendar_event_map (user_id, google_calendar_id, google_event_id)
  WHERE google_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_event_user ON public.calendar_event_map (user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_event_brain ON public.calendar_event_map (brain_id);
CREATE INDEX IF NOT EXISTS idx_calendar_event_conn ON public.calendar_event_map (connection_id);
CREATE INDEX IF NOT EXISTS idx_calendar_event_start ON public.calendar_event_map (start_at);
CREATE INDEX IF NOT EXISTS idx_calendar_event_google ON public.calendar_event_map (google_event_id);

CREATE TRIGGER trg_calendar_event_updated_at
  BEFORE UPDATE ON public.calendar_event_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) OAuth state (anti-CSRF, short-lived)
CREATE TABLE IF NOT EXISTS public.google_calendar_oauth_states (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  state_token TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id UUID NULL REFERENCES public.calendar_connection_settings(id) ON DELETE CASCADE,
  brain_id UUID NULL,
  redirect_to TEXT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['https://www.googleapis.com/auth/calendar.readonly'],
  used_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_calendar_oauth_states TO authenticated;
GRANT ALL ON public.google_calendar_oauth_states TO service_role;

ALTER TABLE public.google_calendar_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own calendar oauth states"
  ON public.google_calendar_oauth_states
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_google_calendar_oauth_states_token ON public.google_calendar_oauth_states (state_token);
CREATE INDEX IF NOT EXISTS idx_google_calendar_oauth_states_user ON public.google_calendar_oauth_states (user_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_oauth_states_expires ON public.google_calendar_oauth_states (expires_at);