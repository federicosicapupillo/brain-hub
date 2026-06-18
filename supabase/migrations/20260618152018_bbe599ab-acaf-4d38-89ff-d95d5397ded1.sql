
-- Jack Memory Entries (conversational memory)
CREATE TABLE IF NOT EXISTS public.jack_memory_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid NULL,
  project_id uuid NULL,
  project_name text NULL,
  category text NOT NULL DEFAULT 'general',
  content text NOT NULL,
  normalized_content text NULL,
  source text NOT NULL DEFAULT 'conversation',
  status text NOT NULL DEFAULT 'active',
  importance text NOT NULL DEFAULT 'normal',
  sensitivity text NOT NULL DEFAULT 'normal',
  confidence numeric NULL,
  source_conversation_id uuid NULL,
  source_message_id uuid NULL,
  approved_at timestamptz NULL,
  archived_at timestamptz NULL,
  last_used_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jack_memory_entries TO authenticated;
GRANT ALL ON public.jack_memory_entries TO service_role;

ALTER TABLE public.jack_memory_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jme_select_own" ON public.jack_memory_entries
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "jme_insert_own" ON public.jack_memory_entries
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "jme_update_own" ON public.jack_memory_entries
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "jme_delete_own" ON public.jack_memory_entries
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS jme_user_idx ON public.jack_memory_entries(user_id);
CREATE INDEX IF NOT EXISTS jme_status_idx ON public.jack_memory_entries(user_id, status);
CREATE INDEX IF NOT EXISTS jme_category_idx ON public.jack_memory_entries(user_id, category);
CREATE INDEX IF NOT EXISTS jme_project_name_idx ON public.jack_memory_entries(user_id, project_name);
CREATE INDEX IF NOT EXISTS jme_brain_idx ON public.jack_memory_entries(user_id, brain_id);

CREATE TRIGGER trg_jme_updated_at
  BEFORE UPDATE ON public.jack_memory_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
