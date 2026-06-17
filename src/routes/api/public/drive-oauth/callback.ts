import { createFileRoute } from "@tanstack/react-router";

// ============================================================
// Brain Hub v2.8.1 — Google Drive OAuth callback (public route)
// ============================================================
// Google redirects here with ?code & ?state. We:
//   1. Look up the state token (service role: callback has no user session)
//   2. Validate it is unused, not expired, bound to a connection
//   3. Exchange code for access_token (server-side only, never logged)
//   4. Immediately call Drive API files.list (metadata only)
//   5. Persist metadata rows in drive_file_map
//   6. Mark connection 'connected' + last_sync_at, store scopes in metadata
//   7. Mark state used, redirect back to /drive-knowledge
//
// We DO NOT persist access_token / refresh_token anywhere.
// Re-sync = re-OAuth.
// ============================================================

function safeRedirect(target: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      "Cache-Control": "no-store",
    },
  });
}

function sanitizeReason(input: unknown): string {
  const s =
    typeof input === "string"
      ? input
      : input instanceof Error
        ? input.message
        : "Errore sconosciuto";
  return s
    .replace(/[?&](code|state|access_token|refresh_token|id_token)=[^&\s]+/gi, "")
    .replace(/(access_token|refresh_token|id_token)[^\s,;]{0,400}/gi, "***")
    .slice(0, 200);
}

