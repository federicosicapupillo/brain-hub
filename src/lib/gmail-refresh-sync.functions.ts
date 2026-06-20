// ============================================================
// Brain Hub v3.22.2 — Gmail Controlled Auto Sync (read-only)
// ============================================================
// Jack-controlled refresh of the local gmail_message_map cache.
// READ-ONLY: only fetches metadata via gmail.readonly scope, never
// archives, never marks read, never sends/forwards/drafts. Writes
// only to Brain Hub DB (gmail_message_map + sync timestamps).
// Refresh tokens are server-only; never returned to the client.
// ============================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { romeStartOfDayIso } from "@/lib/gmail-intelligence.functions";

export type RefreshGmailMetadataSyncInput = {
  brain_id?: string | null;
  mode?: "today" | "recent";
  reason?: "user_requested" | "stale_before_read" | "manual_debug";
  force?: boolean;
};

export type RefreshGmailMetadataSyncResult = {
  ok: boolean;
  status:
    | "synced"
    | "skipped_recent"
    | "already_in_progress"
    | "not_connected"
    | "reauth_required"
    | "config_missing"
    | "migration_missing"
    | "google_api_error"
    | "db_error"
    | "failed";
  connection_id_hash?: string;
  last_sync_before?: string | null;
  last_sync_after?: string | null;
  fetched_count?: number;
  upserted_count?: number;
  new_messages_count?: number;
  updated_messages_count?: number;
  today_count_after?: number;
  unread_count_after?: number;
  sync_window?: { start: string; end: string };
  error_code?: string;
  safe_message?: string;
  mode?: "today" | "recent";
  reason?: string;
};

const COOLDOWN_MS = 2 * 60 * 1000;
const LOCK_TIMEOUT_MS = 60 * 1000;

function hashId(id: string): string {
  // Short non-reversible identifier for logs.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return `c_${Math.abs(h).toString(36)}`;
}

async function logEvt(
  supabase: unknown,
  userId: string,
  event: string,
  metadata: Record<string, unknown>,
) {
  try {
    await (
      supabase as {
        from: (t: string) => {
          insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      }
    )
      .from("agent_event_log")
      .insert({ user_id: userId, event_type: event, metadata });
  } catch {
    /* best-effort */
  }
}

export const refreshGmailMetadataSyncFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: RefreshGmailMetadataSyncInput | undefined) => ({
    brain_id:
      d && typeof d.brain_id === "string" && d.brain_id ? d.brain_id : null,
    mode: (d?.mode === "recent" ? "recent" : "today") as "today" | "recent",
    reason: (d?.reason ?? "user_requested") as
      | "user_requested"
      | "stale_before_read"
      | "manual_debug",
    force: d?.force === true,
  }))
  .handler(async ({ data, context }): Promise<RefreshGmailMetadataSyncResult> =>
    runRefreshGmailMetadataSyncCore(context.supabase, context.userId, data),
  );

