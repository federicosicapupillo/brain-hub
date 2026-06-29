// v3.25.7 — Public-ish server route for best-effort Jack GPT telemetry.
// Bypasses the createServerFn dispatcher, which in dev intermittently
// returns 500 ("Cannot read properties of undefined (reading 'method')")
// when getServerFnById misses during HMR/optimize-deps reloads. The route
// is fire-and-forget; the client uses `keepalive: true` and ignores the
// response, so a transient failure can never blank the UI.
import { createFileRoute } from "@tanstack/react-router";
import { writeJackGptEventLog } from "@/lib/jack-gpt-log.server";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function okJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const Route = createFileRoute("/api/jack-event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const raw = (await request.json().catch(() => ({}))) as {
            event?: unknown;
            metadata?: unknown;
          };
          const event =
            typeof raw.event === "string" && raw.event.length > 0
              ? raw.event
              : "jack_gpt_event_unknown";
          const metadata =
            raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
              ? (raw.metadata as Record<string, unknown>)
              : {};
          const result = await writeJackGptEventLog({ event, metadata });
          return okJson(result);
        } catch {
          // Telemetry MUST never bubble a 5xx; always return JSON 200.
          return okJson({ ok: false, skipped: "error" });
        }
      },
    },
  },
});
