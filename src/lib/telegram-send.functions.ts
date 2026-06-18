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

    // Load destinations and pick best match (risk/type → brain default → global default)
    let destQuery = supabase
      .from("telegram_connection_settings")
      .select(
        "id,chat_id,label,is_enabled,default_for_approvals,brain_id,risk_levels,approval_types",
      )
      .eq("user_id", userId)
      .eq("is_enabled", true);
    if (data.connection_id) {
      destQuery = destQuery.eq("id", data.connection_id);
    } else if (req.brain_id) {
      destQuery = destQuery.or(`brain_id.eq.${req.brain_id},brain_id.is.null`);
    }
    const { data: destsRaw, error: dErr } = await destQuery;
    if (dErr) throw new Error(dErr.message);
    type DestRow = {
      id: string;
      chat_id: string;
      label: string;
      is_enabled: boolean;
      default_for_approvals: boolean;
      brain_id: string | null;
      risk_levels: string[] | null;
      approval_types: string[] | null;
    };
    const dests = (destsRaw ?? []) as unknown as DestRow[];
    const riskLevel = String(req.risk_level ?? "");
    const approvalType = String(req.approval_type ?? "");
    const matchRisk = (c: DestRow) =>
      c.risk_levels && c.risk_levels.length > 0 ? c.risk_levels.includes(riskLevel) : true;
    const matchType = (c: DestRow) =>
      c.approval_types && c.approval_types.length > 0
        ? c.approval_types.includes(approvalType)
        : true;
    const hasFilter = (c: DestRow) =>
      (c.risk_levels && c.risk_levels.length > 0) ||
      (c.approval_types && c.approval_types.length > 0);
    let dest: DestRow | undefined =
      dests.find(
        (c) => c.brain_id === req.brain_id && hasFilter(c) && matchRisk(c) && matchType(c),
      ) ??
      dests.find((c) => c.brain_id === req.brain_id && c.default_for_approvals) ??
      dests.find(
        (c) => c.brain_id === null && hasFilter(c) && matchRisk(c) && matchType(c),
      ) ??
      dests.find((c) => c.brain_id === null && c.default_for_approvals) ??
      dests.find((c) => c.brain_id === req.brain_id) ??
      dests.find((c) => c.brain_id === null) ??
      dests[0];
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

    // Generate callback token + hash (server-side only). Only the hash is stored.
    const tokenBytes = new Uint8Array(8);
    crypto.getRandomValues(tokenBytes);
    const callbackToken = Array.from(tokenBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const tokenHashBuf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(callbackToken),
    );
    const callbackTokenHash = Array.from(new Uint8Array(tokenHashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const callbackExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

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
    lines.push(``, `<i>Approva o rifiuta direttamente da Telegram, oppure apri Brain Hub.</i>`);
    const text = lines.join("\n");

    const inlineKeyboard: Array<Array<Record<string, unknown>>> = [
      [
        { text: "✅ Approva", callback_data: `a|${callbackToken}` },
        { text: "❌ Rifiuta", callback_data: `r|${callbackToken}` },
      ],
    ];
    if (openUrl) {
      inlineKeyboard.push([{ text: "Apri in Brain Hub", url: openUrl }]);
    }

    const tgBody: Record<string, unknown> = {
      chat_id: dest.chat_id,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: inlineKeyboard },
    };

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

    const existingMetadata =
      (req.metadata && typeof req.metadata === "object" && !Array.isArray(req.metadata)
        ? (req.metadata as Record<string, unknown>)
        : {}) ?? {};
    const updatePayload: Record<string, unknown> = {
      telegram_delivery_status: ok ? "sent" : "failed",
      telegram_chat_id: dest.chat_id,
      telegram_message_id: messageId,
      telegram_sent_at: ok ? new Date().toISOString() : null,
      telegram_error_text: errorText,
      telegram_receipt_json: receipt,
      metadata: ok
        ? {
            ...existingMetadata,
            callback_token_hash: callbackTokenHash,
            callback_expires_at: callbackExpiresAt,
            callback_status: "pending",
          }
        : existingMetadata,
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

    // Append to delivery attempts ledger (best-effort, non-blocking)
    try {
      const { count } = await supabase
        .from("telegram_delivery_attempts")
        .select("id", { count: "exact", head: true })
        .eq("approval_request_id", req.id);
      const attemptNumber = (count ?? 0) + 1;
      await supabase.from("telegram_delivery_attempts").insert({
        user_id: userId,
        brain_id: req.brain_id ?? null,
        approval_request_id: req.id,
        connection_id: dest.id,
        delivery_status: ok ? "sent" : "failed",
        telegram_message_id: messageId,
        telegram_chat_id: dest.chat_id,
        error_text: errorText ? errorText.slice(0, 500) : null,
        receipt_json: receipt,
        attempt_number: attemptNumber,
      } as never);
    } catch {
      // swallow ledger errors; primary update already succeeded
    }

    return {
      ok,
      message_id: messageId,
      chat_id: dest.chat_id,
      error: errorText,
    };
  });
