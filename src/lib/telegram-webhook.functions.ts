import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TELEGRAM_API = "https://api.telegram.org";
const WEBHOOK_PATH = "/api/public/telegram/webhook";

/**
 * Brain Hub v3.7 — Telegram webhook configuration status.
 * Returns only booleans about server-side env. Never returns secret values.
 */
export const checkTelegramWebhookConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const bot = process.env.TELEGRAM_BOT_TOKEN;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    return {
      bot_token_configured: !!(bot && bot.trim().length > 0),
      webhook_secret_configured: !!(secret && secret.trim().length > 0),
    };
  });

function sanitizeDescription(input: unknown): string {
  if (typeof input !== "string") return "";
  // Strip anything that resembles a bot token (digits:base64ish) defensively.
  return input.replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, "[redacted]").slice(0, 500);
}

function validateWebhookUrl(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("webhook_url mancante");
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("webhook_url non valido");
  }
  if (url.protocol !== "https:") {
    throw new Error("webhook_url deve essere HTTPS");
  }
  if (url.pathname !== WEBHOOK_PATH) {
    throw new Error("webhook_url deve terminare con " + WEBHOOK_PATH);
  }
  return url.toString();
}

export type TelegramWebhookRegisterResult = {
  success: boolean;
  description: string;
  webhook_url: string;
  timestamp: string;
};

export const registerTelegramWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { webhook_url: string }) => ({
    webhook_url: validateWebhookUrl(data?.webhook_url),
  }))
  .handler(async ({ data }): Promise<TelegramWebhookRegisterResult> => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!token || !token.trim()) throw new Error("TELEGRAM_BOT_TOKEN non configurato");
    if (!secret || !secret.trim()) throw new Error("TELEGRAM_WEBHOOK_SECRET non configurato");

    const resp = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: data.webhook_url,
        secret_token: secret,
        allowed_updates: ["callback_query", "message"],
      }),
    });
    const body = (await resp.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
    };
    if (!resp.ok || !body.ok) {
      throw new Error(sanitizeDescription(body.description) || `Telegram API errore (${resp.status})`);
    }
    return {
      success: true,
      description: sanitizeDescription(body.description) || "Webhook registrato",
      webhook_url: data.webhook_url,
      timestamp: new Date().toISOString(),
    };
  });

export type TelegramWebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date: number | null;
  last_error_message: string | null;
  max_connections: number | null;
  allowed_updates: string[];
};

export const getTelegramWebhookInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<TelegramWebhookInfo> => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !token.trim()) throw new Error("TELEGRAM_BOT_TOKEN non configurato");
    const resp = await fetch(`${TELEGRAM_API}/bot${token}/getWebhookInfo`);
    const body = (await resp.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: {
        url?: string;
        has_custom_certificate?: boolean;
        pending_update_count?: number;
        last_error_date?: number;
        last_error_message?: string;
        max_connections?: number;
        allowed_updates?: string[];
      };
    };
    if (!resp.ok || !body.ok || !body.result) {
      throw new Error(sanitizeDescription(body.description) || `Telegram API errore (${resp.status})`);
    }
    const r = body.result;
    return {
      url: typeof r.url === "string" ? r.url : "",
      has_custom_certificate: !!r.has_custom_certificate,
      pending_update_count: typeof r.pending_update_count === "number" ? r.pending_update_count : 0,
      last_error_date: typeof r.last_error_date === "number" ? r.last_error_date : null,
      last_error_message: r.last_error_message ? sanitizeDescription(r.last_error_message) : null,
      max_connections: typeof r.max_connections === "number" ? r.max_connections : null,
      allowed_updates: Array.isArray(r.allowed_updates) ? r.allowed_updates : [],
    };
  });

export const deleteTelegramWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { confirm: boolean }) => {
    if (!data || data.confirm !== true) throw new Error("Conferma richiesta");
    return data;
  })
  .handler(async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !token.trim()) throw new Error("TELEGRAM_BOT_TOKEN non configurato");
    const resp = await fetch(`${TELEGRAM_API}/bot${token}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: false }),
    });
    const body = (await resp.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!resp.ok || !body.ok) {
      throw new Error(sanitizeDescription(body.description) || `Telegram API errore (${resp.status})`);
    }
    return {
      success: true,
      description: sanitizeDescription(body.description) || "Webhook eliminato",
      timestamp: new Date().toISOString(),
    };
  });
