CREATE TABLE public.company_os_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid NOT NULL,
  company_os_profile_id uuid NOT NULL,
  title text NOT NULL,
  blueprint_status text NOT NULL DEFAULT 'draft',
  executive_summary text,
  blueprint_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  markdown_content text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_os_blueprints_user_id ON public.company_os_blueprints(user_id);
CREATE INDEX idx_company_os_blueprints_brain_id ON public.company_os_blueprints(brain_id);
CREATE INDEX idx_company_os_blueprints_profile_id ON public.company_os_blueprints(company_os_profile_id);
CREATE INDEX idx_company_os_blueprints_status ON public.company_os_blueprints(blueprint_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_os_blueprints TO authenticated;
GRANT ALL ON public.company_os_blueprints TO service_role;

ALTER TABLE public.company_os_blueprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own company blueprints"
  ON public.company_os_blueprints
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_company_os_blueprints_updated_at
  BEFORE UPDATE ON public.company_os_blueprints
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();