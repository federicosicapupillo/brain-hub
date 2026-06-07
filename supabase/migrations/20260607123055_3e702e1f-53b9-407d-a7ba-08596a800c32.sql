CREATE TABLE public.project_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  brain_id UUID NOT NULL REFERENCES public.brains(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('project','file','prompt','roadmap','task','tool','external')),
  relation_type TEXT,
  title TEXT NOT NULL,
  url TEXT,
  description TEXT,
  category TEXT,
  tool TEXT,
  status TEXT,
  notes TEXT,
  target_brain_id UUID REFERENCES public.brains(id) ON DELETE SET NULL,
  target_table TEXT,
  target_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX project_links_brain_id_idx ON public.project_links(brain_id);
CREATE INDEX project_links_user_id_idx ON public.project_links(user_id);
CREATE INDEX project_links_type_idx ON public.project_links(link_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_links TO authenticated;
GRANT ALL ON public.project_links TO service_role;

ALTER TABLE public.project_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own project links"
  ON public.project_links FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own project links"
  ON public.project_links FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own project links"
  ON public.project_links FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own project links"
  ON public.project_links FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER project_links_set_updated_at
  BEFORE UPDATE ON public.project_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();