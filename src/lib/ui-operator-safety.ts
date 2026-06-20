// Brain Hub v3.23 — Jack UI Operator safety policy.
// Pure functions, no DB / browser deps. Used by server functions, UI, and tools.

import type {
  UiOperatorActionType,
  UiOperatorRiskLevel,
  UiOperatorSafetyDecision,
} from "./ui-operator-types";

export const ALLOWED_UI_ROUTES: ReadonlyArray<string> = [
  "/gmail-connector",
  "/gmail-intelligence",
  "/operating-dashboard",
  "/action-queue",
  "/project-console",
  "/master-snapshot",
  "/loop-qa",
  "/tool-connections",
  "/ui-operator-lab",
];

// Domains UI Operator must never navigate to even if asked.
export const FORBIDDEN_EXTERNAL_DOMAINS: ReadonlyArray<string> = [
  "accounts.google.com",
  "myaccount.google.com",
  "login.live.com",
  "login.microsoftonline.com",
  "appleid.apple.com",
  "github.com/login",
  "checkout.stripe.com",
  "paypal.com",
  "facebook.com/login",
];

const LOW_RISK: ReadonlySet<UiOperatorActionType> = new Set([
  "open_route",
  "observe_screen",
  "scroll",
  "read_state",
  "open_detail",
  "change_tab",
]);

const MEDIUM_RISK: ReadonlySet<UiOperatorActionType> = new Set([
  "click_sync",
  "open_dialog",
  "prepare_action",
  "save_safe_result",
]);

const HIGH_RISK: ReadonlySet<UiOperatorActionType> = new Set([
  "disconnect_connection",
  "remove_connection",
  "approve_action_queue",
  "execute_n8n",
  "update_master_snapshot",
  "confirm_operation",
  "delete_resource",
]);

const FORBIDDEN: ReadonlySet<UiOperatorActionType> = new Set([
  "handle_password",
  "complete_external_oauth",
  "send_email",
  "modify_gmail",
  "navigate_external",
  "click_payment",
  "click_external_authorization",
]);

export function classifyUiOperatorActionRisk(
  actionType: UiOperatorActionType,
): UiOperatorRiskLevel {
  if (FORBIDDEN.has(actionType)) return "forbidden";
  if (HIGH_RISK.has(actionType)) return "high";
  if (MEDIUM_RISK.has(actionType)) return "medium";
  if (LOW_RISK.has(actionType)) return "low";
  return "high";
}

export function isRouteAllowedForUiOperator(route: string | null | undefined): boolean {
  if (!route || typeof route !== "string") return false;
  if (!route.startsWith("/")) return false;
  // Strip query/hash
  const path = route.split("?")[0]?.split("#")[0] ?? "";
  return ALLOWED_UI_ROUTES.some(
    (allowed) => path === allowed || path.startsWith(allowed + "/"),
  );
}

export function isActionAllowedForUiOperator(
  actionType: UiOperatorActionType,
  route: string | null | undefined,
): boolean {
  if (classifyUiOperatorActionRisk(actionType) === "forbidden") return false;
  if (!isRouteAllowedForUiOperator(route)) return false;
  return true;
}

export function requiresUiOperatorConfirmation(
  actionType: UiOperatorActionType,
): boolean {
  const risk = classifyUiOperatorActionRisk(actionType);
  return risk === "medium" || risk === "high" || risk === "forbidden";
}

export function getUiOperatorSafetyWarning(
  actionType: UiOperatorActionType,
): string | null {
  const risk = classifyUiOperatorActionRisk(actionType);
  if (risk === "forbidden") {
    return "Azione vietata da policy: Jack non può eseguirla in nessun caso.";
  }
  if (risk === "high") {
    return "Azione ad alto rischio. Conferma esplicita richiesta.";
  }
  if (risk === "medium") {
    return "Azione che modifica lo stato. Conferma richiesta.";
  }
  return null;
}

export function decideUiOperatorSafety(input: {
  action_type: UiOperatorActionType;
  route: string | null;
}): UiOperatorSafetyDecision {
  const risk = classifyUiOperatorActionRisk(input.action_type);
  if (risk === "forbidden") {
    return {
      allowed: false,
      risk_level: "forbidden",
      requires_confirmation: false,
      reason: "action_forbidden_by_policy",
      warning: getUiOperatorSafetyWarning(input.action_type),
    };
  }
  if (!isRouteAllowedForUiOperator(input.route)) {
    return {
      allowed: false,
      risk_level: risk,
      requires_confirmation: requiresUiOperatorConfirmation(input.action_type),
      reason: "route_not_allowed",
      warning: "Route non consentita per UI Operator.",
    };
  }
  return {
    allowed: true,
    risk_level: risk,
    requires_confirmation: requiresUiOperatorConfirmation(input.action_type),
    reason: null,
    warning: getUiOperatorSafetyWarning(input.action_type),
  };
}

export function isExternalDomainForbidden(url: string): boolean {
  try {
    const parsed = new URL(url);
    return FORBIDDEN_EXTERNAL_DOMAINS.some((d) => parsed.hostname.includes(d));
  } catch {
    return false;
  }
}
