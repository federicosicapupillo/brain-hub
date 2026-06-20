// Brain Hub v3.23.2 — UI Operator auth handshake public route.
// Validates a one-time token issued by an authenticated user and redirects
// to the controlled UI Operator proxy page. Never sets a Supabase session,
// never returns user PII, never accepts password / OAuth tokens.

import { createFileRoute } from "@tanstack/react-router";
import {
  consumeUiOperatorAuthToken,
  isRouteAuthorizedByToken,
  safeTokenPrefix,
} from "@/lib/ui-operator-auth.server";
import { isRouteAllowedForUiOperator } from "@/lib/ui-operator-safety";

async function logServerEvt(
  user_id: string | null,
  event: string,
  metadata: Record<string, unknown>,
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("agent_event_log")
      .insert({ user_id, event_type: event, metadata });
  } catch {
    // best-effort
  }
}

function htmlMessage(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="robots" content="noindex,nofollow">
<style>body{font-family:system-ui;margin:2rem;color:#111}h1{font-size:1.1rem}</style>
</head><body><h1>${title}</h1><p>${body}</p></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/public/ui-operator-auth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = (url.searchParams.get("token") ?? "").trim();
        const session_id = (url.searchParams.get("session_id") ?? "").trim();
        const route = (url.searchParams.get("route") ?? "").trim();

        if (!token || !session_id || !route) {
          await logServerEvt(null, "ui_operator_auth_token_invalid", {
            reason: "missing_params",
            has_token: !!token, has_session_id: !!session_id, has_route: !!route,
          });
          return htmlMessage("Richiesta non valida", "Parametri mancanti.", 400);
        }
        if (!isRouteAllowedForUiOperator(route)) {
          await logServerEvt(null, "ui_operator_auth_token_invalid", {
            reason: "route_not_allowed", route, session_id,
            token_prefix: safeTokenPrefix(token),
          });
          return htmlMessage("Route non consentita", "Questa route non è autorizzata.", 403);
        }

        const consumed = await consumeUiOperatorAuthToken(token);
        if (!consumed.ok) {
          const evt =
            consumed.status === "expired"
              ? "ui_operator_auth_token_expired"
              : "ui_operator_auth_token_invalid";
          await logServerEvt(consumed.user_id, evt, {
            reason: consumed.reason, session_id, route,
            token_prefix: safeTokenPrefix(token),
            status: consumed.status,
          });
          const msg =
            consumed.status === "expired"
              ? "Token scaduto."
              : consumed.status === "used"
                ? "Token già utilizzato."
                : "Token non valido.";
          return htmlMessage("Auth handshake fallito", msg, 401);
        }
        if (consumed.session_id !== session_id) {
          await logServerEvt(consumed.user_id, "ui_operator_auth_token_invalid", {
            reason: "session_mismatch", session_id, route,
            token_prefix: safeTokenPrefix(token),
          });
          return htmlMessage("Sessione non valida", "Mismatch sessione.", 401);
        }
        if (!isRouteAuthorizedByToken(route, consumed.allowed_routes)) {
          await logServerEvt(consumed.user_id, "ui_operator_auth_token_invalid", {
            reason: "route_not_in_token_allowlist", route, session_id,
            token_prefix: safeTokenPrefix(token),
          });
          return htmlMessage("Route non autorizzata", "Route fuori dall'allowlist del token.", 403);
        }

        await logServerEvt(consumed.user_id, "ui_operator_auth_token_consumed", {
          session_id, route, token_prefix: safeTokenPrefix(token),
        });

        const target = `/ui-operator-proxy/${encodeURIComponent(session_id)}?route=${encodeURIComponent(route)}&tp=${encodeURIComponent(safeTokenPrefix(token))}`;
        await logServerEvt(consumed.user_id, "ui_operator_auth_redirect_completed", {
          session_id, route, target_path: target.split("?")[0],
        });
        return new Response(null, {
          status: 302,
          headers: { location: target, "cache-control": "no-store" },
        });
      },
    },
  },
});
