
CREATE TABLE public.daily_operating_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid NULL,
  brief_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  status text NOT NULL DEFAULT 'generated',
  generated_at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL,
  executive_summary text NOT NULL,
  voice_summary_text text NULL,
  project_status_summary text NULL,
  today_activity_summary text NULL,
  implemented_today jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_actions_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  email_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  calendar_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  drive_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  automation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_action_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_daily_briefs_user ON public.daily_operating_briefs(user_id);
CREATE INDEX idx_daily_briefs_brain ON public.daily_operating_briefs(brain_id);
CREATE INDEX idx_daily_briefs_date ON public.daily_operating_briefs(brief_date DESC);
CREATE INDEX idx_daily_briefs_generated_at ON public.daily_operating_briefs(generated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_operating_briefs TO authenticated;
GRANT ALL ON public.daily_operating_briefs TO service_role;

ALTER TABLE public.daily_operating_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own daily briefs"
  ON public.daily_operating_briefs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_daily_briefs_updated_at
  BEFORE UPDATE ON public.daily_operating_briefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
