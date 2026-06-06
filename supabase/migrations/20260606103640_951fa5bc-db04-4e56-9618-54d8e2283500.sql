
-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users select own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- brains
CREATE TABLE public.brains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'manuale',
  kind TEXT NOT NULL DEFAULT 'progetto',
  visibility TEXT NOT NULL DEFAULT 'privato',
  color TEXT NOT NULL DEFAULT 'var(--neon-violet)',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brains TO authenticated;
GRANT ALL ON public.brains TO service_role;
ALTER TABLE public.brains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own brains" ON public.brains FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX brains_user_idx ON public.brains(user_id);

-- brain_nodes
CREATE TABLE public.brain_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  brain_id UUID NOT NULL REFERENCES public.brains ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'nota',
  origin TEXT NOT NULL DEFAULT 'manuale',
  tags TEXT[] NOT NULL DEFAULT '{}',
  summary TEXT DEFAULT '',
  x REAL NOT NULL DEFAULT 0.5,
  y REAL NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brain_nodes TO authenticated;
GRANT ALL ON public.brain_nodes TO service_role;
ALTER TABLE public.brain_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own nodes" ON public.brain_nodes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX brain_nodes_brain_idx ON public.brain_nodes(brain_id);
CREATE INDEX brain_nodes_user_idx ON public.brain_nodes(user_id);

-- brain_edges
CREATE TABLE public.brain_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  brain_id UUID NOT NULL REFERENCES public.brains ON DELETE CASCADE,
  source UUID NOT NULL REFERENCES public.brain_nodes ON DELETE CASCADE,
  target UUID NOT NULL REFERENCES public.brain_nodes ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'link',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brain_edges TO authenticated;
GRANT ALL ON public.brain_edges TO service_role;
ALTER TABLE public.brain_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own edges" ON public.brain_edges FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX brain_edges_brain_idx ON public.brain_edges(brain_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_brains_updated BEFORE UPDATE ON public.brains FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_nodes_updated BEFORE UPDATE ON public.brain_nodes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)), NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
