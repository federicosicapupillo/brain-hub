CREATE TABLE public.n8n_execution_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid,
  brain_id uuid,
  automation_action_id uuid,
  workflow_registry_id uuid,
  runbook_instance_id uuid,
  execution_mode text NOT NULL DEFAULT 'dry_run',
  request_payload jsonb,
  response_status int,
  response_body jsonb,
  success boolean NOT NULL DEFAULT false,
  error_text text,
  receipt_json jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_n8n_exec_logs_user ON public.n8n_execution_logs(user_id, created_at DESC);
CREATE INDEX idx_n8n_exec_logs_action ON public.n8n_execution_logs(automation_action_id);
CREATE INDEX idx_n8n_exec_logs_workflow ON public.n8n_execution_logs(workflow_registry_id);
CREATE INDEX idx_n8n_exec_logs_brain ON public.n8n_execution_logs(brain_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.n8n_execution_logs TO authenticated;
GRANT ALL ON public.n8n_execution_logs TO service_role;

ALTER TABLE public.n8n_execution_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own n8n execution logs"
  ON public.n8n_execution_logs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);