
CREATE TABLE IF NOT EXISTS public.project_knowledge_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NULL,
  brain_id UUID NULL,
  roadmap_item_id UUID NULL,
  task_id UUID NULL,
  prompt_execution_log_id UUID NULL,
  runbook_instance_id UUID NULL,
  tool_link_id UUID NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'custom',
  category TEXT NOT NULL DEFAULT 'Altro',
  source_url TEXT NULL,
  local_path TEXT NULL,
  external_drive_name TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  importance TEXT NOT NULL DEFAULT 'media',
  description TEXT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_knowledge_sources TO authenticated;
GRANT ALL ON public.project_knowledge_sources TO service_role;

ALTER TABLE public.project_knowledge_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their knowledge sources"
  ON public.project_knowledge_sources
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_pks_user ON public.project_knowledge_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_pks_brain ON public.project_knowledge_sources(brain_id);
CREATE INDEX IF NOT EXISTS idx_pks_project ON public.project_knowledge_sources(project_id);
CREATE INDEX IF NOT EXISTS idx_pks_roadmap ON public.project_knowledge_sources(roadmap_item_id);
CREATE INDEX IF NOT EXISTS idx_pks_tool ON public.project_knowledge_sources(tool_link_id);
CREATE INDEX IF NOT EXISTS idx_pks_status ON public.project_knowledge_sources(status);

CREATE TRIGGER update_project_knowledge_sources_updated_at
  BEFORE UPDATE ON public.project_knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
