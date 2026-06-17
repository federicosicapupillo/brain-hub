import { supabase } from "@/integrations/supabase/client";

// ============================================================
// Brain Hub v2.8 — Google Drive Knowledge (read-only)
// ============================================================
// Strict client-side helpers for drive_connection_settings + drive_file_map.
// No file write/delete/move. No content download.
// ============================================================

export type DriveConnectionStatus =
  | "not_configured"
  | "manual"
  | "connected"
  | "partial"
  | "error";

export const DRIVE_CONNECTION_STATUS_LABEL: Record<DriveConnectionStatus, string> = {
  not_configured: "Non configurato",
  manual: "Manuale (link)",
  connected: "Collegato",
  partial: "Parziale",
  error: "Errore",
};

export const DRIVE_CONNECTION_STATUS_TONE: Record<DriveConnectionStatus, string> = {
  not_configured: "bg-muted text-muted-foreground border-border",
  manual: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  connected: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  partial: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  error: "bg-red-500/10 text-red-600 border-red-500/30",
};

export type DriveConnection = {
  id: string;
  user_id: string;
  brain_id: string | null;
  label: string;
  provider: string;
  connection_status: DriveConnectionStatus;
  root_folder_id: string | null;
  root_folder_name: string | null;
  last_sync_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DriveFileCategory =
  | "contratti"
  | "offerte"
  | "fatture"
  | "marketing"
  | "procedure"
  | "meeting"
  | "clienti"
  | "progetti"
  | "immagini"
  | "video"
  | "documenti_legali"
  | "altro";

export const DRIVE_CATEGORY_LABEL: Record<DriveFileCategory, string> = {
  contratti: "Contratti",
  offerte: "Offerte",
  fatture: "Fatture",
  marketing: "Marketing",
  procedure: "Procedure",
  meeting: "Meeting",
  clienti: "Clienti",
  progetti: "Progetti",
  immagini: "Immagini",
  video: "Video",
  documenti_legali: "Documenti legali",
  altro: "Altro",
};

export type DriveFileStatus = "mapped" | "linked" | "archived";

export type DriveFile = {
  id: string;
  user_id: string;
  brain_id: string | null;
  connection_id: string | null;
  google_file_id: string | null;
  parent_google_file_id: string | null;
  name: string;
  mime_type: string | null;
  web_url: string | null;
  icon_url: string | null;
  size_bytes: number | null;
  modified_time: string | null;
  path: string | null;
  category: DriveFileCategory | null;
  status: DriveFileStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DriveKnowledgeEvent =
  | "drive_connection_created"
  | "drive_connection_updated"
  | "drive_metadata_sync_started"
  | "drive_metadata_sync_completed"
  | "drive_metadata_sync_failed"
  | "drive_manual_link_added"
  | "drive_file_mapped"
  | "drive_knowledge_source_created"
  | "drive_organization_suggested"
  | "drive_connection_opened"
  | "google_drive_oauth_started"
  | "google_drive_oauth_completed"
  | "google_drive_oauth_failed"
  | "google_drive_disconnected"
  | "google_drive_metadata_sync_started"
  | "google_drive_metadata_sync_completed"
  | "google_drive_metadata_sync_failed";

// ------------------------------------------------------------
// Logging
// ------------------------------------------------------------

export async function logDriveKnowledgeEvent(
  action: DriveKnowledgeEvent,
  notes: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
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

// ------------------------------------------------------------
// Heuristic categorization
// ------------------------------------------------------------

const CATEGORY_RULES: Array<{ category: DriveFileCategory; keywords: string[] }> = [
  { category: "contratti", keywords: ["contratto", "contract", "nda", "accord"] },
  { category: "offerte", keywords: ["offerta", "offer", "preventivo", "quote", "proposal"] },
  { category: "fatture", keywords: ["fattura", "invoice", "ricevuta", "receipt"] },
  { category: "marketing", keywords: ["marketing", "campagna", "campaign", "ads", "social", "brand"] },
  { category: "procedure", keywords: ["procedura", "sop", "process", "manuale", "manual", "playbook"] },
  { category: "meeting", keywords: ["meeting", "riunione", "minute", "verbale", "agenda"] },
  { category: "clienti", keywords: ["cliente", "client", "customer", "crm"] },
  { category: "progetti", keywords: ["progetto", "project", "roadmap", "milestone"] },
  { category: "documenti_legali", keywords: ["legal", "legale", "privacy", "gdpr", "policy"] },
];

const MIME_CATEGORY: Array<{ category: DriveFileCategory; mimePrefix: string }> = [
  { category: "immagini", mimePrefix: "image/" },
  { category: "video", mimePrefix: "video/" },
];

export function categorizeDriveFile(file: {
  name: string;
  mime_type?: string | null;
  path?: string | null;
}): DriveFileCategory {
  const hay = `${file.name} ${file.path ?? ""}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => hay.includes(k))) return rule.category;
  }
  if (file.mime_type) {
    for (const m of MIME_CATEGORY) {
      if (file.mime_type.startsWith(m.mimePrefix)) return m.category;
    }
  }
  return "altro";
}

// ------------------------------------------------------------
// Connections
// ------------------------------------------------------------

export async function getDriveConnections(
  brainId?: string | null,
): Promise<DriveConnection[]> {
  let q = supabase
    .from("drive_connection_settings" as never)
    .select("*")
    .order("created_at", { ascending: false });
  if (brainId) q = q.or(`brain_id.eq.${brainId},brain_id.is.null`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as DriveConnection[];
}

export type CreateDriveConnectionInput = {
  label: string;
  brainId?: string | null;
  rootFolderId?: string | null;
  rootFolderName?: string | null;
  connectionStatus?: DriveConnectionStatus;
  metadata?: Record<string, unknown>;
};

export async function createDriveConnection(
  input: CreateDriveConnectionInput,
): Promise<DriveConnection> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non autenticato");

  const { data, error } = await supabase
    .from("drive_connection_settings" as never)
    .insert({
      user_id: u.user.id,
      brain_id: input.brainId ?? null,
      label: input.label.trim() || "Google Drive",
      provider: "google_drive",
      connection_status: input.connectionStatus ?? "not_configured",
      root_folder_id: input.rootFolderId ?? null,
      root_folder_name: input.rootFolderName ?? null,
      metadata: input.metadata ?? {},
    } as never)
    .select("*")
    .single();
  if (error) throw error;
  const row = data as unknown as DriveConnection;
  await logDriveKnowledgeEvent("drive_connection_created", `Drive connection: ${row.label}`, {
    connection_id: row.id,
    brain_id: row.brain_id,
    status: row.connection_status,
  });
  return row;
}

export type UpdateDriveConnectionInput = {
  label?: string;
  rootFolderId?: string | null;
  rootFolderName?: string | null;
  connectionStatus?: DriveConnectionStatus;
  lastSyncAt?: string | null;
  metadata?: Record<string, unknown>;
};

export async function updateDriveConnection(
  id: string,
  input: UpdateDriveConnectionInput,
): Promise<DriveConnection> {
  const patch: Record<string, unknown> = {};
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.rootFolderId !== undefined) patch.root_folder_id = input.rootFolderId;
  if (input.rootFolderName !== undefined) patch.root_folder_name = input.rootFolderName;
  if (input.connectionStatus !== undefined) patch.connection_status = input.connectionStatus;
  if (input.lastSyncAt !== undefined) patch.last_sync_at = input.lastSyncAt;
  if (input.metadata !== undefined) patch.metadata = input.metadata;

  const { data, error } = await supabase
    .from("drive_connection_settings" as never)
    .update(patch as never)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  const row = data as unknown as DriveConnection;
  await logDriveKnowledgeEvent("drive_connection_updated", `Drive connection updated`, {
    connection_id: row.id,
    status: row.connection_status,
  });
  return row;
}

// ------------------------------------------------------------
// File map
// ------------------------------------------------------------

export type ListDriveFileMapFilters = {
  brainId?: string | null;
  connectionId?: string | null;
  category?: DriveFileCategory | null;
  mimePrefix?: string | null;
  status?: DriveFileStatus | null;
  search?: string | null;
  limit?: number;
};

export async function listDriveFileMap(
  filters: ListDriveFileMapFilters = {},
): Promise<DriveFile[]> {
  let q = supabase
    .from("drive_file_map" as never)
    .select("*")
    .order("modified_time", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 200);
  if (filters.brainId) q = q.or(`brain_id.eq.${filters.brainId},brain_id.is.null`);
  if (filters.connectionId) q = q.eq("connection_id", filters.connectionId);
  if (filters.category) q = q.eq("category", filters.category);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.mimePrefix) q = q.ilike("mime_type", `${filters.mimePrefix}%`);
  if (filters.search) q = q.ilike("name", `%${filters.search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as DriveFile[];
}

// ------------------------------------------------------------
// Manual link import
// ------------------------------------------------------------

export type ImportManualDriveLinkInput = {
  url: string;
  name?: string;
  brainId?: string | null;
  connectionId?: string | null;
  mimeType?: string | null;
  path?: string | null;
};

const DRIVE_FILE_RE = /\/file\/d\/([a-zA-Z0-9_-]+)/;
const DRIVE_OPEN_RE = /[?&]id=([a-zA-Z0-9_-]+)/;
const DRIVE_FOLDER_RE = /\/folders\/([a-zA-Z0-9_-]+)/;

export function extractGoogleFileId(url: string): {
  id: string | null;
  kind: "file" | "folder" | "unknown";
} {
  const file = DRIVE_FILE_RE.exec(url);
  if (file) return { id: file[1], kind: "file" };
  const open = DRIVE_OPEN_RE.exec(url);
  if (open) return { id: open[1], kind: "file" };
  const folder = DRIVE_FOLDER_RE.exec(url);
  if (folder) return { id: folder[1], kind: "folder" };
  return { id: null, kind: "unknown" };
}

export async function importManualDriveLink(
  input: ImportManualDriveLinkInput,
): Promise<DriveFile> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non autenticato");

  const trimmedUrl = input.url.trim();
  if (!trimmedUrl) throw new Error("URL richiesto");

  const parsed = extractGoogleFileId(trimmedUrl);
  const name = input.name?.trim() || (parsed.kind === "folder" ? "Cartella Drive" : "File Drive");
  const mimeType =
    input.mimeType ?? (parsed.kind === "folder" ? "application/vnd.google-apps.folder" : null);
  const category = categorizeDriveFile({
    name,
    mime_type: mimeType,
    path: input.path ?? null,
  });

  const { data, error } = await supabase
    .from("drive_file_map" as never)
    .insert({
      user_id: u.user.id,
      brain_id: input.brainId ?? null,
      connection_id: input.connectionId ?? null,
      google_file_id: parsed.id,
      parent_google_file_id: null,
      name,
      mime_type: mimeType,
      web_url: trimmedUrl,
      icon_url: null,
      size_bytes: null,
      modified_time: null,
      path: input.path ?? null,
      category,
      status: "mapped",
      metadata: {
        source: "manual_link",
        detected_kind: parsed.kind,
      },
    } as never)
    .select("*")
    .single();
  if (error) throw error;
  const row = data as unknown as DriveFile;
  await logDriveKnowledgeEvent("drive_manual_link_added", `Drive manual link: ${row.name}`, {
    drive_file_map_id: row.id,
    google_file_id: row.google_file_id,
    kind: parsed.kind,
  });
  return row;
}

// ------------------------------------------------------------
// Sync (server-call wrapper) — placeholder safe
// ------------------------------------------------------------

export type DriveSyncResult = {
  ok: boolean;
  reason?: string;
  authUrl?: string;
  filesProcessed?: number;
  filesAdded?: number;
  filesUpdated?: number;
  startedAt: string;
  finishedAt: string;
};

/**
 * v2.8.1: tokens are not persisted. When OAuth is configured the server fn
 * returns an authUrl; the UI must redirect to it. The public OAuth callback
 * runs the actual metadata-only sync and forgets the access token.
 */
export async function syncDriveMetadata(connectionId: string): Promise<DriveSyncResult> {
  const startedAt = new Date().toISOString();
  await logDriveKnowledgeEvent("google_drive_metadata_sync_started", "Sync metadata avviato", {
    connection_id: connectionId,
  });
  try {
    const { syncGoogleDriveMetadata } = await import("@/lib/drive-knowledge.functions");
    const res = await syncGoogleDriveMetadata({
      data: { connectionId, returnTo: "/drive-knowledge?oauth=success" },
    });
    const finishedAt = new Date().toISOString();
    if (res.ok) {
      await logDriveKnowledgeEvent(
        "google_drive_metadata_sync_completed",
        "Sync metadata completato",
        { connection_id: connectionId, files_processed: res.filesProcessed ?? 0 },
      );
      await updateDriveConnection(connectionId, {
        lastSyncAt: finishedAt,
        connectionStatus: "connected",
      });
    } else if (!res.authUrl) {
      await logDriveKnowledgeEvent(
        "google_drive_metadata_sync_failed",
        res.reason ?? "Sync metadata fallito",
        { connection_id: connectionId, reason: res.reason ?? null },
      );
    }
    return { ...res, startedAt, finishedAt };
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const reason = err instanceof Error ? err.message : "Errore sconosciuto";
    await logDriveKnowledgeEvent("google_drive_metadata_sync_failed", reason, {
      connection_id: connectionId,
    });
    return { ok: false, reason, startedAt, finishedAt };
  }
}

// ------------------------------------------------------------
// Knowledge source bridge
// ------------------------------------------------------------

export type CreateKnowledgeSourceFromDriveResult = {
  knowledgeSourceId: string;
};

export async function createKnowledgeSourceFromDriveFile(
  fileId: string,
  opts: { brainId: string },
): Promise<CreateKnowledgeSourceFromDriveResult> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non autenticato");
  if (!opts.brainId) throw new Error("brainId richiesto per creare una knowledge source");

  const { data: fileRow, error: fErr } = await supabase
    .from("drive_file_map" as never)
    .select("*")
    .eq("id", fileId)
    .maybeSingle();
  if (fErr) throw fErr;
  if (!fileRow) throw new Error("File Drive non trovato");
  const file = fileRow as unknown as DriveFile;

  const category = file.category ?? "altro";
  const tags = ["google_drive", category];
  const summary =
    `File Google Drive${file.mime_type ? ` (${file.mime_type})` : ""}` +
    (file.path ? ` — ${file.path}` : "");

  const { data: ks, error: ksErr } = await supabase
    .from("knowledge_sources")
    .insert({
      user_id: u.user.id,
      brain_id: opts.brainId,
      title: file.name,
      source_type: "drive_file",
      status: "active",
      url: file.web_url,
      mime_type: file.mime_type,
      file_size: file.size_bytes,
      summary,
      tags,
      metadata: {
        drive_file_map_id: file.id,
        google_file_id: file.google_file_id,
        mime_type: file.mime_type,
        modified_time: file.modified_time,
        path: file.path,
        source: "google_drive_connector",
      },
    } as never)
    .select("id")
    .single();
  if (ksErr) throw ksErr;
  const ksRow = ks as unknown as { id: string };

  await supabase
    .from("drive_file_map" as never)
    .update({
      status: "linked",
      metadata: {
        ...(file.metadata ?? {}),
        knowledge_source_id: ksRow.id,
      },
    } as never)
    .eq("id", file.id);

  await logDriveKnowledgeEvent(
    "drive_knowledge_source_created",
    `Knowledge source da Drive: ${file.name}`,
    {
      drive_file_map_id: file.id,
      knowledge_source_id: ksRow.id,
      google_file_id: file.google_file_id,
    },
  );

  return { knowledgeSourceId: ksRow.id };
}

// ------------------------------------------------------------
// Organization suggestion
// ------------------------------------------------------------

export type DriveOrganizationSuggestion = {
  category: DriveFileCategory;
  count: number;
  filesWithoutKnowledge: number;
  recommendation: string;
};

export async function suggestDriveOrganization(
  brainId?: string | null,
): Promise<DriveOrganizationSuggestion[]> {
  const files = await listDriveFileMap({ brainId: brainId ?? null, limit: 500 });
  const byCategory = new Map<DriveFileCategory, { total: number; linked: number }>();
  for (const f of files) {
    const cat: DriveFileCategory = f.category ?? "altro";
    const entry = byCategory.get(cat) ?? { total: 0, linked: 0 };
    entry.total += 1;
    if (f.status === "linked") entry.linked += 1;
    byCategory.set(cat, entry);
  }

  const suggestions: DriveOrganizationSuggestion[] = [];
  for (const [category, agg] of byCategory.entries()) {
    const missing = agg.total - agg.linked;
    const recommendation =
      missing === 0
        ? "Tutti i file mappati hanno una knowledge source."
        : `Crea knowledge source per ${missing} file in "${DRIVE_CATEGORY_LABEL[category]}".`;
    suggestions.push({
      category,
      count: agg.total,
      filesWithoutKnowledge: missing,
      recommendation,
    });
  }

  suggestions.sort((a, b) => b.filesWithoutKnowledge - a.filesWithoutKnowledge);

  await logDriveKnowledgeEvent(
    "drive_organization_suggested",
    `Drive: suggerite ${suggestions.length} categorie`,
    { brain_id: brainId ?? null, categories: suggestions.length },
  );

  return suggestions;
}

// ------------------------------------------------------------
// Dashboard / Loop QA helpers
// ------------------------------------------------------------

export type DriveSyncStatus =
  | "never"
  | "completed"
  | "completed_with_warnings"
  | "failed";

export type DriveKnowledgeSummary = {
  connections: number;
  configuredConnections: number;
  totalFiles: number;
  linkedFiles: number;
  knowledgeSourcesCreated: number;
  hasNeverSynced: boolean;
  lastSyncAt: string | null;
  lastSyncFailed: boolean;
  lastSyncFileCount: number | null;
  lastSyncReachedLimit: boolean;
  lastSyncWarnings: string[];
  lastSyncStatus: DriveSyncStatus;
};

export async function getDriveKnowledgeSummary(
  brainId?: string | null,
): Promise<DriveKnowledgeSummary> {
  const [connections, files] = await Promise.all([
    getDriveConnections(brainId).catch(() => [] as DriveConnection[]),
    listDriveFileMap({ brainId: brainId ?? null, limit: 500 }).catch(() => [] as DriveFile[]),
  ]);

  const configured = connections.filter(
    (c) => c.connection_status === "connected" || c.connection_status === "manual",
  );
  const linked = files.filter((f) => f.status === "linked");
  const lastSync = configured
    .map((c) => c.last_sync_at)
    .filter((s): s is string => Boolean(s))
    .sort()
    .at(-1) ?? null;

  // Aggregate latest sync metadata across configured connections.
  let lastSyncFileCount: number | null = null;
  let lastSyncReachedLimit = false;
  let lastSyncWarnings: string[] = [];
  let lastSyncStatus: DriveSyncStatus = "never";
  let latestTs = 0;
  for (const c of configured) {
    const m = (c.metadata ?? {}) as Record<string, unknown>;
    const completedAt =
      typeof m.last_sync_completed_at === "string" ? m.last_sync_completed_at : null;
    const ts = completedAt ? new Date(completedAt).getTime() : 0;
    if (ts >= latestTs) {
      latestTs = ts;
      lastSyncFileCount =
        typeof m.last_sync_file_count === "number" ? m.last_sync_file_count : lastSyncFileCount;
      lastSyncReachedLimit = m.last_sync_reached_limit === true;
      const w = m.last_sync_warnings;
      lastSyncWarnings = Array.isArray(w)
        ? w.filter((x): x is string => typeof x === "string")
        : [];
      const st = m.last_sync_status;
      if (st === "completed" || st === "completed_with_warnings" || st === "failed") {
        lastSyncStatus = st;
      } else if (completedAt) {
        lastSyncStatus = "completed";
      }
    }
  }

  // Check most recent sync log for last failure
  let lastSyncFailed = false;
  try {
    const { data } = await supabase
      .from("clipboard_execution_logs")
      .select("action, created_at")
      .in("action", ["drive_metadata_sync_completed", "drive_metadata_sync_failed"])
      .order("created_at", { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      lastSyncFailed = (data[0] as { action: string }).action === "drive_metadata_sync_failed";
    }
  } catch {
    // non-blocking
  }
  if (lastSyncFailed) lastSyncStatus = "failed";

  return {
    connections: connections.length,
    configuredConnections: configured.length,
    totalFiles: files.length,
    linkedFiles: linked.length,
    knowledgeSourcesCreated: linked.length,
    hasNeverSynced: configured.length > 0 && lastSync === null,
    lastSyncAt: lastSync,
    lastSyncFailed,
    lastSyncFileCount,
    lastSyncReachedLimit,
    lastSyncWarnings,
    lastSyncStatus,
  };
}

export type DriveLoopWarning = {
  id: string;
  level: "warning" | "info" | "error";
  title: string;
  description: string;
  cta?: { label: string; to: string };
};

export async function getDriveKnowledgeWarnings(
  brainId?: string | null,
): Promise<DriveLoopWarning[]> {
  const out: DriveLoopWarning[] = [];
  try {
    const s = await getDriveKnowledgeSummary(brainId);
    const cta = { label: "Apri Drive Knowledge", to: "/drive-knowledge" };
    if (s.connections === 0) {
      out.push({
        id: "drive-no-connection",
        level: "info",
        title: "Google Drive non collegato",
        description: "Nessuna connessione Drive: i documenti aziendali non sono mappati.",
        cta,
      });
    } else if (s.hasNeverSynced) {
      out.push({
        id: "drive-never-synced",
        level: "warning",
        title: "Google Drive mai sincronizzato",
        description: "Una connessione è configurata ma non è mai stato eseguito sync metadata.",
        cta,
      });
    }
    if (s.lastSyncFailed) {
      out.push({
        id: "drive-last-sync-failed",
        level: "warning",
        title: "Ultimo sync Drive fallito",
        description: "L'ultimo tentativo di sincronizzare metadata Drive non è andato a buon fine.",
        cta,
      });
    }
    if (s.totalFiles > 0 && s.knowledgeSourcesCreated === 0) {
      out.push({
        id: "drive-no-knowledge",
        level: "info",
        title: "File Drive mappati senza knowledge source",
        description: `${s.totalFiles} file mappati ma nessuna knowledge source ancora creata.`,
        cta,
      });
    }
  } catch {
    // non-blocking
  }
  return out;
}
