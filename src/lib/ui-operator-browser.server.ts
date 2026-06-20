// Brain Hub v3.23.1 — UI Operator browser adapter (server-only).
// Routes to the external Node UI Operator Runner (Stagehand + Browserbase)
// when configured, otherwise to the controlled mock. Never throws.

import {
  getStagehandBrowserbaseConfig,
  buildEmptyObservation,
  inferActionTypeFromGoal,
  type StagehandConfig,
} from "./stagehand-browserbase.server";
import type {
  UiOperatorObservation,
  UiOperatorActionType,
  UiOperatorRiskLevel,
  UiOperatorExecutionMode,
} from "./ui-operator-types";
import {
  decideUiOperatorSafety,
  isRouteAllowedForUiOperator,
} from "./ui-operator-safety";
import {
  getUiOperatorRunnerConfig,
  isUiOperatorRunnerConfigured,
  pingUiOperatorRunner,
  startRunnerSession,
  openRunnerRoute,
  observeRunnerScreen,
  proposeRunnerAction,
  executeRunnerAction,
  stopRunnerSession,
} from "./ui-operator-runner-client.server";

export interface UiOperatorAdapterConfig extends StagehandConfig {
  runner_configured: boolean;
  runner_url_present: boolean;
  runner_secret_present: boolean;
  execution_mode: UiOperatorExecutionMode;
}

export interface UiOperatorBrowserStartInput {
  initialRoute: string;
  brainId: string | null;
  sessionId: string;
}

export interface UiOperatorBrowserStartResult {
  ok: boolean;
  mode: "real" | "mock";
  execution_mode: UiOperatorExecutionMode;
  configured: boolean;
  runner_configured: boolean;
  runner_reachable: boolean | null;
  browserbase_session_id: string | null;
  runner_session_id: string | null;
  message: string;
}

export function getUiOperatorConfig(): UiOperatorAdapterConfig {
  const bb = getStagehandBrowserbaseConfig();
  const runner = getUiOperatorRunnerConfig();
  return {
    ...bb,
    runner_configured: runner.configured,
    runner_url_present: runner.runner_url_present,
    runner_secret_present: runner.runner_secret_present,
    execution_mode: runner.configured ? "real_runner" : "mock",
  };
}

export function isUiOperatorConfigured(): boolean {
  return getStagehandBrowserbaseConfig().configured || isUiOperatorRunnerConfigured();
}

export async function healthCheckUiOperatorRunner(): Promise<{
  ok: boolean;
  configured: boolean;
  reachable: boolean;
  status: string;
  safe_message: string;
}> {
  const cfg = getUiOperatorRunnerConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      configured: false,
      reachable: false,
      status: "not_configured",
      safe_message: "UI Operator Runner non configurato.",
    };
  }
  const res = await pingUiOperatorRunner();
  return {
    ok: res.ok,
    configured: true,
    reachable: res.ok,
    status: res.status,
    safe_message: res.safe_message,
  };
}

export async function startUiOperatorBrowserSession(
  input: UiOperatorBrowserStartInput,
): Promise<UiOperatorBrowserStartResult> {
  if (!isRouteAllowedForUiOperator(input.initialRoute)) {
    return {
      ok: false,
      mode: "mock",
      execution_mode: "mock",
      configured: false,
      runner_configured: isUiOperatorRunnerConfigured(),
      runner_reachable: null,
      browserbase_session_id: null,
      runner_session_id: null,
      message: "Route iniziale non consentita.",
    };
  }
  const runnerCfg = getUiOperatorRunnerConfig();
  if (runnerCfg.configured) {
    const res = await startRunnerSession({
      session_id: input.sessionId,
      initial_route: input.initialRoute,
      brain_id: input.brainId,
    });
    if (res.ok) {
      return {
        ok: true,
        mode: "real",
        execution_mode: "real_runner",
        configured: true,
        runner_configured: true,
        runner_reachable: true,
        browserbase_session_id: res.data.browserbase_session_id,
        runner_session_id: res.data.runner_session_id,
        message: "Sessione runner reale avviata.",
      };
    }
    // runner configured but unreachable/error → fallback to mock
    return {
      ok: true,
      mode: "mock",
      execution_mode: "mock",
      configured: true,
      runner_configured: true,
      runner_reachable: false,
      browserbase_session_id: null,
      runner_session_id: null,
      message: `Runner non disponibile (${res.error_code}). Fallback mock.`,
    };
  }
  return {
    ok: true,
    mode: "mock",
    execution_mode: "mock",
    configured: false,
    runner_configured: false,
    runner_reachable: null,
    browserbase_session_id: null,
    runner_session_id: null,
    message: "UI Operator in mock mode (runner non configurato).",
  };
}

export async function openUiOperatorRoute(
  sessionId: string,
  route: string,
): Promise<{
  ok: boolean;
  route: string;
  message: string;
  execution_mode: UiOperatorExecutionMode;
}> {
  if (!isRouteAllowedForUiOperator(route)) {
    return { ok: false, route, message: "Route non consentita.", execution_mode: "mock" };
  }
  if (isUiOperatorRunnerConfigured()) {
    const res = await openRunnerRoute({ session_id: sessionId, route });
    if (res.ok) {
      return { ok: true, route, message: `Route aperta: ${route}`, execution_mode: "real_runner" };
    }
    return {
      ok: false,
      route,
      message: `Runner: ${res.safe_message}`,
      execution_mode: "mock",
    };
  }
  return {
    ok: true,
    route,
    message: `Route aperta (mock): ${route}`,
    execution_mode: "mock",
  };
}

