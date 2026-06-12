CREATE TABLE public.automation_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID,
  brain_id UUID,
  roadmap_item_id UUID,
  task_id UUID,
  prompt_execution_log_id UUID,
  parent_execution_log_id UUID,
  source TEXT NOT NULL DEFAULT 'system_suggestion',
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  risk_level TEXT NOT NULL DEFAULT 'low',
  status TEXT NOT NULL DEFAULT 'suggested',
  requires_confirmation BOOLEAN NOT NULL DEFAULT true,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  result_text TEXT,
  error_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_actions TO authenticated;
GRANT ALL ON public.automation_actions TO service_role;

ALTER TABLE public.automation_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own automation actions"
  ON public.automation_actions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX automation_actions_user_status_idx
  ON public.automation_actions(user_id, status, created_at DESC);
CREATE INDEX automation_actions_brain_idx
  ON public.automation_actions(brain_id);
CREATE INDEX automation_actions_pel_idx
  ON public.automation_actions(prompt_execution_log_id);

CREATE TRIGGER automation_actions_set_updated_at
  BEFORE UPDATE ON public.automation_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();