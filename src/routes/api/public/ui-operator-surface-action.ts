// Brain Hub v3.23.3 — UI Operator Controlled Surface action endpoint (public).
// Executes only allowlisted, scoped actions tied to an active UI Operator
// session. Medium/high risk requires a confirmed ui_operator_actions row.
// Never accepts user_id from the client; resolves it from the session.

import { createFileRoute } from "@tanstack/react-router";
import {
  validateSurfaceSession,
  findSurfaceAction,
  loadGmailConnectorSurfaceState,
  logSurfaceEvt,
  SURFACE_TO_ROUTE,
} from "@/lib/ui-operator-surface.server";
import { runRefreshGmailMetadataSyncCore } from "@/lib/gmail-refresh-sync.functions";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

interface SurfaceActionInput {
  session_id?: unknown;
  action_key?: unknown;
  token?: unknown;
  confirmation_action_id?: unknown;
}

export const Route = createFileRoute("/api/public/ui-operator-surface-action")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: SurfaceActionInput;
        try {
          raw = (await request.json()) as SurfaceActionInput;
        } catch {
          return jsonResponse({ ok: false, status: "invalid_body" }, 400);
        }
        const session_id =
          typeof raw.session_id === "string" ? raw.session_id.trim() : "";
        const action_key =
          typeof raw.action_key === "string" ? raw.action_key.trim() : "";
        const confirmation_action_id =
          typeof raw.confirmation_action_id === "string"
            ? raw.confirmation_action_id.trim()
            : null;

        if (!session_id || !action_key) {
          return jsonResponse(
            { ok: false, status: "missing_params" },
            400,
          );
        }

        const descriptor = findSurfaceAction(action_key);
        if (!descriptor) {
          await logSurfaceEvt(null, "ui_operator_surface_action_blocked", {
            reason: "action_key_not_allowed", action_key, session_id,
          });
          return jsonResponse(
            { ok: false, status: "action_key_not_allowed", action_key },
            403,
          );
        }

        const sess = await validateSurfaceSession(session_id);
        if (!sess.ok || !sess.user_id) {
          await logSurfaceEvt(sess.user_id, "ui_operator_surface_action_blocked", {
            reason: sess.reason ?? "invalid_session",
            action_key, session_id,
          });
          return jsonResponse(
            { ok: false, status: "invalid_session", reason: sess.reason },
            401,
          );
        }
        const userId = sess.user_id;
        const route = SURFACE_TO_ROUTE[descriptor.surface];

        await logSurfaceEvt(userId, "ui_operator_surface_action_requested", {
          session_id, surface: descriptor.surface,
          action_key, risk_level: descriptor.risk,
        });

        // Medium/high risk: confirmation gate.
        if (descriptor.requires_confirmation) {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          // Path A: caller provided a confirmation_action_id → must be confirmed.
          if (confirmation_action_id) {
            const { data: actRow } = await supabaseAdmin
              .from("ui_operator_actions")
              .select(
                "id, user_id, session_id, status, action_type, risk_level, metadata",
              )
              .eq("id", confirmation_action_id)
              .maybeSingle();
            const act = actRow as {
              id: string;
              user_id: string;
              session_id: string;
              status: string;
              action_type: string;
              risk_level: string;
              metadata: Record<string, unknown> | null;
            } | null;
            if (
              !act ||
              act.session_id !== session_id ||
              act.user_id !== userId ||
              (act.metadata?.surface_action_key as string | undefined) !==
                action_key
            ) {
              await logSurfaceEvt(userId, "ui_operator_surface_action_blocked", {
                reason: "confirmation_mismatch",
                action_key, session_id,
                confirmation_action_id,
              });
              return jsonResponse(
                { ok: false, status: "confirmation_mismatch" },
                403,
              );
            }
            if (act.status !== "confirmed") {
              await logSurfaceEvt(
                userId,
                "ui_operator_surface_action_requires_confirmation",
                {
                  action_key, session_id, confirmation_action_id,
                  current_status: act.status,
                },
              );
              return jsonResponse(
                {
                  ok: false,
                  status: "confirmation_required",
                  confirmation_action_id,
                  action_status: act.status,
                },
                409,
              );
            }
            // executed below
            const result = await executeSurfaceAction({
              action_key,
              userId,
            });
            await supabaseAdmin
              .from("ui_operator_actions")
              .update({
                status: result.ok ? "executed" : "failed",
                executed_at: result.ok ? new Date().toISOString() : null,
                failed_at: !result.ok ? new Date().toISOString() : null,
                result_text: result.ok
                  ? String(result.message ?? "").slice(0, 800)
                  : null,
                error_text: !result.ok
                  ? String(result.message ?? "").slice(0, 800)
                  : null,
              })
              .eq("id", act.id);
            await logSurfaceEvt(
              userId,
              result.ok
                ? "ui_operator_surface_action_executed"
                : "ui_operator_surface_action_failed",
              {
                session_id, surface: descriptor.surface, action_key,
                risk_level: descriptor.risk, status: result.status,
              },
            );
            return jsonResponse({
              ok: result.ok,
              status: result.ok ? "executed" : "failed",
              action_key,
              confirmation_action_id,
              result: result.payload ?? null,
              message: result.message,
            });
          }

          // Path B: no confirmation yet → create proposed action row.
          const { data: inserted } = await supabaseAdmin
            .from("ui_operator_actions")
            .insert({
              session_id,
              user_id: userId,
              brain_id: sess.brain_id,
              route,
              action_type: descriptor.internal_action_type,
              title: descriptor.title,
              description: `Richiesta dalla Controlled Surface (${descriptor.surface}).`,
              risk_level: descriptor.risk,
              status: "proposed",
              requires_confirmation: true,
              metadata: {
                source: "ui_operator_surface",
                surface: descriptor.surface,
                surface_action_key: action_key,
              },
            })
            .select("id")
            .maybeSingle();
          const newId = (inserted as { id?: string } | null)?.id ?? null;
          await logSurfaceEvt(
            userId,
            "ui_operator_surface_action_requires_confirmation",
            {
              session_id, surface: descriptor.surface, action_key,
              risk_level: descriptor.risk, action_id: newId,
            },
          );
          return jsonResponse(
            {
              ok: false,
              status: "confirmation_required",
              confirmation_action_id: newId,
              action_key,
              risk_level: descriptor.risk,
              message:
                "Conferma richiesta in Brain Hub prima dell'esecuzione.",
            },
            202,
          );
        }

        // Low-risk: execute directly.
        const result = await executeSurfaceAction({ action_key, userId });
        await logSurfaceEvt(
          userId,
          result.ok
            ? "ui_operator_surface_action_executed"
            : "ui_operator_surface_action_failed",
          {
            session_id, surface: descriptor.surface, action_key,
            risk_level: descriptor.risk, status: result.status,
          },
        );
        return jsonResponse({
          ok: result.ok,
          status: result.status,
          action_key,
          result: result.payload ?? null,
          message: result.message,
        });
      },
    },
  },
});

