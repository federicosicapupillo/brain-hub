
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz,
  ADD COLUMN IF NOT EXISTS embedding_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS embedding_error text;

CREATE INDEX IF NOT EXISTS idx_kc_status ON public.knowledge_chunks(embedding_status);
CREATE INDEX IF NOT EXISTS idx_kc_embedding ON public.knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding vector(1536),
  match_brain_id uuid DEFAULT NULL,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  chunk_id uuid,
  source_id uuid,
  brain_id uuid,
  node_id uuid,
  content text,
  similarity float,
  source_title text,
  source_type text,
  source_tags text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    kc.id AS chunk_id,
    kc.source_id,
    kc.brain_id,
    kc.node_id,
    kc.content,
    1 - (kc.embedding <=> query_embedding) AS similarity,
    ks.title AS source_title,
    ks.source_type,
    ks.tags AS source_tags
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_sources ks ON ks.id = kc.source_id
  WHERE kc.user_id = auth.uid()
    AND kc.embedding_status = 'ready'
    AND kc.embedding IS NOT NULL
    AND (match_brain_id IS NULL OR kc.brain_id = match_brain_id)
    AND 1 - (kc.embedding <=> query_embedding) >= match_threshold
  ORDER BY kc.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(vector, uuid, float, int) TO authenticated;
