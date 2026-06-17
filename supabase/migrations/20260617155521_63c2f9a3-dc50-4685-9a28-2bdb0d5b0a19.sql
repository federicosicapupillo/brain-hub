CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.code_engine_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid,
  project_id uuid,
  repository_id uuid,
  action_id uuid,
  engine text NOT NULL,
  handoff_status text NOT NULL DEFAULT 'draft',
  prompt_text text NOT NULL,
  prompt_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_text text,
  result_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_review_item_id uuid,
  next_action_id uuid,
  copied_at timestamptz,
  sent_manually_at timestamptz,
  result_received_at timestamptz,
  reviewed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_engine_handoffs TO authenticated;
GRANT ALL ON public.code_engine_handoffs TO service_role;

ALTER TABLE public.code_engine_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own code engine handoffs"
  ON public.code_engine_handoffs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_ceh_user ON public.code_engine_handoffs(user_id);
CREATE INDEX idx_ceh_brain ON public.code_engine_handoffs(brain_id);
CREATE INDEX idx_ceh_action ON public.code_engine_handoffs(action_id);
CREATE INDEX idx_ceh_repo ON public.code_engine_handoffs(repository_id);
CREATE INDEX idx_ceh_engine ON public.code_engine_handoffs(engine);
CREATE INDEX idx_ceh_status ON public.code_engine_handoffs(handoff_status);

CREATE TRIGGER update_code_engine_handoffs_updated_at
  BEFORE UPDATE ON public.code_engine_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();