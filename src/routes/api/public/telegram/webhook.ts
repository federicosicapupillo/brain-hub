import { createFileRoute } from "@tanstack/react-router";

/**
 * Brain Hub v3.7 — Telegram bidirectional approval webhook.
 *
 * Security:
 * - Telegram must call this endpoint with header `X-Telegram-Bot-Api-Secret-Token`
 *   equal to the env `TELEGRAM_WEBHOOK_SECRET`. Without that secret all callbacks
 *   are rejected with 401.
 * - The callback_data carries only a random nonce. The hash of that nonce is the
 *   only thing stored on the approval request, so callbacks cannot be forged
 *   without knowing the original token.
 * - Token has an expiry (`metadata.callback_expires_at`).
 * - Replay is idempotent: once `status` is approved/rejected, further clicks are
 *   logged as `telegram_approval_callback_replay_ignored` and ignored.
 *
 * This endpoint NEVER triggers n8n/Drive/Calendar/Telegram-send/etc.
 * It only updates the approval request and propagates a metadata flag onto the
 * linked automation_action (no status change is forced).
 */

function ok(body: unknown = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type TgCallbackQuery = {
  id: string;
  from?: { id?: number; username?: string; first_name?: string };
  message?: { message_id?: number; chat?: { id?: number } };
  data?: string;
};

type TgUpdate = {
  update_id?: number;
  callback_query?: TgCallbackQuery;
};

async function answerCallback(
  token: string,
  callback_query_id: string,
  text: string,
  show_alert = false,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id, text, show_alert }),
    });
  } catch {
    // swallow — best effort
  }
}

