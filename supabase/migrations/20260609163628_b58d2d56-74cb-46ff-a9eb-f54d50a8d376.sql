
ALTER TABLE public.clipboard_items
  ADD COLUMN IF NOT EXISTS next_action TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS output_result TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS project_tool_link_id UUID REFERENCES public.project_tool_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS automation_status TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS automation_target TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS automation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS automation_last_run_at TIMESTAMPTZ;
