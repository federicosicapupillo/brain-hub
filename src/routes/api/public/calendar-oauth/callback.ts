import { createFileRoute } from "@tanstack/react-router";

// ============================================================
// Brain Hub v3.0 — Google Calendar OAuth callback (public route)
// ============================================================
// READ-ONLY. We never write to Google Calendar.
// We never persist access/refresh tokens.
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

export const Route = createFileRoute("/api/public/calendar-oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");

        if (oauthError) {
          return safeRedirect(
            `/calendar-knowledge?oauth=error&reason=${encodeURIComponent(
              sanitizeReason(oauthError),
            )}`,
          );
        }
        if (!code || !state) {
          return safeRedirect(
            `/calendar-knowledge?oauth=error&reason=${encodeURIComponent(
              "Parametri callback mancanti",
            )}`,
          );
        }

        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const {
            exchangeCalendarCodeForTokens,
            listUserCalendarsReadOnly,
            listCalendarEventsReadOnly,
            startDateOfEvent,
            endDateOfEvent,
            sanitizeEventText,
            CALENDAR_OAUTH_SCOPE,
          } = await import("@/lib/calendar-oauth.server");

          // 1) Lookup state
          const { data: stateRow, error: stateErr } = await supabaseAdmin
            .from("google_calendar_oauth_states" as never)
            .select(
              "id, user_id, connection_id, brain_id, redirect_to, scopes, used_at, expires_at",
            )
            .eq("state_token", state)
            .maybeSingle();
          if (stateErr || !stateRow) {
            return safeRedirect(
              `/calendar-knowledge?oauth=error&reason=${encodeURIComponent(
                "State OAuth non valido",
              )}`,
            );
          }
          const sRow = stateRow as unknown as {
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
              `/calendar-knowledge?oauth=error&reason=${encodeURIComponent(
                "State OAuth già usato",
              )}`,
            );
          }
          if (new Date(sRow.expires_at).getTime() < Date.now()) {
            return safeRedirect(
              `/calendar-knowledge?oauth=error&reason=${encodeURIComponent(
                "State OAuth scaduto",
              )}`,
            );
          }
          if (!sRow.connection_id) {
            return safeRedirect(
              `/calendar-knowledge?oauth=error&reason=${encodeURIComponent(
                "Connessione non collegata allo state",
              )}`,
            );
          }

          // Mark state used to prevent replay.
          await supabaseAdmin
            .from("google_calendar_oauth_states" as never)
            .update({ used_at: new Date().toISOString() } as never)
            .eq("id", sRow.id);

          // 2) Exchange code (server-side only, never logged)
          const tokens = await exchangeCalendarCodeForTokens(code);
          const grantedScopes = (tokens.scope ?? "").split(" ").filter(Boolean);
          if (!grantedScopes.includes(CALENDAR_OAUTH_SCOPE)) {
            return safeRedirect(
              `/calendar-knowledge?oauth=error&reason=${encodeURIComponent(
                "Scope Calendar non sufficiente",
              )}`,
            );
          }

          // 3) Read calendars list + events (READ-ONLY API GETs).
          const calendars = await listUserCalendarsReadOnly(tokens.access_token);
          const nowIso = new Date().toISOString();
          let totalEvents = 0;
          let inserted = 0;
          let updated = 0;
          const allWarnings: string[] = [];

          for (const cal of calendars) {
            const { events, warnings } = await listCalendarEventsReadOnly(
              tokens.access_token,
              cal.id,
              { timeMinIso: nowIso, maxResults: 200 },
            );
            allWarnings.push(...warnings);
            for (const ev of events) {
              totalEvents += 1;
              const start = startDateOfEvent(ev);
              const end = endDateOfEvent(ev);
              const attendeesCount = ev.attendees?.length ?? null;
              const title = sanitizeEventText(ev.summary, 240) ?? "(senza titolo)";
              const description = sanitizeEventText(ev.description, 1000);
              const location = sanitizeEventText(ev.location, 240);

              const { data: existing } = await supabaseAdmin
                .from("calendar_event_map" as never)
                .select("id")
                .eq("user_id", sRow.user_id)
                .eq("google_calendar_id", cal.id)
                .eq("google_event_id", ev.id)
                .maybeSingle();

              if (existing) {
                await supabaseAdmin
                  .from("calendar_event_map" as never)
                  .update({
                    connection_id: sRow.connection_id,
                    brain_id: sRow.brain_id,
                    calendar_name: cal.summary ?? null,
                    title,
                    description,
                    location,
                    start_at: start,
                    end_at: end,
                    status: ev.status ?? null,
                    event_type: ev.eventType ?? null,
                    hangout_link: ev.hangoutLink ?? null,
                    html_link: ev.htmlLink ?? null,
                    attendees_count: attendeesCount,
                    metadata: { last_sync_at: nowIso },
                  } as never)
                  .eq("id", (existing as { id: string }).id);
                updated += 1;
              } else {
                await supabaseAdmin
                  .from("calendar_event_map" as never)
                  .insert({
                    user_id: sRow.user_id,
                    brain_id: sRow.brain_id,
                    connection_id: sRow.connection_id,
                    google_calendar_id: cal.id,
                    google_event_id: ev.id,
                    calendar_name: cal.summary ?? null,
                    title,
                    description,
                    location,
                    start_at: start,
                    end_at: end,
                    status: ev.status ?? null,
                    event_type: ev.eventType ?? null,
                    hangout_link: ev.hangoutLink ?? null,
                    html_link: ev.htmlLink ?? null,
                    attendees_count: attendeesCount,
                    metadata: { first_sync_at: nowIso },
                  } as never);
                inserted += 1;
              }
            }
          }

          // 4) Update connection state. Scopes only in metadata; NO tokens stored.
          const syncStatus: "completed" | "completed_with_warnings" =
            allWarnings.length > 0 ? "completed_with_warnings" : "completed";
          const { data: connRow } = await supabaseAdmin
            .from("calendar_connection_settings" as never)
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
            last_sync_calendar_count: calendars.length,
            last_sync_event_count: totalEvents,
            last_sync_inserted: inserted,
            last_sync_updated: updated,
            last_sync_warnings: allWarnings,
            last_sync_status: syncStatus,
          };
          await supabaseAdmin
            .from("calendar_connection_settings" as never)
            .update({
              connection_status: "connected",
              last_sync_at: nowIso,
              scopes: grantedScopes,
              metadata: nextMeta,
            } as never)
            .eq("id", sRow.connection_id);

          // 5) Log success (no event titles, no tokens).
          try {
            await supabaseAdmin.from("clipboard_execution_logs").insert({
              user_id: sRow.user_id,
              clipboard_item_id: null,
              action: "google_calendar_oauth_completed",
              notes: "OAuth Calendar completato e sync iniziale eseguito",
              metadata: {
                connection_id: sRow.connection_id,
                calendars: calendars.length,
                events: totalEvents,
                inserted,
                updated,
              },
            } as never);
            await supabaseAdmin.from("clipboard_execution_logs").insert({
              user_id: sRow.user_id,
              clipboard_item_id: null,
              action: "google_calendar_sync_completed",
              notes: `Sync Calendar: ${totalEvents} eventi (${inserted} nuovi, ${updated} agg.)`,
              metadata: {
                connection_id: sRow.connection_id,
                events: totalEvents,
                warnings: allWarnings.length,
              },
            } as never);
          } catch {
            // non-blocking
          }

          // Forget access_token implicitly (out of scope).
          const target =
            sRow.redirect_to ??
            `/calendar-knowledge?oauth=success&events=${totalEvents}`;
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
              action: "google_calendar_oauth_failed",
              notes: reason,
              metadata: {},
            } as never);
          } catch {
            // non-blocking
          }
          return safeRedirect(
            `/calendar-knowledge?oauth=error&reason=${encodeURIComponent(reason)}`,
          );
        }
      },
    },
  },
});
