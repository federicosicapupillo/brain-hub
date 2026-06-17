CREATE TABLE public.company_os_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid NOT NULL,
  company_name text NOT NULL,
  industry text,
  company_size text,
  operating_model text,
  main_goal text,
  pain_points text[] NOT NULL DEFAULT '{}',
  active_departments text[] NOT NULL DEFAULT '{}',
  preferred_modules text[] NOT NULL DEFAULT '{}',
  preset text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_os_profiles_user_id ON public.company_os_profiles(user_id);
CREATE INDEX idx_company_os_profiles_brain_id ON public.company_os_profiles(brain_id);
CREATE UNIQUE INDEX uq_company_os_profiles_user_brain ON public.company_os_profiles(user_id, brain_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_os_profiles TO authenticated;
GRANT ALL ON public.company_os_profiles TO service_role;

ALTER TABLE public.company_os_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own company os profiles"
  ON public.company_os_profiles
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_company_os_profiles_updated_at
  BEFORE UPDATE ON public.company_os_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();