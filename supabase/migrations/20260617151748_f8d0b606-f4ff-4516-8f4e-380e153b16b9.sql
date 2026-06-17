
CREATE TABLE public.agent_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid NULL,
  name text NOT NULL,
  agent_key text NOT NULL,
  description text NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  operating_mode text NOT NULL DEFAULT 'manual',
  max_risk_level text NOT NULL DEFAULT 'low',
  requires_approval boolean NOT NULL DEFAULT true,
  can_create_actions boolean NOT NULL DEFAULT true,
  can_execute_tools boolean NOT NULL DEFAULT false,
  can_call_external_apis boolean NOT NULL DEFAULT false,
  can_trigger_n8n boolean NOT NULL DEFAULT false,
  can_send_telegram boolean NOT NULL DEFAULT false,
  can_modify_external_data boolean NOT NULL DEFAULT false,
  allowed_sources text[] NOT NULL DEFAULT '{}',
  allowed_tools text[] NOT NULL DEFAULT '{}',
  output_targets text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_registry TO authenticated;
GRANT ALL ON public.agent_registry TO service_role;
ALTER TABLE public.agent_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own agents" ON public.agent_registry
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_ar_user ON public.agent_registry(user_id);
CREATE INDEX idx_ar_brain ON public.agent_registry(brain_id);
CREATE INDEX idx_ar_key ON public.agent_registry(agent_key);
CREATE INDEX idx_ar_status ON public.agent_registry(status);
CREATE INDEX idx_ar_role ON public.agent_registry(role);
CREATE TRIGGER trg_ar_updated BEFORE UPDATE ON public.agent_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.agent_permission_matrix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid NULL,
  agent_id uuid NOT NULL REFERENCES public.agent_registry(id) ON DELETE CASCADE,
  tool_key text NOT NULL,
  permission_level text NOT NULL DEFAULT 'read',
  risk_level text NOT NULL DEFAULT 'low',
  requires_approval boolean NOT NULL DEFAULT true,
  is_enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, tool_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_permission_matrix TO authenticated;
GRANT ALL ON public.agent_permission_matrix TO service_role;
ALTER TABLE public.agent_permission_matrix ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own agent permissions" ON public.agent_permission_matrix
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_apm_user ON public.agent_permission_matrix(user_id);
CREATE INDEX idx_apm_brain ON public.agent_permission_matrix(brain_id);
CREATE INDEX idx_apm_agent ON public.agent_permission_matrix(agent_id);
CREATE INDEX idx_apm_tool ON public.agent_permission_matrix(tool_key);
CREATE TRIGGER trg_apm_updated BEFORE UPDATE ON public.agent_permission_matrix
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
