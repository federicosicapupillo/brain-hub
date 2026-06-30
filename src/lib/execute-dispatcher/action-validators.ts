// Brain Hub v3.35a — Internal Execute payload validators.
//
// One validator per InternalActionType. Each validator returns a
// narrowed, sanitized payload to be stored in
// internal_execute_artifacts.payload. Validators are intentionally
// strict: unknown fields are dropped, required fields are enforced,
// and string lengths are capped to keep audit-readable.

import type { InternalActionType } from "./types";

export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string };

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function optStr(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return str(value, max);
}

function need(field: string): { ok: false; message: string } {
  return { ok: false, message: `missing_required_field:${field}` };
}

export function validatePayload(
  action_type: InternalActionType,
  raw: Record<string, unknown>,
): ValidationResult {
  const p = raw ?? {};
  switch (action_type) {
    case "create_action": {
      const title = str(p.title, 200);
      if (!title) return need("title");
      const description = optStr(p.description, 2000);
      const priority = optStr(p.priority, 32);
      return { ok: true, value: { title, description, priority } };
    }
    case "update_action": {
      const target_action_id = str(p.target_action_id, 64);
      if (!target_action_id) return need("target_action_id");
      const new_status = optStr(p.new_status, 64);
      const note = optStr(p.note, 2000);
      if (!new_status && !note) return need("new_status_or_note");
      return { ok: true, value: { target_action_id, new_status, note } };
    }
    case "prepare_email_draft": {
      const to = str(p.to, 320);
      const subject = str(p.subject, 300);
      const body = str(p.body, 20000);
      if (!to) return need("to");
      if (!subject) return need("subject");
      if (!body) return need("body");
      return { ok: true, value: { to, subject, body, sent: false } };
    }
    case "prepare_codex_prompt": {
      const prompt = str(p.prompt, 20000);
      if (!prompt) return need("prompt");
      const context_ref = optStr(p.context_ref, 200);
      return { ok: true, value: { prompt, context_ref, executed: false } };
    }
    case "create_review": {
      const subject_kind = str(p.subject_kind, 64);
      const subject_id = str(p.subject_id, 200);
      const verdict = str(p.verdict, 64);
      if (!subject_kind) return need("subject_kind");
      if (!subject_id) return need("subject_id");
      if (!verdict) return need("verdict");
      const note = optStr(p.note, 2000);
      return { ok: true, value: { subject_kind, subject_id, verdict, note } };
    }
    case "create_project_note": {
      const project_id = str(p.project_id, 100);
      const note = str(p.note, 4000);
      if (!project_id) return need("project_id");
      if (!note) return need("note");
      return { ok: true, value: { project_id, note } };
    }
    case "create_snapshot": {
      const label = str(p.label, 200);
      if (!label) return need("label");
      const summary = optStr(p.summary, 4000);
      return { ok: true, value: { label, summary, captured_at: new Date().toISOString() } };
    }
    case "create_memory_entry": {
      const scope = str(p.scope, 64);
      const content = str(p.content, 4000);
      if (!scope) return need("scope");
      if (!content) return need("content");
      return { ok: true, value: { scope, content } };
    }
  }
}

export function deriveTitle(
  action_type: InternalActionType,
  payload: Record<string, unknown>,
): string {
  const pick = (k: string): string => {
    const v = payload[k];
    return typeof v === "string" ? v.slice(0, 80) : "";
  };
  switch (action_type) {
    case "create_action":
    case "create_snapshot":
      return pick("title") || pick("label") || action_type;
    case "update_action":
      return `update ${pick("target_action_id")}`.trim();
    case "prepare_email_draft":
      return `draft: ${pick("subject")}`.trim();
    case "prepare_codex_prompt":
      return "codex prompt";
    case "create_review":
      return `review ${pick("subject_kind")}:${pick("subject_id")}`;
    case "create_project_note":
      return `note ${pick("project_id")}`.trim();
    case "create_memory_entry":
      return `memory:${pick("scope")}`;
  }
}
