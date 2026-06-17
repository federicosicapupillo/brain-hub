
CREATE TABLE public.learning_loop_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id uuid,
  project_id uuid,
  result_review_item_id uuid NOT NULL REFERENCES public.result_review_items(id) ON DELETE CASCADE,
  suggestion_type text NOT NULL,
  suggestion_status text NOT NULL DEFAULT 'suggested',
  title text NOT NULL,
  description text,
  suggested_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_object_type text,
  applied_object_id uuid,
  risk_level text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_loop_suggestions TO authenticated;
GRANT ALL ON public.learning_loop_suggestions TO service_role;

ALTER TABLE public.learning_loop_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own learning loop suggestions"
  ON public.learning_loop_suggestions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_lls_user ON public.learning_loop_suggestions(user_id);
CREATE INDEX idx_lls_brain ON public.learning_loop_suggestions(brain_id);
CREATE INDEX idx_lls_project ON public.learning_loop_suggestions(project_id);
CREATE INDEX idx_lls_review ON public.learning_loop_suggestions(result_review_item_id);
CREATE INDEX idx_lls_type ON public.learning_loop_suggestions(suggestion_type);
CREATE INDEX idx_lls_status ON public.learning_loop_suggestions(suggestion_status);

CREATE TRIGGER trg_lls_updated
  BEFORE UPDATE ON public.learning_loop_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
