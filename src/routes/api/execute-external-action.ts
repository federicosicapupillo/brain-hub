// Brain Hub v3.35b — External Execute Sandbox HTTP entry point.
//
// POST /api/execute-external-action
//   Body: ExternalDispatchRequest (see lib/execute-dispatcher/
//         external-dispatcher.server). Auth required (bearer).
//
// This route is the ONLY HTTP path that calls executeExternalAction.
// Internal and External dispatchers are kept strictly separate — no
// shared dynamic switch, no fallback.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function safe(err: unknown): string {
  const m = (err as { message?: string } | null)?.message ?? "error";
  return m
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/g, "[redacted-email]")
    .slice(0, 240);
}

export const Route = createFileRoute("/api/execute-external-action")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) {
          return new Response(
            JSON.stringify({ ok: false, status: "rejected_confirm", safe_message: "no_session" }),
            { status: 401, headers: { "content-type": "application/json" } },
          );
        }

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response(
            JSON.stringify({ ok: false, status: "failed", safe_message: "server_misconfigured" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }

        const userScoped = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data: userResp, error: userErr } = await userScoped.auth.getUser();
        if (userErr || !userResp?.user) {
          return new Response(
            JSON.stringify({ ok: false, status: "rejected_confirm", safe_message: "invalid_session" }),
            { status: 401, headers: { "content-type": "application/json" } },
          );
        }
        const userId = userResp.user.id;

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response(
            JSON.stringify({ ok: false, status: "rejected_validation", safe_message: "invalid_json" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        try {
          const { executeExternalAction } = await import(
            "@/lib/execute-dispatcher/external-dispatcher.server"
          );
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const url = new URL(request.url);
          const selfOrigin = `${url.protocol}//${url.host}`;

          const result = await executeExternalAction(
            { admin: supabaseAdmin, userId, selfOrigin },
            {
              action_type: String(body.action_type ?? ""),
              idempotency_key: String(body.idempotency_key ?? ""),
              confirmed_at:
                typeof body.confirmed_at === "string" ? body.confirmed_at : undefined,
              confirmation_source: (body.confirmation_source as never) ?? "ui_button",
              confirmation_id:
                typeof body.confirmation_id === "string"
                  ? body.confirmation_id
                  : (body.payload as Record<string, unknown> | undefined)
                      ?.confirmation_id as string | undefined,
              payload: (body.payload as Record<string, unknown>) ?? {},
              requested_by_label:
                typeof body.requested_by_label === "string"
                  ? body.requested_by_label
                  : undefined,
              project_id:
                typeof body.project_id === "string" ? body.project_id : undefined,
            },
          );

          const status = result.ok
            ? 200
            : result.status === "rejected_governance" ||
                result.status === "rejected_high_risk_blocked"
              ? 403
              : result.status === "rejected_confirm" ||
                  result.status === "rejected_validation" ||
                  result.status === "rejected_unknown_action" ||
                  result.status === "rejected_disabled" ||
                  result.status === "rollback_not_supported"
                ? 400
                : 500;
          return new Response(JSON.stringify(result), {
            status,
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          return new Response(
            JSON.stringify({ ok: false, status: "failed", safe_message: safe(err) }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});
