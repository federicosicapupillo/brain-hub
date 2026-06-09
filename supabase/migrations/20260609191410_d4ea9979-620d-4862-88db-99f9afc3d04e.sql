
CREATE TABLE public.warehouses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id UUID REFERENCES public.brains(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  covered_sqm NUMERIC,
  internal_height_m NUMERIC,
  outdoor_area_sqm NUMERIC,
  doors_count INTEGER,
  has_overhead_crane BOOLEAN NOT NULL DEFAULT false,
  overhead_crane_capacity_kg NUMERIC,
  heavy_vehicle_access BOOLEAN NOT NULL DEFAULT false,
  industrial_zone TEXT,
  municipality TEXT,
  province TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  distance_highway_km NUMERIC,
  distance_port_km NUMERIC,
  distance_logistics_hub_km NUMERIC,
  intended_use TEXT,
  property_status TEXT,
  sale_price NUMERIC,
  rent_price NUMERIC,
  commercial_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouses TO authenticated;
GRANT ALL ON public.warehouses TO service_role;

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own warehouses"
  ON public.warehouses
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX warehouses_user_id_idx ON public.warehouses(user_id);
CREATE INDEX warehouses_brain_id_idx ON public.warehouses(brain_id);
CREATE INDEX warehouses_province_idx ON public.warehouses(province);
CREATE INDEX warehouses_municipality_idx ON public.warehouses(municipality);

CREATE TRIGGER warehouses_set_updated_at
  BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
