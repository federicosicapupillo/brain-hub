-- build_engine_registry
CREATE TABLE IF NOT EXISTS public.build_engine_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid NULL,
  engine_key text NOT NULL,
  engine_name text NOT NULL,
  engine_type text NOT NULL,
  status text NOT NULL DEFAULT 'available',
  connection_mode text NOT NULL DEFAULT 'manual',
  best_for text[] NOT NULL DEFAULT '{}',
  limitations text[] NOT NULL DEFAULT '{}',
  risk_level text NULL,
  tool_url text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.build_engine_registry TO authenticated;
GRANT ALL ON public.build_engine_registry TO service_role;

ALTER TABLE public.build_engine_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own build engines"
  ON public.build_engine_registry
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_build_engine_registry_user ON public.build_engine_registry(user_id);
CREATE INDEX IF NOT EXISTS idx_build_engine_registry_brain ON public.build_engine_registry(brain_id);
CREATE INDEX IF NOT EXISTS idx_build_engine_registry_key ON public.build_engine_registry(engine_key);
CREATE INDEX IF NOT EXISTS idx_build_engine_registry_status ON public.build_engine_registry(status);

CREATE TRIGGER build_engine_registry_set_updated_at
  BEFORE UPDATE ON public.build_engine_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- build_engine_handoffs
CREATE TABLE IF NOT EXISTS public.build_engine_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid NULL,
  project_id uuid NULL,
  engine_key text NOT NULL,
  task_type text NOT NULL,
  title text NOT NULL,
  description text NULL,
  generated_prompt text NOT NULL,
  handoff_status text NOT NULL DEFAULT 'draft',
  risk_level text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.build_engine_handoffs TO authenticated;
GRANT ALL ON public.build_engine_handoffs TO service_role;

ALTER TABLE public.build_engine_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own build engine handoffs"
  ON public.build_engine_handoffs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_build_engine_handoffs_user ON public.build_engine_handoffs(user_id);
CREATE INDEX IF NOT EXISTS idx_build_engine_handoffs_brain ON public.build_engine_handoffs(brain_id);
CREATE INDEX IF NOT EXISTS idx_build_engine_handoffs_engine ON public.build_engine_handoffs(engine_key);
CREATE INDEX IF NOT EXISTS idx_build_engine_handoffs_status ON public.build_engine_handoffs(handoff_status);

CREATE TRIGGER build_engine_handoffs_set_updated_at
  BEFORE UPDATE ON public.build_engine_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();