
CREATE TABLE public.automation_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  type text NOT NULL,
  target_tool text NOT NULL,
  webhook_url text,
  browser_profile text,
  is_active boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_connectors TO authenticated;
GRANT ALL ON public.automation_connectors TO service_role;

ALTER TABLE public.automation_connectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own automation_connectors"
  ON public.automation_connectors
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_automation_connectors_updated_at
  BEFORE UPDATE ON public.automation_connectors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.clipboard_items
  ADD COLUMN IF NOT EXISTS automation_connector_id uuid REFERENCES public.automation_connectors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clipboard_items_automation_connector_id
  ON public.clipboard_items(automation_connector_id);
