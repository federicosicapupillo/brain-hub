// Brain Hub v3.35a.1 — Internal Execute Rollback HTTP entry point.
//
// POST /api/rollback-internal-action
//   Body: { receipt_id: string, confirmation_source?: string }
//   Auth: required (bearer).
//
// Rollback flows through `rollbackInternalAction` in the dispatcher,
// which enforces governance + ownership and appends an immutable
// Receipt with result="rolled_back". The original Receipt is NEVER
// mutated.

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

export const Route = createFileRoute("/api/rollback-internal-action")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) {
          return new Response(
            JSON.stringify({
              ok: false,
              status: "rejected_confirm",
              safe_message: "no_session",
            }),
            { status: 401, headers: { "content-type": "application/json" } },
          );
        }

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response(
            JSON.stringify({
              ok: false,
              status: "failed",
              safe_message: "server_misconfigured",
            }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }

        const userScoped = createClient<Database>(
          SUPABASE_URL,
          SUPABASE_PUBLISHABLE_KEY,
          {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: {
              storage: undefined,
              persistSession: false,
              autoRefreshToken: false,
            },
          },
        );
        const { data: userResp, error: userErr } = await userScoped.auth.getUser();
        if (userErr || !userResp?.user) {
          return new Response(
            JSON.stringify({
              ok: false,
              status: "rejected_confirm",
              safe_message: "invalid_session",
            }),
            { status: 401, headers: { "content-type": "application/json" } },
          );
        }
        const userId = userResp.user.id;

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response(
            JSON.stringify({
              ok: false,
              status: "rejected_validation",
              safe_message: "invalid_json",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        const receipt_id =
          typeof body.receipt_id === "string" ? body.receipt_id.trim() : "";
        if (!receipt_id) {
          return new Response(
            JSON.stringify({
              ok: false,
              status: "rejected_validation",
              safe_message: "missing_receipt_id",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const confirmation_source =
          body.confirmation_source === "voice_confirm" ||
          body.confirmation_source === "keyboard_enter"
            ? body.confirmation_source
            : "ui_button";

        try {
          const { rollbackInternalAction } = await import(
            "@/lib/execute-dispatcher/dispatcher.server"
          );
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          const result = await rollbackInternalAction(
            { admin: supabaseAdmin, userId },
            { receipt_id, confirmation_source },
          );

          const status = result.ok
            ? 200
            : result.status === "rejected_governance"
              ? 403
              : result.status === "rejected_not_found"
                ? 404
                : result.status === "rejected_already_rolled_back"
                  ? 409
                  : result.status === "rejected_not_rollbackable" ||
                      result.status === "rejected_validation" ||
                      result.status === "rejected_unknown_action" ||
                      result.status === "rejected_confirm"
                    ? 400
                    : 500;
          return new Response(JSON.stringify(result), {
            status,
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          return new Response(
            JSON.stringify({
              ok: false,
              status: "failed",
              safe_message: safe(err),
            }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});
