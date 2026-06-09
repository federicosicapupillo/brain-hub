CREATE TABLE public.clipboard_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  clipboard_item_id uuid NOT NULL REFERENCES public.clipboard_items(id) ON DELETE CASCADE,
  action text NOT NULL,
  previous_status text,
  new_status text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clipboard_execution_logs TO authenticated;
GRANT ALL ON public.clipboard_execution_logs TO service_role;

ALTER TABLE public.clipboard_execution_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own clipboard execution logs"
  ON public.clipboard_execution_logs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX clipboard_execution_logs_item_idx ON public.clipboard_execution_logs(clipboard_item_id, created_at DESC);