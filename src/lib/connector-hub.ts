// Brain Hub v3.21 — Connector Hub
// Centralizes connector status + project↔source mapping. Read-only / manual-first.
// All operations user-scoped via RLS. Never expose tokens, file/email/calendar/SQL bodies.

import { supabase } from "@/integrations/supabase/client";

// ---------- Types ----------

export type ConnectorKey =
  | "google_drive"
  | "gmail"
  | "google_calendar"
  | "github"
  | "supabase"
  | "obsidian"
  | "telegram"
  | "n8n"
  | "lovable_manual";

export type ConnectorStatus =
  | "not_configured"
  | "connected"
  | "read_only"
  | "warning"
  | "error"
  | "manual";

export type PermissionLevel = "read_only" | "manual" | "write";

export type ConnectorType = "oauth" | "api" | "webhook" | "manual" | "internal";

export type ConnectorRegistryRow = {
  id: string;
  user_id: string;
  connector_key: ConnectorKey | string;
  connector_name: string;
  connector_type: ConnectorType | string;
  status: ConnectorStatus | string;
  permission_level: PermissionLevel | string;
  last_sync_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ProjectSourceMappingRow = {
  id: string;
  user_id: string;
  brain_id: string | null;
  project_key: string;
  connector_key: ConnectorKey | string;
  source_type: string;
  source_label: string;
  source_ref: string | null;
  source_url: string | null;
  sync_status: string;
  last_seen_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type UpsertConnectorInput = {
  connector_key: ConnectorKey | string;
  connector_name: string;
  connector_type: ConnectorType | string;
  status?: ConnectorStatus | string;
  permission_level?: PermissionLevel | string;
  last_sync_at?: string | null;
  last_error?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreateMappingInput = {
  project_key: string;
  connector_key: ConnectorKey | string;
  source_type: string;
  source_label: string;
  source_ref?: string | null;
  source_url?: string | null;
  brain_id?: string | null;
  metadata?: Record<string, unknown>;
};

export type UpdateMappingInput = Partial<
  Omit<CreateMappingInput, "project_key" | "connector_key">
> & { sync_status?: string; last_seen_at?: string | null };

// ---------- Constants ----------

const REG_TABLE = "connector_registry";
const MAP_TABLE = "project_source_mappings";

export const CONNECTOR_CATALOG: Array<{
  key: ConnectorKey;
  name: string;
  type: ConnectorType;
  defaultPermission: PermissionLevel;
  ctaLabel: string;
  ctaRoute: string | null;
  description: string;
}> = [
  {
    key: "google_drive",
    name: "Google Drive",
    type: "oauth",
    defaultPermission: "read_only",
    ctaLabel: "Apri Drive Knowledge",
    ctaRoute: "/drive-knowledge",
    description: "Solo metadata e mapping. Nessun download/modifica/cancellazione file.",
  },
  {
    key: "gmail",
    name: "Gmail",
    type: "oauth",
    defaultPermission: "read_only",
    ctaLabel: "Apri Gmail Connector",
    ctaRoute: "/gmail-connector",
    description: "Solo lettura metadata/thread/label. Nessun invio o modifica.",
  },
  {
    key: "google_calendar",
    name: "Google Calendar",
    type: "oauth",
    defaultPermission: "read_only",
    ctaLabel: "Apri Calendar Knowledge",
    ctaRoute: "/calendar-knowledge",
    description: "Solo lettura eventi/calendari. Nessuna creazione/modifica.",
  },
  {
    key: "github",
    name: "GitHub",
    type: "api",
    defaultPermission: "read_only",
    ctaLabel: "Apri GitHub Operational",
    ctaRoute: "/github-operational",
    description: "Solo metadata repo. Nessun commit/push/PR.",
  },
  {
    key: "supabase",
    name: "Supabase (Brain Hub)",
    type: "internal",
    defaultPermission: "read_only",
    ctaLabel: "Apri Health Check",
    ctaRoute: "/health-check",
    description: "Health interno Brain Hub. Nessuna query SQL arbitraria dal frontend.",
  },
  {
    key: "obsidian",
    name: "Obsidian",
    type: "manual",
    defaultPermission: "manual",
    ctaLabel: "Configura Obsidian (manuale)",
    ctaRoute: null,
    description: "Import manuale vault/folder. Nessun accesso filesystem locale.",
  },
  {
    key: "telegram",
    name: "Telegram",
    type: "webhook",
    defaultPermission: "read_only",
    ctaLabel: "Apri Telegram Approvals",
    ctaRoute: "/telegram-approvals",
    description: "Approval-first. Nessun invio automatico senza conferma.",
  },
  {
    key: "n8n",
    name: "n8n",
    type: "api",
    defaultPermission: "read_only",
    ctaLabel: "Apri n8n Workflows",
    ctaRoute: "/n8n-workflows",
    description: "Solo lettura registry. Esecuzione richiede approval.",
  },
  {
    key: "lovable_manual",
    name: "Lovable (Summary manuale)",
    type: "manual",
    defaultPermission: "manual",
    ctaLabel: "Apri Project State",
    ctaRoute: "/project-state",
    description: "Import summary manuale per aggiornare lo stato progetti.",
  },
];

// ---------- Project key resolver (v3.21.1) ----------
// Pure, no DB. Normalizes user input ("Brain Hub", "brianhub",
// "Furia immobiliare") to the canonical project_key used by
// project_state_snapshots and project_source_mappings.

export const PROJECT_KEY_ALIASES: Readonly<Record<string, string>> = {
  "brain hub": "brain_hub",
  "brainhub": "brain_hub",
  "brian hub": "brain_hub",
  "brianhub": "brain_hub",
  "brain_hub": "brain_hub",
  "furia": "furia_immobiliare",
  "furia immobiliare": "furia_immobiliare",
  "furia_immobiliare": "furia_immobiliare",
  "sica radar": "sica_industrial_radar",
  "sica industrial radar": "sica_industrial_radar",
  "sica_industrial_radar": "sica_industrial_radar",
  "sica immobiliare industriale": "sica_immobiliare_industriale",
  "sica_immobiliare_industriale": "sica_immobiliare_industriale",
  "pupillo": "pupillo",
  "studio nikla": "studio_nikla",
  "studio_nikla": "studio_nikla",
  "nikla": "studio_nikla",
  "retail ai": "retail_ai_capannoni",
  "retail ai capannoni": "retail_ai_capannoni",
  "retail_ai_capannoni": "retail_ai_capannoni",
  "ideapilot": "ideapilot",
  "idea pilot": "ideapilot",
};

function normalizeProjectInput(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^progetto\s+/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a user-supplied project label to a canonical project_key.
 * Returns null when no alias matches; caller may fall back to a
 * project_state_snapshots lookup.
 */
export function resolveProjectKeyAlias(input: string | null | undefined): string | null {
  if (!input) return null;
  const norm = normalizeProjectInput(input);
  if (!norm) return null;
  if (PROJECT_KEY_ALIASES[norm]) return PROJECT_KEY_ALIASES[norm];
  const underscored = norm.replace(/\s+/g, "_");
  if (PROJECT_KEY_ALIASES[underscored]) return PROJECT_KEY_ALIASES[underscored];
  if (/^[a-z0-9_]+$/.test(underscored)) return underscored;
  return null;
}

// ---------- Events ----------

export async function logConnectorHubEvent(
  event: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("app_logs" as never).insert({
      user_id: u.user.id,
      entity_type: "connector_hub",
      action: event,
      message: event,
      severity: "info",
      metadata,
    } as never);
  } catch {
    // best-effort
  }
}

// ---------- Auto-detection of connector status from existing tables ----------

async function detectStatuses(): Promise<
  Partial<Record<ConnectorKey, { status: ConnectorStatus; last_sync_at: string | null; metadata: Record<string, unknown> }>>
> {
  const out: Partial<
    Record<ConnectorKey, { status: ConnectorStatus; last_sync_at: string | null; metadata: Record<string, unknown> }>
  > = {};

  // Drive
  try {
    const { data } = await supabase
      .from("drive_connection_settings" as never)
      .select("*")
      .limit(1)
      .maybeSingle();
    const row = data as Record<string, unknown> | null;
    if (row) {
      const configured = Boolean(row.is_configured ?? row.configured ?? row.access_token_present);
      out.google_drive = {
        status: configured ? "read_only" : "not_configured",
        last_sync_at:
          (row.last_sync_at as string | null) ?? (row.updated_at as string | null) ?? null,
        metadata: { detected: true },
      };
    }
  } catch {
    // best-effort
  }

  // Gmail
  try {
    const { data } = await supabase
      .from("gmail_connection_settings" as never)
      .select("*")
      .limit(1)
      .maybeSingle();
    const row = data as Record<string, unknown> | null;
    if (row) {
      const configured = Boolean(row.is_configured ?? row.configured ?? row.access_token_present);
      out.gmail = {
        status: configured ? "read_only" : "not_configured",
        last_sync_at:
          (row.last_sync_at as string | null) ?? (row.updated_at as string | null) ?? null,
        metadata: { detected: true },
      };
    }
  } catch {
    // best-effort
  }

  // Calendar
  try {
    const { data } = await supabase
      .from("calendar_connection_settings" as never)
      .select("*")
      .limit(1)
      .maybeSingle();
    const row = data as Record<string, unknown> | null;
    if (row) {
      const configured = Boolean(row.is_configured ?? row.configured ?? row.access_token_present);
      out.google_calendar = {
        status: configured ? "read_only" : "not_configured",
        last_sync_at:
          (row.last_sync_at as string | null) ?? (row.updated_at as string | null) ?? null,
        metadata: { detected: true },
      };
    }
  } catch {
    // best-effort
  }

  // GitHub
  try {
    const { count } = await supabase
      .from("github_repository_registry" as never)
      .select("id", { count: "exact", head: true });
    if (typeof count === "number" && count > 0) {
      out.github = {
        status: "read_only",
        last_sync_at: null,
        metadata: { repos_count: count },
      };
    }
  } catch {
    // best-effort
  }

  // n8n
  try {
    const { count } = await supabase
      .from("n8n_workflow_registry" as never)
      .select("id", { count: "exact", head: true });
    if (typeof count === "number" && count > 0) {
      out.n8n = {
        status: "read_only",
        last_sync_at: null,
        metadata: { workflows_count: count },
      };
    }
  } catch {
    // best-effort
  }

  // Telegram
  try {
    const { data } = await supabase
      .from("telegram_connection_settings" as never)
      .select("*")
      .limit(1)
      .maybeSingle();
    if (data) {
      out.telegram = {
        status: "read_only",
        last_sync_at:
          ((data as Record<string, unknown>).updated_at as string | null) ?? null,
        metadata: { detected: true },
      };
    }
  } catch {
    // best-effort
  }

  // Supabase is always "internal/connected" for Brain Hub itself.
  out.supabase = {
    status: "read_only",
    last_sync_at: null,
    metadata: { internal: true },
  };

  return out;
}

// ---------- Registry CRUD ----------

export async function listConnectorRegistry(): Promise<ConnectorRegistryRow[]> {
  const { data, error } = await supabase
    .from(REG_TABLE as never)
    .select("*")
    .order("connector_key", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ConnectorRegistryRow[];
}

export async function getConnectorStatus(
  connectorKey: ConnectorKey | string,
): Promise<ConnectorRegistryRow | null> {
  const { data, error } = await supabase
    .from(REG_TABLE as never)
    .select("*")
    .eq("connector_key", connectorKey)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as ConnectorRegistryRow | null;
}

export async function upsertConnectorStatus(
  input: UpsertConnectorInput,
): Promise<ConnectorRegistryRow> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  const existing = await getConnectorStatus(input.connector_key);

  const payload: Record<string, unknown> = {
    user_id: u.user.id,
    connector_key: input.connector_key,
    connector_name: input.connector_name,
    connector_type: input.connector_type,
    status: input.status ?? existing?.status ?? "not_configured",
    permission_level: input.permission_level ?? existing?.permission_level ?? "read_only",
    last_sync_at: input.last_sync_at ?? existing?.last_sync_at ?? null,
    last_error: input.last_error ?? null,
    metadata: input.metadata ?? existing?.metadata ?? {},
  };

  if (existing) {
    const { data, error } = await supabase
      .from(REG_TABLE as never)
      .update(payload as never)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    await logConnectorHubEvent("connector_status_updated", {
      connector_key: input.connector_key,
      status: payload.status,
    });
    return data as unknown as ConnectorRegistryRow;
  }
  const { data, error } = await supabase
    .from(REG_TABLE as never)
    .insert(payload as never)
    .select("*")
    .single();
  if (error) throw error;
  await logConnectorHubEvent("connector_status_updated", {
    connector_key: input.connector_key,
    status: payload.status,
  });
  return data as unknown as ConnectorRegistryRow;
}

export async function seedConnectorRegistry(): Promise<{
  created: number;
  updated: number;
  total: number;
}> {
  const existing = await listConnectorRegistry();
  const existingByKey = new Map(existing.map((r) => [r.connector_key, r]));
  const detected = await detectStatuses();

  let created = 0;
  let updated = 0;
  for (const c of CONNECTOR_CATALOG) {
    const det = detected[c.key];
    const status = det?.status ?? "not_configured";
    const wasNew = !existingByKey.has(c.key);
    await upsertConnectorStatus({
      connector_key: c.key,
      connector_name: c.name,
      connector_type: c.type,
      permission_level: c.defaultPermission,
      status,
      last_sync_at: det?.last_sync_at ?? null,
      metadata: { ...(det?.metadata ?? {}), description: c.description },
    });
    if (wasNew) created += 1;
    else updated += 1;
  }
  await logConnectorHubEvent("connector_registry_seeded", {
    created,
    updated,
    total: CONNECTOR_CATALOG.length,
  });
  return { created, updated, total: CONNECTOR_CATALOG.length };
}

// ---------- Mapping CRUD ----------

export async function listProjectSourceMappings(
  projectKey?: string,
): Promise<ProjectSourceMappingRow[]> {
  let q = supabase
    .from(MAP_TABLE as never)
    .select("*")
    .order("project_key", { ascending: true })
    .order("connector_key", { ascending: true });
  if (projectKey) {
    q = (q as unknown as { eq: (c: string, v: string) => typeof q }).eq(
      "project_key",
      projectKey,
    );
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as ProjectSourceMappingRow[];
}

export async function createProjectSourceMapping(
  input: CreateMappingInput,
): Promise<ProjectSourceMappingRow> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");
  const payload = {
    user_id: u.user.id,
    project_key: input.project_key,
    connector_key: input.connector_key,
    source_type: input.source_type,
    source_label: input.source_label,
    source_ref: input.source_ref ?? null,
    source_url: input.source_url ?? null,
    brain_id: input.brain_id ?? null,
    metadata: input.metadata ?? {},
  };
  const { data, error } = await supabase
    .from(MAP_TABLE as never)
    .insert(payload as never)
    .select("*")
    .single();
  if (error) throw error;
  const row = data as unknown as ProjectSourceMappingRow;
  await logConnectorHubEvent("project_source_mapping_created", {
    mapping_id: row.id,
    project_key: row.project_key,
    connector_key: row.connector_key,
    source_type: row.source_type,
  });
  return row;
}

export async function updateProjectSourceMapping(
  id: string,
  input: UpdateMappingInput,
): Promise<ProjectSourceMappingRow> {
  const payload: Record<string, unknown> = {};
  if (input.source_type !== undefined) payload.source_type = input.source_type;
  if (input.source_label !== undefined) payload.source_label = input.source_label;
  if (input.source_ref !== undefined) payload.source_ref = input.source_ref;
  if (input.source_url !== undefined) payload.source_url = input.source_url;
  if (input.brain_id !== undefined) payload.brain_id = input.brain_id;
  if (input.metadata !== undefined) payload.metadata = input.metadata;
  if (input.sync_status !== undefined) payload.sync_status = input.sync_status;
  if (input.last_seen_at !== undefined) payload.last_seen_at = input.last_seen_at;

  const { data, error } = await supabase
    .from(MAP_TABLE as never)
    .update(payload as never)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  const row = data as unknown as ProjectSourceMappingRow;
  await logConnectorHubEvent("project_source_mapping_updated", {
    mapping_id: row.id,
    project_key: row.project_key,
    connector_key: row.connector_key,
  });
  return row;
}

export async function deleteProjectSourceMapping(id: string): Promise<void> {
  const existing = await supabase
    .from(MAP_TABLE as never)
    .select("project_key,connector_key")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from(MAP_TABLE as never).delete().eq("id", id);
  if (error) throw error;
  const row = (existing.data ?? {}) as Record<string, unknown>;
  await logConnectorHubEvent("project_source_mapping_deleted", {
    mapping_id: id,
    project_key: row.project_key ?? null,
    connector_key: row.connector_key ?? null,
  });
}

// ---------- Quick mapping presets ----------

export type QuickMappingSpec = {
  project_key: string;
  connector_key: ConnectorKey;
  source_type: string;
  source_label: string;
  source_ref: string | null;
  source_url: string | null;
  metadata: Record<string, unknown>;
};

export const PUPILLO_QUICK_MAPPINGS: ReadonlyArray<QuickMappingSpec> = [
  {
    project_key: "pupillo",
    connector_key: "github",
    source_type: "repository",
    source_label: "my-pupillo-app",
    source_ref: "federicosicapupillo/my-pupillo-app",
    source_url: "https://github.com/federicosicapupillo/my-pupillo-app",
    metadata: { note: "Repository principale del progetto Pupillo" },
  },
  {
    project_key: "pupillo",
    connector_key: "lovable_manual",
    source_type: "project_summary",
    source_label: "Pupillo Lovable summaries",
    source_ref: "lovable_pupillo",
    source_url: null,
    metadata: {
      note: "Riepiloghi Lovable manuali usati per aggiornare lo stato del progetto Pupillo",
    },
  },
  {
    project_key: "pupillo",
    connector_key: "google_drive",
    source_type: "folder",
    source_label: "Pupillo documenti progetto",
    source_ref: "pupillo_drive_folder",
    source_url: null,
    metadata: {
      note: "Cartella Drive opzionale per documenti, roadmap, grafiche e materiali del progetto Pupillo",
    },
  },
];

export type QuickSeedResult = {
  project_key: string;
  created: number;
  skipped: number;
  total: number;
};

/**
 * Idempotent: insert any of the project's preset mappings that don't already
 * exist. Dedup key = (project_key, connector_key, source_type, source_ref).
 */
export async function seedProjectQuickMappings(
  projectKey: string,
  specs: ReadonlyArray<QuickMappingSpec>,
): Promise<QuickSeedResult> {
  const existing = await listProjectSourceMappings(projectKey);
  const keyOf = (pk: string, ck: string, st: string, ref: string | null) =>
    `${pk}::${ck}::${st}::${ref ?? ""}`;
  const seen = new Set(
    existing.map((r) =>
      keyOf(r.project_key, r.connector_key, r.source_type, r.source_ref),
    ),
  );

  let created = 0;
  let skipped = 0;
  for (const s of specs) {
    if (s.project_key !== projectKey) {
      skipped += 1;
      continue;
    }
    const k = keyOf(s.project_key, s.connector_key, s.source_type, s.source_ref);
    if (seen.has(k)) {
      skipped += 1;
      continue;
    }
    await createProjectSourceMapping({
      project_key: s.project_key,
      connector_key: s.connector_key,
      source_type: s.source_type,
      source_label: s.source_label,
      source_ref: s.source_ref,
      source_url: s.source_url,
      metadata: s.metadata,
    });
    seen.add(k);
    created += 1;
  }

  await logConnectorHubEvent("project_source_mapping_quick_seeded", {
    project_key: projectKey,
    created_count: created,
    skipped_count: skipped,
  });

  return { project_key: projectKey, created, skipped, total: specs.length };
}

export async function seedPupilloQuickMappings(): Promise<QuickSeedResult> {
  return seedProjectQuickMappings("pupillo", PUPILLO_QUICK_MAPPINGS);
}

// ---------- Summaries / warnings ----------

export type ConnectorWarning = {
  connector_key: string;
  connector_name: string;
  level: "info" | "warning" | "error";
  message: string;
};

export async function getConnectorWarnings(): Promise<ConnectorWarning[]> {
  const rows = await listConnectorRegistry();
  const out: ConnectorWarning[] = [];
  for (const r of rows) {
    if (r.status === "error") {
      out.push({
        connector_key: r.connector_key,
        connector_name: r.connector_name,
        level: "error",
        message: r.last_error ?? "Errore connettore",
      });
    } else if (r.status === "warning") {
      out.push({
        connector_key: r.connector_key,
        connector_name: r.connector_name,
        level: "warning",
        message: r.last_error ?? "Connettore in warning",
      });
    } else if (r.status === "not_configured") {
      out.push({
        connector_key: r.connector_key,
        connector_name: r.connector_name,
        level: "info",
        message: "Non ancora configurato",
      });
    }
  }
  return out;
}

export type ConnectorHubSummary = {
  total: number;
  connected: number;
  read_only: number;
  warnings: number;
  errors: number;
  not_configured: number;
  manual: number;
  mappings_total: number;
  projects_with_mappings: number;
  last_sync_at: string | null;
};

export async function getConnectorHubSummary(): Promise<ConnectorHubSummary> {
  const [rows, mappings] = await Promise.all([
    listConnectorRegistry(),
    listProjectSourceMappings(),
  ]);
  const projects = new Set(mappings.map((m) => m.project_key));
  let lastSync: string | null = null;
  for (const r of rows) {
    if (r.last_sync_at && (!lastSync || r.last_sync_at > lastSync)) lastSync = r.last_sync_at;
  }
  return {
    total: rows.length,
    connected: rows.filter((r) => r.status === "connected").length,
    read_only: rows.filter((r) => r.status === "read_only").length,
    warnings: rows.filter((r) => r.status === "warning").length,
    errors: rows.filter((r) => r.status === "error").length,
    not_configured: rows.filter((r) => r.status === "not_configured").length,
    manual: rows.filter((r) => r.status === "manual").length,
    mappings_total: mappings.length,
    projects_with_mappings: projects.size,
    last_sync_at: lastSync,
  };
}

export type ProjectConnectorSummary = {
  project_key: string;
  connectors: Array<{
    connector_key: string;
    connector_name: string;
    status: string;
    sources: number;
  }>;
  mappings: ProjectSourceMappingRow[];
};

export async function getProjectConnectorSummary(
  projectKey: string,
): Promise<ProjectConnectorSummary> {
  const [registry, mappings] = await Promise.all([
    listConnectorRegistry(),
    listProjectSourceMappings(projectKey),
  ]);
  const regByKey = new Map(registry.map((r) => [r.connector_key, r]));
  const grouped = new Map<string, number>();
  for (const m of mappings) {
    grouped.set(m.connector_key, (grouped.get(m.connector_key) ?? 0) + 1);
  }
  const connectors = Array.from(grouped.entries()).map(([key, count]) => {
    const r = regByKey.get(key);
    return {
      connector_key: key,
      connector_name: r?.connector_name ?? key,
      status: r?.status ?? "unknown",
      sources: count,
    };
  });
  return { project_key: projectKey, connectors, mappings };
}

export type JackConnectorContext = {
  summary: ConnectorHubSummary;
  warnings: ConnectorWarning[];
  per_project: Array<{
    project_key: string;
    connectors: Array<{ connector_key: string; status: string; sources: number }>;
  }>;
};

export async function getJackConnectorContext(
  projectKey?: string,
): Promise<JackConnectorContext> {
  const [summary, warnings, mappings] = await Promise.all([
    getConnectorHubSummary(),
    getConnectorWarnings(),
    listProjectSourceMappings(projectKey),
  ]);
  const byProject = new Map<string, Map<string, number>>();
  for (const m of mappings) {
    if (!byProject.has(m.project_key)) byProject.set(m.project_key, new Map());
    const inner = byProject.get(m.project_key)!;
    inner.set(m.connector_key, (inner.get(m.connector_key) ?? 0) + 1);
  }
  const registry = await listConnectorRegistry();
  const regByKey = new Map(registry.map((r) => [r.connector_key, r]));
  const per_project = Array.from(byProject.entries()).map(([pk, inner]) => ({
    project_key: pk,
    connectors: Array.from(inner.entries()).map(([ck, count]) => ({
      connector_key: ck,
      status: regByKey.get(ck)?.status ?? "unknown",
      sources: count,
    })),
  }));
  return { summary, warnings, per_project };
}
