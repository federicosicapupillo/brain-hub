// ============================================================
// Brain Hub v3.25.5 — Smart Gmail Sync Scheduler (client hook)
// ============================================================
// Owns the controlled auto-sync loop for Gmail:
//   - real Gmail sync every 5 minutes (server fn refresh_gmail_sync)
//   - manual refresh on demand (button "Aggiorna ora")
//   - lightweight UI status poll every 30s (no Gmail calls, DB only)
//   - hard anti-overlap lock (no concurrent runs)
//   - stops auto-loop on reauth_required (no infinite loop)
//   - never clears local cache on error (cache is preserved)
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { refreshGmailMetadataSyncFn } from "@/lib/gmail-refresh-sync.functions";
import { getGmailSummary, logGmailConnectorEvent } from "@/lib/gmail-connector";
import { supabase } from "@/integrations/supabase/client";

export const GMAIL_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const GMAIL_AUTO_SYNC_SKIP_RECENT_MS = 4 * 60 * 1000; // skip if last < 4 min
export const GMAIL_UI_STATUS_POLL_MS = 30 * 1000; // 30s, UI only

export type GmailAutoSyncRunState =
  | "idle"
  | "running"
  | "error"
  | "reauth_required"
  | "disabled";

export type GmailAutoSyncState = {
  runState: GmailAutoSyncRunState;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastErrorCode: string | null;
  lastSafeMessage: string | null;
  nextAutoCheckAt: string | null;
  requiresReauth: boolean;
  isManualSyncing: boolean;
};

type SafeLogMeta = Record<string, string | number | boolean | null | undefined>;

async function safeLog(event: string, message: string, meta: SafeLogMeta) {
  try {
    await logGmailConnectorEvent(event, message, meta as Record<string, unknown>);
  } catch {
    /* best-effort */
  }
}

