import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const sendInput = z.object({
  approval_request_id: z.string().uuid(),
  connection_id: z.string().uuid().optional(),
  origin_url: z.string().url().optional(),
});

const SENSITIVE_KEYS = [
  "token",
  "api_key",
  "secret",
  "authorization",
  "bearer",
  "password",
  "webhook_secret",
];

function sanitize(obj: unknown): unknown {
  if (obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((x) => sanitize(x));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lower.includes(s))) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = sanitize(v);
    }
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export const checkTelegramTokenConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    return { configured: !!(token && token.trim().length > 0) };
  });

export const sendTelegramApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sendInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error(
        "TELEGRAM_BOT_TOKEN non configurato. Imposta il secret server per abilitare l'invio reale.",
      );
    }

    // Load approval request (RLS scopes to user)
    const { data: req, error: reqErr } = await supabase
      .from("telegram_approval_requests")
      .select("*")
      .eq("id", data.approval_request_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (reqErr) throw new Error(reqErr.message);
    if (!req) throw new Error("Richiesta approvazione non trovata");

    // Load destination
    let destQuery = supabase
      .from("telegram_connection_settings")
      .select("id,chat_id,label,is_enabled,default_for_approvals,brain_id")
      .eq("user_id", userId)
      .eq("is_enabled", true);
    if (data.connection_id) {
      destQuery = destQuery.eq("id", data.connection_id);
    } else if (req.brain_id) {
      destQuery = destQuery.or(`brain_id.eq.${req.brain_id},brain_id.is.null`);
    }
    const { data: dests, error: dErr } = await destQuery.order("default_for_approvals", {
      ascending: false,
    });
    if (dErr) throw new Error(dErr.message);
    const dest = (dests ?? [])[0];
    if (!dest) {
      throw new Error(
        "Nessuna destinazione Telegram abilitata configurata. Aggiungi una destinazione in Telegram Approvals.",
      );
    }

    // Mark as sending
    await supabase
      .from("telegram_approval_requests")
      .update({
        telegram_delivery_status: "sending",
        telegram_error_text: null,
      } as never)
      .eq("id", req.id);

    // Build message
    const origin = data.origin_url ?? "";
    const openUrl = origin
      ? `${origin.replace(/\/$/, "")}/telegram-approvals?brain=${encodeURIComponent(req.brain_id ?? "")}`
      : null;

    const lines = [
      `<b>🔔 Richiesta approvazione Brain Hub</b>`,
      ``,
      `<b>${escapeHtml(truncate(req.title ?? "Richiesta", 200))}</b>`,
      `Tipo: <code>${escapeHtml(String(req.approval_type))}</code>`,
      `Rischio: <b>${escapeHtml(String(req.risk_level))}</b>`,
    ];
    if (req.brain_id) lines.push(`Progetto: <code>${escapeHtml(req.brain_id)}</code>`);
    if (req.message_preview) {
      lines.push(``, escapeHtml(truncate(String(req.message_preview), 800)));
    }
    lines.push(``, `<i>Approva o rifiuta dentro Brain Hub. Telegram è solo notifica.</i>`);
    const text = lines.join("\n");

    const tgBody: Record<string, unknown> = {
      chat_id: dest.chat_id,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (openUrl) {
      tgBody.reply_markup = {
        inline_keyboard: [[{ text: "Apri approvazione", url: openUrl }]],
      };
    }

    // Call Telegram API
    type TgResp = { ok: boolean; result?: { message_id?: number }; description?: string };
    let tgResp: TgResp | null = null;
    let httpStatus = 0;
    let networkError: string | null = null;
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tgBody),
      });
      httpStatus = r.status;
      const parsed = (await r.json().catch(() => null)) as unknown;
      tgResp = parsed && typeof parsed === "object" ? (parsed as TgResp) : null;
    } catch (e) {
      networkError = e instanceof Error ? e.message : "Errore di rete";
    }

    const ok = !networkError && tgResp !== null && tgResp.ok === true;
    const messageId =
      ok && tgResp && tgResp.result?.message_id ? String(tgResp.result.message_id) : null;
    const errorText = !ok
      ? networkError ?? tgResp?.description ?? `HTTP ${httpStatus}`
      : null;

    const receipt = sanitize({
      http_status: httpStatus,
      ok,
      message_id: messageId,
      description: tgResp?.description ?? null,
      sent_at: new Date().toISOString(),
    }) as Record<string, unknown>;

    const updatePayload: Record<string, unknown> = {
      telegram_delivery_status: ok ? "sent" : "failed",
      telegram_chat_id: dest.chat_id,
      telegram_message_id: messageId,
      telegram_sent_at: ok ? new Date().toISOString() : null,
      telegram_error_text: errorText,
      telegram_receipt_json: receipt,
    };
    if (ok && req.status === "draft") {
      updatePayload.status = "sent";
      updatePayload.requested_at = new Date().toISOString();
    } else if (ok && req.status === "ready_to_send") {
      updatePayload.status = "sent";
    }

    const { error: upErr } = await supabase
      .from("telegram_approval_requests")
      .update(updatePayload as never)
      .eq("id", req.id);
    if (upErr) throw new Error(upErr.message);

    return {
      ok,
      message_id: messageId,
      chat_id: dest.chat_id,
      error: errorText,
    };
  });
