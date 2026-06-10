import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const testInput = z.object({ connector_id: z.string().uuid() });
const sendInput = z.object({ clipboard_item_id: z.string().uuid() });

async function postToWebhook(url: string, body: unknown) {
  let statusCode: number | null = null;
  let responseText = "";
  let ok = false;
  let errorMsg: string | null = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    statusCode = res.status;
    responseText = (await res.text()).slice(0, 500);
    ok = res.status >= 200 && res.status < 300;
    if (!ok) errorMsg = `HTTP ${res.status}`;
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : "Errore di rete";
  }
  return { statusCode, responseText, ok, errorMsg };
}

export const testN8nWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => testInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: connector, error: cErr } = await supabase
      .from("automation_connectors")
      .select("id,name,type,target_tool,is_active,webhook_url")
      .eq("id", data.connector_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!connector) throw new Error("Connector non trovato");
    if (connector.type !== "n8n_webhook") throw new Error("Connector non è di tipo n8n_webhook");
    if (!connector.is_active) throw new Error("Connector non attivo");
    if (!connector.webhook_url) throw new Error("Webhook URL non configurata");

    const payload = {
      source: "brain_hub",
      mode: "test",
      message: "n8n webhook test",
      timestamp: new Date().toISOString(),
      connector_id: connector.id,
      target_tool: connector.target_tool,
    };
    const { statusCode, responseText, ok, errorMsg } = await postToWebhook(connector.webhook_url, payload);

    await supabase.from("clipboard_execution_logs").insert({
      user_id: userId,
      clipboard_item_id: null,
      action: ok ? "n8n_webhook_test_success" : "n8n_webhook_test_failed",
      notes: ok ? "Test webhook n8n riuscito" : errorMsg,
      metadata: {
        connector_id: connector.id,
        connector_name: connector.name,
        target_tool: connector.target_tool,
        status_code: statusCode,
        response_preview: responseText,
      },
    } as never);

    return { ok, statusCode, responseText, errorMsg };
  });

export const sendVerifiedPayloadToN8n = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sendInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: item, error: iErr } = await supabase
      .from("clipboard_items")
      .select(
        "id,user_id,target_tool,automation_status,automation_attempts,automation_connector_id,human_review_required,automation_payload"
      )
      .eq("id", data.clipboard_item_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!item) throw new Error("Item non trovato");
    if (item.automation_status !== "queued") throw new Error("Item non in stato queued");
    if (item.target_tool !== "Lovable") throw new Error("target_tool non supportato");
    if (item.human_review_required) throw new Error("Item richiede review umana");
    if (!item.automation_payload || Object.keys(item.automation_payload as Record<string, unknown>).length === 0) {
      throw new Error("automation_payload non verificato");
    }
    if (!item.automation_connector_id) throw new Error("Connector non assegnato");

    const { data: connector, error: cErr } = await supabase
      .from("automation_connectors")
      .select("id,type,is_active,webhook_url")
      .eq("id", item.automation_connector_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!connector) throw new Error("Connector non trovato");
    if (connector.type !== "n8n_webhook") throw new Error("Connector non è n8n_webhook");
    if (!connector.is_active) throw new Error("Connector non attivo");
    if (!connector.webhook_url) throw new Error("Webhook URL non configurata");

    const { statusCode, responseText, ok, errorMsg } = await postToWebhook(
      connector.webhook_url,
      item.automation_payload
    );

    if (ok) {
      const { error: upErr } = await supabase
        .from("clipboard_items")
        .update({
          automation_status: "running",
          automation_last_run_at: new Date().toISOString(),
        } as never)
        .eq("id", item.id);
      if (upErr) throw new Error(upErr.message);
      await supabase.from("clipboard_execution_logs").insert({
        user_id: userId,
        clipboard_item_id: item.id,
        action: "n8n_verified_payload_sent",
        previous_status: "queued",
        new_status: "running",
        notes: "Payload verificato inviato a n8n",
        metadata: {
          connector_id: connector.id,
          status_code: statusCode,
          response_preview: responseText,
          payload_mode: "execution_preview",
        },
      } as never);
      return { ok: true, statusCode };
    } else {
      await supabase
        .from("clipboard_items")
        .update({
          automation_status: "failed",
          automation_attempts: (item.automation_attempts ?? 0) + 1,
          automation_last_error: errorMsg,
        } as never)
        .eq("id", item.id);
      await supabase.from("clipboard_execution_logs").insert({
        user_id: userId,
        clipboard_item_id: item.id,
        action: "n8n_verified_payload_failed",
        previous_status: "queued",
        new_status: "failed",
        notes: errorMsg,
        metadata: {
          connector_id: connector.id,
          status_code: statusCode,
          payload_mode: "execution_preview",
        },
      } as never);
      throw new Error(errorMsg ?? "Invio fallito");
    }
  });
