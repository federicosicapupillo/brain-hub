// Brain Hub v3.20 — Project State Sync
// Client-side library + Jack helpers for multi-project state snapshots.
// All reads/writes go through the authenticated supabase client (RLS).
// No external API calls. No automatic action creation.

import { supabase } from "@/integrations/supabase/client";

export type ProjectStatus =
  | "active"
  | "paused"
  | "blocked"
  | "parked"
  | "completed";
export type ProjectPriority = "very_high" | "high" | "medium" | "low";
export type FreshnessStatus = "fresh" | "stale" | "old" | "unknown";

export type LinkedTools = {
  repo?: string | null;
  drive?: string | null;
  lovable?: string | null;
  notes?: string | null;
  [k: string]: unknown;
};

export type ProjectStateSnapshot = {
  id: string;
  user_id: string;
  brain_id: string | null;
  project_id: string | null;
  project_key: string;
  project_name: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  current_state: string;
  last_completed: string | null;
  next_action: string | null;
  blockers: string[];
  linked_tools: LinkedTools;
  source_summary: string | null;
  freshness_status: FreshnessStatus;
  last_state_update_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type UpsertProjectStateInput = {
  project_key: string;
  project_name: string;
  brain_id?: string | null;
  project_id?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  current_state?: string;
  last_completed?: string | null;
  next_action?: string | null;
  blockers?: string[];
  linked_tools?: LinkedTools;
  source_summary?: string | null;
  metadata?: Record<string, unknown>;
};

const TABLE = "project_state_snapshots";

// ---------- Initial seed configuration ----------

export const INITIAL_PROJECT_SEEDS: UpsertProjectStateInput[] = [
  {
    project_key: "brain_hub",
    project_name: "Brain Hub",
    status: "active",
    priority: "very_high",
    current_state:
      "Jack operativo controllato fino a v3.19.6. Preview action + creazione solo via conferma UI/router. Componenti attivi: Daily Brief, Operational Health, Loop QA, Remediation Planner, Readiness, Action Queue, Jack Memory, Gmail, Calendar, Drive, GitHub Operational, Code Agent.",
    last_completed: "v3.19.6 — Write Tool Hard Lock & Confirmed UI Bridge",
    next_action: "Collegamento multi-progetto e stato aggiornato (v3.20).",
    blockers: [],
    linked_tools: { lovable: "/operating-dashboard", notes: "core Brain Hub" },
  },
  {
    project_key: "furia_immobiliare",
    project_name: "Furia Immobiliare",
    status: "active",
    priority: "high",
    current_state:
      "Sito immobiliare residenziale Lunigiana avanzato: ottimizzazione immagini, SEO comuni/tipologie, pagine servizi, wizard 'Trova casa', lead magnet, form migliorato, rendering/immagini. Integrazione Idealista in corso.",
    last_completed: "Wizard 'Trova casa' + lead magnet + form migliorato",
    next_action:
      "Completare integrazione Idealista (feed/API), gestione rendering pubblicabile e tracking lead.",
    blockers: [],
    linked_tools: {},
  },
  {
    project_key: "sica_industrial_radar",
    project_name: "Sica Industrial Radar",
    status: "active",
    priority: "high",
    current_state:
      "Sistema per ricerca lead capannoni industriali/logistici. Zone: La Spezia, Massa-Carrara, Lunigiana, Versilia, Sarzana, Luni, Pisa/Navicelli.",
    last_completed: null,
    next_action:
      "Definire MVP: database immobili/richieste, lead search, script chiamate, collegamento Retail AI.",
    blockers: ["MVP non ancora definito"],
    linked_tools: {},
  },
  {
    project_key: "sica_immobiliare_industriale",
    project_name: "Sica Immobiliare / Industriale",
    status: "active",
    priority: "medium",
    current_state:
      "Focus commerciale: capannoni industriali, logistica, marmo, navale. Posizionamento: 'Specialisti dei capannoni'.",
    last_completed: null,
    next_action:
      "Marketing verticale, database richieste clienti, contenuti industriali, lead generation aziende.",
    blockers: [],
    linked_tools: {},
  },
  {
    project_key: "pupillo",
    project_name: "Pupillo",
    status: "active",
    priority: "medium",
    current_state:
      "Marketplace turni extra ristorazione esistente ma da riordinare. Problemi noti: mappa, filtri ruolo, offerte lato lavoratore, annunci lato ristoratore, chat/realtime, notifiche.",
    last_completed: null,
    next_action:
      "Riordino flussi: mappa + filtri ruolo, offerte lavoratore, annunci ristoratore, chat realtime, notifiche.",
    blockers: ["mappa", "filtri ruolo", "chat/realtime", "notifiche"],
    linked_tools: {},
  },
  {
    project_key: "studio_nikla",
    project_name: "Studio Nikla",
    status: "active",
    priority: "medium",
    current_state:
      "App interrogazioni orali con voce. Test voce/quiz, quick phase/complete phase, problemi di stabilità.",
    last_completed: null,
    next_action: "Stabilizzare quick phase / complete phase e flusso voce.",
    blockers: ["stabilità voce/quiz"],
    linked_tools: {},
  },
  {
    project_key: "retail_ai_capannoni",
    project_name: "Retail AI — Chiamate Capannoni",
    status: "active",
    priority: "medium",
    current_state:
      "Collegato a Sica Industrial Radar. Obiettivo: chiamate ad aziende per identificare capannoni in vendita.",
    last_completed: null,
    next_action:
      "Collegare come strumento/progetto operativo a Sica Industrial Radar.",
    blockers: [],
    linked_tools: {},
  },
  {
    project_key: "ideapilot",
    project_name: "IdeaPilot",
    status: "parked",
    priority: "low",
    current_state: "Parcheggiato — non priorità principale.",
    last_completed: null,
    next_action: null,
    blockers: [],
    linked_tools: {},
  },
];

// ---------- Freshness ----------

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeFreshness(
  lastUpdateIso: string | null | undefined,
  hasCoreData: boolean,
): FreshnessStatus {
  if (!lastUpdateIso || !hasCoreData) return "unknown";
  const days = (Date.now() - new Date(lastUpdateIso).getTime()) / DAY_MS;
  if (days <= 7) return "fresh";
  if (days <= 30) return "stale";
  return "old";
}

function hasCore(s: Pick<ProjectStateSnapshot, "current_state" | "next_action">): boolean {
  return !!(s.current_state && s.current_state.trim().length > 0);
}

function refreshRow(row: ProjectStateSnapshot): ProjectStateSnapshot {
  return {
    ...row,
    freshness_status: computeFreshness(row.last_state_update_at, hasCore(row)),
  };
}

// ---------- Event logging (sanitized) ----------

export async function logProjectStateEvent(
  event: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("app_logs" as never).insert({
      user_id: u.user.id,
      entity_type: "project_state",
      action: event,
      message: event,
      severity: "info",
      metadata,
    } as never);
  } catch {
    // best-effort
  }
}