interface SurfaceActionResult {
  ok: boolean;
  status: string;
  message: string;
  payload?: Record<string, unknown> | null;
}

async function executeSurfaceAction(input: {
  action_key: string;
  userId: string;
}): Promise<SurfaceActionResult> {
  const { action_key, userId } = input;
  try {
    if (action_key === "gmail_check_status" || action_key === "gmail_get_brief") {
      const state = await loadGmailConnectorSurfaceState(userId);
      return {
        ok: true,
        status: "ok",
        message:
          action_key === "gmail_check_status"
            ? `Stato Gmail: ${state.connection_status}.`
            : `Brief Gmail aggiornato (mail oggi: ${state.today_count ?? "—"}).`,
        payload: { state },
      };
    }
    if (action_key === "gmail_open_reconnect") {
      return {
        ok: true,
        status: "reconnect_link_ready",
        message: "Apri il Gmail Connector per ricollegare l'account.",
        payload: { reconnect_path: "/gmail-connector" },
      };
    }
    if (action_key === "gmail_refresh_metadata") {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      const res = await runRefreshGmailMetadataSyncCore(
        supabaseAdmin,
        userId,
        {
          brain_id: null,
          mode: "today",
          reason: "user_requested",
          force: false,
        },
      );
      return {
        ok: res.ok,
        status: res.status,
        message: res.safe_message ?? `Sync status: ${res.status}.`,
        payload: {
          status: res.status,
          last_sync_after: res.last_sync_after ?? null,
          new_messages_count: res.new_messages_count ?? null,
          today_count_after: res.today_count_after ?? null,
        },
      };
    }
    return {
      ok: false,
      status: "action_not_implemented",
      message: "Azione non implementata.",
    };
  } catch (e) {
    return {
      ok: false,
      status: "execution_error",
      message: e instanceof Error ? e.message : "Errore esecuzione azione.",
    };
  }
}
