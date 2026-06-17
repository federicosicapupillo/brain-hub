// Costanti e tipi HMAC condivisibili con la UI.
// La lettura dei secret e la firma crypto stanno in n8n-hmac.server.ts.

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
