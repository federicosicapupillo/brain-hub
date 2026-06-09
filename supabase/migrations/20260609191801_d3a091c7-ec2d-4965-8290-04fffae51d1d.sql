ALTER TABLE public.clipboard_items
ADD COLUMN IF NOT EXISTS next_step_generated BOOLEAN NOT NULL DEFAULT false;