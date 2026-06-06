
-- knowledge_sources
CREATE TABLE public.knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id uuid NOT NULL REFERENCES public.brains(id) ON DELETE CASCADE,
  node_id uuid REFERENCES public.brain_nodes(id) ON DELETE SET NULL,
  title text NOT NULL,
  source_type text NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  description text,
  url text,
  file_path text,
  file_name text,
  mime_type text,
  file_size bigint,
  content_hash text,
  extracted_text text,
  summary text,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_sources TO authenticated;
GRANT ALL ON public.knowledge_sources TO service_role;
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own knowledge_sources" ON public.knowledge_sources FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_ks_user ON public.knowledge_sources(user_id);
CREATE INDEX idx_ks_brain ON public.knowledge_sources(brain_id);
CREATE INDEX idx_ks_node ON public.knowledge_sources(node_id);
CREATE TRIGGER trg_ks_updated BEFORE UPDATE ON public.knowledge_sources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- knowledge_chunks
CREATE TABLE public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id uuid NOT NULL REFERENCES public.brains(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.knowledge_sources(id) ON DELETE CASCADE,
  node_id uuid REFERENCES public.brain_nodes(id) ON DELETE SET NULL,
  chunk_index integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  token_estimate integer,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_chunks TO authenticated;
GRANT ALL ON public.knowledge_chunks TO service_role;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own knowledge_chunks" ON public.knowledge_chunks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_kc_user ON public.knowledge_chunks(user_id);
CREATE INDEX idx_kc_brain ON public.knowledge_chunks(brain_id);
CREATE INDEX idx_kc_source ON public.knowledge_chunks(source_id);
CREATE INDEX idx_kc_node ON public.knowledge_chunks(node_id);
CREATE TRIGGER trg_kc_updated BEFORE UPDATE ON public.knowledge_chunks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- import_jobs
CREATE TABLE public.import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id uuid NOT NULL REFERENCES public.brains(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  total_items integer NOT NULL DEFAULT 0,
  processed_items integer NOT NULL DEFAULT 0,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_jobs TO authenticated;
GRANT ALL ON public.import_jobs TO service_role;
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own import_jobs" ON public.import_jobs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_ij_user ON public.import_jobs(user_id);
CREATE INDEX idx_ij_brain ON public.import_jobs(brain_id);
CREATE TRIGGER trg_ij_updated BEFORE UPDATE ON public.import_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
