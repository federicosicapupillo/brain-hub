
CREATE TABLE public.n8n_workflow_registry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NULL,
  brain_id UUID NULL,
  tool_link_id UUID NULL,
  workflow_name TEXT NOT NULL,
  workflow_description TEXT NULL,
  workflow_url TEXT NULL,
  webhook_url TEXT NULL,
  webhook_method TEXT NOT NULL DEFAULT 'POST',
  status TEXT NOT NULL DEFAULT 'draft',
  risk_level TEXT NOT NULL DEFAULT 'medium',
  linked_action_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected_input_schema JSONB NULL,
  expected_output_schema JSONB NULL,
  verification_method TEXT NULL,
  last_manual_test_at TIMESTAMPTZ NULL,
  last_manual_test_status TEXT NULL,
  notes TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.n8n_workflow_registry TO authenticated;
GRANT ALL ON public.n8n_workflow_registry TO service_role;

ALTER TABLE public.n8n_workflow_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own n8n workflows"
  ON public.n8n_workflow_registry
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_n8n_workflow_user ON public.n8n_workflow_registry(user_id);
CREATE INDEX idx_n8n_workflow_brain ON public.n8n_workflow_registry(brain_id);
CREATE INDEX idx_n8n_workflow_project ON public.n8n_workflow_registry(project_id);
CREATE INDEX idx_n8n_workflow_status ON public.n8n_workflow_registry(status);
CREATE INDEX idx_n8n_workflow_linked_action_types ON public.n8n_workflow_registry USING gin(linked_action_types);

CREATE TRIGGER trg_n8n_workflow_updated_at
  BEFORE UPDATE ON public.n8n_workflow_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
