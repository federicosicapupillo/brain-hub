// Brain Hub v3.23.1 — UI Operator runner contract.
// JSON-safe types shared between Brain Hub (Worker SSR) and the external
// Node UI Operator Runner (Stagehand + Browserbase). No runtime imports of
// Node-only deps so this file is safe in the client bundle too.

import type {
  JsonValue,
  UiOperatorActionType,
  UiOperatorObservation,
  UiOperatorRiskLevel,
} from "./ui-operator-types";

export type RunnerExecutionMode = "real_runner" | "mock";

export type RunnerStatus =
  | "ok"
  | "started"
  | "navigated"
  | "observed"
  | "proposed"
  | "executed"
  | "stopped"
  | "blocked"
  | "route_blocked"
  | "not_configured"
  | "unauthorized"
  | "browserbase_error"
  | "stagehand_error"
  | "timeout"
  | "unreachable"
  | "error";

export interface RunnerErrorResponse {
  ok: false;
  status: RunnerStatus;
  safe_message: string;
  error_code: string;
  data?: JsonValue | null;
}

interface RunnerOkBase {
  ok: true;
  status: RunnerStatus;
  safe_message?: string;
  error_code?: string;
}

export interface RunnerStartSessionRequest {
  session_id: string;       // Brain Hub session UUID
  initial_route: string;
  brain_id: string | null;
}
export type RunnerStartSessionResponse =
  | (RunnerOkBase & {
      data: {
        runner_session_id: string;
        browserbase_session_id: string | null;
        execution_mode: RunnerExecutionMode;
      };
    })
  | RunnerErrorResponse;

export interface RunnerOpenRouteRequest {
  session_id: string;
  route: string;
  /** v3.23.2: optional pre-built handshake URL the runner should open instead
   * of the internal route. When present, runner MUST navigate to this URL. */
  auth_url?: string;
}
export type RunnerOpenRouteResponse =
  | (RunnerOkBase & {
      data: { current_url: string; page_title: string | null };
    })
  | RunnerErrorResponse;

export interface RunnerObserveRequest {
  session_id: string;
  route: string;
}
export type RunnerObserveResponse =
  | (RunnerOkBase & { data: { observation: UiOperatorObservation } })
  | RunnerErrorResponse;

export interface RunnerProposeActionRequest {
  session_id: string;
  route: string;
  goal: string;
}
export type RunnerProposeActionResponse =
  | (RunnerOkBase & {
      data: {
        action_type: UiOperatorActionType;
        title: string;
        description: string;
        selector_hint: string | null;
        risk_level: UiOperatorRiskLevel;
        requires_confirmation: boolean;
      };
    })
  | RunnerErrorResponse;

export interface RunnerExecuteActionRequest {
  session_id: string;
  route: string;
  action_type: UiOperatorActionType;
  selector: string | null;
  confirmed: true;
}
export type RunnerExecuteActionResponse =
  | (RunnerOkBase & {
      data: {
        result_text: string;
        post_observation: UiOperatorObservation | null;
      };
    })
  | RunnerErrorResponse;

export interface RunnerStopSessionRequest {
  session_id: string;
}
export type RunnerStopSessionResponse =
  | (RunnerOkBase & { data: { closed: true } })
  | RunnerErrorResponse;

export interface RunnerHealthResponse {
  ok: boolean;
  status: RunnerStatus;
  safe_message: string;
  data?: {
    runner_version?: string;
    browserbase_configured?: boolean;
    stagehand_ready?: boolean;
  } | null;
  error_code?: string;
}

export type RunnerEndpoint =
  | "/health"
  | "/session/start"
  | "/session/open-route"
  | "/session/observe"
  | "/action/propose"
  | "/action/execute"
  | "/session/stop";
