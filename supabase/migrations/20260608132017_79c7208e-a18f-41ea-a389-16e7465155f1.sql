CREATE TABLE public.project_tool_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id uuid NOT NULL REFERENCES public.brains(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  tool_category text NOT NULL DEFAULT 'altro',
  connection_mode text NOT NULL DEFAULT 'manuale',
  connection_status text NOT NULL DEFAULT 'manuale',
  url text,
  repo_url text,
  folder_path text,
  notes text,
  last_checked_at timestamptz,
  last_sync_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_tool_links_mode_check CHECK (connection_mode IN ('manuale','import_export','github','oauth','api','storage','local_sync','non_disponibile')),
  CONSTRAINT project_tool_links_status_check CHECK (connection_status IN ('manuale','da_collegare','collegato','sincronizzato','errore','non_disponibile')),
  CONSTRAINT project_tool_links_unique UNIQUE (user_id, brain_id, tool_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_tool_links TO authenticated;
GRANT ALL ON public.project_tool_links TO service_role;

ALTER TABLE public.project_tool_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tool links" ON public.project_tool_links
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX project_tool_links_user_idx ON public.project_tool_links(user_id);
CREATE INDEX project_tool_links_brain_idx ON public.project_tool_links(brain_id);

CREATE TRIGGER trg_project_tool_links_updated
  BEFORE UPDATE ON public.project_tool_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();