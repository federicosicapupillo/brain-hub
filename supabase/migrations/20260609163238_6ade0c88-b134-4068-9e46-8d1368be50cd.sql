
CREATE TABLE public.clipboard_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id UUID REFERENCES public.brains(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.project_links(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  source_tool TEXT NOT NULL DEFAULT '',
  target_tool TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'prompt',
  status TEXT NOT NULL DEFAULT 'saved',
  tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  copied_count INTEGER NOT NULL DEFAULT 0,
  last_copied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clipboard_items TO authenticated;
GRANT ALL ON public.clipboard_items TO service_role;

ALTER TABLE public.clipboard_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own clipboard items"
  ON public.clipboard_items
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_clipboard_items_user ON public.clipboard_items(user_id, created_at DESC);
CREATE INDEX idx_clipboard_items_brain ON public.clipboard_items(brain_id);
CREATE INDEX idx_clipboard_items_status ON public.clipboard_items(status);

CREATE TRIGGER trg_clipboard_items_updated_at
  BEFORE UPDATE ON public.clipboard_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
