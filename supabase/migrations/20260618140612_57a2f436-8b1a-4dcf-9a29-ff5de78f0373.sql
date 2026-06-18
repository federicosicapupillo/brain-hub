
CREATE TABLE public.jack_voice_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id UUID NULL,
  daily_operating_brief_id UUID NULL,
  provider TEXT NOT NULL DEFAULT 'elevenlabs',
  voice_id_preview TEXT NULL,
  model_id TEXT NULL,
  text_hash TEXT NOT NULL,
  text_char_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'created',
  generated_at TIMESTAMPTZ NULL,
  played_at TIMESTAMPTZ NULL,
  error_text TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jack_voice_generations TO authenticated;
GRANT ALL ON public.jack_voice_generations TO service_role;

ALTER TABLE public.jack_voice_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own jack voice generations"
  ON public.jack_voice_generations
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_jack_voice_user_created ON public.jack_voice_generations(user_id, created_at DESC);
CREATE INDEX idx_jack_voice_brief ON public.jack_voice_generations(daily_operating_brief_id);

CREATE TRIGGER update_jack_voice_generations_updated_at
  BEFORE UPDATE ON public.jack_voice_generations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
