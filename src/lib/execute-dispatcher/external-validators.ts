// Brain Hub v3.35b — External Execute payload validation & redaction.
//
// Strict allowlist: any field outside `allowed_payload_fields` is a
// validation failure. No coercion of unknown values. Sensitive fields
// are always stripped from payload previews and response previews.

import type { ExternalActionEntry } from "./external-registry";

export interface ExternalValidatedPayload {
  message: string;
  correlation_id: string;
  dry_run: boolean;
  live_execute: boolean;
  confirmation_id: string | null;
  // v3.36 — only populated for action_types that route to a workflow
  // allowlist (currently `external_n8n_controlled_webhook`).
  workflow_key: string | null;
  title: string | null;
  metadata: Record<string, unknown> | null;
}

export type ExternalValidationResult =
  | { ok: true; value: ExternalValidatedPayload }
  | { ok: false; message: string };

// v3.36.1 — redaction hardening. Order is binding:
//   1) JWT generic (header/body/logs/anywhere serialized).
//   2) Querystring secret parameters (token|key|secret|access_token).
//   3) Bearer tokens.
//   4) sk-… style keys.
//   5) Email addresses.
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const QS_SECRET_RE = /([?&](?:token|key|secret|access_token)=)[^&\s"']+/gi;
const BEARER_RE = /bearer\s+[A-Za-z0-9._\-+/=%]+/gi;
const SK_RE = /sk-[A-Za-z0-9_-]{6,}/gi;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/g;


// Hard-blocked payload keys — never accepted regardless of allowlist.
// Forbids clients from supplying URLs, headers or secrets directly.
const HARD_FORBIDDEN_PAYLOAD_KEYS: ReadonlyArray<string> = [
  "arbitrary_url",
  "webhook_url",
  "url",
  "endpoint",
  "raw_headers",
  "raw_body",
  "attachment",
  "file",
  "html",
];

function validateMetadata(raw: unknown): {
  ok: boolean;
  value?: Record<string, unknown>;
  message?: string;
} {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "metadata_must_be_object" };
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length > 8) return { ok: false, message: "metadata_too_many_keys" };
  for (const k of keys) {
    const lk = k.toLowerCase();
    if (HARD_FORBIDDEN_PAYLOAD_KEYS.includes(lk)) {
      return { ok: false, message: `metadata_field_forbidden:${k}` };
    }
    if (
      lk.includes("authorization") ||
      lk.includes("token") ||
      lk.includes("secret") ||
      lk.includes("api_key") ||
      lk.includes("apikey") ||
      lk.includes("password") ||
      lk.includes("bearer")
    ) {
      return { ok: false, message: `metadata_field_sensitive:${k}` };
    }
    const v = obj[k];
    if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
      return { ok: false, message: `metadata_field_invalid_type:${k}` };
    }
    if (typeof v === "string" && v.length > 240) {
      return { ok: false, message: `metadata_field_too_long:${k}` };
    }
  }
  return { ok: true, value: obj };
}

