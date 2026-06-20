// Brain Hub v3.23 — UI Operator browser adapter (server-only).
// Wraps Stagehand+Browserbase. Falls back to a controlled mock when not configured.

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
} from "./ui-operator-types";
import {
  decideUiOperatorSafety,
  isRouteAllowedForUiOperator,
} from "./ui-operator-safety";

export interface UiOperatorBrowserStartInput {
  initialRoute: string;
  brainId: string | null;
}

export interface UiOperatorBrowserStartResult {
  ok: boolean;
  mode: "real" | "mock";
  configured: boolean;
  browserbase_session_id: string | null;
  message: string;
}

export function getUiOperatorConfig(): StagehandConfig {
  return getStagehandBrowserbaseConfig();
}

export function isUiOperatorConfigured(): boolean {
  return getStagehandBrowserbaseConfig().configured;
}

export async function startUiOperatorBrowserSession(
  input: UiOperatorBrowserStartInput,
): Promise<UiOperatorBrowserStartResult> {
  const cfg = getStagehandBrowserbaseConfig();
  if (!isRouteAllowedForUiOperator(input.initialRoute)) {
    return {
      ok: false,
      mode: cfg.configured ? "real" : "mock",
      configured: cfg.configured,
      browserbase_session_id: null,
      message: "Route iniziale non consentita.",
    };
  }
  if (!cfg.configured) {
    return {
      ok: true,
      mode: "mock",
      configured: false,
      browserbase_session_id: null,
      message: "UI Operator in mock mode (Browserbase non configurato).",
    };
  }
  // Real Stagehand path is intentionally disabled in this POC: the
  // `@browserbasehq/stagehand` SDK is Node-only and cannot run inside the
  // Worker SSR runtime. The mock keeps the workflow usable end-to-end.
  return {
    ok: true,
    mode: "mock",
    configured: true,
    browserbase_session_id: null,
    message:
      "UI Operator: Browserbase/Stagehand configurati, ma il SDK non è disponibile nel runtime Worker. Sessione in mock mode controllato.",
  };
}

export async function openUiOperatorRoute(
  _sessionId: string,
  route: string,
): Promise<{ ok: boolean; route: string; message: string }> {
  if (!isRouteAllowedForUiOperator(route)) {
    return { ok: false, route, message: "Route non consentita." };
  }
  return { ok: true, route, message: `Route aperta (mock): ${route}` };
}

export async function observeUiOperatorScreen(
  _sessionId: string,
  route: string,
): Promise<UiOperatorObservation> {
  if (!isRouteAllowedForUiOperator(route)) {
    return buildEmptyObservation(route, "route_not_allowed");
  }
  // Mock observation tailored to known routes.
  if (route.startsWith("/gmail-connector")) {
    return {
      route,
      current_url: route,
      page_title: "Gmail Connector",
      summary:
        "Pagina Gmail Connector. Mostra stato della connessione, ultima sync e pulsanti Sincronizza/Ricollega/Disconnetti.",
      detected_state: "unknown",
      available_actions: [
        {
          action_type: "click_sync",
          title: "Premere 'Sincronizza'",
          selector_hint: "button:has-text('Sincronizza')",
          risk_level: "medium",
        },
        {
          action_type: "open_dialog",
          title: "Aprire 'Ricollega Gmail'",
          selector_hint: "button:has-text('Ricollega Gmail')",
          risk_level: "medium",
        },
        {
          action_type: "open_dialog",
          title: "Aprire 'Connetti Gmail'",
          selector_hint: "button:has-text('Collega Gmail')",
          risk_level: "medium",
        },
        {
          action_type: "disconnect_connection",
          title: "Disconnetti Gmail",
          selector_hint: "button:has-text('Disconnetti')",
          risk_level: "high",
        },
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
      {
        action_type: "read_state",
        title: "Leggere lo stato della pagina",
        selector_hint: null,
        risk_level: "low",
      },
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
}

export async function proposeUiOperatorAction(
  _sessionId: string,
  input: { route: string; goal: string },
): Promise<UiOperatorProposal> {
  const actionType = inferActionTypeFromGoal(input.goal);
  const safety = decideUiOperatorSafety({
    action_type: actionType,
    route: input.route,
  });
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
  };
}

export async function executeUiOperatorAction(
  _sessionId: string,
  input: {
    route: string;
    action_type: UiOperatorActionType;
    selector: string | null;
  },
): Promise<{ ok: boolean; result_text: string; error_text: string | null }> {
  const safety = decideUiOperatorSafety({
    action_type: input.action_type,
    route: input.route,
  });
  if (!safety.allowed) {
    return {
      ok: false,
      result_text: "",
      error_text: safety.reason ?? "blocked_by_policy",
    };
  }
  // Mock execution: simulate a dry-run. Real Stagehand click would land here.
  return {
    ok: true,
    result_text: `Azione '${input.action_type}' eseguita (mock dry-run) su ${input.route}.`,
    error_text: null,
  };
}

export async function stopUiOperatorBrowserSession(
  _sessionId: string,
): Promise<{ ok: boolean; message: string }> {
  return { ok: true, message: "Sessione UI Operator chiusa." };
}
