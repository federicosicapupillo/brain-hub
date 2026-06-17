
CREATE TABLE public.github_repository_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid NULL,
  project_id uuid NULL,
  repository_url text NOT NULL,
  repository_owner text NULL,
  repository_name text NULL,
  default_branch text NULL,
  connected_status text NOT NULL DEFAULT 'manual',
  provider text NOT NULL DEFAULT 'github',
  last_sync_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.github_repository_registry TO authenticated;
GRANT ALL ON public.github_repository_registry TO service_role;
ALTER TABLE public.github_repository_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own github repos" ON public.github_repository_registry
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_ghrr_user ON public.github_repository_registry(user_id);
CREATE INDEX idx_ghrr_brain ON public.github_repository_registry(brain_id);
CREATE INDEX idx_ghrr_project ON public.github_repository_registry(project_id);
CREATE INDEX idx_ghrr_url ON public.github_repository_registry(repository_url);
CREATE TRIGGER trg_ghrr_updated BEFORE UPDATE ON public.github_repository_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.code_file_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid NULL,
  project_id uuid NULL,
  repository_id uuid NULL REFERENCES public.github_repository_registry(id) ON DELETE SET NULL,
  file_path text NOT NULL,
  file_type text NULL,
  importance text NULL,
  area text NULL,
  status text NOT NULL DEFAULT 'mapped',
  summary text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_file_map TO authenticated;
GRANT ALL ON public.code_file_map TO service_role;
ALTER TABLE public.code_file_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own code file map" ON public.code_file_map
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_cfm_user ON public.code_file_map(user_id);
CREATE INDEX idx_cfm_brain ON public.code_file_map(brain_id);
CREATE INDEX idx_cfm_repo ON public.code_file_map(repository_id);
CREATE INDEX idx_cfm_path ON public.code_file_map(file_path);
CREATE INDEX idx_cfm_area ON public.code_file_map(area);
CREATE TRIGGER trg_cfm_updated BEFORE UPDATE ON public.code_file_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
