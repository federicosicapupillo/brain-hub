
CREATE TABLE IF NOT EXISTS public.project_console_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id UUID NULL REFERENCES public.brains(id) ON DELETE CASCADE,
  project_id UUID NULL,
  console_name TEXT NOT NULL DEFAULT 'Console',
  preset TEXT NOT NULL DEFAULT 'custom',
  project_priority TEXT NOT NULL DEFAULT 'generico',
  visible_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  block_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  block_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS project_console_configs_user_brain_uniq
  ON public.project_console_configs(user_id, brain_id)
  WHERE brain_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_console_configs TO authenticated;
GRANT ALL ON public.project_console_configs TO service_role;

ALTER TABLE public.project_console_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own console configs"
  ON public.project_console_configs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_project_console_configs_updated_at
  BEFORE UPDATE ON public.project_console_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
