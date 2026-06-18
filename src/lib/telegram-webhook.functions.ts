import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
