CREATE TABLE public.gmail_console_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_id uuid NULL,
  in_reply_to_gmail_message_id text NULL,
  in_reply_to_gmail_thread_id text NULL,
  forward_of_gmail_message_id text NULL,
  to_emails text[] NOT NULL DEFAULT '{}',
  cc_emails text[] NOT NULL DEFAULT '{}',
  bcc_emails text[] NOT NULL DEFAULT '{}',
  subject text NULL,
  body text NULL,
  generated_by_ai boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gmail_console_drafts TO authenticated;
GRANT ALL ON public.gmail_console_drafts TO service_role;

ALTER TABLE public.gmail_console_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own gmail console drafts"
  ON public.gmail_console_drafts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX gmail_console_drafts_user_updated_idx
  ON public.gmail_console_drafts (user_id, updated_at DESC);

CREATE TRIGGER update_gmail_console_drafts_updated_at
  BEFORE UPDATE ON public.gmail_console_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();