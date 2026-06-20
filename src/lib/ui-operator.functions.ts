// Brain Hub v3.23 — UI Operator server functions.
// All authenticated. Never accept user_id from client. RLS enforced.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  isRouteAllowedForUiOperator,
  decideUiOperatorSafety,
  ALLOWED_UI_ROUTES,
} from "./ui-operator-safety";
import type {
  UiOperatorActionType,
  UiOperatorSession,
  UiOperatorAction,
  UiOperatorObservation,
  UiOperatorRunResult,
} from "./ui-operator-types";

type SupabaseLike = {
  from: (t: string) => {
    insert: (v: Record<string, unknown>) => {
      select: (cols?: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
    update: (v: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: unknown }>;
    };
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
        };
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
};

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

function asSession(row: unknown): UiOperatorSession | null {
  if (!row || typeof row !== "object") return null;
  return row as UiOperatorSession;
}

function asAction(row: unknown): UiOperatorAction | null {
  if (!row || typeof row !== "object") return null;
  return row as UiOperatorAction;
}

// ---------- start session ----------
export const startUiOperatorSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = (d && typeof d === "object" ? d : {}) as {
      target_route?: unknown;
      brain_id?: unknown;
      provider?: unknown;
    };
    return {
      target_route: typeof o.target_route === "string" ? o.target_route : "/ui-operator-lab",
      brain_id: typeof o.brain_id === "string" ? o.brain_id : null,
      provider: typeof o.provider === "string" ? o.provider : null,
    };
  })
  .handler(async ({ data, context }): Promise<UiOperatorRunResult> => {
    const { supabase, userId } = context;
    const sb = supabase as unknown as SupabaseLike;

    if (!isRouteAllowedForUiOperator(data.target_route)) {
      await logEvt(supabase, userId, "ui_operator_action_blocked", {
        reason: "route_not_allowed",
        route: data.target_route,
      });
      return {
        ok: false,
        status: "route_not_allowed",
        message: "Route iniziale non consentita.",
      };
    }

    const { getUiOperatorConfig, isUiOperatorConfigured, startUiOperatorBrowserSession } =
      await import("./ui-operator-browser.server");
    const cfg = getUiOperatorConfig();
    const provider = isUiOperatorConfigured() ? "browserbase_stagehand" : "mock";

    const { data: row, error } = await sb
      .from("ui_operator_sessions")
      .insert({
        user_id: userId,
        brain_id: data.brain_id,
        provider,
        status: "active",
        target_route: data.target_route,
        current_url: data.target_route,
        metadata: {
          configured: cfg.configured,
          model: cfg.model,
          runner_configured: cfg.runner_configured,
          execution_mode: cfg.execution_mode,
        },
      })
      .select("*")
      .maybeSingle();

    if (error || !row) {
      return {
        ok: false,
        status: "stagehand_error",
        message: "Impossibile creare la sessione UI Operator.",
      };
    }

    const brainHubSessionId = (row as { id: string }).id;
    await logEvt(supabase, userId, "ui_operator_runner_config_checked", {
      runner_configured: cfg.runner_configured,
      execution_mode: cfg.execution_mode,
    });

    // attempt to start runner session (or mock)
    const startRes = await startUiOperatorBrowserSession({
      initialRoute: data.target_route,
      brainId: data.brain_id,
      sessionId: brainHubSessionId,
    });

    // persist runner-side ids in metadata
    await sb
      .from("ui_operator_sessions")
      .update({
        browserbase_session_id: startRes.browserbase_session_id,
        metadata: {
          configured: cfg.configured,
          model: cfg.model,
          runner_configured: cfg.runner_configured,
          runner_reachable: startRes.runner_reachable,
          runner_session_id: startRes.runner_session_id,
          browserbase_session_id: startRes.browserbase_session_id,
          execution_mode: startRes.execution_mode,
          runner_status: startRes.message.slice(0, 200),
        },
      })
      .eq("id", brainHubSessionId);

    if (cfg.runner_configured && startRes.execution_mode === "real_runner") {
      await logEvt(supabase, userId, "ui_operator_real_session_started", {
        session_id: brainHubSessionId,
        runner_session_id: startRes.runner_session_id,
        target_route: data.target_route,
      });
    } else if (cfg.runner_configured && startRes.execution_mode === "mock") {
      await logEvt(supabase, userId, "ui_operator_runner_unavailable", {
        session_id: brainHubSessionId,
        reason: startRes.message,
      });
      await logEvt(supabase, userId, "ui_operator_fallback_to_mock", {
        session_id: brainHubSessionId,
      });
    } else {
      await logEvt(supabase, userId, "ui_operator_mock_mode_used", {
        target_route: data.target_route,
      });
    }
    await logEvt(supabase, userId, "ui_operator_session_started", {
      session_id: brainHubSessionId,
      mode: provider,
      execution_mode: startRes.execution_mode,
      target_route: data.target_route,
    });

    const enrichedSession = {
      ...(row as Record<string, unknown>),
      browserbase_session_id: startRes.browserbase_session_id,
    };

    return {
      ok: true,
      status: "active",
      message:
        startRes.execution_mode === "real_runner"
          ? "Sessione UI Operator avviata (runner reale)."
          : "Sessione UI Operator avviata in mock mode.",
      session: asSession(enrichedSession),
      execution_mode: startRes.execution_mode,
      runner_configured: cfg.runner_configured,
      runner_reachable: startRes.runner_reachable ?? undefined,
    };
  });


