// Brain Hub v3.23.2 — UI Operator auth handshake server functions.
// Authenticated. Mints short-lived one-time tokens used by the runner.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createUiOperatorAuthToken,
  getBrainHubBaseUrl,
  buildUiOperatorAuthUrl,
  safeTokenPrefix,
} from "./ui-operator-auth.server";
import { ALLOWED_UI_ROUTES, isRouteAllowedForUiOperator } from "./ui-operator-safety";

async function logEvt(
  supabase: unknown,
  userId: string,
  event: string,
  metadata: Record<string, unknown>,
) {
  try {
    await (supabase as {
      from: (t: string) => {
        insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
      };
    })
      .from("agent_event_log")
      .insert({ user_id: userId, event_type: event, metadata });
  } catch {
    // best-effort
  }
}

export const createUiOperatorAuthTokenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = (d && typeof d === "object" ? d : {}) as {
      session_id?: unknown;
      route?: unknown;
      allowed_routes?: unknown;
      ttl_ms?: unknown;
    };
    const route = typeof o.route === "string" ? o.route : "";
    const allowed = Array.isArray(o.allowed_routes)
      ? (o.allowed_routes as unknown[]).filter((r): r is string => typeof r === "string")
      : route
        ? [route]
        : [];
    return {
      session_id: typeof o.session_id === "string" ? o.session_id : "",
      route,
      allowed_routes: allowed,
      ttl_ms: typeof o.ttl_ms === "number" ? o.ttl_ms : undefined,
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.session_id) {
      return { ok: false, error: "session_id_missing", url: null, token: null,
        token_prefix: null, expires_at: null, allowed_routes: [], status: "invalid" as const };
    }
    if (data.route && !isRouteAllowedForUiOperator(data.route)) {
      await logEvt(supabase, userId, "ui_operator_auth_token_invalid", {
        reason: "route_not_allowed", route: data.route, session_id: data.session_id,
      });
      return { ok: false, error: "route_not_allowed", url: null, token: null,
        token_prefix: null, expires_at: null, allowed_routes: [], status: "invalid" as const };
    }
    const allowed = data.allowed_routes.length > 0 ? data.allowed_routes : [...ALLOWED_UI_ROUTES];
    const res = await createUiOperatorAuthToken({
      user_id: userId,
      session_id: data.session_id,
      allowed_routes: allowed,
      ttl_ms: data.ttl_ms,
      metadata: { route: data.route || null },
    });
    if (!res.ok || !res.token) {
      await logEvt(supabase, userId, "ui_operator_auth_token_invalid", {
        reason: res.error, session_id: data.session_id,
      });
      return { ok: false, error: res.error ?? "create_failed", url: null, token: null,
        token_prefix: null, expires_at: null, allowed_routes: res.allowed_routes, status: "invalid" as const };
    }
    const url = data.route
      ? buildUiOperatorAuthUrl({
          baseUrl: getBrainHubBaseUrl(),
          token: res.token,
          session_id: data.session_id,
          route: data.route,
        })
      : null;
    await logEvt(supabase, userId, "ui_operator_auth_token_created", {
      session_id: data.session_id,
      token_prefix: safeTokenPrefix(res.token),
      expires_at: res.expires_at,
      allowed_routes: res.allowed_routes,
      route: data.route || null,
    });
    return {
      ok: true,
      error: null,
      url,
      token: res.token,
      token_prefix: safeTokenPrefix(res.token),
      expires_at: res.expires_at,
      allowed_routes: res.allowed_routes,
      status: "active" as const,
    };
  });

export const getLatestUiOperatorAuthTokenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = (d && typeof d === "object" ? d : {}) as { session_id?: unknown };
    return { session_id: typeof o.session_id === "string" ? o.session_id : "" };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.session_id) {
      return { ok: false, token: null };
    }
    const sb = supabase as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            order: (col: string, opts: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
            };
          };
        };
      };
    };
    const { data: rows } = await sb
      .from("ui_operator_auth_tokens")
      .select("id, status, allowed_routes, expires_at, used_at, created_at, metadata")
      .eq("session_id", data.session_id)
      .order("created_at", { ascending: false })
      .limit(1);
    const list = Array.isArray(rows) ? rows : [];
    const latest = list[0] ?? null;
    void userId;
    return { ok: true, token: latest };
  });