export async function observeUiOperatorScreen(
  sessionId: string,
  route: string,
): Promise<UiOperatorObservation> {
  if (!isRouteAllowedForUiOperator(route)) {
    return buildEmptyObservation(route, "route_not_allowed");
  }
  if (isUiOperatorRunnerConfigured()) {
    const res = await observeRunnerScreen({ session_id: sessionId, route });
    if (res.ok && res.data?.observation) {
      return { ...res.data.observation, mock: false };
    }
    // fallback mock observation below
  }
  if (route.startsWith("/gmail-connector")) {
    return {
      route,
      current_url: route,
      page_title: "Gmail Connector",
      summary:
        "Pagina Gmail Connector. Mostra stato connessione, ultima sync e pulsanti Sincronizza/Ricollega/Disconnetti.",
      detected_state: "unknown",
      available_actions: [
        { action_type: "click_sync", title: "Premere 'Sincronizza'", selector_hint: "button:has-text('Sincronizza')", risk_level: "medium" },
        { action_type: "open_dialog", title: "Aprire 'Ricollega Gmail'", selector_hint: "button:has-text('Ricollega Gmail')", risk_level: "medium" },
        { action_type: "open_dialog", title: "Aprire 'Collega Gmail'", selector_hint: "button:has-text('Collega Gmail')", risk_level: "medium" },
        { action_type: "disconnect_connection", title: "Disconnetti Gmail", selector_hint: "button:has-text('Disconnetti')", risk_level: "high" },
      ],
      screenshot_hash: null,
      captured_at: new Date().toISOString(),
      mock: true,
    };
  }
  return {
    route,
    current_url: route,
    page_title: null,
    summary: `Osservazione mock per ${route}. Nessun click effettuato.`,
    detected_state: null,
    available_actions: [
      { action_type: "read_state", title: "Leggere lo stato della pagina", selector_hint: null, risk_level: "low" },
    ],
    screenshot_hash: null,
    captured_at: new Date().toISOString(),
    mock: true,
  };
}

export interface UiOperatorProposal {
  ok: boolean;
  action_type: UiOperatorActionType;
  title: string;
  description: string;
  selector_hint: string | null;
  risk_level: UiOperatorRiskLevel;
  requires_confirmation: boolean;
  safety_reason: string | null;
  execution_mode: UiOperatorExecutionMode;
}

export async function proposeUiOperatorAction(
  sessionId: string,
  input: { route: string; goal: string },
): Promise<UiOperatorProposal> {
  if (isUiOperatorRunnerConfigured()) {
    const res = await proposeRunnerAction({
      session_id: sessionId,
      route: input.route,
      goal: input.goal,
    });
    if (res.ok) {
      const safety = decideUiOperatorSafety({
        action_type: res.data.action_type,
        route: input.route,
      });
      return {
        ok: safety.allowed,
        action_type: res.data.action_type,
        title: res.data.title,
        description: res.data.description,
        selector_hint: res.data.selector_hint,
        risk_level: safety.risk_level,
        requires_confirmation: res.data.requires_confirmation || safety.requires_confirmation,
        safety_reason: safety.reason,
        execution_mode: "real_runner",
      };
    }
    // fallthrough to local heuristic
  }
  const actionType = inferActionTypeFromGoal(input.goal);
  const safety = decideUiOperatorSafety({ action_type: actionType, route: input.route });
  return {
    ok: safety.allowed,
    action_type: actionType,
    title: `Proposta: ${input.goal}`.slice(0, 160),
    description: safety.allowed
      ? `Propongo di eseguire '${actionType}' su ${input.route}.`
      : `Azione bloccata: ${safety.reason ?? "policy"}.`,
    selector_hint: null,
    risk_level: safety.risk_level,
    requires_confirmation: safety.requires_confirmation,
    safety_reason: safety.reason,
    execution_mode: "mock",
  };
}

export async function executeUiOperatorAction(
  sessionId: string,
  input: {
    route: string;
    action_type: UiOperatorActionType;
    selector: string | null;
  },
): Promise<{
  ok: boolean;
  result_text: string;
  error_text: string | null;
  execution_mode: UiOperatorExecutionMode;
}> {
  const safety = decideUiOperatorSafety({
    action_type: input.action_type,
    route: input.route,
  });
  if (!safety.allowed) {
    return {
      ok: false,
      result_text: "",
      error_text: safety.reason ?? "blocked_by_policy",
      execution_mode: "mock",
    };
  }
  if (isUiOperatorRunnerConfigured()) {
    const res = await executeRunnerAction({
      session_id: sessionId,
      route: input.route,
      action_type: input.action_type,
      selector: input.selector,
      confirmed: true,
    });
    if (res.ok) {
      return {
        ok: true,
        result_text: res.data.result_text || `Azione '${input.action_type}' eseguita su ${input.route}.`,
        error_text: null,
        execution_mode: "real_runner",
      };
    }
    return {
      ok: false,
      result_text: "",
      error_text: `${res.error_code}: ${res.safe_message}`,
      execution_mode: "real_runner",
    };
  }
  return {
    ok: true,
    result_text: `Azione '${input.action_type}' eseguita (mock dry-run) su ${input.route}.`,
    error_text: null,
    execution_mode: "mock",
  };
}

export async function stopUiOperatorBrowserSession(
  sessionId: string,
): Promise<{ ok: boolean; message: string; execution_mode: UiOperatorExecutionMode }> {
  if (isUiOperatorRunnerConfigured()) {
    const res = await stopRunnerSession({ session_id: sessionId });
    return {
      ok: res.ok,
      message: res.ok ? "Sessione runner chiusa." : `Runner: ${res.safe_message}`,
      execution_mode: "real_runner",
    };
  }
  return { ok: true, message: "Sessione UI Operator chiusa.", execution_mode: "mock" };
}
