import { supabase } from "@/integrations/supabase/client";

export type MasterSnapshotStatus =
  | "current"
  | "archived"
  | "draft_update"
  | "approved_update";

export type MasterSnapshotSource =
  | "manual"
  | "result_review"
  | "build_engine_handoff"
  | "action_queue"
  | "project_console"
  | "import";

export type MasterSnapshotEvent =
  | "master_snapshot_opened"
  | "master_snapshot_update_proposed"
  | "master_snapshot_update_approved"
  | "master_snapshot_update_rejected"
  | "master_snapshot_version_created"
  | "master_snapshot_markdown_import_started"
  | "master_snapshot_markdown_import_draft_created"
  | "master_snapshot_version_label_computed"
  | "master_snapshot_version_mismatch_detected"
  | "master_snapshot_version_integrity_checked"
  | "master_snapshot_version_saved";

export type MasterSnapshotChanges = {
  what_changed?: string;
  modules_completed?: string[];
  files_modified?: string[];
  migrations?: string[];
  typecheck_status?: string;
  build_status?: string;
  residual_risks?: string[];
  residual_limits?: string[];
  next_step?: string;
  sections_updated?: string[];
};

export type MasterSnapshotVersion = {
  id: string;
  user_id: string;
  brain_id: string | null;
  title: string;
  version_label: string;
  version_status: MasterSnapshotStatus;
  markdown_content: string;
  summary: string | null;
  reason: string | null;
  source: MasterSnapshotSource;
  source_id: string | null;
  previous_version_id: string | null;
  changes: MasterSnapshotChanges;
  metadata: Record<string, unknown>;
  approved_at: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
};

