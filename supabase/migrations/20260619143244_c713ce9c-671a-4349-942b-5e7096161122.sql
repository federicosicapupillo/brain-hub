CREATE TABLE public.jack_action_previews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id UUID NULL,
  preview_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NULL,
  action_type TEXT NULL,
  priority TEXT NULL,
  source TEXT NOT NULL DEFAULT 'jack',
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NULL,
  preview_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed_action_id UUID NULL,
  confirmed_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jack_action_previews_user_preview_unique UNIQUE (user_id, preview_id),
  CONSTRAINT jack_action_previews_status_check CHECK (status IN ('pending','confirmed','cancelled','expired'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jack_action_previews TO authenticated;
GRANT ALL ON public.jack_action_previews TO service_role;

ALTER TABLE public.jack_action_previews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own jack_action_previews"
  ON public.jack_action_previews
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX jack_action_previews_user_idx ON public.jack_action_previews (user_id);
CREATE INDEX jack_action_previews_preview_id_idx ON public.jack_action_previews (preview_id);
CREATE INDEX jack_action_previews_brain_idx ON public.jack_action_previews (brain_id);
CREATE INDEX jack_action_previews_status_idx ON public.jack_action_previews (status);
CREATE INDEX jack_action_previews_confirmed_action_idx ON public.jack_action_previews (confirmed_action_id);
CREATE INDEX jack_action_previews_user_status_created_idx ON public.jack_action_previews (user_id, status, created_at DESC);

CREATE TRIGGER jack_action_previews_set_updated_at
  BEFORE UPDATE ON public.jack_action_previews
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();