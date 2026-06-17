// Helpers server-only per firma HMAC outbound verso webhook n8n.
// IMPORTANTE:
// - Il secret NON viene mai persistito in database.
// - Il secret è letto solo lato server da process.env[hmac_secret_env_key].
// - Non logghiamo mai il secret né la signature completa.

import { createHmac } from "crypto";
import {
  DEFAULT_HMAC_SECRET_ENV_KEY,
  HMAC_SIGNATURE_VERSION,
  type BuildSignedHeadersInput,
  type BuildSignedHeadersResult,
  type HmacConfigResolved,
  type HmacWorkflowConfig,
} from "@/lib/n8n-hmac";

export function getN8nHmacConfig(workflow: HmacWorkflowConfig): HmacConfigResolved {
  const enabled = !!workflow.hmac_signing_enabled;
  const envKey = (workflow.hmac_secret_env_key || DEFAULT_HMAC_SECRET_ENV_KEY).trim();
  const secretConfigured = hasHmacSecret(envKey);
  return { enabled, envKey, secretConfigured };
}

export function hasHmacSecret(envKey: string): boolean {
  if (!envKey) return false;
  const v = process.env[envKey];
  return typeof v === "string" && v.length > 0;
}

export function signN8nPayload(payload: unknown, secret: string, timestamp: string): string {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const base = `${timestamp}.${body}`;
  const digest = createHmac("sha256", secret).update(base).digest("hex");
  return `sha256=${digest}`;
}

export function buildN8nSignedHeaders({
  payload,
  workflow,
  actionId,
}: BuildSignedHeadersInput): BuildSignedHeadersResult {
  const cfg = getN8nHmacConfig(workflow);
  if (!cfg.enabled) return { enabled: false };
  if (!cfg.secretConfigured) {
    return { enabled: true, error: "secret_missing", envKey: cfg.envKey };
  }
  const secret = process.env[cfg.envKey];
  if (!secret) return { enabled: true, error: "secret_missing", envKey: cfg.envKey };
  const timestamp = new Date().toISOString();
  const signature = signN8nPayload(payload, secret, timestamp);
  const headers: Record<string, string> = {
    "X-BrainHub-Signature": signature,
    "X-BrainHub-Timestamp": timestamp,
    "X-BrainHub-Workflow-Id": workflow.id,
    "X-BrainHub-Signature-Version": HMAC_SIGNATURE_VERSION,
  };
  if (actionId) headers["X-BrainHub-Action-Id"] = actionId;
  const digestOnly = signature.slice("sha256=".length);
  const signaturePreview = `sha256=${digestOnly.slice(0, 8)}…`;
  return {
    enabled: true,
    headers,
    timestamp,
    signaturePreview,
    signatureVersion: HMAC_SIGNATURE_VERSION,
  };
}