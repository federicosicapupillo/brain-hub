
ALTER TABLE public.prompt_execution_logs
  ADD COLUMN IF NOT EXISTS parent_execution_log_id uuid REFERENCES public.prompt_execution_logs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS generation_goal text,
  ADD COLUMN IF NOT EXISTS generated_prompt_text text;

CREATE INDEX IF NOT EXISTS idx_pel_parent
  ON public.prompt_execution_logs (parent_execution_log_id);