// ---------- open route ----------
export const openUiOperatorRouteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = (d && typeof d === "object" ? d : {}) as {
      session_id?: unknown;
      route?: unknown;
    };
    return {
      session_id: typeof o.session_id === "string" ? o.session_id : "",
      route: typeof o.route === "string" ? o.route : "",
    };
  })
  .handler(async ({ data, context }): Promise<UiOperatorRunResult> => {
    const { supabase, userId } = context;
    const sb = supabase as unknown as SupabaseLike;
    if (!data.session_id) {
      return { ok: false, status: "stagehand_error", message: "session_id mancante." };
    }
    if (!isRouteAllowedForUiOperator(data.route)) {
      await logEvt(supabase, userId, "ui_operator_action_blocked", {
        reason: "route_not_allowed",
        route: data.route,
        session_id: data.session_id,
      });
      return {
        ok: false,
        status: "route_not_allowed",
        message: "Route non consentita.",
      };
    }
    const { openUiOperatorRoute } = await import("./ui-operator-browser.server");
    const { createUiOperatorAuthToken, getBrainHubBaseUrl, buildUiOperatorAuthUrl, safeTokenPrefix } =
      await import("./ui-operator-auth.server");

    // Mint a one-time auth token so the runner can land on the route via the
    // public handshake URL (Brain Hub never shares cookies or passwords).
    let authUrl: string | null = null;
    let tokenPrefix: string | null = null;
    let tokenExpiresAt: string | null = null;
    const tokenRes = await createUiOperatorAuthToken({
      user_id: userId,
      session_id: data.session_id,
      allowed_routes: [data.route],
      metadata: { source: "open_route" },
    });
    if (tokenRes.ok && tokenRes.token) {
      authUrl = buildUiOperatorAuthUrl({
        baseUrl: getBrainHubBaseUrl(),
        token: tokenRes.token,
        session_id: data.session_id,
        route: data.route,
      });
      tokenPrefix = safeTokenPrefix(tokenRes.token);
      tokenExpiresAt = tokenRes.expires_at;
      await logEvt(supabase, userId, "ui_operator_auth_token_created", {
        session_id: data.session_id, route: data.route,
        token_prefix: tokenPrefix, expires_at: tokenExpiresAt, source: "open_route",
      });
    } else {
      await logEvt(supabase, userId, "ui_operator_auth_token_invalid", {
        reason: tokenRes.error, session_id: data.session_id, route: data.route,
      });
    }

    const res = await openUiOperatorRoute(data.session_id, data.route, {
      auth_url: authUrl,
    });
    await sb
      .from("ui_operator_sessions")
      .update({
        target_route: data.route,
        current_url: data.route,
        status: "navigating",
      })
      .eq("id", data.session_id);
    await logEvt(supabase, userId, "ui_operator_route_opened", {
      session_id: data.session_id,
      route: data.route,
      execution_mode: res.execution_mode,
      auth_url_used: res.auth_url_used,
      token_prefix: tokenPrefix,
    });
    if (res.execution_mode === "real_runner") {
      await logEvt(supabase, userId, "ui_operator_runner_called", {
        endpoint: "/session/open-route",
        ok: res.ok,
      });
      await logEvt(
        supabase,
        userId,
        res.ok ? "ui_operator_auth_redirect_completed" : "ui_operator_auth_redirect_failed",
        { session_id: data.session_id, route: data.route, token_prefix: tokenPrefix },
      );
    }
    return {
      ok: res.ok,
      status: "navigating",
      message: res.message,
      execution_mode: res.execution_mode,
    };
  });

