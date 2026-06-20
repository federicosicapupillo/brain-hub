// Brain Hub v3.23.3 — UI Operator Controlled Surface (server-only).
// Public-facing helper that exposes only minimal, sanitized data for the
// runner UI Operator. Never returns refresh tokens, access tokens, full
// email bodies, or user PII beyond the minimum needed by the surface.

export type UiOperatorSurfaceName =
  | "gmail_connector"
  | "action_queue"
  | "project_console"
  | "master_snapshot"
  | "loop_qa";

export type SurfaceActionKey =
  | "gmail_check_status"
  | "gmail_refresh_metadata"
  | "gmail_get_brief"
  | "gmail_open_reconnect";

export type SurfaceActionRisk = "low" | "medium" | "high";

export const SURFACE_ROUTE_MAP: Record<string, UiOperatorSurfaceName> = {
  "/gmail-connector": "gmail_connector",
  "/action-queue": "action_queue",
  "/project-console": "project_console",
  "/master-snapshot": "master_snapshot",
  "/loop-qa": "loop_qa",
};

export const SURFACE_TO_ROUTE: Record<UiOperatorSurfaceName, string> = {
  gmail_connector: "/gmail-connector",
  action_queue: "/action-queue",
  project_console: "/project-console",
  master_snapshot: "/master-snapshot",
  loop_qa: "/loop-qa",
};

export const SUPPORTED_SURFACES: ReadonlyArray<UiOperatorSurfaceName> = [
  "gmail_connector",
];

export interface SurfaceActionDescriptor {
  key: SurfaceActionKey;
  surface: UiOperatorSurfaceName;
  title: string;
  risk: SurfaceActionRisk;
  requires_confirmation: boolean;
  internal_action_type:
    | "read_state"
    | "click_sync"
    | "open_route"
    | "prepare_action";
}

export const SURFACE_ACTIONS: ReadonlyArray<SurfaceActionDescriptor> = [
  {
    key: "gmail_check_status",
    surface: "gmail_connector",
    title: "Controlla stato Gmail",
    risk: "low",
    requires_confirmation: false,
    internal_action_type: "read_state",
  },
  {
    key: "gmail_get_brief",
    surface: "gmail_connector",
    title: "Leggi brief email aggiornato",
    risk: "low",
    requires_confirmation: false,
    internal_action_type: "read_state",
  },
  {
    key: "gmail_open_reconnect",
    surface: "gmail_connector",
    title: "Apri ricollegamento Gmail",
    risk: "low",
    requires_confirmation: false,
    internal_action_type: "open_route",
  },
  {
    key: "gmail_refresh_metadata",
    surface: "gmail_connector",
    title: "Sincronizza metadati Gmail",
    risk: "medium",
    requires_confirmation: true,
    internal_action_type: "click_sync",
  },
];

export function getSurfaceActions(
  surface: UiOperatorSurfaceName,
): SurfaceActionDescriptor[] {
  return SURFACE_ACTIONS.filter((a) => a.surface === surface);
}

export function findSurfaceAction(
  key: string,
): SurfaceActionDescriptor | null {
  return SURFACE_ACTIONS.find((a) => a.key === key) ?? null;
}

export function routeToSurface(route: string): UiOperatorSurfaceName | null {
  const path = route.split("?")[0]?.split("#")[0] ?? "";
  return SURFACE_ROUTE_MAP[path] ?? null;
}

export function isSupportedSurface(name: string): name is UiOperatorSurfaceName {
  return (SUPPORTED_SURFACES as ReadonlyArray<string>).includes(name);
}

// ---------- session validation ----------

export interface ValidatedSurfaceSession {
  ok: boolean;
  reason: string | null;
  session_id: string | null;
  user_id: string | null;
  brain_id: string | null;
  status: string | null;
  target_route: string | null;
}

const ACTIVE_SESSION_STATUSES = new Set([
  "created",
  "active",
  "navigating",
  "observing",
  "proposing",
  "awaiting_confirmation",
  "executing",
]);

