
-- 1) Extend telegram_connection_settings with optional routing filters
ALTER TABLE public.telegram_connection_settings
  ADD COLUMN IF NOT EXISTS risk_levels text[] NULL,
  ADD COLUMN IF NOT EXISTS approval_types text[] NULL;

-- 2) Delivery attempts history (non-destructive, append-only ledger)
CREATE TABLE IF NOT EXISTS public.telegram_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id uuid NULL,
  approval_request_id uuid NOT NULL,
  connection_id uuid NULL,
  delivery_status text NOT NULL,
  telegram_message_id text NULL,
  telegram_chat_id text NULL,
  error_text text NULL,
  receipt_json jsonb NULL,
  attempt_number integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_delivery_attempts TO authenticated;
GRANT ALL ON public.telegram_delivery_attempts TO service_role;

ALTER TABLE public.telegram_delivery_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "telegram_delivery_attempts owner all"
  ON public.telegram_delivery_attempts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_tda_user_id ON public.telegram_delivery_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_tda_brain_id ON public.telegram_delivery_attempts(brain_id);
CREATE INDEX IF NOT EXISTS idx_tda_req ON public.telegram_delivery_attempts(approval_request_id);
CREATE INDEX IF NOT EXISTS idx_tda_status ON public.telegram_delivery_attempts(delivery_status);
