// ============================================================
// Brain Hub v3.25.6 — Global Gmail Auto Sync Context
// ============================================================
// Source of truth for the Smart Gmail Sync Scheduler.
// Mounted once inside the authenticated layout so the 5-minute
// auto sync keeps the local cache fresh on every page (Dashboard,
// Action Queue, Jack Voice, Operating Dashboard, ...), not only
// on the Gmail Connector page.
//
// Consumers must read state via useGmailAutoSyncContext() instead
// of calling useGmailAutoSync() again — that would spin up a second
// interval and duplicate Gmail traffic.
// ============================================================

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import {
  useGmailAutoSync,
  type GmailAutoSyncState,
} from "@/hooks/use-gmail-auto-sync";
import { logGmailConnectorEvent } from "@/lib/gmail-connector";

export type GmailAutoSyncContextValue = {
  // Boolean facade (derived from runState) for convenient UI checks.
  isAutoSyncEnabled: boolean;
  isSyncing: boolean;
  lastSyncAt: string | null;
  nextAutoSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  requiresReauth: boolean;
  // Full state object for components that already use the v3.25.5 shape.
  state: GmailAutoSyncState;
  triggerManualSync: () => Promise<unknown>;
};

const GmailAutoSyncContext = createContext<GmailAutoSyncContextValue | null>(null);

type ProviderProps = {
  children: ReactNode;
  /**
   * Optional brain scope. When null/undefined the scheduler targets the
   * user's most recently connected Gmail account (same behavior Jack uses).
   * Do NOT invent a brainId here — pass through whatever the upper layer
   * resolved or leave it null.
   */
  brainId?: string | null;
};

export function GmailAutoSyncProvider({ children, brainId = null }: ProviderProps) {
  const { state, triggerManualRefresh } = useGmailAutoSync(brainId ?? null);

  useEffect(() => {
    void logGmailConnectorEvent(
      "gmail_auto_sync_provider_mounted",
      "Provider globale Gmail Auto Sync montato",
      { has_brain_scope: !!brainId },
    );
    return () => {
      void logGmailConnectorEvent(
        "gmail_auto_sync_provider_unmounted",
        "Provider globale Gmail Auto Sync smontato",
        { has_brain_scope: !!brainId },
      );
    };
  }, [brainId]);

  const value = useMemo<GmailAutoSyncContextValue>(
    () => ({
      isAutoSyncEnabled:
        state.runState !== "disabled" && state.runState !== "reauth_required",
      isSyncing: state.runState === "running" || state.isManualSyncing,
      lastSyncAt: state.lastSyncAt,
      nextAutoSyncAt: state.nextAutoCheckAt,
      lastSyncStatus: state.lastSyncStatus,
      lastSyncError: state.lastErrorCode,
      requiresReauth: state.requiresReauth,
      state,
      triggerManualSync: triggerManualRefresh,
    }),
    [state, triggerManualRefresh],
  );

  return (
    <GmailAutoSyncContext.Provider value={value}>
      {children}
    </GmailAutoSyncContext.Provider>
  );
}

/**
 * Read the global Gmail Auto Sync state.
 * Returns null if called outside the provider — callers can render a no-op
 * fallback in that case (e.g. unauthenticated routes).
 */
export function useGmailAutoSyncContext(): GmailAutoSyncContextValue | null {
  return useContext(GmailAutoSyncContext);
}

/**
 * Strict variant: throws if not mounted. Use inside _authenticated/* code
 * that always runs under the provider.
 */
export function useGmailAutoSyncContextStrict(): GmailAutoSyncContextValue {
  const ctx = useContext(GmailAutoSyncContext);
  if (!ctx) {
    throw new Error(
      "useGmailAutoSyncContextStrict must be used inside <GmailAutoSyncProvider>",
    );
  }
  return ctx;
}
