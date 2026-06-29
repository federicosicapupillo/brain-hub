ALTER TABLE public.gmail_message_map
  ADD COLUMN IF NOT EXISTS is_trashed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inbox boolean NOT NULL DEFAULT true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gmail_message_map TO authenticated;
GRANT ALL ON public.gmail_message_map TO service_role;

ALTER TABLE public.gmail_message_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can update their own gmail messages"
ON public.gmail_message_map
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);