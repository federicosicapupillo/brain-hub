CREATE TABLE IF NOT EXISTS public.result_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid,
  project_id uuid,
  source_type text NOT NULL,
  source_id uuid,
  title text NOT NULL,
  result_text text,
  error_text text,
  review_status text NOT NULL DEFAULT 'pending_review',
  risk_level text,
  linked_action_id uuid,
  linked_workflow_id uuid,
  linked_runbook_instance_id uuid,
  linked_roadmap_item_id uuid,
  linked_next_prompt_id uuid,
  review_note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.result_review_items TO authenticated;
GRANT ALL ON public.result_review_items TO service_role;

ALTER TABLE public.result_review_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own result review items"
  ON public.result_review_items
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_result_review_user ON public.result_review_items(user_id);
CREATE INDEX IF NOT EXISTS idx_result_review_brain ON public.result_review_items(brain_id);
CREATE INDEX IF NOT EXISTS idx_result_review_project ON public.result_review_items(project_id);
CREATE INDEX IF NOT EXISTS idx_result_review_source ON public.result_review_items(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_result_review_status ON public.result_review_items(review_status);

CREATE TRIGGER trg_result_review_items_updated_at
  BEFORE UPDATE ON public.result_review_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();