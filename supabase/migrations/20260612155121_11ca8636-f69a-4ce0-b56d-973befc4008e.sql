CREATE TABLE public.telegram_approval_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid,
  brain_id uuid,
  automation_action_id uuid,
  n8n_execution_log_id uuid,
  runbook_instance_id uuid,
  approval_type text NOT NULL DEFAULT 'manual_action',
  title text NOT NULL,
  message_preview text,
  payload_preview jsonb,
  status text NOT NULL DEFAULT 'draft',
  risk_level text NOT NULL DEFAULT 'medium',
  requested_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  expired_at timestamptz,
  approved_by text,
  rejection_reason text,
  telegram_message_id text,
  telegram_chat_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_tg_appr_user ON public.telegram_approval_requests(user_id, created_at DESC);
CREATE INDEX idx_tg_appr_brain ON public.telegram_approval_requests(brain_id);
CREATE INDEX idx_tg_appr_action ON public.telegram_approval_requests(automation_action_id);
CREATE INDEX idx_tg_appr_status ON public.telegram_approval_requests(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_approval_requests TO authenticated;
GRANT ALL ON public.telegram_approval_requests TO service_role;

ALTER TABLE public.telegram_approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own telegram approval requests"
  ON public.telegram_approval_requests
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_telegram_approval_requests_updated_at
  BEFORE UPDATE ON public.telegram_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();