export function useGmailAutoSync(brainId: string | null) {
  const queryClient = useQueryClient();
  const refreshFn = useServerFn(refreshGmailMetadataSyncFn);

  // Anti-overlap lock (ref-based so it is not subject to render races).
  const inFlightRef = useRef(false);
  // Stop the auto loop once we detect a reauth requirement.
  const reauthStopRef = useRef(false);
  // Track last sync timestamp (mirrors server, but used for client-side skip).
  const lastSyncAtRef = useRef<string | null>(null);

  const [runState, setRunState] = useState<GmailAutoSyncRunState>("idle");
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null);
  const [lastSafeMessage, setLastSafeMessage] = useState<string | null>(null);
  const [requiresReauth, setRequiresReauth] = useState(false);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [nextAutoCheckAt, setNextAutoCheckAt] = useState<string | null>(null);

  // ---- UI status poll (no Gmail calls) -------------------------------------
  // Reads only the Brain Hub DB-backed summary. Used to update labels in UI.
  const statusQuery = useQuery({
    queryKey: ["gmail-auto-sync-status", brainId],
    queryFn: async () => {
      const s = await getGmailSummary(brainId);
      lastSyncAtRef.current = s.lastSyncAt ?? lastSyncAtRef.current;
      void safeLog("gmail_status_poll_checked", "UI status poll (no Gmail call)", {
        has_connection: !!s.connection,
        connected: s.connected,
        last_sync_status: s.lastSyncStatus,
      });
      return s;
    },
    refetchInterval: GMAIL_UI_STATUS_POLL_MS,
    refetchOnWindowFocus: false,
  });

  const connected = !!statusQuery.data?.connected;

  // ---- Core sync runner with all guards ------------------------------------
  const runSync = useCallback(
    async (
      source: "auto" | "manual" | "on_demand",
    ): Promise<{ ok: boolean; status: string; safe_message?: string }> => {
      // Anti-overlap (client-side, complements server-side sync_lock_until).
      if (inFlightRef.current) {
        void safeLog(
          "gmail_auto_sync_skipped_in_progress",
          "Sync già in corso (lock client)",
          { source },
        );
        return { ok: false, status: "already_in_progress" };
      }
      // Skip if last sync is recent (only for auto / on_demand; manual bypasses).
      if (source !== "manual") {
        const last = lastSyncAtRef.current;
        if (last) {
          const age = Date.now() - new Date(last).getTime();
          if (age < GMAIL_AUTO_SYNC_SKIP_RECENT_MS) {
            void safeLog(
              "gmail_auto_sync_skipped_recent",
              "Sync saltata: ultima esecuzione recente",
              { source, age_ms: age },
            );
            return { ok: true, status: "skipped_recent" };
          }
        }
      }

      inFlightRef.current = true;
      setRunState("running");
      if (source === "manual") {
        setIsManualSyncing(true);
        void safeLog(
          "gmail_manual_sync_triggered",
          "Refresh manuale Gmail richiesto",
          { source },
        );
      } else {
        void safeLog(
          "gmail_auto_sync_started",
          "Avvio sync Gmail automatica",
          { source },
        );
      }

      try {
        const reason =
          source === "manual"
            ? ("user_requested" as const)
            : source === "on_demand"
              ? ("stale_before_read" as const)
              : ("auto" as const);
        const res = await refreshFn({
          data: { brain_id: brainId, mode: "today", reason, force: false },
        });

        if (res.ok && (res.status === "synced" || res.status === "skipped_recent")) {
          setRunState("idle");
          setLastErrorCode(null);
          setLastSafeMessage(res.safe_message ?? null);
          lastSyncAtRef.current =
            res.last_sync_after ?? lastSyncAtRef.current;
          void safeLog(
            "gmail_auto_sync_success",
            "Sync Gmail completata",
            {
              source,
              status: res.status,
              fetched_count: res.fetched_count ?? 0,
              new_messages_count: res.new_messages_count ?? 0,
            },
          );
        } else if (res.status === "reauth_required") {
          reauthStopRef.current = true;
          setRequiresReauth(true);
          setRunState("reauth_required");
          setLastErrorCode("reauth_required");
          setLastSafeMessage(res.safe_message ?? null);
          void safeLog(
            "gmail_auto_sync_stopped_reauth_required",
            "Auto sync fermata: richiesta riconnessione Gmail",
            { source },
          );
        } else if (res.status === "already_in_progress") {
          setRunState("idle");
          void safeLog(
            "gmail_auto_sync_skipped_in_progress",
            "Sync già in corso (server lock)",
            { source },
          );
        } else {
          setRunState("error");
          setLastErrorCode(res.error_code ?? res.status);
          setLastSafeMessage(res.safe_message ?? null);
          void safeLog(
            "gmail_auto_sync_failed",
            "Sync Gmail fallita",
            {
              source,
              status: res.status,
              error_code: res.error_code ?? null,
            },
          );
          // IMPORTANT: never clear local cache here.
        }
        // Invalidate UI summary so labels refresh — does NOT call Gmail.
        void queryClient.invalidateQueries({
          queryKey: ["gmail-auto-sync-status", brainId],
        });
        void queryClient.invalidateQueries({ queryKey: ["gmail-summary", brainId] });
        return {
          ok: !!res.ok,
          status: res.status,
          safe_message: res.safe_message,
        };
      } catch (err) {
        setRunState("error");
        const code =
          (err as Error & { code?: string }).code ?? "client_exception";
        setLastErrorCode(code);
        setLastSafeMessage("Sincronizzazione Gmail non riuscita.");
        void safeLog("gmail_auto_sync_failed", "Eccezione client durante sync", {
          source,
          error_code: code,
        });
        // Cache is preserved (we never delete on error).
        return { ok: false, status: "failed", safe_message: "Sync fallita" };
      } finally {
        inFlightRef.current = false;
        if (source === "manual") setIsManualSyncing(false);
      }
    },
    [brainId, queryClient, refreshFn],
  );

  // ---- Auto-loop (5 minutes) ----------------------------------------------
  useEffect(() => {
    if (!connected) {
      setRunState("disabled");
      return;
    }
    if (reauthStopRef.current) {
      setRunState("reauth_required");
      return;
    }
    // Ensure user session exists before scheduling (no anonymous calls).
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled || !data.user) return;

      const tick = () => {
        if (reauthStopRef.current) return;
        const next = new Date(
          Date.now() + GMAIL_AUTO_SYNC_INTERVAL_MS,
        ).toISOString();
        setNextAutoCheckAt(next);
        void runSync("auto");
      };
      // Schedule the first tick after the interval — do NOT auto-fire on mount
      // to avoid blind polling immediately after navigation.
      setNextAutoCheckAt(
        new Date(Date.now() + GMAIL_AUTO_SYNC_INTERVAL_MS).toISOString(),
      );
      timer = setInterval(tick, GMAIL_AUTO_SYNC_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [connected, runSync]);

  const state: GmailAutoSyncState = {
    runState: reauthStopRef.current
      ? "reauth_required"
      : !connected
        ? "disabled"
        : runState,
    lastSyncAt: statusQuery.data?.lastSyncAt ?? lastSyncAtRef.current ?? null,
    lastSyncStatus: statusQuery.data?.lastSyncStatus ?? null,
    lastErrorCode,
    lastSafeMessage,
    nextAutoCheckAt,
    requiresReauth,
    isManualSyncing,
  };

  return {
    state,
    triggerManualRefresh: () => runSync("manual"),
    refetchStatus: () => statusQuery.refetch(),
  };
}
