ALTER TABLE public.execute_idempotency ALTER COLUMN receipt_id DROP NOT NULL;
GRANT UPDATE ON public.execute_idempotency TO authenticated;