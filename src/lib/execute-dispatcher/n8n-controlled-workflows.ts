// Brain Hub v3.36 — External MEDIUM Connector: n8n controlled workflow
// allowlist (single source of truth, server-side only).
//
// Workflow keys NOT declared here are REJECTED by the dispatcher. There
// is no dynamic dispatch from a free string and no client-supplied URL.
// Each workflow declares its own endpoint env var so secrets stay in
// the server runtime.
//
// v3.36 ships exactly ONE workflow at MEDIUM. Telegram-approval is the
// recommended target. The fallback `brainhub_n8n_controlled_echo_medium`
// exists for environments where the Telegram Approval Layer is not
// reachable — see docs/engineering/eqg-reports/v3.36-external-medium-connector.md
// for the rationale that applies in this environment.

import type { RbacRiskLevel } from "@/lib/governance/rbacModel";

export interface N8nControlledWorkflowEntry {
  workflow_key: string;
  display_name: string;
  description: string;
  risk_level: RbacRiskLevel;
  enabled: boolean;
  supports_dry_run: boolean;
  supports_live_execute: boolean;
  supports_rollback: boolean;
  endpoint_env_var: string;
  timeout_ms: number;
  required_fields: ReadonlyArray<"workflow_key" | "title" | "message" | "correlation_id">;
  redaction_rules: ReadonlyArray<string>;
  expected_response_shape: { kind: "json_object" | "text"; max_preview_bytes: number };
  /**
   * Declares the worst side-effect this workflow can produce. Used by
   * the EQG report and by the dispatcher's "no HIGH live" guard. NEVER
   * widen without an EQG patch.
   */
  side_effect_profile:
    | "echo_safe" // no external write — echoes back the payload
    | "telegram_preview" // sends a Telegram preview message; no automated approval
    | "n8n_controlled_safe"; // any other internal-to-n8n controlled flow
  /** n8n test/sandbox mode is unavailable for this workflow → dry-run stays local. */
  n8n_test_mode_available: boolean;
}

export const N8N_CONTROLLED_WORKFLOWS: Readonly<
  Record<string, N8nControlledWorkflowEntry>
> = Object.freeze({
  brainhub_telegram_approval_preview: {
    workflow_key: "brainhub_telegram_approval_preview",
    display_name: "Telegram Approval Preview",
    description:
      "Sends a controlled preview to the Telegram Approval Layer workflow on n8n. Does not auto-approve, does not publish, does not send email.",
    risk_level: "medium",
    enabled: true,
    supports_dry_run: true,
    supports_live_execute: true,
    supports_rollback: false,
    endpoint_env_var: "BRAINHUB_N8N_CONTROLLED_WEBHOOK_URL",
    timeout_ms: 8000,
    required_fields: ["workflow_key", "title", "message", "correlation_id"],
    redaction_rules: [
      "authorization",
      "token",
      "secret",
      "api_key",
      "apikey",
      "password",
      "bearer",
      "webhook_url",
    ],
    expected_response_shape: { kind: "json_object", max_preview_bytes: 512 },
    side_effect_profile: "telegram_preview",
    n8n_test_mode_available: false,
  },
  brainhub_n8n_controlled_echo_medium: {
    workflow_key: "brainhub_n8n_controlled_echo_medium",
    display_name: "n8n Controlled Echo (MEDIUM)",
    description:
      "Echo-only workflow on n8n. Calls a real n8n endpoint but produces no external side effect. Used when the Telegram Approval Layer is not reachable in this environment.",
    risk_level: "medium",
    enabled: true,
    supports_dry_run: true,
    supports_live_execute: true,
    supports_rollback: false,
    endpoint_env_var: "BRAINHUB_N8N_CONTROLLED_WEBHOOK_URL",
    timeout_ms: 8000,
    required_fields: ["workflow_key", "title", "message", "correlation_id"],
    redaction_rules: [
      "authorization",
      "token",
      "secret",
      "api_key",
      "apikey",
      "password",
      "bearer",
      "webhook_url",
    ],
    expected_response_shape: { kind: "json_object", max_preview_bytes: 512 },
    side_effect_profile: "echo_safe",
    n8n_test_mode_available: false,
  },
});

export function getControlledWorkflow(
  workflow_key: string,
): N8nControlledWorkflowEntry | null {
  return N8N_CONTROLLED_WORKFLOWS[workflow_key] ?? null;
}

export function isWorkflowAllowlisted(workflow_key: string): boolean {
  const entry = N8N_CONTROLLED_WORKFLOWS[workflow_key];
  return Boolean(entry && entry.enabled);
}
