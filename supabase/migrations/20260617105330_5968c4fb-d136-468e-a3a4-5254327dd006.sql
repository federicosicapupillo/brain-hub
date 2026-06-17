CREATE TABLE public.master_snapshot_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id UUID NULL,
  title TEXT NOT NULL DEFAULT 'Brain Hub — Master Project Snapshot',
  version_label TEXT NOT NULL,
  version_status TEXT NOT NULL DEFAULT 'draft_update',
  markdown_content TEXT NOT NULL,
  summary TEXT NULL,
  reason TEXT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  source_id UUID NULL,
  previous_version_id UUID NULL REFERENCES public.master_snapshot_versions(id) ON DELETE SET NULL,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_at TIMESTAMPTZ NULL,
  rejected_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.master_snapshot_versions TO authenticated;
GRANT ALL ON public.master_snapshot_versions TO service_role;

ALTER TABLE public.master_snapshot_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own master snapshot versions"
  ON public.master_snapshot_versions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_master_snapshot_user_brain ON public.master_snapshot_versions(user_id, brain_id, created_at DESC);
CREATE INDEX idx_master_snapshot_status ON public.master_snapshot_versions(user_id, version_status);

CREATE TRIGGER trg_master_snapshot_updated_at
  BEFORE UPDATE ON public.master_snapshot_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();