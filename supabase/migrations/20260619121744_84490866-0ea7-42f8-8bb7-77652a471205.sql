
CREATE TABLE public.connector_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connector_key text NOT NULL,
  connector_name text NOT NULL,
  connector_type text NOT NULL,
  status text NOT NULL DEFAULT 'not_configured',
  permission_level text NOT NULL DEFAULT 'read_only',
  last_sync_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, connector_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.connector_registry TO authenticated;
GRANT ALL ON public.connector_registry TO service_role;

ALTER TABLE public.connector_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "connector_registry_owner_all"
  ON public.connector_registry
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_connector_registry_user ON public.connector_registry(user_id);
CREATE INDEX idx_connector_registry_key ON public.connector_registry(connector_key);
CREATE INDEX idx_connector_registry_status ON public.connector_registry(status);
CREATE INDEX idx_connector_registry_type ON public.connector_registry(connector_type);

CREATE TRIGGER trg_connector_registry_updated_at
  BEFORE UPDATE ON public.connector_registry
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.project_source_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid,
  project_key text NOT NULL,
  connector_key text NOT NULL,
  source_type text NOT NULL,
  source_label text NOT NULL,
  source_ref text,
  source_url text,
  sync_status text NOT NULL DEFAULT 'not_synced',
  last_seen_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_source_mappings TO authenticated;
GRANT ALL ON public.project_source_mappings TO service_role;

ALTER TABLE public.project_source_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_source_mappings_owner_all"
  ON public.project_source_mappings
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_psm_user ON public.project_source_mappings(user_id);
CREATE INDEX idx_psm_project ON public.project_source_mappings(project_key);
CREATE INDEX idx_psm_connector ON public.project_source_mappings(connector_key);
CREATE INDEX idx_psm_source_type ON public.project_source_mappings(source_type);
CREATE INDEX idx_psm_sync_status ON public.project_source_mappings(sync_status);

CREATE TRIGGER trg_psm_updated_at
  BEFORE UPDATE ON public.project_source_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
