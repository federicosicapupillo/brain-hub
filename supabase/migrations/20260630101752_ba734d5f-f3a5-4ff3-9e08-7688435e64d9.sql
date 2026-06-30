
-- Brain Hub v3.35a — Internal Execute Layer foundation tables.

CREATE TABLE IF NOT EXISTS public.internal_execute_artifacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  title TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  rolled_back_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.internal_execute_artifacts TO authenticated;
GRANT ALL ON public.internal_execute_artifacts TO service_role;
ALTER TABLE public.internal_execute_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "iea_owner_select" ON public.internal_execute_artifacts
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "iea_owner_insert" ON public.internal_execute_artifacts
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "iea_owner_update" ON public.internal_execute_artifacts
  FOR UPDATE TO authenticated USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.execute_receipts (
  receipt_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_id UUID,
  action_type TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  executed_by TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  result TEXT NOT NULL CHECK (result IN ('success','failure','partial')),
  rollback_available BOOLEAN NOT NULL DEFAULT false,
  external_reference TEXT,
  audit_record JSONB NOT NULL DEFAULT '{}'::jsonb,
  related_receipt_id UUID REFERENCES public.execute_receipts(receipt_id) ON DELETE SET NULL,
  idempotency_key TEXT,
  safe_error_message TEXT
);
GRANT SELECT, INSERT ON public.execute_receipts TO authenticated;
GRANT ALL ON public.execute_receipts TO service_role;
ALTER TABLE public.execute_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "er_owner_select" ON public.execute_receipts
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "er_owner_insert" ON public.execute_receipts
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

-- Receipts are immutable: no UPDATE/DELETE policy granted. service_role
-- can still amend in extraordinary maintenance; the dispatcher itself
-- only INSERTs.

CREATE TABLE IF NOT EXISTS public.execute_idempotency (
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  receipt_id UUID NOT NULL REFERENCES public.execute_receipts(receipt_id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, idempotency_key)
);
GRANT SELECT, INSERT ON public.execute_idempotency TO authenticated;
GRANT ALL ON public.execute_idempotency TO service_role;
ALTER TABLE public.execute_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ei_owner_select" ON public.execute_idempotency
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "ei_owner_insert" ON public.execute_idempotency
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS execute_receipts_owner_started_idx
  ON public.execute_receipts(owner_id, started_at DESC);
CREATE INDEX IF NOT EXISTS internal_execute_artifacts_owner_created_idx
  ON public.internal_execute_artifacts(owner_id, created_at DESC);
