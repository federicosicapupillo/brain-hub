
DROP POLICY IF EXISTS "Users manage own automation_connectors" ON public.automation_connectors;
CREATE POLICY "Users manage own automation_connectors" ON public.automation_connectors FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage their own calendar connections" ON public.calendar_connection_settings;
CREATE POLICY "Users manage their own calendar connections" ON public.calendar_connection_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage their own calendar events" ON public.calendar_event_map;
CREATE POLICY "Users manage their own calendar events" ON public.calendar_event_map FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own clipboard execution logs" ON public.clipboard_execution_logs;
CREATE POLICY "Users manage own clipboard execution logs" ON public.clipboard_execution_logs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage their own calendar oauth states" ON public.google_calendar_oauth_states;
CREATE POLICY "Users manage their own calendar oauth states" ON public.google_calendar_oauth_states FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage their own oauth states" ON public.google_drive_oauth_states;
CREATE POLICY "Users manage their own oauth states" ON public.google_drive_oauth_states FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "mvp_build_projects_owner_all" ON public.mvp_build_projects;
CREATE POLICY "mvp_build_projects_owner_all" ON public.mvp_build_projects FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own n8n execution logs" ON public.n8n_execution_logs;
CREATE POLICY "Users manage own n8n execution logs" ON public.n8n_execution_logs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own console configs" ON public.project_console_configs;
CREATE POLICY "Users manage own console configs" ON public.project_console_configs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage their knowledge sources" ON public.project_knowledge_sources;
CREATE POLICY "Users manage their knowledge sources" ON public.project_knowledge_sources FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage their own runbook_instances" ON public.runbook_instances;
CREATE POLICY "Users manage their own runbook_instances" ON public.runbook_instances FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own telegram approval requests" ON public.telegram_approval_requests;
CREATE POLICY "Users manage own telegram approval requests" ON public.telegram_approval_requests FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
