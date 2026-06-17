
-- 1) telegram_connection_settings
CREATE TABLE IF NOT EXISTS public.telegram_connection_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id uuid NULL,
  label text NOT NULL,
  chat_id text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  default_for_approvals boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_connection_settings TO authenticated;
GRANT ALL ON public.telegram_connection_settings TO service_role;

ALTER TABLE public.telegram_connection_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "telegram_connection_settings owner all"
  ON public.telegram_connection_settings
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_tcs_user_id ON public.telegram_connection_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_tcs_brain_id ON public.telegram_connection_settings(brain_id);
CREATE INDEX IF NOT EXISTS idx_tcs_enabled ON public.telegram_connection_settings(is_enabled);

CREATE TRIGGER trg_tcs_updated_at
  BEFORE UPDATE ON public.telegram_connection_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) telegram_approval_requests delivery columns
ALTER TABLE public.telegram_approval_requests
  ADD COLUMN IF NOT EXISTS telegram_delivery_status text NULL,
  ADD COLUMN IF NOT EXISTS telegram_sent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS telegram_error_text text NULL,
  ADD COLUMN IF NOT EXISTS telegram_receipt_json jsonb NULL;