// ---------- observe ----------
export const observeUiOperatorScreenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = (d && typeof d === "object" ? d : {}) as {
      session_id?: unknown;
      route?: unknown;
    };
    return {
      session_id: typeof o.session_id === "string" ? o.session_id : "",
      route: typeof o.route === "string" ? o.route : "",
    };
  })
  .handler(async ({ data, context }): Promise<UiOperatorRunResult> => {
    const { supabase, userId } = context;
    const sb = supabase as unknown as SupabaseLike;
    if (!data.session_id) {
      return { ok: false, status: "stagehand_error", message: "session_id mancante." };
    }
    if (!isRouteAllowedForUiOperator(data.route)) {
      return {
        ok: false,
        status: "route_not_allowed",
        message: "Route non consentita per osservazione.",
      };
    }
    const { observeUiOperatorScreen } = await import("./ui-operator-browser.server");
    const obs: UiOperatorObservation = await observeUiOperatorScreen(
      data.session_id,
      data.route,
    );
    await sb
      .from("ui_operator_sessions")
      .update({
        status: "observing",
        last_observation: obs.summary.slice(0, 1000),
        last_observed_at: new Date().toISOString(),
        last_screenshot_hash: obs.screenshot_hash,
        current_url: obs.current_url,
      })
      .eq("id", data.session_id);
    await logEvt(supabase, userId, "ui_operator_screen_observed", {
      session_id: data.session_id,
      route: data.route,
      mock: obs.mock,
    });
    return {
      ok: true,
      status: "observing",
      message: "Schermata osservata.",
      observation: obs,
    };
  });

// ---------- propose ----------
export const proposeUiOperatorActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = (d && typeof d === "object" ? d : {}) as {
      session_id?: unknown;
      route?: unknown;
      goal?: unknown;
      brain_id?: unknown;
    };
    return {
      session_id: typeof o.session_id === "string" ? o.session_id : "",
      route: typeof o.route === "string" ? o.route : "",
      goal: typeof o.goal === "string" ? o.goal : "",
      brain_id: typeof o.brain_id === "string" ? o.brain_id : null,
    };
  })
  .handler(async ({ data, context }): Promise<UiOperatorRunResult> => {
    const { supabase, userId } = context;
    const sb = supabase as unknown as SupabaseLike;
    if (!data.session_id || !data.goal) {
      return { ok: false, status: "stagehand_error", message: "session_id o goal mancante." };
    }
    if (!isRouteAllowedForUiOperator(data.route)) {
      return {
        ok: false,
        status: "route_not_allowed",
        message: "Route non consentita.",
      };
    }
    const { proposeUiOperatorAction } = await import("./ui-operator-browser.server");
    const prop = await proposeUiOperatorAction(data.session_id, {
      route: data.route,
      goal: data.goal,
    });
    const safety = decideUiOperatorSafety({
      action_type: prop.action_type,
      route: data.route,
    });
    const { data: row, error } = await sb
      .from("ui_operator_actions")
      .insert({
        session_id: data.session_id,
        user_id: userId,
        brain_id: data.brain_id,
        route: data.route,
        action_type: prop.action_type,
        title: prop.title,
        description: prop.description,
        risk_level: prop.risk_level,
        status: safety.allowed ? "proposed" : "blocked",
        requires_confirmation: prop.requires_confirmation,
        selector: prop.selector_hint,
        safety_reason: safety.reason,
        blocked_at: safety.allowed ? null : new Date().toISOString(),
        metadata: { goal: data.goal },
      })
      .select("*")
      .maybeSingle();
    if (error || !row) {
      return { ok: false, status: "stagehand_error", message: "Impossibile salvare la proposta." };
    }
    await logEvt(
      supabase,
      userId,
      safety.allowed ? "ui_operator_action_proposed" : "ui_operator_action_blocked",
      {
        session_id: data.session_id,
        action_id: (row as { id: string }).id,
        action_type: prop.action_type,
        risk_level: prop.risk_level,
        reason: safety.reason,
      },
    );
    return {
      ok: safety.allowed,
      status: safety.allowed ? "proposed" : "blocked",
      message: safety.allowed ? "Proposta registrata." : "Proposta bloccata da policy.",
      action: asAction(row),
      safety,
    };
  });

