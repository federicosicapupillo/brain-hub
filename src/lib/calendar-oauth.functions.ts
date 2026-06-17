import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// Brain Hub v3.0 — Google Calendar OAuth (client-callable fns)
// ============================================================
// READ-ONLY. Tokens are never persisted in DB.
// ============================================================

export type CalendarOauthStatus = {
  configured: boolean;
  redirectUri: string | null;
  scope: string;
};

export const getGoogleCalendarOauthStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<CalendarOauthStatus> => {
    const { getGoogleCalendarOauthConfig, CALENDAR_OAUTH_SCOPE } = await import(
      "@/lib/calendar-oauth.server"
    );
    const cfg = getGoogleCalendarOauthConfig();
    return {
      configured: !!cfg,
      redirectUri: cfg?.redirectUri ?? null,
      scope: CALENDAR_OAUTH_SCOPE,
    };
  });

export type StartGoogleCalendarOauthInput = {
  connectionId: string;
  returnTo?: string | null;
};

export type StartGoogleCalendarOauthResult =
  | { ok: true; authUrl: string }
  | { ok: false; reason: string };

export const startGoogleCalendarOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: StartGoogleCalendarOauthInput) => {
    if (!data || typeof data.connectionId !== "string" || !data.connectionId) {
      throw new Error("connectionId richiesto");
    }
    return {
      connectionId: data.connectionId,
      returnTo:
        typeof data.returnTo === "string" && data.returnTo.startsWith("/")
          ? data.returnTo
          : null,
    };
  })
  .handler(
    async ({ data, context }): Promise<StartGoogleCalendarOauthResult> => {
      const { supabase, userId } = context;
      const {
        getGoogleCalendarOauthConfig,
        buildGoogleCalendarAuthUrl,
        CALENDAR_OAUTH_SCOPE,
      } = await import("@/lib/calendar-oauth.server");

      const cfg = getGoogleCalendarOauthConfig();
      if (!cfg) {
        return {
          ok: false,
          reason:
            "Google Calendar OAuth non configurato. Imposta GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_CALENDAR_OAUTH_REDIRECT_URL (oppure riusa GOOGLE_OAUTH_REDIRECT_URL).",
        };
      }

      const { data: conn, error: connErr } = await supabase
        .from("calendar_connection_settings" as never)
        .select("id, user_id, brain_id")
        .eq("id", data.connectionId)
        .maybeSingle();
      if (connErr || !conn) {
        return { ok: false, reason: "Connessione non trovata" };
      }
      const connRow = conn as unknown as {
        id: string;
        user_id: string;
        brain_id: string | null;
      };
      if (connRow.user_id !== userId) {
        return { ok: false, reason: "Connessione non autorizzata" };
      }

      const stateToken = crypto.randomUUID() + "." + crypto.randomUUID();

      const { error: stateErr } = await supabase
        .from("google_calendar_oauth_states" as never)
        .insert({
          state_token: stateToken,
          user_id: userId,
          connection_id: connRow.id,
          brain_id: connRow.brain_id,
          redirect_to: data.returnTo,
          scopes: [CALENDAR_OAUTH_SCOPE],
        } as never);
      if (stateErr) {
        return { ok: false, reason: "Impossibile creare state OAuth" };
      }

      const authUrl = buildGoogleCalendarAuthUrl(stateToken);
      if (!authUrl) {
        return { ok: false, reason: "Configurazione OAuth incompleta" };
      }

      try {
        await supabase.from("clipboard_execution_logs").insert({
          user_id: userId,
          clipboard_item_id: null,
          action: "google_calendar_oauth_started",
          notes: "Avviato OAuth Google Calendar",
          metadata: { connection_id: connRow.id },
        } as never);
      } catch {
        // non-blocking
      }
      return { ok: true, authUrl };
    },
  );

export type DisconnectGoogleCalendarInput = { connectionId: string };
export type DisconnectGoogleCalendarResult = { ok: boolean; reason?: string };

export const disconnectGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: DisconnectGoogleCalendarInput) => {
    if (!data || typeof data.connectionId !== "string" || !data.connectionId) {
      throw new Error("connectionId richiesto");
    }
    return { connectionId: data.connectionId };
  })
  .handler(
    async ({ data, context }): Promise<DisconnectGoogleCalendarResult> => {
      const { supabase, userId } = context;
      const { data: conn, error: connErr } = await supabase
        .from("calendar_connection_settings" as never)
        .select("id, user_id, metadata")
        .eq("id", data.connectionId)
        .maybeSingle();
      if (connErr || !conn) return { ok: false, reason: "Connessione non trovata" };
      const connRow = conn as unknown as {
        id: string;
        user_id: string;
        metadata: Record<string, unknown> | null;
      };
      if (connRow.user_id !== userId) {
        return { ok: false, reason: "Connessione non autorizzata" };
      }
      const prevMeta = (connRow.metadata ?? {}) as Record<string, unknown>;
      const nextMeta: Record<string, unknown> = {
        ...prevMeta,
        oauth_disconnected_at: new Date().toISOString(),
      };
      delete (nextMeta as Record<string, unknown>).oauth_scopes;
      const { error: updErr } = await supabase
        .from("calendar_connection_settings" as never)
        .update({
          connection_status: "not_configured",
          metadata: nextMeta,
        } as never)
        .eq("id", data.connectionId);
      if (updErr) return { ok: false, reason: "Impossibile disconnettere" };

      try {
        await supabase.from("clipboard_execution_logs").insert({
          user_id: userId,
          clipboard_item_id: null,
          action: "google_calendar_disconnected",
          notes: "Google Calendar disconnesso",
          metadata: { connection_id: data.connectionId },
        } as never);
      } catch {
        // non-blocking
      }
      return { ok: true };
    },
  );

// ============================================================
// Sync: requires re-OAuth (tokens never persisted).
// This server fn alone cannot sync — it returns a status so the
// UI can drive the user back through the OAuth flow.
// ============================================================
export const syncGoogleCalendarEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => {
    if (!data || typeof data.connectionId !== "string" || !data.connectionId) {
      throw new Error("connectionId richiesto");
    }
    return { connectionId: data.connectionId };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { getGoogleCalendarOauthConfig } = await import(
      "@/lib/calendar-oauth.server"
    );
    const cfg = getGoogleCalendarOauthConfig();
    if (!cfg) {
      return {
        ok: false as const,
        reason:
          "Google Calendar OAuth non configurato sul server.",
      };
    }
    const { data: conn } = await supabase
      .from("calendar_connection_settings" as never)
      .select("id,user_id")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (!conn) return { ok: false as const, reason: "Connessione non trovata" };
    const connRow = conn as unknown as { id: string; user_id: string };
    if (connRow.user_id !== userId) {
      return { ok: false as const, reason: "Connessione non autorizzata" };
    }
    // In v3.0 (no refresh tokens) re-sync passa di nuovo per OAuth.
    return {
      ok: true as const,
      requires_reauth: true as const,
      message: "Per sincronizzare nuovamente, autorizza di nuovo Google Calendar.",
    };
  });
