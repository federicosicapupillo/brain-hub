import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// Brain Hub v2.8.1 — Google Drive OAuth (client-callable fns)
// ============================================================
// Real OAuth start + disconnect. Tokens are never persisted in DB.
// The callback (server route /api/public/drive-oauth/callback) does an
// immediate metadata sync and then forgets the access token.
// ============================================================

export type DriveOauthStatus = {
  configured: boolean;
  redirectUri: string | null;
  scope: string;
};

export const getGoogleDriveOauthStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<DriveOauthStatus> => {
    const { getGoogleOauthConfig, DRIVE_OAUTH_SCOPE } = await import(
      "@/lib/drive-oauth.server"
    );
    const cfg = getGoogleOauthConfig();
    return {
      configured: !!cfg,
      redirectUri: cfg?.redirectUri ?? null,
      scope: DRIVE_OAUTH_SCOPE,
    };
  });

export type StartGoogleDriveOauthInput = {
  connectionId: string;
  returnTo?: string | null;
};

export type StartGoogleDriveOauthResult =
  | { ok: true; authUrl: string }
  | { ok: false; reason: string };

export const startGoogleDriveOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: StartGoogleDriveOauthInput) => {
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
    async ({ data, context }): Promise<StartGoogleDriveOauthResult> => {
      const { supabase, userId } = context;
      const { getGoogleOauthConfig, buildGoogleAuthUrl, DRIVE_OAUTH_SCOPE } =
        await import("@/lib/drive-oauth.server");

      const cfg = getGoogleOauthConfig();
      if (!cfg) {
        return {
          ok: false,
          reason:
            "Google OAuth non configurato. Configura GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_OAUTH_REDIRECT_URL.",
        };
      }

      // Verify connection belongs to the user (RLS also enforces).
      const { data: conn, error: connErr } = await supabase
        .from("drive_connection_settings")
        .select("id, user_id, brain_id")
        .eq("id", data.connectionId)
        .maybeSingle();
      if (connErr || !conn) {
        return { ok: false, reason: "Connessione non trovata" };
      }
      const connRow = conn as {
        id: string;
        user_id: string;
        brain_id: string | null;
      };
      if (connRow.user_id !== userId) {
        return { ok: false, reason: "Connessione non autorizzata" };
      }

      // Strong random state token (CSRF protection)
      const stateToken = crypto.randomUUID() + "." + crypto.randomUUID();

      const { error: stateErr } = await supabase
        .from("google_drive_oauth_states")
        .insert({
          state_token: stateToken,
          user_id: userId,
          connection_id: connRow.id,
          brain_id: connRow.brain_id,
          redirect_to: data.returnTo,
          scopes: [DRIVE_OAUTH_SCOPE],
        } as never);
      if (stateErr) {
        return { ok: false, reason: "Impossibile creare state OAuth" };
      }

      const authUrl = buildGoogleAuthUrl(stateToken);
      if (!authUrl) {
        return { ok: false, reason: "Configurazione OAuth incompleta" };
      }
      return { ok: true, authUrl };
    },
  );

export type DisconnectGoogleDriveInput = { connectionId: string };

export type DisconnectGoogleDriveResult = {
  ok: boolean;
  reason?: string;
};

export const disconnectGoogleDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: DisconnectGoogleDriveInput) => {
    if (!data || typeof data.connectionId !== "string" || !data.connectionId) {
      throw new Error("connectionId richiesto");
    }
    return { connectionId: data.connectionId };
  })
  .handler(
    async ({ data, context }): Promise<DisconnectGoogleDriveResult> => {
      const { supabase, userId } = context;

      const { data: conn, error: connErr } = await supabase
        .from("drive_connection_settings")
        .select("id, user_id, metadata")
        .eq("id", data.connectionId)
        .maybeSingle();
      if (connErr || !conn) {
        return { ok: false, reason: "Connessione non trovata" };
      }
      const connRow = conn as {
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
      // Strip any cached oauth metadata (we never store tokens, but be safe).
      delete (nextMeta as Record<string, unknown>).oauth_scopes;
      delete (nextMeta as Record<string, unknown>).oauth_last_sync_files;

      const { error: updErr } = await supabase
        .from("drive_connection_settings")
        .update({
          connection_status: "not_configured",
          metadata: nextMeta,
        } as never)
        .eq("id", data.connectionId);
      if (updErr) {
        return { ok: false, reason: "Impossibile disconnettere" };
      }
      return { ok: true };
    },
  );
