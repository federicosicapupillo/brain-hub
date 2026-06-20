CREATE TABLE public.ui_operator_auth_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES public.ui_operator_sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  allowed_routes JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ui_operator_auth_tokens TO authenticated;
GRANT ALL ON public.ui_operator_auth_tokens TO service_role;

ALTER TABLE public.ui_operator_auth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own ui operator auth tokens"
  ON public.ui_operator_auth_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_ui_op_auth_tokens_user ON public.ui_operator_auth_tokens(user_id);
CREATE INDEX idx_ui_op_auth_tokens_session ON public.ui_operator_auth_tokens(session_id);
CREATE INDEX idx_ui_op_auth_tokens_hash ON public.ui_operator_auth_tokens(token_hash);
CREATE INDEX idx_ui_op_auth_tokens_status ON public.ui_operator_auth_tokens(status);
CREATE INDEX idx_ui_op_auth_tokens_expires ON public.ui_operator_auth_tokens(expires_at);

CREATE TRIGGER update_ui_operator_auth_tokens_updated_at
  BEFORE UPDATE ON public.ui_operator_auth_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();