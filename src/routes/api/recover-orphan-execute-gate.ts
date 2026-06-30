// Brain Hub v3.35c — Orphan Gate Reaper HTTP entry point.
//
// POST /api/recover-orphan-execute-gate
//   Body: { idempotency_key: string, ttl_ms?: number }
//   Auth: required (Supabase bearer). Owner-scoped — the reaper only
//   ever touches the caller's own (owner_id, idempotency_key) row.
//
// Governance: this endpoint never invokes any handler. It only writes a
// recovery receipt and stamps the orphaned idempotency row. RBAC is
// enforced via the static `recover_orphan_execute_gate` action on the
// `user` entity (see rbacModel.ts). For HIGH / unknown risk the response
// is always `orphaned_unknown_requires_manual_review` and `auto_reexecuted`
// is invariantly false (enforced at the reaper layer).

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

export const Route = createFileRoute("/api/recover-orphan-execute-gate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) {
          return jsonResp(401, {
            ok: false,
            decision: "not_found",
            safe_message: "no_session",
          });
        }
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return jsonResp(500, {
            ok: false,
            decision: "not_found",
            safe_message: "server_misconfigured",
          });
        }
        const userScoped = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data: userResp, error: userErr } = await userScoped.auth.getUser();
        if (userErr || !userResp?.user) {
          return jsonResp(401, {
            ok: false,
            decision: "not_found",
            safe_message: "invalid_session",
          });
        }
        const userId = userResp.user.id;

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return jsonResp(400, {
            ok: false,
            decision: "not_found",
            safe_message: "invalid_json",
          });
        }
        const idempotency_key =
          typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
        if (!idempotency_key || idempotency_key.length > 200) {
          return jsonResp(400, {
            ok: false,
            decision: "not_found",
            safe_message: "invalid_idempotency_key",
          });
        }
        const ttl_ms_in = body.ttl_ms;
        const ttl_ms =
          typeof ttl_ms_in === "number" && Number.isFinite(ttl_ms_in) && ttl_ms_in > 0
            ? ttl_ms_in
            : undefined;

        // Governance Evaluator — recovery is itself a governed action.
        const gov = evaluateAction({
          action: "recover_orphan_execute_gate",
          entity: { type: "user", id: userId },
          project_id: "brainhub-os",
          context_active_project_id: "brainhub-os",
          risk_level: "medium",
          requires_confirmation: false,
        });
        if (!gov.allowed) {
          return jsonResp(403, {
            ok: false,
            decision: "not_found",
            safe_message: `governance_denied:${gov.reason}`,
          });
        }

        // Service-role client for write (RLS on execute_idempotency has
        // no UPDATE policy). Owner is enforced explicitly via userId.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { recoverOrphanExecuteGate } = await import(
          "@/lib/execute-dispatcher/orphan-gate-reaper.server"
        );
        const result = await recoverOrphanExecuteGate(supabaseAdmin, {
          owner_id: userId,
          idempotency_key,
          ttl_ms,
          invoked_by: "endpoint:recover-orphan-execute-gate",
        });
        return jsonResp(200, result);
      },
    },
  },
});
