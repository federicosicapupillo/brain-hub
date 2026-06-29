
CREATE TABLE IF NOT EXISTS public.agent_tool_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_key text NOT NULL,
  tool_key text NOT NULL,
  contract_version text NOT NULL DEFAULT 'v1',
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'manual',
  confidence integer NOT NULL DEFAULT 100,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_tool_contracts TO authenticated;
GRANT ALL ON public.agent_tool_contracts TO service_role;
ALTER TABLE public.agent_tool_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_tool_contracts_owner" ON public.agent_tool_contracts
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.governance_action_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  level_key text NOT NULL,
  label text NOT NULL,
  risk_score integer NOT NULL DEFAULT 0,
  requires_approval boolean NOT NULL DEFAULT true,
  approval_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text,
  source text NOT NULL DEFAULT 'manual',
  confidence integer NOT NULL DEFAULT 100,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.governance_action_levels TO authenticated;
GRANT ALL ON public.governance_action_levels TO service_role;
ALTER TABLE public.governance_action_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "governance_action_levels_owner" ON public.governance_action_levels
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.brain_graph_relation_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid,
  from_node_id uuid,
  to_node_id uuid,
  relation_type text NOT NULL,
  source text NOT NULL,
  confidence integer NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brain_graph_relation_candidates TO authenticated;
GRANT ALL ON public.brain_graph_relation_candidates TO service_role;
ALTER TABLE public.brain_graph_relation_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brain_graph_relation_candidates_owner" ON public.brain_graph_relation_candidates
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.architecture_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  snapshot_id text NOT NULL,
  phase text NOT NULL,
  routes_count integer NOT NULL DEFAULT 0,
  services_count integer NOT NULL DEFAULT 0,
  tables_count integer NOT NULL DEFAULT 0,
  dependencies_count integer NOT NULL DEFAULT 0,
  low_confidence_count integer NOT NULL DEFAULT 0,
  limits jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.architecture_audit_runs TO authenticated;
GRANT ALL ON public.architecture_audit_runs TO service_role;
ALTER TABLE public.architecture_audit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "architecture_audit_runs_owner" ON public.architecture_audit_runs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
