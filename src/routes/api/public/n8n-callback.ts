import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-N8N-Secret",
  "Access-Control-Max-Age": "86400",
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const payloadSchema = z
  .object({
    source: z.string().optional(),
    item_id: z.string().uuid({ message: "item_id must be a valid uuid" }),
    status: z.enum(["done", "failed"]),
    output_result: z.string().max(50000).optional(),
    error_message: z.string().max(5000).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => d.status !== "done" || (d.output_result && d.output_result.trim() !== ""), {
    message: "output_result is required when status=done",
    path: ["output_result"],
  })
  .refine((d) => d.status !== "failed" || (d.error_message && d.error_message.trim() !== ""), {
    message: "error_message is required when status=failed",
    path: ["error_message"],
  });

export const Route = createFileRoute("/api/public/n8n-callback")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      POST: async ({ request }) => {
        // Optional shared-secret auth
        const expected = process.env.N8N_CALLBACK_SECRET;
        if (expected) {
          const provided = request.headers.get("x-n8n-secret") ?? "";
          if (provided !== expected) {
            return json({ error: "Unauthorized" }, 401);
          }
        }

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        const parsed = payloadSchema.safeParse(raw);
        if (!parsed.success) {
          return json({ error: "Invalid payload", details: parsed.error.issues }, 400);
        }
        const data = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: item, error: itemErr } = await supabaseAdmin
          .from("clipboard_items")
          .select("id,user_id,automation_attempts,automation_status")
          .eq("id", data.item_id)
          .maybeSingle();

        if (itemErr) return json({ error: itemErr.message }, 500);
        if (!item) return json({ error: "item_not_found" }, 404);

        const previousStatus = item.automation_status ?? null;
        const nowIso = new Date().toISOString();

        if (data.status === "done") {
          const { error: upErr } = await supabaseAdmin
            .from("clipboard_items")
            .update({
              automation_status: "done",
              automation_completed_at: nowIso,
              output_result: data.output_result ?? "",
              status: "ai_response",
              human_review_required: true,
              next_step_generated: false,
            })
            .eq("id", item.id);
          if (upErr) return json({ error: upErr.message }, 500);

          await supabaseAdmin.from("clipboard_execution_logs").insert({
            user_id: item.user_id,
            clipboard_item_id: item.id,
            action: "n8n_result_received",
            previous_status: previousStatus ?? "running",
            new_status: "done",
            notes: "Risultato ricevuto da n8n",
            metadata: { source: "n8n", ...(data.metadata ?? {}) },
          });

          return json({ ok: true, item_id: item.id, status: "done" });
        } else {
          const { error: upErr } = await supabaseAdmin
            .from("clipboard_items")
            .update({
              automation_status: "failed",
              automation_last_error: data.error_message ?? null,
              automation_attempts: (item.automation_attempts ?? 0) + 1,
              human_review_required: true,
            })
            .eq("id", item.id);
          if (upErr) return json({ error: upErr.message }, 500);

          await supabaseAdmin.from("clipboard_execution_logs").insert({
            user_id: item.user_id,
            clipboard_item_id: item.id,
            action: "n8n_result_failed",
            previous_status: previousStatus ?? "running",
            new_status: "failed",
            notes: data.error_message ?? "n8n result failed",
            metadata: { source: "n8n", ...(data.metadata ?? {}) },
          });

          return json({ ok: true, item_id: item.id, status: "failed" });
        }
      },
    },
  },
});
