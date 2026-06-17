
CREATE TABLE public.mvp_build_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  brain_id uuid null,
  company_os_profile_id uuid null,
  company_blueprint_id uuid null,
  title text not null,
  idea_summary text not null,
  target_users text[] not null default '{}',
  main_problem text null,
  value_proposition text null,
  mvp_scope jsonb not null default '{}'::jsonb,
  screens jsonb not null default '[]'::jsonb,
  data_model jsonb not null default '[]'::jsonb,
  user_roles jsonb not null default '[]'::jsonb,
  integrations jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  success_criteria jsonb not null default '[]'::jsonb,
  roadmap jsonb not null default '[]'::jsonb,
  recommended_engine text null,
  build_engine_handoff_id uuid null,
  status text not null default 'draft',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mvp_build_projects TO authenticated;
GRANT ALL ON public.mvp_build_projects TO service_role;

ALTER TABLE public.mvp_build_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mvp_build_projects_owner_all"
  ON public.mvp_build_projects
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX mvp_build_projects_user_id_idx ON public.mvp_build_projects (user_id);
CREATE INDEX mvp_build_projects_brain_id_idx ON public.mvp_build_projects (brain_id);
CREATE INDEX mvp_build_projects_status_idx ON public.mvp_build_projects (status);
CREATE INDEX mvp_build_projects_recommended_engine_idx ON public.mvp_build_projects (recommended_engine);

CREATE TRIGGER mvp_build_projects_set_updated_at
  BEFORE UPDATE ON public.mvp_build_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
