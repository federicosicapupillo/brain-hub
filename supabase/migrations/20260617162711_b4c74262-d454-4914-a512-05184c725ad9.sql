ALTER TABLE public.agent_run_logs
  ADD COLUMN IF NOT EXISTS ai_prompt_text text,
  ADD COLUMN IF NOT EXISTS ai_result_text text,
  ADD COLUMN IF NOT EXISTS ai_provider text,
  ADD COLUMN IF NOT EXISTS ai_handoff_status text DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS ai_prompt_copied_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_result_received_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_agent_run_logs_ai_handoff_status
  ON public.agent_run_logs(ai_handoff_status);