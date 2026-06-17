
ALTER TABLE public.n8n_workflow_registry
  ADD COLUMN IF NOT EXISTS webhook_test_url text,
  ADD COLUMN IF NOT EXISTS webhook_production_url text,
  ADD COLUMN IF NOT EXISTS webhook_environment text NOT NULL DEFAULT 'test',
  ADD COLUMN IF NOT EXISTS real_execution_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_telegram_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_real_execution_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_real_execution_status text;
