// Brain Hub v3.35b — External Execute Sandbox Foundation: registry.
//
// SINGLE SOURCE OF TRUTH for external action_type values. If an
// action_type is not declared here (or `enabled=false`), the external
// dispatcher MUST reject the request as `rejected_unknown_action` /
// `rejected_disabled`. There is no fallback path.
//
// v3.35b ships ONLY `external_webhook_test_ping` (LOW, sandbox). HIGH
// external actions are intentionally absent and remain blocked.

import type { RbacRiskLevel } from "@/lib/governance/rbacModel";

export interface ExternalActionEntry {
  action_type: string;
  connector_name: string;
  handler_name: string;
  risk_level: RbacRiskLevel;
  enabled: boolean;
  requires_confirmation: boolean; // for live execute
  supports_dry_run: boolean;
  supports_live_execute: boolean;
  supports_rollback: boolean;
  timeout_ms: number;
  allowed_payload_fields: ReadonlyArray<string>;
  sensitive_fields_redaction: ReadonlyArray<string>;
  expected_response_shape: { kind: "json_object" | "text"; max_preview_bytes: number };
}

/**
 * Sandbox/test endpoint reachable from the Worker. It is served by this
 * project at `/api/public/external-execute-sandbox-target` and always
 * returns a stable 200 JSON. NO secrets, NO PII.
 */
export const EXTERNAL_SANDBOX_TARGET_PATH =
  "/api/public/external-execute-sandbox-target";

export const EXTERNAL_ACTION_REGISTRY: Readonly<Record<string, ExternalActionEntry>> =
  Object.freeze({
    external_webhook_test_ping: {
      action_type: "external_webhook_test_ping",
      connector_name: "brainhub_sandbox",
      handler_name: "external_webhook_test_ping",
      risk_level: "low",
      enabled: true,
      requires_confirmation: true,
      supports_dry_run: true,
      supports_live_execute: true,
      supports_rollback: false,
      timeout_ms: 5000,
      allowed_payload_fields: [
        "message",
        "correlation_id",
        "dry_run",
        "live_execute",
        "confirmation_id",
      ],
      sensitive_fields_redaction: [
        "authorization",
        "token",
        "secret",
        "api_key",
        "password",
      ],
      expected_response_shape: { kind: "json_object", max_preview_bytes: 512 },
    },
  });

export function getExternalAction(action_type: string): ExternalActionEntry | null {
  return EXTERNAL_ACTION_REGISTRY[action_type] ?? null;
}
