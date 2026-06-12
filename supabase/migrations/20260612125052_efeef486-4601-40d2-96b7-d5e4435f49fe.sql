
CREATE TABLE IF NOT EXISTS public.prompt_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  project_id uuid,
  brain_id uuid,
  roadmap_item_id uuid,
  task_id uuid,
  execution_package_id uuid,
  target_tool text NOT NULL DEFAULT 'lovable',
  prompt_title text NOT NULL DEFAULT '',
  prompt_content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  receipt_json jsonb,
  result_text text,
  result_type text,
  internal_notes text,
  retry_count integer NOT NULL DEFAULT 0,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prompt_execution_logs TO authenticated;
GRANT ALL ON public.prompt_execution_logs TO service_role;

ALTER TABLE public.prompt_execution_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'prompt_execution_logs'
      AND policyname = 'pel_owner_all'
  ) THEN
    CREATE POLICY "pel_owner_all"
      ON public.prompt_execution_logs
      FOR ALL
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_pel_user_updated
  ON public.prompt_execution_logs (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pel_exec_pkg
  ON public.prompt_execution_logs (execution_package_id);
CREATE INDEX IF NOT EXISTS idx_pel_status
  ON public.prompt_execution_logs (user_id, status);

DROP TRIGGER IF EXISTS trg_pel_set_updated_at ON public.prompt_execution_logs;
CREATE TRIGGER trg_pel_set_updated_at
  BEFORE UPDATE ON public.prompt_execution_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
