
-- Brain Hub v3.15 — Code Agent Orchestrator
CREATE TABLE IF NOT EXISTS public.code_agent_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid NULL,
  project_id uuid NULL,
  repository_id uuid NULL,
  action_id uuid NULL,
  source text NOT NULL DEFAULT 'jack',
  command_text text NOT NULL,
  job_type text NOT NULL,
  recommended_engine text NOT NULL,
  selected_engine text NULL,
  risk_level text NOT NULL DEFAULT 'medium',
  requires_approval boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft',
  approval_status text NOT NULL DEFAULT 'pending',
  execution_mode text NOT NULL DEFAULT 'manual',
  repo_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  branch_name text NULL,
  prompt_text text NULL,
  execution_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_commands text[] NULL,
  forbidden_paths text[] NULL,
  result_text text NULL,
  result_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_review_item_id uuid NULL,
  next_action_id uuid NULL,
  master_snapshot_draft_id uuid NULL,
  telegram_approval_id uuid NULL,
  runner_status text NULL,
  external_task_url text NULL,
  external_pr_url text NULL,
  external_run_id text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_agent_jobs TO authenticated;
GRANT ALL ON public.code_agent_jobs TO service_role;

ALTER TABLE public.code_agent_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "code_agent_jobs owner all"
ON public.code_agent_jobs FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_code_agent_jobs_user ON public.code_agent_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_code_agent_jobs_brain ON public.code_agent_jobs(brain_id);
CREATE INDEX IF NOT EXISTS idx_code_agent_jobs_project ON public.code_agent_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_code_agent_jobs_repo ON public.code_agent_jobs(repository_id);
CREATE INDEX IF NOT EXISTS idx_code_agent_jobs_status ON public.code_agent_jobs(status);
CREATE INDEX IF NOT EXISTS idx_code_agent_jobs_engine ON public.code_agent_jobs(recommended_engine);
CREATE INDEX IF NOT EXISTS idx_code_agent_jobs_risk ON public.code_agent_jobs(risk_level);

CREATE TRIGGER trg_code_agent_jobs_updated_at
BEFORE UPDATE ON public.code_agent_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.code_agent_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.code_agent_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_agent_job_events TO authenticated;
GRANT ALL ON public.code_agent_job_events TO service_role;

ALTER TABLE public.code_agent_job_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "code_agent_job_events owner all"
ON public.code_agent_job_events FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_code_agent_job_events_user ON public.code_agent_job_events(user_id);
CREATE INDEX IF NOT EXISTS idx_code_agent_job_events_job ON public.code_agent_job_events(job_id);
CREATE INDEX IF NOT EXISTS idx_code_agent_job_events_type ON public.code_agent_job_events(event_type);
