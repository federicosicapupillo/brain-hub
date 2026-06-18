CREATE TABLE public.jack_memory_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  version text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','current','archived')),
  content_markdown text NOT NULL,
  content_hash text NOT NULL,
  source_filename text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  archived_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_jack_memory_user ON public.jack_memory_documents(user_id);
CREATE INDEX idx_jack_memory_status ON public.jack_memory_documents(user_id, status);
CREATE INDEX idx_jack_memory_hash ON public.jack_memory_documents(user_id, content_hash);
CREATE UNIQUE INDEX uq_jack_memory_one_current_per_user
  ON public.jack_memory_documents(user_id)
  WHERE status = 'current';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jack_memory_documents TO authenticated;
GRANT ALL ON public.jack_memory_documents TO service_role;

ALTER TABLE public.jack_memory_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own jack memory documents"
  ON public.jack_memory_documents
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_jack_memory_updated_at
  BEFORE UPDATE ON public.jack_memory_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();