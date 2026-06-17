ALTER TABLE public.n8n_workflow_registry
  ADD COLUMN IF NOT EXISTS hmac_signing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hmac_secret_env_key text DEFAULT 'N8N_WEBHOOK_SIGNING_SECRET',
  ADD COLUMN IF NOT EXISTS hmac_last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS hmac_status text;