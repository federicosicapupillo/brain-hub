// Brain Hub v3.23.3 — UI Operator Controlled Surface state endpoint (public).
// Returns minimal, sanitized state for the surface the runner is viewing.
// No PII, no tokens, no email bodies, no raw logs.

import { createFileRoute } from "@tanstack/react-router";
import {
  validateSurfaceSession,
  loadGmailConnectorSurfaceState,
  isSupportedSurface,
  logSurfaceEvt,
} from "@/lib/ui-operator-surface.server";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/public/ui-operator-surface-state")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const session_id = (url.searchParams.get("session_id") ?? "").trim();
        const surface = (url.searchParams.get("surface") ?? "gmail_connector").trim();

        if (!isSupportedSurface(surface)) {
          await logSurfaceEvt(null, "ui_operator_surface_action_blocked", {
            reason: "surface_not_supported", surface, session_id,
          });
          return jsonResponse(
            { ok: false, status: "surface_not_supported", surface },
            400,
          );
        }

        const sess = await validateSurfaceSession(session_id);
        if (!sess.ok || !sess.user_id) {
          await logSurfaceEvt(sess.user_id, "ui_operator_surface_action_blocked", {
            reason: sess.reason ?? "invalid_session", surface, session_id,
          });
          return jsonResponse(
            { ok: false, status: "invalid_session", reason: sess.reason },
            401,
          );
        }

        if (surface === "gmail_connector") {
          const state = await loadGmailConnectorSurfaceState(sess.user_id);
          await logSurfaceEvt(sess.user_id, "ui_operator_surface_opened", {
            session_id, surface,
            connection_status: state.connection_status,
          });
          return jsonResponse({ ok: true, status: "ok", surface, state });
        }

        return jsonResponse(
          { ok: false, status: "surface_not_implemented", surface },
          501,
        );
      },
    },
  },
});
