import { createFileRoute } from "@tanstack/react-router";

// ============================================================
// Brain Hub v3.8 — Gmail OAuth callback (public route, read-only)
// ============================================================
// 1. Validate state token (CSRF + expiry).
// 2. Exchange code -> access_token (server only, never logged/stored).
// 3. Refuse if any forbidden scope is granted.
// 4. Fetch Gmail profile.
// 5. Initial sync: list up to 20 recent messages (last 7 days) + parse.
// 6. Upsert message rows; update connection status.
// 7. Redirect to /gmail-connector. Access token is discarded.
// ============================================================

function safeRedirect(target: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: target, "Cache-Control": "no-store" },
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

export const Route = createFileRoute("/api/public/gmail-oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");

        if (oauthError) {
          return safeRedirect(
            `/gmail-connector?oauth=error&reason=${encodeURIComponent(
              sanitizeReason(oauthError),
            )}`,
          );
        }
        if (!code || !state) {
          return safeRedirect(
            `/gmail-connector?oauth=error&reason=${encodeURIComponent(
              "Parametri callback Gmail mancanti",
            )}`,
          );
        }

        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const {
            exchangeGmailCodeForTokens,
            fetchGmailProfile,
            listGmailMessageIds,
            getGmailMessageFull,
            getHeader,
            parseAddressList,
            parseFrom,
            extractBodyPreview,
            GMAIL_OAUTH_SCOPE,
            hasForbiddenGmailScope,
          } = await import("@/lib/gmail-oauth.server");

          // 1) state lookup
          const { data: stateRow } = await supabaseAdmin
            .from("gmail_oauth_states")
            .select(
              "id,user_id,brain_id,connection_id,redirect_path,expires_at,consumed_at,metadata",
            )
            .eq("state_token", state)
            .maybeSingle();
          if (!stateRow) {
            return safeRedirect(
              `/gmail-connector?oauth=error&reason=${encodeURIComponent("State OAuth non valido")}`,
            );
          }
          const sRow = stateRow as {
            id: string;
            user_id: string;
            brain_id: string | null;
            connection_id: string | null;
            redirect_path: string | null;
            expires_at: string;
            consumed_at: string | null;
            metadata: Record<string, unknown> | null;
          };
          if (sRow.consumed_at) {
            return safeRedirect(
              `/gmail-connector?oauth=error&reason=${encodeURIComponent("State OAuth già usato")}`,
            );
          }
          if (new Date(sRow.expires_at).getTime() < Date.now()) {
            return safeRedirect(
              `/gmail-connector?oauth=error&reason=${encodeURIComponent("State OAuth scaduto")}`,
            );
          }
          await supabaseAdmin
            .from("gmail_oauth_states")
            .update({ consumed_at: new Date().toISOString() } as never)
            .eq("id", sRow.id);

          // 2) exchange token
          const tokens = await exchangeGmailCodeForTokens(code);
          const granted = (tokens.scope ?? "").split(" ").filter(Boolean);
          if (hasForbiddenGmailScope(granted)) {
            return safeRedirect(
              `/gmail-connector?oauth=error&reason=${encodeURIComponent(
                "Scope non consentito (richiesto solo gmail.readonly)",
              )}`,
            );
          }
          if (!granted.includes(GMAIL_OAUTH_SCOPE)) {
            return safeRedirect(
              `/gmail-connector?oauth=error&reason=${encodeURIComponent(
                "Scope gmail.readonly non concesso",
              )}`,
            );
          }

          // 3) profile
          const profile = await fetchGmailProfile(tokens.access_token);

          // 4) ensure connection row
          let connectionId = sRow.connection_id;
          if (!connectionId) {
            const { data: ins } = await supabaseAdmin
              .from("gmail_connection_settings")
              .insert({
                user_id: sRow.user_id,
                brain_id: sRow.brain_id,
                status: "connected",
                scopes: [GMAIL_OAUTH_SCOPE],
                google_email: profile.emailAddress,
                connected_at: new Date().toISOString(),
              } as never)
              .select("id")
              .single();
            connectionId = (ins as { id: string }).id;
          }

          // 5) initial sync: prefer state metadata query, else newer_than:7d
          const meta = sRow.metadata ?? {};
          const requestedMax =
            typeof (meta as Record<string, unknown>).sync_max === "number"
              ? Math.min(Math.max((meta as Record<string, number>).sync_max, 1), 50)
              : 20;
          const queryFromState =
            typeof (meta as Record<string, unknown>).sync_query === "string"
              ? ((meta as Record<string, string>).sync_query)
              : null;
          const effectiveQuery = queryFromState ?? "newer_than:7d";

          const ids = await listGmailMessageIds(tokens.access_token, {
            maxResults: requestedMax,
            query: effectiveQuery,
          });

          let added = 0;
          let updated = 0;
          for (const mid of ids) {
            const full = await getGmailMessageFull(tokens.access_token, mid);
            const headers = full.payload?.headers;
            const subject = getHeader(headers, "Subject");
            const fromRaw = getHeader(headers, "From");
            const toRaw = getHeader(headers, "To");
            const ccRaw = getHeader(headers, "Cc");
            const dateRaw = getHeader(headers, "Date");
            const internalDateIso = full.internalDate
              ? new Date(Number(full.internalDate)).toISOString()
              : dateRaw
                ? (() => {
                    const d = new Date(dateRaw);
                    return isNaN(d.getTime()) ? null : d.toISOString();
                  })()
                : null;

            const { email: fromEmail, name: fromName } = parseFrom(fromRaw);
            const toEmails = parseAddressList(toRaw);
            const ccEmails = parseAddressList(ccRaw);
            const { bodyPreview, hasAttachments } = extractBodyPreview(full.payload);
            const labels = full.labelIds ?? [];
            const isUnread = labels.includes("UNREAD");
            const isImportant = labels.includes("IMPORTANT");

            // heuristic classify (inline; light)
            const text = `${subject ?? ""}\n${bodyPreview}`.toLowerCase();
            const from = (fromEmail ?? "").toLowerCase();
            let category = "general";
            let priority = "low";
            if (/^(no[-_.]?reply|noreply)@/.test(from) || /notifica\s+automatica/.test(text)) {
              category = "notification"; priority = "low";
            } else if (/\b(urgente|urgent|scadenza|entro\s+oggi|asap|overdue|problema|errore|critical)\b/.test(text)) {
              category = "urgent"; priority = "high";
            } else if (/\b(fattura|invoice|pagamento|payment|bonifico|saldo)\b/.test(text)) {
              category = "finance"; priority = "high";
            } else if (/\b(richiesta\s+info|preventivo|interessato|immobile|capannone|visita|sopralluogo)\b/.test(text)) {
              category = "lead"; priority = "high";
            } else if (/\b(meeting|call|appuntamento|calendario|invito|riunione|teams|zoom)\b/.test(text)) {
              category = "meeting"; priority = "medium";
            } else if (/\b(puoi|potresti|conferma|confermare|disponibilit[aà]|reply)\b|\?/.test(text)) {
              category = "reply_needed"; priority = "medium";
            }

            const suggestedType =
              category === "urgent" || category === "finance" || category === "lead"
                ? "email_followup"
                : category === "reply_needed" || category === "meeting"
                  ? "email_reply_draft_internal"
                  : "email_review";

            const { data: existing } = await supabaseAdmin
              .from("gmail_message_map")
              .select("id")
              .eq("user_id", sRow.user_id)
              .eq("connection_id", connectionId)
              .eq("gmail_message_id", mid)
              .maybeSingle();

            const row = {
              user_id: sRow.user_id,
              brain_id: sRow.brain_id,
              connection_id: connectionId,
              gmail_message_id: mid,
              gmail_thread_id: full.threadId,
              internal_date: internalDateIso,
              from_email: fromEmail,
              from_name: fromName,
              to_emails: toEmails,
              cc_emails: ccEmails,
              subject: subject ?? null,
              snippet: full.snippet ?? null,
              body_preview: bodyPreview || null,
              label_ids: labels,
              is_unread: isUnread,
              is_important: isImportant,
              has_attachments: hasAttachments,
              detected_category: category,
              detected_priority: priority,
              suggested_action_type: suggestedType,
              source_query: effectiveQuery,
            };

            if (existing) {
              await supabaseAdmin
                .from("gmail_message_map")
                .update(row as never)
                .eq("id", (existing as { id: string }).id);
              updated += 1;
            } else {
              await supabaseAdmin
                .from("gmail_message_map")
                .insert(row as never);
              added += 1;
            }
          }

          // 6) finalize connection
          const nowIso = new Date().toISOString();
          const tokenExpiresAt = tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : null;
          const finalizeUpdate: Record<string, unknown> = {
            status: "connected",
            scopes: [GMAIL_OAUTH_SCOPE],
            google_email: profile.emailAddress,
            connected_at: nowIso,
            last_sync_at: nowIso,
            last_sync_completed_at: nowIso,
            last_sync_status: "completed",
            sync_status: "idle",
            last_sync_error: null,
            last_sync_error_code: null,
            message_count: ids.length,
            token_expires_at: tokenExpiresAt,
          };
          // Persist refresh_token only when Google returns one
          // (offline + consent prompts the user, granting a refresh_token).
          if (tokens.refresh_token) {
            finalizeUpdate.refresh_token = tokens.refresh_token;
          }
          await supabaseAdmin
            .from("gmail_connection_settings")
            .update(finalizeUpdate as never)
            .eq("id", connectionId);

          try {
            await supabaseAdmin.from("clipboard_execution_logs").insert({
              user_id: sRow.user_id,
              clipboard_item_id: null,
              action: "gmail_oauth_connected" as never,
              notes: `Gmail collegato per ${profile.emailAddress}. Sync iniziale: ${ids.length} messaggi.`,
              metadata: {
                connection_id: connectionId,
                files_added: added,
                files_updated: updated,
                scope: GMAIL_OAUTH_SCOPE,
                query: effectiveQuery,
              },
            } as never);
          } catch {
            // non-blocking
          }

          const target =
            sRow.redirect_path ?? `/gmail-connector?oauth=success&count=${ids.length}`;
          return safeRedirect(target);
        } catch (err) {
          const reason = sanitizeReason(err);
          try {
            const { supabaseAdmin } = await import(
              "@/integrations/supabase/client.server"
            );
            await supabaseAdmin.from("clipboard_execution_logs").insert({
              user_id: "00000000-0000-0000-0000-000000000000",
              clipboard_item_id: null,
              action: "gmail_oauth_failed" as never,
              notes: reason,
              metadata: {},
            } as never);
          } catch {
            // non-blocking
          }
          return safeRedirect(
            `/gmail-connector?oauth=error&reason=${encodeURIComponent(reason)}`,
          );
        }
      },
    },
  },
});