export function validateExternalPayload(
  entry: ExternalActionEntry,
  raw: Record<string, unknown>,
): ExternalValidationResult {
  const p = raw ?? {};
  // Reject hard-forbidden keys first (defense in depth).
  for (const k of Object.keys(p)) {
    if (HARD_FORBIDDEN_PAYLOAD_KEYS.includes(k.toLowerCase())) {
      return { ok: false, message: `payload_field_forbidden:${k}` };
    }
  }
  // Reject unknown fields up-front.
  for (const k of Object.keys(p)) {
    if (!entry.allowed_payload_fields.includes(k)) {
      return { ok: false, message: `payload_field_not_allowed:${k}` };
    }
  }
  // Reject any sensitive-field name leaking into payload.
  for (const k of Object.keys(p)) {
    const lk = k.toLowerCase();
    if (entry.sensitive_fields_redaction.some((s) => lk.includes(s))) {
      return { ok: false, message: `payload_field_sensitive:${k}` };
    }
  }
  const message = typeof p.message === "string" ? p.message.trim() : "";
  if (!message || message.length > 400) {
    return { ok: false, message: "invalid_message" };
  }
  const correlation_id =
    typeof p.correlation_id === "string" ? p.correlation_id.trim() : "";
  if (!correlation_id || correlation_id.length > 120) {
    return { ok: false, message: "invalid_correlation_id" };
  }
  const dry_run = p.dry_run === true;
  const live_execute = p.live_execute === true;
  if (dry_run === live_execute) {
    return { ok: false, message: "must_set_exactly_one_of:dry_run|live_execute" };
  }
  const confirmation_id =
    typeof p.confirmation_id === "string" && p.confirmation_id.trim()
      ? p.confirmation_id.trim().slice(0, 120)
      : null;

  // Optional, action-type-aware fields.
  let workflow_key: string | null = null;
  let title: string | null = null;
  let metadata: Record<string, unknown> | null = null;

  const needsWorkflow =
    Array.isArray(entry.allowlisted_workflow_keys) &&
    entry.allowlisted_workflow_keys.length > 0;

  if (needsWorkflow) {
    const wk = typeof p.workflow_key === "string" ? p.workflow_key.trim() : "";
    if (!wk) return { ok: false, message: "missing_workflow_key" };
    if (!entry.allowlisted_workflow_keys!.includes(wk)) {
      return { ok: false, message: "workflow_not_allowlisted" };
    }
    workflow_key = wk;

    const t = typeof p.title === "string" ? p.title.trim() : "";
    if (!t || t.length > 200) {
      return { ok: false, message: "invalid_title" };
    }
    title = t;

    const mres = validateMetadata(p.metadata);
    if (!mres.ok) return { ok: false, message: mres.message ?? "invalid_metadata" };
    metadata = mres.value ?? null;
  } else {
    if (p.workflow_key !== undefined)
      return { ok: false, message: "payload_field_not_allowed:workflow_key" };
    if (p.title !== undefined)
      return { ok: false, message: "payload_field_not_allowed:title" };
    if (p.metadata !== undefined)
      return { ok: false, message: "payload_field_not_allowed:metadata" };
  }

  return {
    ok: true,
    value: {
      message,
      correlation_id,
      dry_run,
      live_execute,
      confirmation_id,
      workflow_key,
      title,
      metadata,
    },
  };
}

export function redactString(s: string): string {
  if (!s) return s;
  // Apply in binding order: JWT → querystring → Bearer → sk- → email.
  return s
    .replace(JWT_RE, "[REDACTED]")
    .replace(QS_SECRET_RE, "$1[REDACTED]")
    .replace(BEARER_RE, "Bearer [REDACTED]")
    .replace(SK_RE, "[REDACTED]")
    .replace(EMAIL_RE, "[redacted-email]");
}


export function redactObject(
  obj: Record<string, unknown>,
  sensitive: ReadonlyArray<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    if (sensitive.some((s) => lk.includes(s))) {
      out[k] = "[redacted]";
      continue;
    }
    if (typeof v === "string") out[k] = redactString(v);
    else if (v && typeof v === "object" && !Array.isArray(v))
      out[k] = redactObject(v as Record<string, unknown>, sensitive);
    else out[k] = v;
  }
  return out;
}

export function previewResponseText(
  text: string,
  maxBytes: number,
  sensitive: ReadonlyArray<string>,
): string {
  const trimmed = text.length > maxBytes ? text.slice(0, maxBytes) + "…" : text;
  let redacted = redactString(trimmed);
  // Best-effort object redaction if response parses as JSON.
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      redacted = JSON.stringify(
        redactObject(parsed as Record<string, unknown>, sensitive),
      );
    }
  } catch {
    /* keep redacted text form */
  }
  return redacted;
}

export function hashRequest(input: unknown): string {
  // Cheap deterministic non-crypto hash for audit correlation only.
  const s = JSON.stringify(input ?? null);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16)}`;
}