// ---------- confirm ----------
export const confirmUiOperatorActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = (d && typeof d === "object" ? d : {}) as { action_id?: unknown };
    return { action_id: typeof o.action_id === "string" ? o.action_id : "" };
  })
  .handler(async ({ data, context }): Promise<UiOperatorRunResult> => {
    const { supabase, userId } = context;
    const sb = supabase as unknown as SupabaseLike;
    if (!data.action_id) {
      return { ok: false, status: "stagehand_error", message: "action_id mancante." };
    }
    const { data: existing } = await sb
      .from("ui_operator_actions")
      .select("*")
      .eq("id", data.action_id)
      .maybeSingle();
    const act = asAction(existing);
    if (!act) {
      return { ok: false, status: "stagehand_error", message: "Azione non trovata." };
    }
    if (act.status !== "proposed") {
      return {
        ok: false,
        status: "blocked",
        message: `Azione in stato '${act.status}', non confermabile.`,
        action: act,
      };
    }
    await sb
      .from("ui_operator_actions")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", data.action_id);
    await logEvt(supabase, userId, "ui_operator_action_confirmed", {
      action_id: data.action_id,
      action_type: act.action_type,
      risk_level: act.risk_level,
    });
    return {
      ok: true,
      status: "confirmed",
      message: "Azione confermata. Pronta per l'esecuzione.",
      action: { ...act, status: "confirmed", confirmed_at: new Date().toISOString() },
    };
  });

// ---------- execute confirmed ----------
export const executeConfirmedUiOperatorActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = (d && typeof d === "object" ? d : {}) as { action_id?: unknown };
    return { action_id: typeof o.action_id === "string" ? o.action_id : "" };
  })
  .handler(async ({ data, context }): Promise<UiOperatorRunResult> => {
    const { supabase, userId } = context;
    const sb = supabase as unknown as SupabaseLike;
    if (!data.action_id) {
      return { ok: false, status: "stagehand_error", message: "action_id mancante." };
    }
    const { data: existing } = await sb
      .from("ui_operator_actions")
      .select("*")
      .eq("id", data.action_id)
      .maybeSingle();
    const act = asAction(existing);
    if (!act) {
      return { ok: false, status: "stagehand_error", message: "Azione non trovata." };
    }
    if (act.status !== "confirmed") {
      return {
        ok: false,
        status: "blocked",
        message: `Azione in stato '${act.status}', non eseguibile senza conferma.`,
        action: act,
      };
    }
    const safety = decideUiOperatorSafety({
      action_type: act.action_type as UiOperatorActionType,
      route: act.route,
    });
    if (!safety.allowed) {
      await sb
        .from("ui_operator_actions")
        .update({
          status: "blocked",
          blocked_at: new Date().toISOString(),
          safety_reason: safety.reason,
        })
        .eq("id", data.action_id);
      await logEvt(supabase, userId, "ui_operator_action_blocked", {
        action_id: data.action_id,
        reason: safety.reason,
      });
      return {
        ok: false,
        status: "blocked",
        message: "Esecuzione bloccata da policy.",
        action: { ...act, status: "blocked" },
        safety,
      };
    }
    await sb
      .from("ui_operator_actions")
      .update({ status: "executing" })
      .eq("id", data.action_id);
    const { executeUiOperatorAction } = await import("./ui-operator-browser.server");
    const exec = await executeUiOperatorAction(act.session_id, {
      route: act.route ?? "",
      action_type: act.action_type as UiOperatorActionType,
      selector: act.selector,
    });
    if (!exec.ok) {
      await sb
        .from("ui_operator_actions")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          error_text: exec.error_text,
        })
        .eq("id", data.action_id);
      await logEvt(supabase, userId, "ui_operator_action_failed", {
        action_id: data.action_id,
        error_code: exec.error_text,
        execution_mode: exec.execution_mode,
      });
      if (exec.execution_mode === "real_runner") {
        await logEvt(supabase, userId, "ui_operator_real_action_failed", {
          action_id: data.action_id,
          error_code: exec.error_text,
        });
      }
      return {
        ok: false,
        status: "failed",
        message: "Esecuzione fallita.",
        action: { ...act, status: "failed", error_text: exec.error_text },
        execution_mode: exec.execution_mode,
      };
    }
    await sb
      .from("ui_operator_actions")
      .update({
        status: "executed",
        executed_at: new Date().toISOString(),
        result_text: exec.result_text.slice(0, 1000),
      })
      .eq("id", data.action_id);
    await logEvt(supabase, userId, "ui_operator_action_executed", {
      action_id: data.action_id,
      action_type: act.action_type,
      risk_level: act.risk_level,
      execution_mode: exec.execution_mode,
    });
    if (exec.execution_mode === "real_runner") {
      await logEvt(supabase, userId, "ui_operator_real_action_executed", {
        action_id: data.action_id,
        action_type: act.action_type,
      });
    }
    return {
      ok: true,
      status: "executed",
      message: exec.result_text,
      action: { ...act, status: "executed", result_text: exec.result_text },
      execution_mode: exec.execution_mode,
    };
  });