type Row = {
  id: string;
  user_id: string;
  brain_id: string | null;
  title: string;
  version_label: string;
  version_status: string;
  markdown_content: string;
  summary: string | null;
  reason: string | null;
  source: string;
  source_id: string | null;
  previous_version_id: string | null;
  changes: unknown;
  metadata: unknown;
  approved_at: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(r: Row): MasterSnapshotVersion {
  return {
    id: r.id,
    user_id: r.user_id,
    brain_id: r.brain_id,
    title: r.title,
    version_label: r.version_label,
    version_status: r.version_status as MasterSnapshotStatus,
    markdown_content: r.markdown_content,
    summary: r.summary,
    reason: r.reason,
    source: r.source as MasterSnapshotSource,
    source_id: r.source_id,
    previous_version_id: r.previous_version_id,
    changes: (r.changes ?? {}) as MasterSnapshotChanges,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    approved_at: r.approved_at,
    rejected_at: r.rejected_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function listMasterSnapshots(brainId?: string | null) {
  let q = supabase
    .from("master_snapshot_versions")
    .select("*")
    .order("created_at", { ascending: false });
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Row[]).map(mapRow);
}

export async function getCurrentMasterSnapshot(brainId?: string | null) {
  let q = supabase
    .from("master_snapshot_versions")
    .select("*")
    .eq("version_status", "current")
    .order("created_at", { ascending: false })
    .limit(1);
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) throw error;
  return data && data[0] ? mapRow(data[0] as Row) : null;
}

export async function getMasterSnapshot(id: string) {
  const { data, error } = await supabase
    .from("master_snapshot_versions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as Row) : null;
}

/** Parse a label like "1.10" / "v1.10" / "1.10-draft" → {major, minor} or null */
export function parseVersionLabel(
  label: string | null | undefined,
): { major: number; minor: number } | null {
  if (!label) return null;
  const cleaned = label.trim().replace(/^v/i, "").replace(/-draft$/i, "");
  const m = cleaned.match(/^(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

/** Canonical display label derived ONLY from structured DB fields. */
export function getSnapshotVersionLabel(
  snapshot: Pick<MasterSnapshotVersion, "version_label" | "version_status">,
): string {
  const parsed = parseVersionLabel(snapshot.version_label);
  if (!parsed) return snapshot.version_label || "?";
  const base = `${parsed.major}.${parsed.minor}`;
  return snapshot.version_status === "draft_update" ? `${base}-draft` : base;
}

/** Highest non-draft label across the provided versions, or null. */
function maxApprovedVersion(
  versions: MasterSnapshotVersion[],
): { major: number; minor: number } | null {
  let best: { major: number; minor: number } | null = null;
  for (const v of versions) {
    if (v.version_status === "draft_update") continue;
    const p = parseVersionLabel(v.version_label);
    if (!p) continue;
    if (!best || p.major > best.major || (p.major === best.major && p.minor > best.minor)) {
      best = p;
    }
  }
  return best;
}

/** Next deterministic version label given the full history. */
export function computeNextVersionLabel(versions: MasterSnapshotVersion[]): string {
  const best = maxApprovedVersion(versions);
  if (!best) return "1.0";
  return `${best.major}.${best.minor + 1}`;
}

function nextVersionLabel(current: string | null): string {
  const p = parseVersionLabel(current);
  if (!p) return "1.0";
  return `${p.major}.${p.minor + 1}`;
}

export type ProposeUpdateInput = {
  brainId?: string | null;
  reason: string;
  summary?: string;
  source: MasterSnapshotSource;
  sourceId?: string | null;
  changes: MasterSnapshotChanges;
  markdownContent?: string;
  title?: string;
};

export async function proposeMasterSnapshotUpdate(
  input: ProposeUpdateInput,
): Promise<MasterSnapshotVersion> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Devi essere autenticato");

  const current = await getCurrentMasterSnapshot(input.brainId ?? null);
  const baseContent = input.markdownContent ?? current?.markdown_content ?? "# Brain Hub — Master Project Snapshot\n\n_Documento iniziale._";
  const versionLabel = `${nextVersionLabel(current?.version_label ?? null)}-draft`;
  const title = input.title ?? current?.title ?? "Brain Hub — Master Project Snapshot";

  const { data, error } = await supabase
    .from("master_snapshot_versions")
    .insert({
      user_id: u.user.id,
      brain_id: input.brainId ?? null,
      title,
      version_label: versionLabel,
      version_status: "draft_update",
      markdown_content: baseContent,
      summary: input.summary ?? null,
      reason: input.reason,
      source: input.source,
      source_id: input.sourceId ?? null,
      previous_version_id: current?.id ?? null,
      changes: input.changes as never,
      metadata: {},
    } as never)
    .select("*")
    .single();
  if (error) throw error;
  await logMasterSnapshotEvent("master_snapshot_update_proposed", input.reason, {
    source: input.source,
    source_id: input.sourceId ?? null,
    draft_id: (data as Row).id,
  });
  return mapRow(data as Row);
}

export async function approveMasterSnapshotUpdate(
  draftId: string,
  finalMarkdown?: string,
): Promise<MasterSnapshotVersion> {
  const draft = await getMasterSnapshot(draftId);
  if (!draft) throw new Error("Bozza non trovata");
  if (draft.version_status !== "draft_update" && draft.version_status !== "approved_update") {
    throw new Error("Solo le bozze possono essere approvate");
  }

  // Defensive guard: archive ALL existing currents matching the same brain
  // context (brain_id can be null; match exactly). Prevents double-current.
  const { data: u } = await supabase.auth.getUser();
  if (u.user) {
    let q = supabase
      .from("master_snapshot_versions")
      .update({ version_status: "archived" } as never)
      .eq("user_id", u.user.id)
      .eq("version_status", "current")
      .neq("id", draftId);
    if (draft.brain_id === null) {
      q = q.is("brain_id", null);
    } else {
      q = q.eq("brain_id", draft.brain_id);
    }
    await q;
  }

  // Deterministically compute next label from ALL existing approved versions
  // (not just the draft's preset label, which may be stale if multiple drafts
  // were created off the same prior current).
  const allVersions = await listMasterSnapshots(draft.brain_id);
  const nextParsed = (() => {
    const best = maxApprovedVersion(
      allVersions.filter((v) => v.id !== draftId),
    );
    return best ? { major: best.major, minor: best.minor + 1 } : { major: 1, minor: 0 };
  })();
  const newLabel = `${nextParsed.major}.${nextParsed.minor}`;
  await logMasterSnapshotEvent("master_snapshot_version_label_computed", newLabel, {
    draft_id: draftId,
    draft_preset_label: draft.version_label,
    computed_label: newLabel,
    history_size: allVersions.length,
  });
  const update: Record<string, unknown> = {
    version_status: "current",
    version_label: newLabel,
    approved_at: new Date().toISOString(),
  };
  if (finalMarkdown && finalMarkdown !== draft.markdown_content) {
    update.markdown_content = finalMarkdown;
  }
  const { data, error } = await supabase
    .from("master_snapshot_versions")
    .update(update as never)
    .eq("id", draftId)
    .select("*")
    .single();
  if (error) throw error;
  await logMasterSnapshotEvent("master_snapshot_update_approved", draft.reason ?? "Approvato", {
    version_id: draftId,
    version_label: newLabel,
  });
  await logMasterSnapshotEvent("master_snapshot_version_created", newLabel, {
    version_id: draftId,
  });
  await logMasterSnapshotEvent("master_snapshot_version_saved", newLabel, {
    version_id: draftId,
    previous_label: draft.version_label,
  });
  return mapRow(data as Row);
}

export async function rejectMasterSnapshotUpdate(draftId: string, note?: string) {
  const { error } = await supabase
    .from("master_snapshot_versions")
    .update({
      version_status: "archived",
      rejected_at: new Date().toISOString(),
    } as never)
    .eq("id", draftId);
  if (error) throw error;
  await logMasterSnapshotEvent("master_snapshot_update_rejected", note ?? "Rifiutato", {
    version_id: draftId,
  });
}

export async function createInitialMasterSnapshot(
  markdown: string,
  brainId?: string | null,
): Promise<MasterSnapshotVersion> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Devi essere autenticato");
  const { data, error } = await supabase
    .from("master_snapshot_versions")
    .insert({
      user_id: u.user.id,
      brain_id: brainId ?? null,
      title: "Brain Hub — Master Project Snapshot",
      version_label: "1.0",
      version_status: "current",
      markdown_content: markdown,
      reason: "Versione iniziale",
      source: "manual",
      changes: {} as never,
      metadata: {},
      approved_at: new Date().toISOString(),
    } as never)
    .select("*")
    .single();
  if (error) throw error;
  await logMasterSnapshotEvent("master_snapshot_version_created", "1.0", {
    version_id: (data as Row).id,
  });
  return mapRow(data as Row);
}

export type CreateDraftFromMarkdownInput = {
  brainId?: string | null;
  reason: string;
  summary?: string;
  markdown: string;
  title?: string;
};

/**
 * Sostituisce righe tipo "**Versione documento:** 1.2" (o "Versione contenuto: ...")
 * con un placeholder gestito da Brain Hub. La versione ufficiale è quella della UI.
 * Idempotente, non distruttivo per il resto del contenuto.
 */
export function normalizeSnapshotMarkdownVersion(markdown: string): string {
  const replacement = "**Versione Snapshot:** gestita da Brain Hub";
  const re = /^[ \t]*(?:\*\*\s*)?Versione\s+(?:documento|contenuto)(?:\s*\*\*)?\s*:[^\n\r]*$/gim;
  return markdown.replace(re, replacement);
}

export async function createDraftFromMarkdown(
  input: CreateDraftFromMarkdownInput,
): Promise<MasterSnapshotVersion> {
  const normalizedMarkdown = normalizeSnapshotMarkdownVersion(input.markdown);
  const wasNormalized = normalizedMarkdown !== input.markdown;
  await logMasterSnapshotEvent(
    "master_snapshot_markdown_import_started",
    input.reason,
    {
      brain_id: input.brainId ?? null,
      length: input.markdown.length,
      normalized_version_line: wasNormalized,
    },
  );
  const draft = await proposeMasterSnapshotUpdate({
    brainId: input.brainId ?? null,
    reason: input.reason,
    summary: input.summary,
    source: "import",
    changes: {
      what_changed: wasNormalized
        ? "Import markdown completo (riga versione normalizzata)"
        : "Import markdown completo",
    },
    markdownContent: normalizedMarkdown,
    title: input.title,
  });
  await logMasterSnapshotEvent(
    "master_snapshot_markdown_import_draft_created",
    input.reason,
    {
      draft_id: draft.id,
      length: normalizedMarkdown.length,
      normalized_version_line: wasNormalized,
    },
  );
  return draft;
}

export async function logMasterSnapshotEvent(
  action: MasterSnapshotEvent,
  notes: string,
  metadata: Record<string, unknown> = {},
) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("clipboard_execution_logs").insert({
    user_id: u.user.id,
    clipboard_item_id: null,
    action,
    notes,
    metadata,
  } as never);
}
