import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// Brain Hub v2.8.1 — Google Drive metadata sync (server fn)
// ============================================================
// In v2.8.1 we DO NOT persist OAuth tokens. Re-sync = re-OAuth.
// This function returns an authUrl for the UI to redirect the user
// through the consent screen (usually silent if already granted),
// after which the public callback route performs the actual
// metadata-only sync server-side and forgets the access token.
//
// HARD CONSTRAINTS:
//   - Never download file content.
//   - Never write/modify/delete on Google Drive.
//   - Never log tokens or secrets.
// ============================================================

export type SyncGoogleDriveMetadataInput = {
  connectionId: string;
  returnTo?: string | null;
};

export type SyncGoogleDriveMetadataResult = {
  ok: boolean;
  reason?: string;
  authUrl?: string;
  filesProcessed?: number;
  filesAdded?: number;
  filesUpdated?: number;
};

export const syncGoogleDriveMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: SyncGoogleDriveMetadataInput) => {
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
  .handler(async ({ data, context }): Promise<SyncGoogleDriveMetadataResult> => {
    const { supabase, userId } = context;
    const { getGoogleOauthConfig, buildGoogleAuthUrl, DRIVE_OAUTH_SCOPE } =
      await import("@/lib/drive-oauth.server");

    // Verify connection ownership (RLS also enforces).
    const { data: connRow, error: connErr } = await supabase
      .from("drive_connection_settings")
      .select("id, user_id, brain_id")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (connErr) {
      return { ok: false, reason: "Errore lettura connessione" };
    }
    if (!connRow || (connRow as { user_id: string }).user_id !== userId) {
      return { ok: false, reason: "Connessione non trovata" };
    }
    const conn = connRow as {
      id: string;
      user_id: string;
      brain_id: string | null;
    };

    if (!getGoogleOauthConfig()) {
      return {
        ok: false,
        reason:
          "Google OAuth non configurato. Usa l'import manuale di link Drive oppure configura GOOGLE_CLIENT_ID/SECRET.",
      };
    }

    // Mint a fresh state and return an authUrl. The UI redirects there;
    // Google bounces to /api/public/drive-oauth/callback which performs
    // the actual sync server-side and forgets the access token.
    const stateToken = crypto.randomUUID() + "." + crypto.randomUUID();
    const { error: stateErr } = await supabase
      .from("google_drive_oauth_states")
      .insert({
        state_token: stateToken,
        user_id: userId,
        connection_id: conn.id,
        brain_id: conn.brain_id,
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
    return {
      ok: false,
      authUrl,
      reason:
        "Per sincronizzare i metadata Brain Hub ti reindirizza a Google (read-only). I token non vengono memorizzati.",
    };
  });