// ---------- stop ----------
export const stopUiOperatorSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = (d && typeof d === "object" ? d : {}) as { session_id?: unknown };
    return { session_id: typeof o.session_id === "string" ? o.session_id : "" };
  })
  .handler(async ({ data, context }): Promise<UiOperatorRunResult> => {
    const { supabase, userId } = context;
    const sb = supabase as unknown as SupabaseLike;
    if (!data.session_id) {
      return { ok: false, status: "stagehand_error", message: "session_id mancante." };
    }
    const { stopUiOperatorBrowserSession } = await import("./ui-operator-browser.server");
    await stopUiOperatorBrowserSession(data.session_id);
    await sb
      .from("ui_operator_sessions")
      .update({
        status: "stopped",
        ended_at: new Date().toISOString(),
      })
      .eq("id", data.session_id);
    await logEvt(supabase, userId, "ui_operator_session_stopped", {
      session_id: data.session_id,
    });
    return {
      ok: true,
      status: "stopped",
      message: "Sessione UI Operator chiusa.",
    };
  });

// ---------- list sessions ----------
export const listUiOperatorSessionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((_d: unknown) => ({}))
  .handler(async ({ context }): Promise<{ ok: boolean; sessions: UiOperatorSession[] }> => {
    const sb = context.supabase as unknown as SupabaseLike;
    const { data } = await sb
      .from("ui_operator_sessions")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    const rows = (data as unknown[] | null) ?? [];
    return {
      ok: true,
      sessions: rows.map(asSession).filter((s): s is UiOperatorSession => s !== null),
    };
  });

// ---------- list actions ----------
export const listUiOperatorActionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = (d && typeof d === "object" ? d : {}) as { session_id?: unknown };
    return { session_id: typeof o.session_id === "string" ? o.session_id : null };
  })
  .handler(async ({ data, context }): Promise<{ ok: boolean; actions: UiOperatorAction[] }> => {
    const sb = context.supabase as unknown as SupabaseLike;
    const q = sb
      .from("ui_operator_actions")
      .select("*")
      .eq(data.session_id ? "session_id" : "user_id", data.session_id ?? context.userId);
    const { data: rows } = await q.order("created_at", { ascending: false }).limit(50);
    const list = (rows as unknown[] | null) ?? [];
    return {
      ok: true,
      actions: list.map(asAction).filter((a): a is UiOperatorAction => a !== null),
    };
  });

// ---------- config ----------
export const getUiOperatorConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((_d: unknown) => ({}))
  .handler(async () => {
    const { getUiOperatorConfig } = await import("./ui-operator-browser.server");
    const cfg = getUiOperatorConfig();
    return {
      ok: true,
      configured: cfg.configured,
      mode: cfg.execution_mode === "real_runner" ? ("real" as const) : ("mock" as const),
      execution_mode: cfg.execution_mode,
      runner_configured: cfg.runner_configured,
      runner_url_present: cfg.runner_url_present,
      runner_secret_present: cfg.runner_secret_present,
      has_browserbase_api_key: cfg.has_browserbase_api_key,
      has_browserbase_project_id: cfg.has_browserbase_project_id,
      has_model_key: cfg.has_model_key,
      model: cfg.model,
      allowed_routes: ALLOWED_UI_ROUTES,
    };
  });

// ---------- runner health ----------
export const getUiOperatorRunnerHealthFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((_d: unknown) => ({}))
  .handler(async ({ context }) => {
    const { healthCheckUiOperatorRunner } = await import("./ui-operator-browser.server");
    const res = await healthCheckUiOperatorRunner();
    await logEvt(context.supabase, context.userId, "ui_operator_runner_health_checked", {
      ok: res.ok,
      configured: res.configured,
      reachable: res.reachable,
      status: res.status,
    });
    return res;
  });
