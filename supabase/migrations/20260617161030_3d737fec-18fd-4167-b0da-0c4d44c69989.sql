
CREATE TABLE public.agent_run_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id uuid NULL,
  agent_id uuid NOT NULL,
  run_status text NOT NULL DEFAULT 'draft',
  run_mode text NOT NULL DEFAULT 'manual',
  objective text NOT NULL,
  input_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_summary text NULL,
  output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggested_action_id uuid NULL,
  result_review_item_id uuid NULL,
  code_handoff_id uuid NULL,
  risk_level text NOT NULL DEFAULT 'low',
  requires_approval boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_run_logs TO authenticated;
GRANT ALL ON public.agent_run_logs TO service_role;

ALTER TABLE public.agent_run_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own agent runs"
  ON public.agent_run_logs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX agent_run_logs_user_idx ON public.agent_run_logs(user_id);
CREATE INDEX agent_run_logs_brain_idx ON public.agent_run_logs(brain_id);
CREATE INDEX agent_run_logs_agent_idx ON public.agent_run_logs(agent_id);
CREATE INDEX agent_run_logs_status_idx ON public.agent_run_logs(run_status);
CREATE INDEX agent_run_logs_created_idx ON public.agent_run_logs(created_at DESC);

CREATE TRIGGER update_agent_run_logs_updated_at
  BEFORE UPDATE ON public.agent_run_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
