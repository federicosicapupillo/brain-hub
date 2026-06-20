
-- Restrict gmail_connection_settings.refresh_token to service_role only.
REVOKE SELECT (refresh_token) ON public.gmail_connection_settings FROM authenticated;
REVOKE SELECT (refresh_token) ON public.gmail_connection_settings FROM anon;
REVOKE UPDATE (refresh_token) ON public.gmail_connection_settings FROM authenticated;
REVOKE UPDATE (refresh_token) ON public.gmail_connection_settings FROM anon;

-- Re-scope UI Operator RLS policies to authenticated role only.
DROP POLICY IF EXISTS "ui_operator_sessions owner all" ON public.ui_operator_sessions;
CREATE POLICY "ui_operator_sessions owner all" ON public.ui_operator_sessions
  AS PERMISSIVE FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ui_operator_actions owner all" ON public.ui_operator_actions;
CREATE POLICY "ui_operator_actions owner all" ON public.ui_operator_actions
  AS PERMISSIVE FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own ui operator auth tokens" ON public.ui_operator_auth_tokens;
CREATE POLICY "Users manage own ui operator auth tokens" ON public.ui_operator_auth_tokens
  AS PERMISSIVE FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
