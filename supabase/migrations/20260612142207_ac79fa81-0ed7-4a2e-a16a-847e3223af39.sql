
CREATE TABLE public.runbook_instances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID,
  brain_id UUID,
  template_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  risk_level TEXT NOT NULL DEFAULT 'medium',
  current_step_index INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_runbook_instances_user ON public.runbook_instances(user_id);
CREATE INDEX idx_runbook_instances_brain ON public.runbook_instances(brain_id);
CREATE INDEX idx_runbook_instances_status ON public.runbook_instances(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.runbook_instances TO authenticated;
GRANT ALL ON public.runbook_instances TO service_role;

ALTER TABLE public.runbook_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own runbook_instances"
ON public.runbook_instances FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_runbook_instances_updated_at
BEFORE UPDATE ON public.runbook_instances
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
