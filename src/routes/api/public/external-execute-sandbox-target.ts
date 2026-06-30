// Brain Hub v3.35b — Sandbox target for External Execute live tests.
//
// This endpoint is intentionally trivial: it accepts a small JSON body
// and returns a deterministic JSON response. NO secrets, NO PII, NO
// business side-effects. It exists solely so the external dispatcher
// can perform an honest HTTP round-trip during sandbox live execute
// validation.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/api/public/external-execute-sandbox-target",
)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          /* ignore — sandbox tolerates empty body */
        }
        const correlation_id =
          typeof body.correlation_id === "string"
            ? body.correlation_id.slice(0, 120)
            : "none";
        return new Response(
          JSON.stringify({
            ok: true,
            sandbox: true,
            received_at: new Date().toISOString(),
            correlation_id,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-correlation-id": correlation_id,
            },
          },
        );
      },
      GET: async () =>
        new Response(
          JSON.stringify({ ok: true, sandbox: true, hint: "POST a JSON body" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    },
  },
});
