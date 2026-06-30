// Brain Hub v3.35d — Execute Console data endpoint.
//
// GET /api/execute-console-data
//   Auth: required (Supabase bearer). User-scoped — only the caller's
//   receipts/artifacts/idempotency rows are surfaced.
//   Governance: read_execute_console_data on `user` entity. No write
//   path here. The aggregator NEVER calls any dispatcher and NEVER
//   exposes secrets — payloads are redacted server-side.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { evaluateAction } from "@/lib/governance/governanceEvaluator";

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function safe(err: unknown): string {
  const m = (err as { message?: string } | null)?.message ?? "error";
  return m
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/g, "[redacted-email]")
    .slice(0, 200);
}

export const Route = createFileRoute("/api/execute-console-data")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) {
          return jsonResp(401, { error: "unauthorized", reason: "no_session" });
        }
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return jsonResp(500, { error: "server_misconfigured" });
        }
        const userScoped = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data: userResp, error: userErr } = await userScoped.auth.getUser();
        if (userErr || !userResp?.user) {
          return jsonResp(401, { error: "unauthorized", reason: "invalid_session" });
        }
        const userId = userResp.user.id;

        const gov = evaluateAction({
          action: "read_execute_console_data",
          entity: { type: "user", id: userId },
          project_id: "brainhub-os",
          context_active_project_id: "brainhub-os",
          risk_level: "low",
          requires_confirmation: false,
        });
        if (!gov.allowed) {
          return jsonResp(403, {
            error: "forbidden",
            reason: gov.reason,
            audit_record: gov.audit_record,
          });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { fetchExecuteConsoleDataOutcome } = await import(
            "@/lib/execute-console/execute-console-data.server"
          );
          // v3.36 — Principio 3: route consumes ServiceOutcome<T> and
          // projects it (trust + duration + safe error) onto the HTTP
          // payload. The legacy `{ ok, data }` shape is preserved for
          // backwards compat with the existing UI hook; new fields are
          // additive.
          const outcome = await fetchExecuteConsoleDataOutcome({
            admin: supabaseAdmin,
            userId,
          });
          const httpStatus = outcome.trust.status === "error" ? 502 : 200;
          return jsonResp(httpStatus, {
            ok: outcome.trust.status !== "error",
            data: outcome.data,
            trust: outcome.trust,
            duration_ms: outcome.duration_ms,
            error_safe_message: outcome.error_safe_message ?? null,
          });
        } catch (err) {
          return jsonResp(500, { error: "fetch_failed", reason: safe(err) });
        }
      },
    },
  },
});