// ---------- CRUD ----------

export async function listProjectStateSnapshots(
  brainId?: string | null,
): Promise<ProjectStateSnapshot[]> {
  let q = supabase
    .from(TABLE as never)
    .select("*")
    .order("priority", { ascending: true })
    .order("updated_at", { ascending: false });
  if (brainId) q = (q as unknown as { eq: (c: string, v: string) => typeof q }).eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as unknown as ProjectStateSnapshot[];
  return rows.map(refreshRow);
}

export async function getProjectStateSnapshot(
  projectKey: string,
): Promise<ProjectStateSnapshot | null> {
  const { data, error } = await supabase
    .from(TABLE as never)
    .select("*")
    .eq("project_key", projectKey)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return refreshRow(data as unknown as ProjectStateSnapshot);
}

export async function upsertProjectStateSnapshot(
  input: UpsertProjectStateInput,
): Promise<ProjectStateSnapshot> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  const existing = await getProjectStateSnapshot(input.project_key);

  const payload = {
    user_id: u.user.id,
    project_key: input.project_key,
    project_name: input.project_name,
    brain_id: input.brain_id ?? existing?.brain_id ?? null,
    project_id: input.project_id ?? existing?.project_id ?? null,
    status: input.status ?? existing?.status ?? "active",
    priority: input.priority ?? existing?.priority ?? "medium",
    current_state: input.current_state ?? existing?.current_state ?? "",
    last_completed: input.last_completed ?? existing?.last_completed ?? null,
    next_action: input.next_action ?? existing?.next_action ?? null,
    blockers: input.blockers ?? existing?.blockers ?? [],
    linked_tools: input.linked_tools ?? existing?.linked_tools ?? {},
    source_summary: input.source_summary ?? existing?.source_summary ?? null,
    metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
    last_state_update_at: new Date().toISOString(),
    freshness_status: "fresh" as FreshnessStatus,
  };

  let result: ProjectStateSnapshot;
  if (existing) {
    const { data, error } = await supabase
      .from(TABLE as never)
      .update(payload as never)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    result = data as unknown as ProjectStateSnapshot;
    void logProjectStateEvent("project_state_snapshot_updated", {
      project_key: result.project_key,
      status: result.status,
      priority: result.priority,
      freshness: result.freshness_status,
      snapshot_id: result.id,
    });
  } else {
    const { data, error } = await supabase
      .from(TABLE as never)
      .insert(payload as never)
      .select()
      .single();
    if (error) throw error;
    result = data as unknown as ProjectStateSnapshot;
    void logProjectStateEvent("project_state_snapshot_created", {
      project_key: result.project_key,
      status: result.status,
      priority: result.priority,
      freshness: result.freshness_status,
      snapshot_id: result.id,
    });
  }
  return refreshRow(result);
}