export const Route = createFileRoute("/api/public/drive-oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");

        if (oauthError) {
          return safeRedirect(
            `/drive-knowledge?oauth=error&reason=${encodeURIComponent(
              sanitizeReason(oauthError),
            )}`,
          );
        }
        if (!code || !state) {
          return safeRedirect(
            `/drive-knowledge?oauth=error&reason=${encodeURIComponent(
              "Parametri callback mancanti",
            )}`,
          );
        }

        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const {
            exchangeCodeForTokens,
            syncAllDriveFilesMetadata,
            buildDrivePathMap,
            DRIVE_OAUTH_SCOPE,
            MAX_DRIVE_METADATA_FILES,
          } = await import("@/lib/drive-oauth.server");
          const { categorizeDriveFile } = await import("@/lib/drive-knowledge");

          // 1. Lookup state
          const { data: stateRow, error: stateErr } = await supabaseAdmin
            .from("google_drive_oauth_states")
            .select(
              "id, user_id, connection_id, brain_id, redirect_to, scopes, used_at, expires_at",
            )
            .eq("state_token", state)
            .maybeSingle();
          if (stateErr || !stateRow) {
            return safeRedirect(
              `/drive-knowledge?oauth=error&reason=${encodeURIComponent(
                "State OAuth non valido",
              )}`,
            );
          }
          const sRow = stateRow as {
            id: string;
            user_id: string;
            connection_id: string | null;
            brain_id: string | null;
            redirect_to: string | null;
            scopes: string[];
            used_at: string | null;
            expires_at: string;
          };
          if (sRow.used_at) {
            return safeRedirect(
              `/drive-knowledge?oauth=error&reason=${encodeURIComponent(
                "State OAuth già usato",
              )}`,
            );
          }
          if (new Date(sRow.expires_at).getTime() < Date.now()) {
            return safeRedirect(
              `/drive-knowledge?oauth=error&reason=${encodeURIComponent(
                "State OAuth scaduto",
              )}`,
            );
          }
          if (!sRow.connection_id) {
            return safeRedirect(
              `/drive-knowledge?oauth=error&reason=${encodeURIComponent(
                "Connessione non collegata allo state",
              )}`,
            );
          }

          // Mark state as used immediately to prevent replay.
          await supabaseAdmin
            .from("google_drive_oauth_states")
            .update({ used_at: new Date().toISOString() } as never)
            .eq("id", sRow.id);

          // 2. Exchange code (server-side, in-memory only). Tokens never persisted.
          const tokens = await exchangeCodeForTokens(code);
          const grantedScopes = (tokens.scope ?? "").split(" ").filter(Boolean);

          if (!grantedScopes.includes(DRIVE_OAUTH_SCOPE)) {
            return safeRedirect(
              `/drive-knowledge?oauth=error&reason=${encodeURIComponent(
                "Scope autorizzato non sufficiente",
              )}`,
            );
          }

          // 3. Paginated metadata-only sync (capped at MAX_DRIVE_METADATA_FILES).
          const sync = await syncAllDriveFilesMetadata(tokens.access_token, {
            maxFiles: MAX_DRIVE_METADATA_FILES,
            pageSize: 200,
          });
          const pathMap = buildDrivePathMap(sync.files);

          // 4. Upsert metadata rows scoped to the connection owner.
          const nowIso = new Date().toISOString();
          let added = 0;
          let updated = 0;
          for (const f of sync.files) {
            const path = pathMap.get(f.id) ?? f.name;
            const category = categorizeDriveFile({
              name: f.name,
              mime_type: f.mimeType,
              path,
            });
            const sizeBytes = f.size ? Number(f.size) : null;
            const parent = f.parents && f.parents.length > 0 ? f.parents[0] : null;

            const { data: existing } = await supabaseAdmin
              .from("drive_file_map")
              .select("id, metadata")
              .eq("user_id", sRow.user_id)
              .eq("google_file_id", f.id)
              .maybeSingle();

            if (existing) {
              const existingMeta =
                ((existing as { metadata: Record<string, unknown> | null }).metadata ??
                  {}) as Record<string, unknown>;
              await supabaseAdmin
                .from("drive_file_map")
                .update({
                  name: f.name,
                  mime_type: f.mimeType,
                  web_url: f.webViewLink ?? null,
                  icon_url: f.iconLink ?? null,
                  size_bytes: sizeBytes !== null && Number.isFinite(sizeBytes) ? sizeBytes : null,
                  modified_time: f.modifiedTime ?? null,
                  parent_google_file_id: parent,
                  path,
                  category,
                  connection_id: sRow.connection_id,
                  brain_id: sRow.brain_id,
                  metadata: { ...existingMeta, last_metadata_sync_at: nowIso },
                } as never)
                .eq("id", (existing as { id: string }).id);
              updated += 1;
            } else {
              await supabaseAdmin.from("drive_file_map").insert({
                user_id: sRow.user_id,
                brain_id: sRow.brain_id,
                connection_id: sRow.connection_id,
                google_file_id: f.id,
                parent_google_file_id: parent,
                name: f.name,
                mime_type: f.mimeType,
                web_url: f.webViewLink ?? null,
                icon_url: f.iconLink ?? null,
                size_bytes: sizeBytes !== null && Number.isFinite(sizeBytes) ? sizeBytes : null,
                modified_time: f.modifiedTime ?? null,
                path,
                category,
                status: "mapped",
                metadata: { first_metadata_sync_at: nowIso },
              } as never);
              added += 1;
            }
          }

          // 5. Update connection state. Scopes + sync summary in metadata. NO tokens.
          const syncStatus: "completed" | "completed_with_warnings" =
            sync.warnings.length > 0 || sync.reachedLimit
              ? "completed_with_warnings"
              : "completed";
          const { data: connRow } = await supabaseAdmin
            .from("drive_connection_settings")
            .select("metadata")
            .eq("id", sRow.connection_id)
            .maybeSingle();
          const prevMeta = ((connRow as { metadata: Record<string, unknown> } | null)
            ?.metadata ?? {}) as Record<string, unknown>;
          const nextMeta: Record<string, unknown> = {
            ...prevMeta,
            oauth_scopes: grantedScopes,
            oauth_last_sync_at: nowIso,
            last_sync_completed_at: nowIso,
            last_sync_file_count: sync.totalFetched,
            last_sync_files_added: added,
            last_sync_files_updated: updated,
            last_sync_reached_limit: sync.reachedLimit,
            last_sync_warnings: sync.warnings,
            last_sync_status: syncStatus,
          };
          await supabaseAdmin
            .from("drive_connection_settings")
            .update({
              connection_status: "connected",
              last_sync_at: nowIso,
              metadata: nextMeta,
            } as never)
            .eq("id", sRow.connection_id);

          // 6. Log success / warning events (non-blocking, no file names or tokens).
          try {
            await supabaseAdmin.from("clipboard_execution_logs").insert({
              user_id: sRow.user_id,
              clipboard_item_id: null,
              action: "google_drive_oauth_completed",
              notes: "OAuth completato e sync metadata eseguito",
              metadata: {
                connection_id: sRow.connection_id,
                files_processed: sync.totalFetched,
                files_added: added,
                files_updated: updated,
                reached_limit: sync.reachedLimit,
                scopes: grantedScopes,
              },
            } as never);
            await supabaseAdmin.from("clipboard_execution_logs").insert({
              user_id: sRow.user_id,
              clipboard_item_id: null,
              action: "google_drive_metadata_sync_file_count_updated",
              notes: `File mappati: ${sync.totalFetched}`,
              metadata: {
                connection_id: sRow.connection_id,
                file_count: sync.totalFetched,
              },
            } as never);
            if (sync.reachedLimit) {
              await supabaseAdmin.from("clipboard_execution_logs").insert({
                user_id: sRow.user_id,
                clipboard_item_id: null,
                action: "google_drive_metadata_sync_limited",
                notes: `Sync limitata a ${sync.totalFetched} file (cap ${MAX_DRIVE_METADATA_FILES}).`,
                metadata: {
                  connection_id: sRow.connection_id,
                  cap: MAX_DRIVE_METADATA_FILES,
                },
              } as never);
            }
            if (sync.warnings.length > 0) {
              await supabaseAdmin.from("clipboard_execution_logs").insert({
                user_id: sRow.user_id,
                clipboard_item_id: null,
                action: "google_drive_metadata_sync_warning",
                notes: sync.warnings.join(" · ").slice(0, 300),
                metadata: {
                  connection_id: sRow.connection_id,
                  warning_count: sync.warnings.length,
                },
              } as never);
            }
          } catch {
            // non-blocking
          }

          // Forget the access token explicitly (no persistence anywhere).
          const target =
            sRow.redirect_to ??
            `/drive-knowledge?oauth=success&files=${sync.totalFetched}`;
          return safeRedirect(target);
        } catch (err) {
          const reason = sanitizeReason(err);
          // Log failure
          try {
            const { supabaseAdmin } = await import(
              "@/integrations/supabase/client.server"
            );
            await supabaseAdmin.from("clipboard_execution_logs").insert({
              user_id: "00000000-0000-0000-0000-000000000000",
              clipboard_item_id: null,
              action: "google_drive_oauth_failed",
              notes: reason,
              metadata: {},
            } as never);
          } catch {
            // non-blocking
          }
          return safeRedirect(
            `/drive-knowledge?oauth=error&reason=${encodeURIComponent(reason)}`,
          );
        }
      },
    },
  },
});
