// Brain Hub v3.35b — External Execute payload validation & redaction.
//
// Strict allowlist: any field outside `allowed_payload_fields` is a
// validation failure. No coercion of unknown values. Sensitive fields
// are always stripped from payload previews and response previews.

import type { ExternalActionEntry } from "./external-registry";

export type ExternalValidationResult =
  | {
      ok: true;
      value: {
        message: string;
        correlation_id: string;
        dry_run: boolean;
        live_execute: boolean;
        confirmation_id: string | null;
      };
    }
  | { ok: false; message: string };

const SENSITIVE_TOKEN_RE =
  /(bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{10,}|eyj[a-z0-9_-]{20,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,})/gi;

export function validateExternalPayload(
  entry: ExternalActionEntry,
  raw: Record<string, unknown>,
): ExternalValidationResult {
  const p = raw ?? {};
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
  if (!message || message.length > 200) {
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
  return {
    ok: true,
    value: { message, correlation_id, dry_run, live_execute, confirmation_id },
  };
}

export function redactString(s: string): string {
  return s
    .replace(SENSITIVE_TOKEN_RE, "[redacted]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/g, "[redacted-email]");
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