export async function seedInitialProjectStates(
  brainId?: string | null,
): Promise<{ created: number; updated: number; skipped: number; total: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const seed of INITIAL_PROJECT_SEEDS) {
    const existing = await getProjectStateSnapshot(seed.project_key);
    if (existing) {
      // Don't overwrite an existing manual snapshot — leave as-is.
      skipped += 1;
      continue;
    }
    await upsertProjectStateSnapshot({ ...seed, brain_id: brainId ?? null });
    created += 1;
  }
  void logProjectStateEvent("project_state_seeded", {
    created,
    updated,
    skipped,
    total: INITIAL_PROJECT_SEEDS.length,
  });
  return { created, updated, skipped, total: INITIAL_PROJECT_SEEDS.length };
}

// ---------- Manual summary import (heuristic parser, no external AI) ----------

export type SummaryImportResult = {
  snapshot: ProjectStateSnapshot;
  needs_review: boolean;
  parsed: {
    last_completed: string | null;
    next_action: string | null;
    blockers: string[];
  };
};

const RE_LAST = /(?:ultim[oa]\s+(?:cosa\s+)?(?:completat[oa]|fatt[oa])|completat[oa]|fatt[oa])\s*[:\-]\s*(.+)/i;
const RE_NEXT = /(?:prossim[oa]\s+(?:azione|step|passo)|next\s*action|prossim[oa])\s*[:\-]\s*(.+)/i;
const RE_BLOCK = /(?:blocc(?:o|hi)|blocker[s]?|problemi)\s*[:\-]\s*(.+)/i;

function takeFirstLine(s: string): string {
  return s.split(/[\r\n]/)[0].trim().slice(0, 400);
}

export function parseSummaryHeuristic(summary: string): {
  last_completed: string | null;
  next_action: string | null;
  blockers: string[];
} {
  const last = summary.match(RE_LAST);
  const next = summary.match(RE_NEXT);
  const block = summary.match(RE_BLOCK);
  const blockers = block
    ? takeFirstLine(block[1])
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  return {
    last_completed: last ? takeFirstLine(last[1]) : null,
    next_action: next ? takeFirstLine(next[1]) : null,
    blockers,
  };
}

