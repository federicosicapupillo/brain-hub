-- Brain Hub v3.23 — UI Operator POC tables

CREATE TABLE public.ui_operator_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  brain_id uuid,
  provider text not null default 'browserbase_stagehand',
  status text not null default 'created',
  target_route text,
  current_url text,
  browserbase_session_id text,
  last_screenshot_hash text,
  last_observation text,
  last_observed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ui_operator_sessions TO authenticated;
GRANT ALL ON public.ui_operator_sessions TO service_role;

ALTER TABLE public.ui_operator_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ui_operator_sessions owner all"
  ON public.ui_operator_sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX ui_operator_sessions_user_idx ON public.ui_operator_sessions(user_id);
CREATE INDEX ui_operator_sessions_brain_idx ON public.ui_operator_sessions(brain_id);
CREATE INDEX ui_operator_sessions_status_idx ON public.ui_operator_sessions(status);

CREATE TRIGGER ui_operator_sessions_set_updated_at
  BEFORE UPDATE ON public.ui_operator_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


CREATE TABLE public.ui_operator_actions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ui_operator_sessions(id) on delete cascade,
  user_id uuid not null,
  brain_id uuid,
  route text,
  action_type text not null,
  title text not null,
  description text,
  risk_level text not null default 'low',
  status text not null default 'proposed',
  requires_confirmation boolean not null default true,
  confirmed_at timestamptz,
  executed_at timestamptz,
  blocked_at timestamptz,
  failed_at timestamptz,
  selector text,
  coordinates jsonb,
  input_text_preview text,
  safety_reason text,
  result_text text,
  error_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ui_operator_actions TO authenticated;
GRANT ALL ON public.ui_operator_actions TO service_role;

ALTER TABLE public.ui_operator_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ui_operator_actions owner all"
  ON public.ui_operator_actions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX ui_operator_actions_user_idx ON public.ui_operator_actions(user_id);
CREATE INDEX ui_operator_actions_brain_idx ON public.ui_operator_actions(brain_id);
CREATE INDEX ui_operator_actions_session_idx ON public.ui_operator_actions(session_id);
CREATE INDEX ui_operator_actions_status_idx ON public.ui_operator_actions(status);
CREATE INDEX ui_operator_actions_risk_idx ON public.ui_operator_actions(risk_level);

CREATE TRIGGER ui_operator_actions_set_updated_at
  BEFORE UPDATE ON public.ui_operator_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();