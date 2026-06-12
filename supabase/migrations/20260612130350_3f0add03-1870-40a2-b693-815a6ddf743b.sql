ALTER TABLE public.roadmap_items
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_prompt_execution_logs_roadmap_item_id
  ON public.prompt_execution_logs (roadmap_item_id);

CREATE INDEX IF NOT EXISTS idx_prompt_execution_logs_brain_id_user_id
  ON public.prompt_execution_logs (brain_id, user_id);