export async function updateProjectStateFromManualSummary(
  projectKey: string,
  summary: string,
): Promise<SummaryImportResult> {
  const existing = await getProjectStateSnapshot(projectKey);
  if (!existing) throw new Error(`Project ${projectKey} non trovato.`);
  const trimmed = summary.trim();
  if (!trimmed) throw new Error("Summary vuoto.");
  const parsed = parseSummaryHeuristic(trimmed);
  const needs_review = !parsed.last_completed && !parsed.next_action;

  const next = await upsertProjectStateSnapshot({
    project_key: existing.project_key,
    project_name: existing.project_name,
    brain_id: existing.brain_id,
    project_id: existing.project_id,
    current_state: trimmed.slice(0, 1200),
    last_completed: parsed.last_completed ?? existing.last_completed,
    next_action: parsed.next_action ?? existing.next_action,
    blockers: parsed.blockers.length > 0 ? parsed.blockers : existing.blockers,
    source_summary: trimmed.slice(0, 4000),
    metadata: {
      ...(existing.metadata ?? {}),
      last_summary_imported_at: new Date().toISOString(),
      needs_review,
    },
  });

  void logProjectStateEvent("project_state_summary_imported", {
    project_key: projectKey,
    snapshot_id: next.id,
    needs_review,
  });
  if (needs_review) {
    void logProjectStateEvent("project_state_needs_review", {
      project_key: projectKey,
      snapshot_id: next.id,
    });
  }
  return { snapshot: next, needs_review, parsed };
}

// ---------- Helpers / aggregations ----------

const PRIORITY_ORDER: Record<ProjectPriority, number> = {
  very_high: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function sortByPriority(rows: ProjectStateSnapshot[]): ProjectStateSnapshot[] {
  return [...rows].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 9;
    const pb = PRIORITY_ORDER[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return b.last_state_update_at.localeCompare(a.last_state_update_at);
  });
}

export async function getProjectNextAction(
  projectKey: string,
): Promise<{ project_key: string; next_action: string | null } | null> {
  const s = await getProjectStateSnapshot(projectKey);
  if (!s) return null;
  return { project_key: s.project_key, next_action: s.next_action };
}

export async function getProjectFreshness(
  projectKey: string,
): Promise<{ project_key: string; freshness: FreshnessStatus; last_state_update_at: string } | null> {
  const s = await getProjectStateSnapshot(projectKey);
  if (!s) return null;
  return {
    project_key: s.project_key,
    freshness: s.freshness_status,
    last_state_update_at: s.last_state_update_at,
  };
}

export type MultiProjectOverview = {
  total: number;
  active: number;
  high_priority: number;
  needs_update: number;
  parked: number;
  blocked: number;
  recommended_next: {
    project_key: string;
    project_name: string;
    next_action: string | null;
    reason: string;
  } | null;
  projects: Array<{
    project_key: string;
    project_name: string;
    status: ProjectStatus;
    priority: ProjectPriority;
    freshness: FreshnessStatus;
    next_action: string | null;
    last_completed: string | null;
    blockers_count: number;
  }>;
};

export async function getMultiProjectOverview(
  brainId?: string | null,
): Promise<MultiProjectOverview> {
  const rows = sortByPriority(await listProjectStateSnapshots(brainId ?? null));
  const active = rows.filter((r) => r.status === "active").length;
  const parked = rows.filter((r) => r.status === "parked").length;
  const blocked = rows.filter((r) => r.status === "blocked" || r.blockers.length > 0).length;
  const high_priority = rows.filter(
    (r) => r.priority === "very_high" || r.priority === "high",
  ).length;
  const needs_update = rows.filter(
    (r) => r.freshness_status === "stale" || r.freshness_status === "old" || r.freshness_status === "unknown",
  ).length;

  const candidate = rows.find(
    (r) => r.status === "active" && (r.priority === "very_high" || r.priority === "high") && !!r.next_action,
  ) ?? rows.find((r) => r.status === "active" && !!r.next_action) ?? null;

  return {
    total: rows.length,
    active,
    high_priority,
    needs_update,
    parked,
    blocked,
    recommended_next: candidate
      ? {
          project_key: candidate.project_key,
          project_name: candidate.project_name,
          next_action: candidate.next_action,
          reason:
            candidate.priority === "very_high" || candidate.priority === "high"
              ? "Priorità alta e prossima azione definita."
              : "Progetto attivo con prossima azione definita.",
        }
      : null,
    projects: rows.map((r) => ({
      project_key: r.project_key,
      project_name: r.project_name,
      status: r.status,
      priority: r.priority,
      freshness: r.freshness_status,
      next_action: r.next_action,
      last_completed: r.last_completed,
      blockers_count: r.blockers.length,
    })),
  };
}

