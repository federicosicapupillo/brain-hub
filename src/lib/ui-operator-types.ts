// Brain Hub v3.23 — Jack UI Operator types.
// All types are JSON-safe and used by both server functions and UI.

export type UiOperatorProvider = "browserbase_stagehand" | "mock";

export type UiOperatorStatus =
  | "created"
  | "active"
  | "navigating"
  | "observing"
  | "proposing"
  | "awaiting_confirmation"
  | "executing"
  | "completed"
  | "stopped"
  | "expired"
  | "blocked_by_policy"
  | "route_not_allowed"
  | "stagehand_error"
  | "not_configured";

export type UiOperatorRiskLevel = "low" | "medium" | "high" | "forbidden";

export type UiOperatorActionType =
  // low risk
  | "open_route"
  | "observe_screen"
  | "scroll"
  | "read_state"
  | "open_detail"
  | "change_tab"
  // medium risk
  | "click_sync"
  | "open_dialog"
  | "prepare_action"
  | "save_safe_result"
  // high risk
  | "disconnect_connection"
  | "remove_connection"
  | "approve_action_queue"
  | "execute_n8n"
  | "update_master_snapshot"
  | "confirm_operation"
  | "delete_resource"
  // forbidden
  | "handle_password"
  | "complete_external_oauth"
  | "send_email"
  | "modify_gmail"
  | "navigate_external"
  | "click_payment"
  | "click_external_authorization";

export type UiOperatorActionStatus =
  | "proposed"
  | "confirmed"
  | "executing"
  | "executed"
  | "blocked"
  | "failed"
  | "cancelled";

export interface UiOperatorSession {
  id: string;
  user_id: string;
  brain_id: string | null;
  provider: UiOperatorProvider;
  status: UiOperatorStatus;
  target_route: string | null;
  current_url: string | null;
  browserbase_session_id: string | null;
  last_screenshot_hash: string | null;
  last_observation: string | null;
  last_observed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface UiOperatorAction {
  id: string;
  session_id: string;
  user_id: string;
  brain_id: string | null;
  route: string | null;
  action_type: UiOperatorActionType;
  title: string;
  description: string | null;
  risk_level: UiOperatorRiskLevel;
  status: UiOperatorActionStatus;
  requires_confirmation: boolean;
  confirmed_at: string | null;
  executed_at: string | null;
  blocked_at: string | null;
  failed_at: string | null;
  selector: string | null;
  coordinates: { x: number; y: number } | null;
  input_text_preview: string | null;
  safety_reason: string | null;
  result_text: string | null;
  error_text: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UiOperatorObservation {
  route: string;
  current_url: string;
  page_title: string | null;
  summary: string;
  detected_state: string | null;
  available_actions: Array<{
    action_type: UiOperatorActionType;
    title: string;
    selector_hint: string | null;
    risk_level: UiOperatorRiskLevel;
  }>;
  screenshot_hash: string | null;
  captured_at: string;
  mock: boolean;
}

export interface UiOperatorSafetyDecision {
  allowed: boolean;
  risk_level: UiOperatorRiskLevel;
  requires_confirmation: boolean;
  reason: string | null;
  warning: string | null;
}

export interface UiOperatorRunResult {
  ok: boolean;
  status: UiOperatorStatus | UiOperatorActionStatus | "not_configured";
  message: string;
  session?: UiOperatorSession | null;
  action?: UiOperatorAction | null;
  observation?: UiOperatorObservation | null;
  safety?: UiOperatorSafetyDecision | null;
}
