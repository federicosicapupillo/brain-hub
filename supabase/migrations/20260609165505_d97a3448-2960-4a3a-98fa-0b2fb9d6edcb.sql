ALTER TABLE public.clipboard_items
  ADD COLUMN IF NOT EXISTS execution_instructions text,
  ADD COLUMN IF NOT EXISTS expected_output text,
  ADD COLUMN IF NOT EXISTS success_criteria text,
  ADD COLUMN IF NOT EXISTS risk_level text DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS requires_approval boolean DEFAULT true;