// Brain Hub v3.23.3 — extracted core so the public UI Operator surface
// endpoint can reuse the same sync logic with supabaseAdmin.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runRefreshGmailMetadataSyncCore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  data: {
    brain_id: string | null;
    mode: "today" | "recent";
    reason: "user_requested" | "stale_before_read" | "manual_debug";
    force: boolean;
  },
): Promise<RefreshGmailMetadataSyncResult> {
    const { mode, reason, force } = data;

    const safeFail = (
      status: RefreshGmailMetadataSyncResult["status"],
      safe_message: string,
      extras: Partial<RefreshGmailMetadataSyncResult> = {},
    ): RefreshGmailMetadataSyncResult => ({
      ok: false,
      status,
      safe_message,
      mode,
      reason,
      ...extras,
    });

    try {
    void logEvt(supabase, userId, "jack_gmail_sync_requested", {
      mode,
      reason,
      brain_id: data.brain_id,
      force,
    });

    // 0) Quick OAuth env check
    const hasOauthCfg = !!(
      (process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID) &&
      (process.env.GOOGLE_CLIENT_SECRET ||
        process.env.GOOGLE_OAUTH_CLIENT_SECRET) &&
      (process.env.GMAIL_OAUTH_REDIRECT_URL ||
        process.env.GOOGLE_OAUTH_REDIRECT_URL ||
        process.env.GOOGLE_OAUTH_REDIRECT_URI)
    );
    if (!hasOauthCfg) {
      void logEvt(supabase, userId, "jack_gmail_sync_config_missing", {
        reason,
      });
      return safeFail(
        "config_missing",
        "Configurazione Google OAuth incompleta.",
        { error_code: "config_missing" },
      );
    }

    // 1) Locate user's gmail connection (best-effort: most recent connected)
    type ConnRow = {
      id: string;
      status: string;
      refresh_token: string | null;
      last_sync_at: string | null;
      last_sync_started_at: string | null;
      last_sync_completed_at: string | null;
      sync_lock_until: string | null;
    };
    let q = supabase
      .from("gmail_connection_settings")
      .select(
        "id,status,refresh_token,last_sync_at,last_sync_started_at,last_sync_completed_at,sync_lock_until",
      )
      .eq("user_id", userId)
      .order("connected_at", { ascending: false });
    if (data.brain_id) q = q.eq("brain_id", data.brain_id);
    const { data: conns, error: connsErr } = await q;
    if (connsErr) {
      const msg = String(connsErr.message ?? "").toLowerCase();
      const code = String((connsErr as { code?: string }).code ?? "");
      const isMissingColumn =
        code === "42703" ||
        code === "PGRST204" ||
        msg.includes("does not exist") ||
        msg.includes("column");
      if (isMissingColumn) {
        void logEvt(supabase, userId, "jack_gmail_sync_migration_missing", {
          reason,
          error_code: code || "missing_column",
        });
        return safeFail(
          "migration_missing",
          "La migration Gmail sync non risulta applicata correttamente.",
          { error_code: "migration_missing" },
        );
      }
      void logEvt(supabase, userId, "jack_gmail_sync_db_error", {
        reason,
        error_code: code || "db_error",
      });
      return safeFail("db_error", "Errore database Gmail.", {
        error_code: "db_error",
      });
    }
    const list = ((conns ?? []) as unknown as ConnRow[]).filter(
      (c) => c.status === "connected",
    );
    const conn = list[0] ?? null;

    if (!conn) {
      void logEvt(supabase, userId, "jack_gmail_sync_failed", {
        error_code: "not_connected",
        reason,
      });
      return safeFail("not_connected", "Gmail non è collegato.");
    }

    const connHash = hashId(conn.id);

    // 2) Refresh token presence
    if (!conn.refresh_token) {
      void logEvt(supabase, userId, "jack_gmail_sync_reauth_required", {
        connection_id_hash: connHash,
        reason,
      });
      return {
        ok: false,
        status: "reauth_required",
        connection_id_hash: connHash,
        last_sync_before: conn.last_sync_at,
        safe_message:
          "Per sincronizzare automaticamente Gmail serve ricollegare l'account (autorizzazione offline mancante).",
        mode,
        reason,
      };
    }

    const now = Date.now();

    // 3) Cooldown / lock
    if (!force) {
      if (
        conn.sync_lock_until &&
        new Date(conn.sync_lock_until).getTime() > now
      ) {
        void logEvt(
          supabase,
          userId,
          "jack_gmail_sync_already_in_progress",
          { connection_id_hash: connHash, reason },
        );
        return {
          ok: false,
          status: "already_in_progress",
          connection_id_hash: connHash,
          last_sync_before: conn.last_sync_at,
          safe_message: "Sincronizzazione Gmail già in corso.",
          mode,
          reason,
        };
      }
      const lastDone = conn.last_sync_completed_at ?? conn.last_sync_at;
      if (lastDone && now - new Date(lastDone).getTime() < COOLDOWN_MS) {
        void logEvt(supabase, userId, "jack_gmail_sync_skipped_recent", {
          connection_id_hash: connHash,
          last_sync_at: lastDone,
          reason,
        });
        return {
          ok: true,
          status: "skipped_recent",
          connection_id_hash: connHash,
          last_sync_before: lastDone,
          last_sync_after: lastDone,
          safe_message: "Gmail è già stato sincronizzato da poco.",
          mode,
          reason,
        };
      }
    }

    // 4) Acquire lock
    const lockUntil = new Date(now + LOCK_TIMEOUT_MS).toISOString();
    const startedAt = new Date(now).toISOString();
    await supabase
      .from("gmail_connection_settings")
      .update({
        sync_lock_until: lockUntil,
        sync_status: "running",
        last_sync_started_at: startedAt,
      } as never)
      .eq("id", conn.id);

    void logEvt(supabase, userId, "jack_gmail_sync_started", {
      connection_id_hash: connHash,
      mode,
      reason,
    });

    // 5) Refresh access token + fetch messages
    try {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      const {
        refreshGmailAccessToken,
        listGmailMessageIds,
        getGmailMessageFull,
        getHeader,
        parseAddressList,
        parseFrom,
        extractBodyPreview,
      } = await import("@/lib/gmail-oauth.server");

      const tokens = await refreshGmailAccessToken(conn.refresh_token);
      const accessToken = tokens.access_token;
      const newExpiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null;

      const windowStart =
        mode === "today"
          ? romeStartOfDayIso(0)
          : new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const windowEnd = new Date().toISOString();
      const query = mode === "today" ? "newer_than:1d" : "newer_than:2d";
      const maxResults = mode === "today" ? 100 : 200;

      const ids = await listGmailMessageIds(accessToken, {
        maxResults,
        query,
      });

      let added = 0;
      let updated = 0;

      for (const mid of ids) {
        const full = await getGmailMessageFull(accessToken, mid);
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

        const text = `${subject ?? ""}\n${bodyPreview}`.toLowerCase();
        const from = (fromEmail ?? "").toLowerCase();
        let category = "general";
        let priority = "low";
        if (/^(no[-_.]?reply|noreply)@/.test(from)) {
          category = "notification";
          priority = "low";
        } else if (
          /\b(urgente|urgent|scadenza|entro\s+oggi|asap|overdue|problema|errore|critical)\b/.test(
            text,
          )
        ) {
          category = "urgent";
          priority = "high";
        } else if (
          /\b(fattura|invoice|pagamento|payment|bonifico|saldo)\b/.test(text)
        ) {
          category = "finance";
          priority = "high";
        } else if (
          /\b(meeting|call|appuntamento|calendario|invito|riunione|teams|zoom)\b/.test(
            text,
          )
        ) {
          category = "meeting";
          priority = "medium";
        } else if (
          /\b(puoi|potresti|conferma|confermare|disponibilit[aà]|reply)\b|\?/.test(
            text,
          )
        ) {
          category = "reply_needed";
          priority = "medium";
        }

        const suggestedType =
          category === "urgent" || category === "finance"
            ? "email_followup"
            : category === "reply_needed" || category === "meeting"
              ? "email_reply_draft_internal"
              : "email_review";

        const { data: existing } = await supabaseAdmin
          .from("gmail_message_map")
          .select("id")
          .eq("user_id", userId)
          .eq("connection_id", conn.id)
          .eq("gmail_message_id", mid)
          .maybeSingle();

        const row = {
          user_id: userId,
          brain_id: data.brain_id,
          connection_id: conn.id,
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
          source_query: query,
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

      const completedIso = new Date().toISOString();
      await supabase
        .from("gmail_connection_settings")
        .update({
          last_sync_at: completedIso,
          last_sync_completed_at: completedIso,
          last_sync_status: "completed",
          last_sync_error: null,
          last_sync_error_code: null,
          last_sync_error_at: null,
          sync_status: "idle",
          sync_lock_until: null,
          token_expires_at: newExpiresAt,
        } as never)
        .eq("id", conn.id);

      // Post counts (today)
      const todayIso = romeStartOfDayIso(0);
      const [tToday, tUnread] = await Promise.all([
        supabase
          .from("gmail_message_map")
          .select("id", { count: "exact", head: true })
          .eq("connection_id", conn.id)
          .gte("internal_date", todayIso),
        supabase
          .from("gmail_message_map")
          .select("id", { count: "exact", head: true })
          .eq("connection_id", conn.id)
          .eq("is_unread", true),
      ]);

      void logEvt(supabase, userId, "jack_gmail_sync_completed", {
        connection_id_hash: connHash,
        mode,
        reason,
        fetched: ids.length,
        new_messages: added,
        updated_messages: updated,
      });

      return {
        ok: true,
        status: "synced",
        connection_id_hash: connHash,
        last_sync_before: conn.last_sync_at,
        last_sync_after: completedIso,
        fetched_count: ids.length,
        upserted_count: added + updated,
        new_messages_count: added,
        updated_messages_count: updated,
        today_count_after: tToday.count ?? 0,
        unread_count_after: tUnread.count ?? 0,
        sync_window: { start: windowStart, end: windowEnd },
        mode,
        reason,
        safe_message: `Sincronizzati ${added + updated} messaggi (${added} nuovi).`,
      };
    } catch (err) {
      const errAny = err as Error & { status?: number; code?: string };
      const tagged = errAny.code;
      const msg = String(errAny.message ?? "").toLowerCase();
      let status: RefreshGmailMetadataSyncResult["status"];
      let errCode: string;
      let safeMessage: string;
      if (tagged === "reauth_required" || errAny.status === 401) {
        status = "reauth_required";
        errCode = "reauth_required";
        safeMessage =
          "Non riesco a sincronizzare Gmail perché serve ricollegare l'account.";
      } else if (tagged === "config_missing") {
        status = "config_missing";
        errCode = "config_missing";
        safeMessage = "Configurazione Google OAuth incompleta.";
      } else if (tagged === "google_api_error") {
        status = "google_api_error";
        errCode = "google_api_error";
        safeMessage = "Errore Gmail API durante la sincronizzazione.";
      } else if (
        msg.includes("does not exist") &&
        msg.includes("column")
      ) {
        status = "migration_missing";
        errCode = "migration_missing";
        safeMessage =
          "La migration Gmail sync non risulta applicata correttamente.";
      } else {
        status = "failed";
        errCode = "sync_failed";
        safeMessage = "Sincronizzazione Gmail non riuscita.";
      }
      const errAt = new Date().toISOString();
      try {
        await supabase
          .from("gmail_connection_settings")
          .update({
            sync_lock_until: null,
            sync_status: "error",
            last_sync_status: "failed",
            last_sync_error: String(errAny.message ?? "").slice(0, 200),
            last_sync_error_code: errCode,
            last_sync_error_at: errAt,
          } as never)
          .eq("id", conn.id);
      } catch {
        /* best-effort */
      }
      const evt =
        status === "reauth_required"
          ? "jack_gmail_sync_reauth_required"
          : status === "google_api_error"
            ? "jack_gmail_sync_google_api_error"
            : status === "migration_missing"
              ? "jack_gmail_sync_migration_missing"
              : "jack_gmail_sync_failed";
      void logEvt(supabase, userId, evt, {
        connection_id_hash: connHash,
        mode,
        reason,
        error_code: errCode,
        has_refresh_token: !!conn.refresh_token,
        last_sync_at: conn.last_sync_at,
      });
      return safeFail(status, safeMessage, {
        connection_id_hash: connHash,
        last_sync_before: conn.last_sync_at,
        error_code: errCode,
      });
    }
    } catch (outerErr) {
      const e = outerErr as Error & { code?: string };
      void logEvt(supabase, userId, "jack_gmail_sync_tool_error_caught", {
        mode,
        reason,
        error_code: e.code ?? "unhandled",
      });
      return safeFail("failed", "Sincronizzazione Gmail non riuscita.", {
        error_code: "unhandled",
      });
    }
  });
