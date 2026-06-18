ALTER TABLE public.code_agent_jobs
ADD COLUMN IF NOT EXISTS sent_manually_at timestamptz;