async function clearMessageButtons(
  token: string,
  chat_id: number,
  message_id: number,
  suffix: string,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        message_id,
        reply_markup: { inline_keyboard: [[{ text: suffix, callback_data: "noop" }]] },
      }),
    });
  } catch {
    // swallow
  }
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!expectedSecret || !botToken) {
          // Misconfigured — refuse silently with 401 to avoid leaking state.
          return new Response("Unauthorized", { status: 401 });
        }
        const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (provided !== expectedSecret) {
          return new Response("Unauthorized", { status: 401 });
        }

        let update: TgUpdate;
        try {
          update = (await request.json()) as TgUpdate;
        } catch {
          return new Response("Bad Request", { status: 400 });
        }

        const cq = update.callback_query;
        if (!cq || !cq.data || !cq.id) {
          // Ignore non-callback updates (Telegram requires 200 to stop retries).
          return ok({ ignored: true });
        }

        // Parse `a|<token>` or `r|<token>`
        const m = /^(a|r)\|([a-f0-9]{8,64})$/i.exec(cq.data);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const baseLog = {
          clipboard_item_id: null as string | null,
          metadata: {
            callback_query_id: cq.id,
            from_user_id: cq.from?.id ?? null,
            from_username: cq.from?.username ?? null,
            chat_id: cq.message?.chat?.id ?? null,
            message_id: cq.message?.message_id ?? null,
          } as Record<string, unknown>,
        };

        if (!m) {
          await answerCallback(botToken, cq.id, "Callback non valida", true);
          return ok({ ignored: true, reason: "bad_callback_data" });
        }
        const action = m[1].toLowerCase() === "a" ? "approve" : "reject";
        const callbackToken = m[2];
        const tokenHash = await sha256Hex(callbackToken);

        // Lookup the approval request by metadata.callback_token_hash
        const { data: reqRow, error: lookupErr } = await supabaseAdmin
          .from("telegram_approval_requests")
          .select("*")
          .filter("metadata->>callback_token_hash", "eq", tokenHash)
          .maybeSingle();

        if (lookupErr || !reqRow) {
          await supabaseAdmin.from("clipboard_execution_logs").insert({
            user_id: "00000000-0000-0000-0000-000000000000",
            clipboard_item_id: null,
            action: "telegram_approval_callback_invalid",
            notes: "Callback Telegram: token non riconosciuto",
            metadata: baseLog.metadata,
          } as never);
          await answerCallback(botToken, cq.id, "Richiesta non trovata", true);
          return ok({ ignored: true, reason: "not_found" });
        }

        const userId = (reqRow as { user_id: string }).user_id;
        const reqId = (reqRow as { id: string }).id;
        const reqStatus = (reqRow as { status: string }).status;
        const existingMeta =
          ((reqRow as { metadata: Record<string, unknown> | null }).metadata ?? {}) as Record<
            string,
            unknown
          >;
        const automationActionId = (reqRow as { automation_action_id: string | null })
          .automation_action_id;

        const logRow = (eventType: string, notes: string, extra: Record<string, unknown> = {}) =>
          supabaseAdmin.from("clipboard_execution_logs").insert({
            user_id: userId,
            clipboard_item_id: null,
            action: eventType,
            notes,
            metadata: { request_id: reqId, ...baseLog.metadata, ...extra },
          } as never);

        await logRow("telegram_approval_callback_received", `Callback ${action} ricevuta`);

        // Expiry check
        const expiresAtStr = existingMeta.callback_expires_at;
        if (typeof expiresAtStr === "string") {
          const expiresAt = new Date(expiresAtStr).getTime();
          if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
            await supabaseAdmin
              .from("telegram_approval_requests")
              .update({
                metadata: {
                  ...existingMeta,
                  callback_status: "expired",
                  telegram_callback_received_at: new Date().toISOString(),
                  telegram_callback_action: action,
                },
              } as never)
              .eq("id", reqId);
            await logRow("telegram_approval_callback_expired", "Callback Telegram scaduta");
            await answerCallback(botToken, cq.id, "Richiesta scaduta", true);
            return ok({ ignored: true, reason: "expired" });
          }
        }

        // Replay: already finalized
        if (reqStatus === "approved" || reqStatus === "rejected" || reqStatus === "cancelled") {
          await logRow(
            "telegram_approval_callback_replay_ignored",
            `Replay ignorato (status=${reqStatus})`,
          );
          await answerCallback(
            botToken,
            cq.id,
            reqStatus === "approved" ? "Già approvata" : "Già processata",
            false,
          );
          if (cq.message?.chat?.id && cq.message?.message_id) {
            await clearMessageButtons(
              botToken,
              cq.message.chat.id,
              cq.message.message_id,
              reqStatus === "approved" ? "✅ Già approvata" : "❌ Già processata",
            );
          }
          return ok({ ignored: true, reason: "replay" });
        }

        const nowIso = new Date().toISOString();
        const callbackMeta = {
          ...existingMeta,
          callback_status: action === "approve" ? "approved" : "rejected",
          telegram_callback_received_at: nowIso,
          telegram_callback_action: action,
          telegram_callback_user_id: cq.from?.id ?? null,
          telegram_callback_username: cq.from?.username ?? null,
        };

        const updatePayload: Record<string, unknown> =
          action === "approve"
            ? {
                status: "approved",
                approved_at: nowIso,
                approved_by: `telegram:${cq.from?.username ?? cq.from?.id ?? "unknown"}`,
                metadata: callbackMeta,
              }
            : {
                status: "rejected",
                rejected_at: nowIso,
                rejection_reason: `Rifiutata via Telegram da ${cq.from?.username ?? cq.from?.id ?? "unknown"}`,
                metadata: callbackMeta,
              };

        const { error: upErr } = await supabaseAdmin
          .from("telegram_approval_requests")
          .update(updatePayload as never)
          .eq("id", reqId);
        if (upErr) {
          await logRow("telegram_approval_callback_invalid", `Update fallito: ${upErr.message}`);
          await answerCallback(botToken, cq.id, "Errore aggiornamento", true);
          return ok({ ok: false, error: "update_failed" });
        }

        // Propagate metadata to linked automation_action (no status change forced).
        if (automationActionId) {
          try {
            const { data: act } = await supabaseAdmin
              .from("automation_actions")
              .select("metadata")
              .eq("id", automationActionId)
              .maybeSingle();
            const actMeta = ((act as { metadata: Record<string, unknown> | null } | null)
              ?.metadata ?? {}) as Record<string, unknown>;
            const patch: Record<string, unknown> =
              action === "approve"
                ? {
                    ...actMeta,
                    telegram_approval_status: "approved",
                    telegram_approval_id: reqId,
                    telegram_approved_at: nowIso,
                    approved_via: "telegram",
                  }
                : {
                    ...actMeta,
                    telegram_approval_status: "rejected",
                    telegram_approval_id: reqId,
                    telegram_rejected_at: nowIso,
                    rejected_via: "telegram",
                  };
            await supabaseAdmin
              .from("automation_actions")
              .update({ metadata: patch } as never)
              .eq("id", automationActionId);
            await logRow("telegram_approval_action_synced", "Metadata action sincronizzata", {
              automation_action_id: automationActionId,
              action,
            });
          } catch {
            // best effort
          }
        }

        await logRow(
          action === "approve"
            ? "telegram_approval_callback_approved"
            : "telegram_approval_callback_rejected",
          action === "approve" ? "Approvata via Telegram" : "Rifiutata via Telegram",
        );

        await answerCallback(
          botToken,
          cq.id,
          action === "approve" ? "Approvata ✅" : "Rifiutata ❌",
          false,
        );
        if (cq.message?.chat?.id && cq.message?.message_id) {
          await clearMessageButtons(
            botToken,
            cq.message.chat.id,
            cq.message.message_id,
            action === "approve" ? "✅ Approvata via Telegram" : "❌ Rifiutata via Telegram",
          );
        }

        return ok({ ok: true, action });
      },
    },
  },
});
