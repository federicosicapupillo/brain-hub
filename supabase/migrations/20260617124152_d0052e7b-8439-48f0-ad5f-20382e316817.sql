CREATE TABLE public.google_drive_oauth_states (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  state_token TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id UUID NULL REFERENCES public.drive_connection_settings(id) ON DELETE CASCADE,
  brain_id UUID NULL,
  redirect_to TEXT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['https://www.googleapis.com/auth/drive.metadata.readonly'],
  used_at TIMESTAMP WITH TIME ZONE NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_drive_oauth_states TO authenticated;
GRANT ALL ON public.google_drive_oauth_states TO service_role;

ALTER TABLE public.google_drive_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own oauth states"
  ON public.google_drive_oauth_states
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_google_drive_oauth_states_token ON public.google_drive_oauth_states (state_token);
CREATE INDEX idx_google_drive_oauth_states_user ON public.google_drive_oauth_states (user_id);
CREATE INDEX idx_google_drive_oauth_states_expires ON public.google_drive_oauth_states (expires_at);