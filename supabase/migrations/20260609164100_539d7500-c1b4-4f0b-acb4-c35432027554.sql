
ALTER TABLE public.clipboard_items
  ADD COLUMN IF NOT EXISTS automation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS automation_last_error TEXT,
  ADD COLUMN IF NOT EXISTS automation_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS human_review_required BOOLEAN NOT NULL DEFAULT true;
