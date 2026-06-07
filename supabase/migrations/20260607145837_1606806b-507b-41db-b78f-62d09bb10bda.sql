
CREATE TABLE public.content_project_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_id uuid NOT NULL,
  content_type text NOT NULL,
  source_project_id uuid REFERENCES public.brains(id) ON DELETE SET NULL,
  target_project_id uuid NOT NULL REFERENCES public.brains(id) ON DELETE CASCADE,
  relationship_type text NOT NULL DEFAULT 'collegato a',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, content_id, content_type, target_project_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_project_links TO authenticated;
GRANT ALL ON public.content_project_links TO service_role;

ALTER TABLE public.content_project_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own content links"
  ON public.content_project_links FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX content_project_links_content_idx
  ON public.content_project_links (content_id, content_type);
CREATE INDEX content_project_links_target_idx
  ON public.content_project_links (target_project_id);
CREATE INDEX content_project_links_source_idx
  ON public.content_project_links (source_project_id);

CREATE TRIGGER content_project_links_set_updated_at
  BEFORE UPDATE ON public.content_project_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
