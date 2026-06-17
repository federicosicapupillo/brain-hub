// Helpers per firma HMAC outbound verso webhook n8n.
// IMPORTANTE:
// - Il secret NON viene mai persistito in database.
// - Il secret è letto solo lato server da process.env[hmac_secret_env_key].
// - Non logghiamo mai il secret né la signature completa.

import { createHmac } from "crypto";

export const HMAC_SIGNATURE_VERSION = "v1";
export const DEFAULT_HMAC_SECRET_ENV_KEY = "N8N_WEBHOOK_SIGNING_SECRET";

export type HmacWorkflowConfig = {
  id: string;
  hmac_signing_enabled?: boolean | null;
  hmac_secret_env_key?: string | null;
};

export type HmacConfigResolved = {
  enabled: boolean;
  envKey: string;
  secretConfigured: boolean;
};

export function getN8nHmacConfig(workflow: HmacWorkflowConfig): HmacConfigResolved {
  const enabled = !!workflow.hmac_signing_enabled;
  const envKey = (workflow.hmac_secret_env_key || DEFAULT_HMAC_SECRET_ENV_KEY).trim();
  const secretConfigured = enabled ? hasHmacSecret(envKey) : hasHmacSecret(envKey);
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

export type BuildSignedHeadersInput = {
  payload: unknown;
  workflow: HmacWorkflowConfig;
  actionId?: string | null;
};

export type BuildSignedHeadersResult =
  | {
      enabled: true;
      headers: Record<string, string>;
      timestamp: string;
      signaturePreview: string;
      signatureVersion: string;
    }
  | { enabled: false }
  | { enabled: true; error: "secret_missing"; envKey: string };

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
  // Preview corta della signature: solo digest, 8 char dopo "sha256=".
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
