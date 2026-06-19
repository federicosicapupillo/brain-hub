
CREATE TABLE IF NOT EXISTS public.project_state_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid,
  project_id uuid,
  project_key text NOT NULL,
  project_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  priority text NOT NULL DEFAULT 'medium',
  current_state text NOT NULL DEFAULT '',
  last_completed text,
  next_action text,
  blockers text[] NOT NULL DEFAULT '{}',
  linked_tools jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_summary text,
  freshness_status text NOT NULL DEFAULT 'fresh',
  last_state_update_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_state_snapshots TO authenticated;
GRANT ALL ON public.project_state_snapshots TO service_role;

ALTER TABLE public.project_state_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own project state snapshots"
  ON public.project_state_snapshots
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_pss_user ON public.project_state_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_pss_brain ON public.project_state_snapshots(brain_id);
CREATE INDEX IF NOT EXISTS idx_pss_key ON public.project_state_snapshots(project_key);
CREATE INDEX IF NOT EXISTS idx_pss_priority ON public.project_state_snapshots(priority);
CREATE INDEX IF NOT EXISTS idx_pss_status ON public.project_state_snapshots(status);
CREATE INDEX IF NOT EXISTS idx_pss_freshness ON public.project_state_snapshots(freshness_status);

CREATE TRIGGER trg_pss_updated_at
  BEFORE UPDATE ON public.project_state_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
