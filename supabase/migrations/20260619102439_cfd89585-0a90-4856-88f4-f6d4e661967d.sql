
DROP POLICY IF EXISTS "Users manage own agent runs" ON public.agent_run_logs;
CREATE POLICY "Users manage own agent runs" ON public.agent_run_logs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own code engine handoffs" ON public.code_engine_handoffs;
CREATE POLICY "Users manage own code engine handoffs" ON public.code_engine_handoffs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own daily briefs" ON public.daily_operating_briefs;
CREATE POLICY "Users manage own daily briefs" ON public.daily_operating_briefs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own jack memory documents" ON public.jack_memory_documents;
CREATE POLICY "Users manage own jack memory documents" ON public.jack_memory_documents FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own jack voice generations" ON public.jack_voice_generations;
CREATE POLICY "Users manage own jack voice generations" ON public.jack_voice_generations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
