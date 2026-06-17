-- Brain Hub v2.8 — Google Drive / Knowledge Real Connector (read-only)

CREATE TABLE IF NOT EXISTS public.drive_connection_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid,
  label text NOT NULL,
  provider text NOT NULL DEFAULT 'google_drive',
  connection_status text NOT NULL DEFAULT 'not_configured',
  root_folder_id text,
  root_folder_name text,
  last_sync_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.drive_connection_settings TO authenticated;
GRANT ALL ON public.drive_connection_settings TO service_role;

ALTER TABLE public.drive_connection_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drive_connection_settings_owner_all"
  ON public.drive_connection_settings
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS drive_connection_settings_user_idx
  ON public.drive_connection_settings (user_id);
CREATE INDEX IF NOT EXISTS drive_connection_settings_brain_idx
  ON public.drive_connection_settings (brain_id);

CREATE TRIGGER set_updated_at_drive_connection_settings
  BEFORE UPDATE ON public.drive_connection_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


CREATE TABLE IF NOT EXISTS public.drive_file_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brain_id uuid,
  connection_id uuid REFERENCES public.drive_connection_settings(id) ON DELETE SET NULL,
  google_file_id text,
  parent_google_file_id text,
  name text NOT NULL,
  mime_type text,
  web_url text,
  icon_url text,
  size_bytes bigint,
  modified_time timestamptz,
  path text,
  category text,
  status text NOT NULL DEFAULT 'mapped',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.drive_file_map TO authenticated;
GRANT ALL ON public.drive_file_map TO service_role;

ALTER TABLE public.drive_file_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drive_file_map_owner_all"
  ON public.drive_file_map
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS drive_file_map_user_idx ON public.drive_file_map (user_id);
CREATE INDEX IF NOT EXISTS drive_file_map_brain_idx ON public.drive_file_map (brain_id);
CREATE INDEX IF NOT EXISTS drive_file_map_connection_idx ON public.drive_file_map (connection_id);
CREATE INDEX IF NOT EXISTS drive_file_map_google_file_idx ON public.drive_file_map (google_file_id);
CREATE INDEX IF NOT EXISTS drive_file_map_mime_idx ON public.drive_file_map (mime_type);
CREATE INDEX IF NOT EXISTS drive_file_map_category_idx ON public.drive_file_map (category);

CREATE TRIGGER set_updated_at_drive_file_map
  BEFORE UPDATE ON public.drive_file_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
