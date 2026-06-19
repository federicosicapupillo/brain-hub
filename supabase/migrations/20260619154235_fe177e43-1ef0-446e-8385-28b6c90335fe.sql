
ALTER TABLE public.gmail_message_map
  ADD COLUMN IF NOT EXISTS importance_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS importance_level text,
  ADD COLUMN IF NOT EXISTS importance_reason text,
  ADD COLUMN IF NOT EXISTS summary_short text,
  ADD COLUMN IF NOT EXISTS project_guess text,
  ADD COLUMN IF NOT EXISTS summary_generated_at timestamptz;

CREATE INDEX IF NOT EXISTS gmail_message_map_importance_score_idx
  ON public.gmail_message_map (importance_score DESC);
CREATE INDEX IF NOT EXISTS gmail_message_map_importance_level_idx
  ON public.gmail_message_map (importance_level);
CREATE INDEX IF NOT EXISTS gmail_message_map_project_guess_idx
  ON public.gmail_message_map (project_guess);