export async function buildJackMultiProjectContext(
  brainId?: string | null,
): Promise<MultiProjectOverview> {
  const ov = await getMultiProjectOverview(brainId ?? null);
  void logProjectStateEvent("jack_multi_project_overview_requested", {
    total: ov.total,
    active: ov.active,
    high_priority: ov.high_priority,
    needs_update: ov.needs_update,
  });
  return ov;
}

// ---------- Action Queue integration ----------

export type ActionFromProjectResult = {
  ok: boolean;
  created: boolean;
  duplicate_prevented: boolean;
  action_id: string | null;
  reason?: string;
};

type AutomationActionRow = {
  id: string;
  title: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

export async function createActionFromProjectSnapshot(
  snapshot: ProjectStateSnapshot,
): Promise<ActionFromProjectResult> {
  if (!snapshot.next_action || !snapshot.next_action.trim()) {
    return { ok: false, created: false, duplicate_prevented: false, action_id: null, reason: "no_next_action" };
  }
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  // Dedup: same project_key + same next_action + still open status.
  const openStatuses = ["suggested", "pending_approval", "approved", "ready_to_execute"];
  const { data: existing } = await supabase
    .from("automation_actions" as never)
    .select("id,title,status,metadata")
    .eq("user_id", u.user.id)
    .in("status", openStatuses as never)
    .limit(50);
  const rows = (existing ?? []) as unknown as AutomationActionRow[];
  const duplicate = rows.find((r) => {
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    return md.project_key === snapshot.project_key && md.next_action === snapshot.next_action;
  });
  if (duplicate) {
    void logProjectStateEvent("project_state_duplicate_action_prevented", {
      project_key: snapshot.project_key,
      action_id: duplicate.id,
      snapshot_id: snapshot.id,
    });
    return { ok: true, created: false, duplicate_prevented: true, action_id: duplicate.id };
  }

  const payload = {
    user_id: u.user.id,
    source: "user_manual",
    action_type: "manual_task",
    title: `[${snapshot.project_name}] ${snapshot.next_action.slice(0, 140)}`,
    description: snapshot.next_action,
    priority:
      snapshot.priority === "very_high" || snapshot.priority === "high" ? "high" : "medium",
    risk_level: "low",
    status: "suggested",
    requires_confirmation: true,
    brain_id: snapshot.brain_id,
    project_id: snapshot.project_id,
    metadata: {
      source_origin: "project_state",
      project_key: snapshot.project_key,
      project_name: snapshot.project_name,
      source_snapshot_id: snapshot.id,
      next_action: snapshot.next_action,
    },
  };

  const { data, error } = await supabase
    .from("automation_actions" as never)
    .insert(payload as never)
    .select("id")
    .single();
  if (error) throw error;
  const actionId = (data as { id: string }).id;
  void logProjectStateEvent("project_state_action_created", {
    project_key: snapshot.project_key,
    snapshot_id: snapshot.id,
    action_id: actionId,
    priority: snapshot.priority,
  });
  return { ok: true, created: true, duplicate_prevented: false, action_id: actionId };
}

// ---------- Labels ----------

export const PRIORITY_LABEL: Record<ProjectPriority, string> = {
  very_high: "Molto alta",
  high: "Alta",
  medium: "Media",
  low: "Bassa",
};

export const PRIORITY_TONE: Record<ProjectPriority, string> = {
  very_high: "bg-red-500/10 text-red-600 border-red-500/30",
  high: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  low: "bg-slate-500/10 text-slate-500 border-slate-500/30",
};

export const STATUS_LABEL_PS: Record<ProjectStatus, string> = {
  active: "Attivo",
  paused: "In pausa",
  blocked: "Bloccato",
  parked: "Parcheggiato",
  completed: "Completato",
};

export const FRESHNESS_LABEL: Record<FreshnessStatus, string> = {
  fresh: "Aggiornato",
  stale: "Da aggiornare",
  old: "Vecchio",
  unknown: "Sconosciuto",
};

export const FRESHNESS_TONE: Record<FreshnessStatus, string> = {
  fresh: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  stale: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  old: "bg-red-500/10 text-red-600 border-red-500/30",
  unknown: "bg-slate-500/10 text-slate-500 border-slate-500/30",
};