export async function validateSurfaceSession(
  sessionId: string,
): Promise<ValidatedSurfaceSession> {
  if (!sessionId || typeof sessionId !== "string") {
    return {
      ok: false,
      reason: "session_id_missing",
      session_id: null,
      user_id: null,
      brain_id: null,
      status: null,
      target_route: null,
    };
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("ui_operator_sessions")
      .select("id, user_id, brain_id, status, target_route, ended_at")
      .eq("id", sessionId)
      .maybeSingle();
    if (error || !data) {
      return {
        ok: false,
        reason: error ? "db_error" : "session_not_found",
        session_id: sessionId,
        user_id: null,
        brain_id: null,
        status: null,
        target_route: null,
      };
    }
    const row = data as {
      id: string;
      user_id: string;
      brain_id: string | null;
      status: string;
      target_route: string | null;
      ended_at: string | null;
    };
    if (row.ended_at || !ACTIVE_SESSION_STATUSES.has(row.status)) {
      return {
        ok: false,
        reason: "session_inactive",
        session_id: row.id,
        user_id: row.user_id,
        brain_id: row.brain_id,
        status: row.status,
        target_route: row.target_route,
      };
    }
    return {
      ok: true,
      reason: null,
      session_id: row.id,
      user_id: row.user_id,
      brain_id: row.brain_id,
      status: row.status,
      target_route: row.target_route,
    };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "unknown",
      session_id: sessionId,
      user_id: null,
      brain_id: null,
      status: null,
      target_route: null,
    };
  }
}

// ---------- gmail connector surface state ----------

export interface GmailConnectorSurfaceState {
  surface: "gmail_connector";
  connection_status: "connected" | "not_connected" | "reauth_required" | "unknown";
  last_sync_at: string | null;
  sync_status: string | null;
  last_sync_error_code: string | null;
  last_sync_error_safe: string | null;
  auto_sync_enabled: boolean;
  today_count: number | null;
  warning: string | null;
  available_actions: Array<{
    key: SurfaceActionKey;
    title: string;
    risk: SurfaceActionRisk;
    requires_confirmation: boolean;
  }>;
}

export async function loadGmailConnectorSurfaceState(
  userId: string,
): Promise<GmailConnectorSurfaceState> {
  const actions = getSurfaceActions("gmail_connector").map((a) => ({
    key: a.key,
    title: a.title,
    risk: a.risk,
    requires_confirmation: a.requires_confirmation,
  }));
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conns } = await supabaseAdmin
      .from("gmail_connection_settings")
      .select(
        "id, status, refresh_token, last_sync_at, sync_status, last_sync_error_code, last_sync_error",
      )
      .eq("user_id", userId)
      .order("connected_at", { ascending: false })
      .limit(1);

    const list = (conns ?? []) as Array<{
      id: string;
      status: string;
      refresh_token: string | null;
      last_sync_at: string | null;
      sync_status: string | null;
      last_sync_error_code: string | null;
      last_sync_error: string | null;
    }>;
    const conn = list[0] ?? null;

    if (!conn) {
      return {
        surface: "gmail_connector",
        connection_status: "not_connected",
        last_sync_at: null,
        sync_status: null,
        last_sync_error_code: null,
        last_sync_error_safe: null,
        auto_sync_enabled: false,
        today_count: null,
        warning: "Gmail non è collegato.",
        available_actions: actions,
      };
    }

    let connection_status: GmailConnectorSurfaceState["connection_status"] = "unknown";
    if (conn.status === "connected" && conn.refresh_token) connection_status = "connected";
    else if (conn.status === "connected" && !conn.refresh_token) connection_status = "reauth_required";
    else if (conn.status === "disconnected") connection_status = "not_connected";

    let today_count: number | null = null;
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { count } = await supabaseAdmin
        .from("gmail_message_map")
        .select("id", { count: "exact", head: true })
        .eq("connection_id", conn.id)
        .gte("internal_date", startOfDay.toISOString());
      today_count = count ?? 0;
    } catch {
      today_count = null;
    }

    const warning =
      connection_status === "reauth_required"
        ? "Ricollegamento Gmail richiesto (refresh token mancante)."
        : connection_status === "not_connected"
          ? "Gmail non è collegato."
          : null;

    return {
      surface: "gmail_connector",
      connection_status,
      last_sync_at: conn.last_sync_at,
      sync_status: conn.sync_status,
      last_sync_error_code: conn.last_sync_error_code,
      last_sync_error_safe: conn.last_sync_error_code
        ? `Errore sync: ${conn.last_sync_error_code}`
        : null,
      auto_sync_enabled: !!conn.refresh_token,
      today_count,
      warning,
      available_actions: actions,
    };
  } catch (e) {
    return {
      surface: "gmail_connector",
      connection_status: "unknown",
      last_sync_at: null,
      sync_status: null,
      last_sync_error_code: null,
      last_sync_error_safe: e instanceof Error ? "errore lettura stato" : null,
      auto_sync_enabled: false,
      today_count: null,
      warning: "Stato Gmail non disponibile.",
      available_actions: actions,
    };
  }
}

// ---------- best-effort sanitized logging ----------

export async function logSurfaceEvt(
  user_id: string | null,
  event: string,
  metadata: Record<string, unknown>,
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as unknown as {
      from: (t: string) => {
        insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
      };
    })
      .from("agent_event_log")
      .insert({ user_id, event_type: event, metadata });
  } catch {
    // best-effort
  }
}
