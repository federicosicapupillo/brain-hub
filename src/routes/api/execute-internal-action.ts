// Brain Hub v3.35a — Internal Execute Layer HTTP entry point.
//
// POST /api/execute-internal-action
//   Body: ExecuteDispatchRequest (see lib/execute-dispatcher/types).
//   Auth: required (bearer). The dispatcher will refuse if no session.
//
// This route is the ONLY HTTP path that calls executeInternalAction.
// Other server code that wants to execute an internal action MUST also
// go through the dispatcher (not through ad-hoc table writes).

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

export const Route = createFileRoute("/api/execute-internal-action")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1. Require bearer token. No anonymous Execute.
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

        // 2. Resolve user id from the bearer token via the user-scoped
        //    client. This is the only place we trust auth.uid().
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

        // 3. Parse body.
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response(
            JSON.stringify({ ok: false, status: "rejected_validation", safe_message: "invalid_json" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        // 4. Load dispatcher dynamically (server-only module).
        try {
          const { executeInternalAction } = await import(
            "@/lib/execute-dispatcher/dispatcher.server"
          );
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const result = await executeInternalAction(
            { admin: supabaseAdmin, userId },
            {
              action_type: String(body.action_type ?? "") as never,
              idempotency_key: String(body.idempotency_key ?? ""),
              confirmed_at: String(body.confirmed_at ?? ""),
              confirmation_source: (body.confirmation_source as never) ?? "ui_button",
              payload: (body.payload as Record<string, unknown>) ?? {},
              title: typeof body.title === "string" ? body.title : undefined,
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
            : result.status === "rejected_governance"
              ? 403
              : result.status === "rejected_confirm" ||
                  result.status === "rejected_validation" ||
                  result.status === "rejected_unknown_action"
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
