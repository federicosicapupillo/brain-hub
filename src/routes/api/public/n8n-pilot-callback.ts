import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Brainhub-Callback-Secret",
  "Access-Control-Max-Age": "86400",
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const callbackSchema = z.object({
  execution_package_id: z.string().min(1),
  run_id: z.string().min(1),
  callback_schema_version: z.literal(1),
  status: z.enum(["completed", "failed"]),
  build_status: z.enum(["ok", "failed", "not_verified"]).optional(),
  console_errors: z.boolean().optional(),
  modified_files: z.array(z.string()).max(500).optional(),
  summary: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
  external_result_reference: z.string().max(500).optional().nullable(),
  raw_output: z.string().max(50000).optional(),
});

// Stable FNV-1a hash for callback dedupe (mirrors src/lib/automation-run.ts)
function computeCallbackHash(parts: {
  execution_package_id: string;
  run_id?: string | null;
  status?: string | null;
  build_status?: string | null;
  summary?: string | null;
  raw_output?: string | null;
}): string {
  const s = [
    parts.execution_package_id,
    parts.run_id ?? "",
    parts.status ?? "",
    parts.build_status ?? "",
    (parts.summary ?? "").trim(),
    (parts.raw_output ?? "").trim(),
  ].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const Route = createFileRoute("/api/public/n8n-pilot-callback")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      POST: async ({ request }) => {
        // 1. Shared-secret auth (MANDATORY)
        const expected = process.env.BRAINHUB_N8N_CALLBACK_SECRET;
        if (!expected) {
          return json({ error: "callback_secret_not_configured" }, 503);
        }
        const provided = request.headers.get("x-brainhub-callback-secret") ?? "";
        if (provided !== expected) {
          return json({ error: "unauthorized" }, 401);
        }

        // 2. Parse JSON
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ error: "invalid_json" }, 400);
        }
        const parsed = callbackSchema.safeParse(raw);
        if (!parsed.success) {
          return json({ error: "invalid_payload", details: parsed.error.issues }, 400);
        }
        const data = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 3. Load item
        const { data: item, error: itemErr } = await supabaseAdmin
          .from("clipboard_items")
          .select("id,user_id,brain_id,content_type,output_result,metadata")
          .eq("id", data.execution_package_id)
          .maybeSingle();
        if (itemErr) return json({ error: "db_error", message: itemErr.message }, 500);
        if (!item) return json({ error: "item_not_found" }, 404);
        if (item.content_type !== "execution_package") {
          return json({ error: "item_not_execution_package" }, 400);
        }

        const meta = (item.metadata as Record<string, unknown> | null) ?? {};
        const run = (meta.automation_run as Record<string, unknown> | undefined) ?? null;
        if (!run) return json({ error: "automation_run_missing" }, 409);
        if (run.run_id !== data.run_id) {
          return json({ error: "run_id_mismatch" }, 409);
        }

        const ext = (run.external_connector as Record<string, unknown> | undefined) ?? null;
        if (!ext || ext.connector !== "n8n") {
          return json({ error: "external_connector_not_n8n" }, 409);
        }
        if (ext.ready_for_real_test !== true) {
          return json({ error: "not_ready_for_real_test" }, 409);
        }
        if (ext.contract_status !== "valid") {
          return json({ error: "contract_not_valid" }, 409);
        }

        // 4. Dry run active blocker
        const dry = (run.dry_run as { enabled?: boolean } | undefined) ?? null;
        if (dry?.enabled === true && run.run_status === "running") {
          return json({ error: "dry_run_active" }, 409);
        }

        // 5. Real-result-already-approved blocker
        const prevResultMeta = (meta.result_meta as Record<string, unknown> | undefined) ?? {};
        const review = (meta.post_execution_review as { review_status?: string } | undefined) ?? null;
        const realApproved =
          prevResultMeta.source !== "dry_run" &&
          prevResultMeta.is_simulated !== true &&
          (review?.review_status === "approvato" || run.run_status === "completed") &&
          !!prevResultMeta.external_result_reference;
        if (realApproved) {
          // Override mode is intentionally NOT implemented yet
          return json({ error: "real_result_already_approved" }, 409);
        }

        // 6. Idempotency checks
        const callbackHash = computeCallbackHash({
          execution_package_id: data.execution_package_id,
          run_id: data.run_id,
          status: data.status,
          build_status: data.build_status ?? null,
          summary: data.summary ?? null,
          raw_output: data.raw_output ?? null,
        });
        if (prevResultMeta.callback_hash && prevResultMeta.callback_hash === callbackHash) {
          return json({ ok: true, status: "duplicate_callback_ignored", callback_hash: callbackHash });
        }
        if (
          data.external_result_reference &&
          prevResultMeta.external_result_reference &&
          prevResultMeta.external_result_reference === data.external_result_reference
        ) {
          return json({
            ok: true,
            status: "duplicate_external_reference_ignored",
            external_result_reference: data.external_result_reference,
          });
        }

        // 7. Apply result
        const now = new Date().toISOString();
        const resultMeta = {
          ...prevResultMeta,
          build_status: data.build_status ?? "not_verified",
          console_errors: data.console_errors ?? false,
          modified_files: data.modified_files ?? [],
          summary: data.summary ?? "",
          notes: data.notes ?? "",
          external_result_reference: data.external_result_reference ?? null,
          callback_hash: callbackHash,
          callback_schema_version: 1,
          source: "n8n_webhook",
          received_at: now,
        };

        const prevRunStatus = (run.run_status as string | undefined) ?? "draft";
        const nextRun: Record<string, unknown> = { ...run, updated_at: now };
        const itemUpdate: Record<string, unknown> = {
          metadata: { ...meta, automation_run: nextRun, result_meta: resultMeta },
        };

        if (data.status === "completed") {
          const output = (data.raw_output ?? data.summary ?? "").toString();
          nextRun.run_status = "completed";
          nextRun.completed_at = now;
          nextRun.external_result_reference = data.external_result_reference ?? null;
          nextRun.execution_notes = data.notes ?? data.summary ?? "";
          itemUpdate.output_result = output;
        } else {
          const errMsg = data.summary || data.notes || "Run fallita via n8n webhook";
          nextRun.run_status = "failed";
          nextRun.failed_at = now;
          nextRun.last_error = errMsg;
          nextRun.execution_notes = data.notes ?? "";
        }

        const { error: upErr } = await supabaseAdmin
          .from("clipboard_items")
          .update(itemUpdate as never)
          .eq("id", item.id);
        if (upErr) return json({ error: "db_update_failed", message: upErr.message }, 500);

        // 8. Write logs (timeline)
        const baseLogMeta = {
          clipboard_item_id: item.id,
          brain_id: item.brain_id,
          source: "n8n_webhook",
          connector: "n8n_pilot",
          run_id: data.run_id,
          status: data.status,
          build_status: data.build_status ?? "not_verified",
          console_errors: data.console_errors ?? false,
          modified_files: data.modified_files ?? [],
          external_result_reference: data.external_result_reference ?? null,
          callback_hash: callbackHash,
        };

        await supabaseAdmin.from("clipboard_execution_logs").insert([
          {
            user_id: item.user_id,
            clipboard_item_id: item.id,
            action: "n8n_callback_received",
            previous_status: prevRunStatus,
            new_status: data.status,
            notes: data.summary || data.notes || `Callback n8n webhook ${data.status}`,
            metadata: baseLogMeta,
          },
          {
            user_id: item.user_id,
            clipboard_item_id: item.id,
            action: "automation_callback_received",
            previous_status: prevRunStatus,
            new_status: data.status,
            notes: data.summary || data.notes || `Callback ${data.status}`,
            metadata: baseLogMeta,
          },
          {
            user_id: item.user_id,
            clipboard_item_id: item.id,
            action: data.status === "completed" ? "automation_completed" : "automation_failed",
            previous_status: prevRunStatus,
            new_status: data.status,
            notes: data.summary || data.notes || "",
            metadata: baseLogMeta,
          },
        ] as never);

        return json({
          ok: true,
          status: data.status,
          callback_hash: callbackHash,
          external_result_reference: data.external_result_reference ?? null,
        });
      },
    },
  },
});
