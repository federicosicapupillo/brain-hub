ALTER TABLE public.github_repository_registry
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS archived_reason text NULL,
  ADD COLUMN IF NOT EXISTS normalized_repository_url text NULL;

CREATE INDEX IF NOT EXISTS idx_ghrr_normalized_active
  ON public.github_repository_registry(user_id, normalized_repository_url)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ghrr_archived_at
  ON public.github_repository_registry(archived_at);