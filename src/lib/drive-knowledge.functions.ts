import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// Brain Hub v2.8 — Google Drive metadata sync (server fn)
// ============================================================
// In v2.8 OAuth Google Drive is NOT configured: this server fn returns a
// clear, sanitized failure so the UI can show "OAuth non configurato"
// without faking a sync. The structure is ready for real OAuth in a
// future version (token refresh, scope check, metadata fetch).
//
// HARD CONTRAINTS:
//   - Never download file content.
//   - Never write/modify/delete on Google Drive.
//   - Never log tokens or secrets.
// ============================================================

export type SyncGoogleDriveMetadataInput = {
  connectionId: string;
};

export type SyncGoogleDriveMetadataResult = {
  ok: boolean;
  reason?: string;
  filesProcessed?: number;
  filesAdded?: number;
  filesUpdated?: number;
};

function isOauthConfigured(): boolean {
  // Placeholder check: real OAuth would verify GOOGLE_OAUTH_CLIENT_ID /
  // refresh token storage. Until those are added we always report false.
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  return Boolean(clientId && clientSecret);
}

export const syncGoogleDriveMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: SyncGoogleDriveMetadataInput) => {
    if (!data || typeof data.connectionId !== "string" || !data.connectionId) {
      throw new Error("connectionId richiesto");
    }
    return { connectionId: data.connectionId };
  })
  .handler(async ({ data, context }): Promise<SyncGoogleDriveMetadataResult> => {
    const { supabase, userId } = context;

    // Verify the connection belongs to the calling user (RLS will also enforce).
    const { data: connRow, error: connErr } = await supabase
      .from("drive_connection_settings")
      .select("id, user_id, connection_status")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (connErr) {
      return { ok: false, reason: "Errore lettura connessione" };
    }
    if (!connRow || (connRow as { user_id: string }).user_id !== userId) {
      return { ok: false, reason: "Connessione non trovata" };
    }

    if (!isOauthConfigured()) {
      return {
        ok: false,
        reason:
          "Google OAuth non configurato. Usa l'import manuale di link Drive oppure attiva OAuth in una versione successiva.",
      };
    }

    // Future: fetch via Drive API v3 (metadata only, fields whitelist).
    // For now, signal that real sync is not yet implemented.
    return {
      ok: false,
      reason: "Sync metadata Drive non ancora implementato (v2.8 read-only placeholder).",
    };
  });
