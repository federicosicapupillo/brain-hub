import { supabase } from "@/integrations/supabase/client";

// ============================================================
// Types
// ============================================================

export type EngineType =
  | "app_builder"
  | "coding_agent"
  | "ide_agent"
  | "repository"
  | "deployment"
  | "automation"
  | "manual";

export type EngineStatus = "available" | "configured" | "disabled" | "experimental";

export type ConnectionMode =
  | "manual"
  | "browser_bridge"
  | "api_future"
  | "local_cli_future";

export type RiskLevel = "low" | "medium" | "high";

export type TaskType =
  | "new_mvp"
  | "feature"
  | "bug_fix"
  | "refactor"
  | "ui_design"
  | "backend"
  | "database"
  | "automation"
  | "deployment"
  | "documentation"
  | "analysis";

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  new_mvp: "Nuovo MVP",
  feature: "Nuova feature",
  bug_fix: "Bug fix",
  refactor: "Refactor",
  ui_design: "UI / Design",
  backend: "Backend",
  database: "Database",
  automation: "Automazione",
  deployment: "Deployment",
  documentation: "Documentazione",
  analysis: "Analisi",
};

export type BuildEngine = {
  id?: string;
  user_id?: string;
  brain_id?: string | null;
  engine_key: string;
  engine_name: string;
  engine_type: EngineType;
  status: EngineStatus;
  connection_mode: ConnectionMode;
  best_for: string[];
  limitations: string[];
  risk_level: RiskLevel | null;
  tool_url: string | null;
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type BuildEngineHandoff = {
  id: string;
  user_id: string;
  brain_id: string | null;
  project_id: string | null;
  engine_key: string;
  task_type: TaskType | string;
  title: string;
  description: string | null;
  generated_prompt: string;
  handoff_status:
    | "draft"
    | "ready"
    | "copied"
    | "sent_manually"
    | "result_received"
    | "reviewed"
    | "archived";
  risk_level: RiskLevel | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

// ============================================================
// Predefined engines (static fallback registry)
// ============================================================

export const DEFAULT_ENGINES: BuildEngine[] = [
  {
    engine_key: "lovable",
    engine_name: "Lovable",
    engine_type: "app_builder",
    status: "available",
    connection_mode: "browser_bridge",
    best_for: [
      "MVP web app",
      "Dashboard",
      "CRUD",
      "Frontend + backend rapido",
      "Prototipo presentabile",
    ],
    limitations: [
      "Progetti molto grandi",
      "Controllo codice profondo",
      "Refactor complessi",
    ],
    risk_level: "low",
    tool_url: "https://lovable.dev",
    metadata: {},
  },
  {
    engine_key: "claude_code",
    engine_name: "Claude Code",
    engine_type: "coding_agent",
    status: "available",
    connection_mode: "manual",
    best_for: [
      "Codebase esistente",
      "Bug fixing",
      "Refactor",
      "Multi-file edits",
      "Terminal workflow",
    ],
    limitations: [
      "Richiede repo/ambiente configurato",
      "Serve controllo umano su modifiche sensibili",
    ],
    risk_level: "medium",
    tool_url: "https://claude.ai/code",
    metadata: {},
  },
  {
    engine_key: "codex",
    engine_name: "Codex",
    engine_type: "coding_agent",
    status: "available",
    connection_mode: "manual",
    best_for: [
      "Sviluppo software strutturato",
      "Task tecnici",
      "Codice",
      "Debugging",
      "Integrazioni",
    ],
    limitations: ["Richiede specifiche chiare", "Serve review tecnica"],
    risk_level: "medium",
    tool_url: "https://chatgpt.com/codex",
    metadata: {},
  },
  {
    engine_key: "replit",
    engine_name: "Replit",
    engine_type: "app_builder",
    status: "available",
    connection_mode: "manual",
    best_for: ["Prototipi deployabili", "App leggere", "Demo rapide"],
    limitations: ["Architetture enterprise complesse"],
    risk_level: "low",
    tool_url: "https://replit.com",
    metadata: {},
  },
  {
    engine_key: "cursor",
    engine_name: "Cursor",
    engine_type: "ide_agent",
    status: "available",
    connection_mode: "local_cli_future",
    best_for: [
      "Sviluppo assistito in IDE",
      "Modifiche su codice esistente",
      "Developer workflow",
    ],
    limitations: ["Richiede sviluppatore o utente tecnico"],
    risk_level: "medium",
    tool_url: "https://cursor.sh",
    metadata: {},
  },
  {
    engine_key: "bolt",
    engine_name: "Bolt",
    engine_type: "app_builder",
    status: "available",
    connection_mode: "manual",
    best_for: ["Prototipi rapidi", "Frontend", "Web app semplici"],
    limitations: ["Controllo architetturale limitato"],
    risk_level: "low",
    tool_url: "https://bolt.new",
    metadata: {},
  },
  {
    engine_key: "v0",
    engine_name: "v0",
    engine_type: "app_builder",
    status: "available",
    connection_mode: "manual",
    best_for: ["UI", "Componenti frontend", "Landing", "Dashboard design"],
    limitations: ["Non è il motore principale per backend complessi"],
    risk_level: "low",
    tool_url: "https://v0.dev",
    metadata: {},
  },
  {
    engine_key: "github",
    engine_name: "GitHub",
    engine_type: "repository",
    status: "available",
    connection_mode: "manual",
    best_for: ["Versionamento", "Pull request", "Code review", "Storico codice"],
    limitations: ["Non costruisce da solo senza agenti collegati"],
    risk_level: "low",
    tool_url: "https://github.com",
    metadata: {},
  },
  {
    engine_key: "manual_developer",
    engine_name: "Manual Developer",
    engine_type: "manual",
    status: "available",
    connection_mode: "manual",
    best_for: [
      "Task critici",
      "Sicurezza",
      "Architettura",
      "Decisioni tecniche",
    ],
    limitations: ["Più lento", "Costo umano"],
    risk_level: "low",
    tool_url: null,
    metadata: {},
  },
  {
    engine_key: "custom_tool",
    engine_name: "Custom Tool",
    engine_type: "manual",
    status: "experimental",
    connection_mode: "manual",
    best_for: ["Strumenti futuri", "Tool aziendali proprietari"],
    limitations: ["Da configurare"],
    risk_level: null,
    tool_url: null,
    metadata: {},
  },
];

export const ENGINE_TYPE_LABEL: Record<EngineType, string> = {
  app_builder: "App builder",
  coding_agent: "Coding agent",
  ide_agent: "IDE agent",
  repository: "Repository",
  deployment: "Deployment",
  automation: "Automazione",
  manual: "Manuale",
};

export const STATUS_LABEL: Record<EngineStatus, string> = {
  available: "Disponibile",
  configured: "Configurato",
  disabled: "Disabilitato",
  experimental: "Sperimentale",
};

export const CONNECTION_MODE_LABEL: Record<ConnectionMode, string> = {
  manual: "Manuale",
  browser_bridge: "Browser bridge",
  api_future: "API (futuro)",
  local_cli_future: "CLI locale (futuro)",
};

// ============================================================
// Registry I/O
// ============================================================

export async function listBuildEngines(brainId?: string | null): Promise<BuildEngine[]> {
  const { data, error } = await supabase
    .from("build_engine_registry" as never)
    .select("*")
    .order("engine_name", { ascending: true });
  if (error) {
    console.warn("[build-engines] registry read failed, fallback to defaults", error);
    return DEFAULT_ENGINES;
  }
  const rows = (data ?? []) as unknown as BuildEngine[];
  const userScoped = brainId
    ? rows.filter((r) => !r.brain_id || r.brain_id === brainId)
    : rows;
  // Merge defaults with stored overrides (engine_key uniqueness)
  const map = new Map<string, BuildEngine>();
  for (const e of DEFAULT_ENGINES) map.set(e.engine_key, e);
  for (const e of userScoped) map.set(e.engine_key, e);
  return Array.from(map.values());
}

export type BuildEngineDetailed = BuildEngine & {
  is_default: boolean;
  is_custom: boolean;
  has_override: boolean;
};

export async function listBuildEnginesDetailed(
  brainId?: string | null,
): Promise<BuildEngineDetailed[]> {
  const { data, error } = await supabase
    .from("build_engine_registry" as never)
    .select("*")
    .order("engine_name", { ascending: true });
  const rows = error ? [] : ((data ?? []) as unknown as BuildEngine[]);
  const userScoped = brainId
    ? rows.filter((r) => !r.brain_id || r.brain_id === brainId)
    : rows;
  const overrideKeys = new Set(userScoped.map((r) => r.engine_key));
  const out: BuildEngineDetailed[] = [];
  const seen = new Set<string>();
  // Defaults (with override applied if exists)
  for (const def of DEFAULT_ENGINES) {
    const ov = userScoped.find((r) => r.engine_key === def.engine_key);
    const base = ov ?? def;
    out.push({
      ...base,
      is_default: true,
      is_custom: false,
      has_override: !!ov,
    });
    seen.add(def.engine_key);
  }
  // Custom-only engines (not in defaults)
  for (const r of userScoped) {
    if (seen.has(r.engine_key)) continue;
    out.push({ ...r, is_default: false, is_custom: true, has_override: false });
  }
  return out.sort((a, b) => a.engine_name.localeCompare(b.engine_name));
  // suppress unused warning
  void overrideKeys;
}

export function getBuildEngine(engineKey: string): BuildEngine | undefined {
  return DEFAULT_ENGINES.find((e) => e.engine_key === engineKey);
}

export function isDefaultEngineKey(engineKey: string): boolean {
  return DEFAULT_ENGINES.some((e) => e.engine_key === engineKey);
}

// ============================================================
// Validation / Sanitization for engine registry input
// ============================================================

const SENSITIVE_KEY_PATTERNS = [
  /api[_-]?key/i,
  /token/i,
  /password/i,
  /authorization/i,
  /bearer/i,
  /secret/i,
  /webhook[_-]?secret/i,
  /access[_-]?key/i,
  /private[_-]?key/i,
];

export function validateEngineKey(engineKey: string): { ok: true } | { ok: false; error: string } {
  if (!engineKey || engineKey.length < 2) {
    return { ok: false, error: "Engine key troppo corto" };
  }
  if (engineKey.length > 60) {
    return { ok: false, error: "Engine key troppo lungo (max 60)" };
  }
  if (!/^[a-z0-9_-]+$/.test(engineKey)) {
    return {
      ok: false,
      error: "Solo lettere minuscole, numeri, underscore o trattino",
    };
  }
  return { ok: true };
}

function looksSensitive(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(value));
}

export function sanitizeEngineMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") return {};
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (SENSITIVE_KEY_PATTERNS.some((p) => p.test(k))) continue;
    if (looksSensitive(v)) continue;
    if (typeof v === "string" && v.length > 2000) continue;
    clean[k] = v;
  }
  return clean;
}

export function sanitizeToolUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (SENSITIVE_KEY_PATTERNS.some((p) => p.test(trimmed))) return null;
  return trimmed.slice(0, 500);
}

export type EngineRegistryInput = {
  engine_key: string;
  engine_name: string;
  engine_type: EngineType;
  status: EngineStatus;
  connection_mode: ConnectionMode;
  best_for: string[];
  limitations: string[];
  risk_level: RiskLevel | null;
  tool_url: string | null;
  metadata?: Record<string, unknown>;
  brain_id?: string | null;
};

async function getEngineRowByKey(
  engineKey: string,
  brainId: string | null | undefined,
): Promise<{ id: string } | null> {
  let q = supabase
    .from("build_engine_registry" as never)
    .select("id,brain_id")
    .eq("engine_key", engineKey);
  if (brainId) q = q.or(`brain_id.eq.${brainId},brain_id.is.null`);
  const { data } = await q.limit(1);
  const row = (data ?? [])[0] as { id: string } | undefined;
  return row ?? null;
}

export async function createCustomBuildEngine(
  input: EngineRegistryInput,
): Promise<BuildEngine> {
  const keyCheck = validateEngineKey(input.engine_key);
  if (!keyCheck.ok) throw new Error(keyCheck.error);
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");
  const existing = await getEngineRowByKey(input.engine_key, input.brain_id ?? null);
  if (existing) throw new Error("Esiste già un engine con questa key");
  const payload = {
    user_id: u.user.id,
    brain_id: input.brain_id ?? null,
    engine_key: input.engine_key,
    engine_name: input.engine_name,
    engine_type: input.engine_type,
    status: input.status,
    connection_mode: input.connection_mode,
    best_for: input.best_for,
    limitations: input.limitations,
    risk_level: input.risk_level,
    tool_url: sanitizeToolUrl(input.tool_url),
    metadata: sanitizeEngineMetadata(input.metadata),
  };
  const { data, error } = await supabase
    .from("build_engine_registry" as never)
    .insert(payload as never)
    .select()
    .single();
  if (error) throw error;
  const created = data as unknown as BuildEngine;
  await logBuildEngineEvent(
    isDefaultEngineKey(input.engine_key)
      ? "build_engine_override_created"
      : "build_engine_custom_created",
    `Engine ${input.engine_name} creato`,
    { engine_key: input.engine_key, is_default_override: isDefaultEngineKey(input.engine_key) },
  );
  return created;
}

export async function updateBuildEngine(
  engineId: string,
  input: Partial<EngineRegistryInput>,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.engine_name !== undefined) patch.engine_name = input.engine_name;
  if (input.engine_type !== undefined) patch.engine_type = input.engine_type;
  if (input.status !== undefined) patch.status = input.status;
  if (input.connection_mode !== undefined) patch.connection_mode = input.connection_mode;
  if (input.best_for !== undefined) patch.best_for = input.best_for;
  if (input.limitations !== undefined) patch.limitations = input.limitations;
  if (input.risk_level !== undefined) patch.risk_level = input.risk_level;
  if (input.tool_url !== undefined) patch.tool_url = sanitizeToolUrl(input.tool_url);
  if (input.metadata !== undefined) patch.metadata = sanitizeEngineMetadata(input.metadata);
  const { error } = await supabase
    .from("build_engine_registry" as never)
    .update(patch as never)
    .eq("id", engineId);
  if (error) throw error;
  await logBuildEngineEvent("build_engine_updated", `Engine aggiornato`, {
    engine_id: engineId,
  });
}

export async function disableBuildEngine(engineKey: string, brainId?: string | null): Promise<void> {
  const existing = await getEngineRowByKey(engineKey, brainId ?? null);
  if (existing) {
    await updateBuildEngine(existing.id, { status: "disabled" });
  } else {
    const def = getBuildEngine(engineKey);
    if (!def) throw new Error("Engine non trovato");
    await createCustomBuildEngine({
      ...def,
      brain_id: brainId ?? null,
      status: "disabled",
      metadata: def.metadata,
    });
  }
  await logBuildEngineEvent("build_engine_disabled", `Engine disabilitato`, {
    engine_key: engineKey,
  });
}

export async function enableBuildEngine(engineKey: string, brainId?: string | null): Promise<void> {
  const existing = await getEngineRowByKey(engineKey, brainId ?? null);
  if (existing) {
    await updateBuildEngine(existing.id, { status: "available" });
  }
  await logBuildEngineEvent("build_engine_enabled", `Engine riattivato`, {
    engine_key: engineKey,
  });
}

export async function resetBuildEngineOverride(
  engineKey: string,
  brainId?: string | null,
): Promise<void> {
  if (!isDefaultEngineKey(engineKey)) {
    throw new Error("Reset disponibile solo per engine predefiniti");
  }
  const existing = await getEngineRowByKey(engineKey, brainId ?? null);
  if (!existing) return;
  const { error } = await supabase
    .from("build_engine_registry" as never)
    .delete()
    .eq("id", existing.id);
  if (error) throw error;
  await logBuildEngineEvent("build_engine_override_reset", `Override rimosso`, {
    engine_key: engineKey,
  });
}

// ============================================================
// Routing / Scoring
// ============================================================

export type RouterInput = {
  brain_id?: string | null;
  project_id?: string | null;
  task_title: string;
  task_description?: string;
  task_type: TaskType;
  complexity?: "low" | "medium" | "high";
  needs_backend?: boolean;
  needs_database?: boolean;
  needs_existing_codebase?: boolean;
  needs_ui?: boolean;
  needs_deploy?: boolean;
  risk_level?: RiskLevel;
  preferred_engine?: string | null;
};

export type EngineScore = {
  engine_key: string;
  engine_name: string;
  score: number;
  reasons: string[];
  warnings: string[];
};

export function scoreBuildEngines(
  input: RouterInput,
  engines: BuildEngine[] = DEFAULT_ENGINES,
): EngineScore[] {
  const out: EngineScore[] = [];
  for (const e of engines) {
    let score = 0;
    const reasons: string[] = [];
    const warnings: string[] = [];

    // Task type heuristics
    if (input.task_type === "new_mvp" && e.engine_type === "app_builder") {
      score += 30;
      reasons.push("Adatto a creare nuovi MVP");
    }
    if (input.task_type === "feature" && e.engine_type === "app_builder") {
      score += 20;
      reasons.push("Adatto a nuove feature in app esistenti");
    }
    if (
      (input.task_type === "bug_fix" || input.task_type === "refactor") &&
      (e.engine_type === "coding_agent" || e.engine_type === "ide_agent")
    ) {
      score += 30;
      reasons.push("Adatto a bug fix / refactor su codebase");
    }
    if (input.task_type === "ui_design" && (e.engine_key === "v0" || e.engine_key === "lovable")) {
      score += 25;
      reasons.push("Adatto a UI / design");
    }
    if (
      (input.task_type === "backend" || input.task_type === "database") &&
      (e.engine_key === "lovable" || e.engine_type === "coding_agent")
    ) {
      score += 20;
      reasons.push("Gestisce backend / DB");
    }
    if (input.task_type === "automation") {
      if (e.engine_key === "manual_developer") {
        score += 15;
        reasons.push("Decisioni di automazione richiedono controllo umano");
      }
    }
    if (input.task_type === "deployment" && (e.engine_key === "replit" || e.engine_key === "github")) {
      score += 20;
      reasons.push("Buono per deployment / repo");
    }
    if (input.task_type === "documentation" && e.engine_key === "manual_developer") {
      score += 10;
      reasons.push("Documentazione affidabile fatta a mano");
    }
    if (input.task_type === "analysis" && e.engine_type === "coding_agent") {
      score += 15;
      reasons.push("Adatto ad analisi tecnica");
    }

    // Capability heuristics
    if (input.needs_existing_codebase) {
      if (e.engine_type === "coding_agent" || e.engine_type === "ide_agent") {
        score += 25;
        reasons.push("Lavora su codebase esistente");
      } else if (e.engine_type === "app_builder") {
        score -= 10;
        warnings.push("Meno adatto su codebase legacy");
      }
    }
    if (input.needs_ui && (e.engine_key === "v0" || e.engine_key === "lovable" || e.engine_key === "bolt")) {
      score += 10;
      reasons.push("Forte sulla UI");
    }
    if (input.needs_backend && e.engine_key === "lovable") {
      score += 10;
      reasons.push("Backend integrato");
    }
    if (input.needs_deploy && (e.engine_key === "replit" || e.engine_key === "lovable")) {
      score += 5;
      reasons.push("Deploy rapido");
    }

    // Complexity
    if (input.complexity === "high") {
      if (
        e.engine_key === "codex" ||
        e.engine_key === "claude_code" ||
        e.engine_key === "manual_developer"
      ) {
        score += 15;
        reasons.push("Gestisce complessità alta");
      } else if (e.engine_type === "app_builder") {
        score -= 5;
        warnings.push("Complessità alta: usare con cautela");
      }
    }

    // Risk
    if (input.risk_level === "high") {
      if (e.engine_key === "manual_developer") {
        score += 30;
        reasons.push("Rischio alto: richiede supervisione umana");
      } else {
        warnings.push("Task ad alto rischio: richiede approval");
      }
    }

    // Preferred engine
    if (input.preferred_engine && input.preferred_engine === e.engine_key) {
      score += 50;
      reasons.push("Engine preferito dall'utente");
    }

    // Status penalties
    if (e.status === "disabled") {
      score -= 100;
      warnings.push("Engine disabilitato");
    }
    if (e.status === "experimental") {
      score -= 5;
      warnings.push("Engine sperimentale");
    }

    out.push({
      engine_key: e.engine_key,
      engine_name: e.engine_name,
      score,
      reasons,
      warnings,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function getRecommendedBuildEngine(
  input: RouterInput,
  engines: BuildEngine[] = DEFAULT_ENGINES,
): EngineScore | null {
  const scored = scoreBuildEngines(input, engines);
  return scored[0] ?? null;
}

// ============================================================
// Prompt builder
// ============================================================

export function buildEnginePrompt(engineKey: string, input: RouterInput): string {
  const engine = getBuildEngine(engineKey);
  const name = engine?.engine_name ?? engineKey;
  const constraints: string[] = [];
  if (input.needs_existing_codebase) constraints.push("- Lavora su codebase esistente");
  if (input.needs_backend) constraints.push("- Serve backend funzionante");
  if (input.needs_database) constraints.push("- Serve persistenza database");
  if (input.needs_ui) constraints.push("- Serve UI rifinita");
  if (input.needs_deploy) constraints.push("- Serve deploy");
  if (input.risk_level) constraints.push(`- Livello di rischio: ${input.risk_level}`);
  if (input.complexity) constraints.push(`- Complessità: ${input.complexity}`);

  const header = [
    `# Handoff Brain Hub → ${name}`,
    "",
    `## Contesto`,
    `Brain Hub sta instradando manualmente questo task verso ${name}.`,
    `Nessuna automazione live: il prompt va copiato e usato dall'utente.`,
    "",
    `## Obiettivo`,
    input.task_title,
    "",
    input.task_description ? `## Descrizione\n${input.task_description}\n` : "",
    `## Tipo task`,
    `${TASK_TYPE_LABEL[input.task_type] ?? input.task_type}`,
    "",
    `## Vincoli`,
    constraints.length ? constraints.join("\n") : "- Nessun vincolo specifico",
    "",
    `## Cosa NON toccare`,
    "- Auth, RLS e secrets",
    "- Sistemi già funzionanti non collegati al task",
    "",
    `## Output richiesto`,
  ];

  let tail: string[] = [];
  switch (engineKey) {
    case "lovable":
      tail = [
        "- Route, componenti, DB e UX coerenti con il design system esistente",
        "- `tsc --noEmit` clean",
        "- Niente automazioni live, nessuna chiave API in chiaro",
        "",
        `## Criteri di successo`,
        "- UI usabile",
        "- Typecheck clean",
        "- Funzionalità verificabile da preview",
      ];
      break;
    case "claude_code":
    case "codex":
      tail = [
        "- Diff dettagliato per file",
        "- Changelog tecnico",
        "- Test / typecheck verificati",
        "- Lista esplicita di file modificati e file NON modificati",
        "",
        `## Criteri di successo`,
        "- Build pulita",
        "- Nessuna regressione",
        "- Decisioni motivate",
      ];
      break;
    case "v0":
      tail = [
        "- Componente UI riutilizzabile",
        "- Layout responsive",
        "- Stati: default, loading, empty, error",
        "",
        `## Criteri di successo`,
        "- Accessibile",
        "- Coerente con design system",
      ];
      break;
    case "replit":
    case "bolt":
      tail = [
        "- Struttura app minima ma deployabile",
        "- Variabili d'ambiente documentate",
        "- Limiti noti documentati",
        "",
        `## Criteri di successo`,
        "- App online accessibile",
        "- README minimo",
      ];
      break;
    case "cursor":
      tail = [
        "- Modifiche puntuali in IDE",
        "- Snippet con file:line di riferimento",
        "- Verifica typecheck locale",
      ];
      break;
    case "github":
      tail = [
        "- Pull request con descrizione",
        "- Issue collegata se possibile",
        "- Checklist di review",
      ];
      break;
    case "manual_developer":
      tail = [
        "- Brief tecnico chiaro",
        "- Priorità e rischi",
        "- Decisioni richieste prima di iniziare",
      ];
      break;
    default:
      tail = ["- Output coerente con il task", "- Documentazione minima"];
  }

  return [
    ...header,
    ...tail,
    "",
    `## Rischi`,
    input.risk_level
      ? `Livello: ${input.risk_level}. Approva ogni passaggio sensibile.`
      : "Non specificato.",
    "",
    `## Istruzioni per il motore`,
    `Sei ${name}. Rispondi seguendo il formato richiesto. Non eseguire azioni distruttive senza conferma esplicita.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ============================================================
// Handoffs CRUD
// ============================================================

export type CreateHandoffInput = {
  brain_id?: string | null;
  project_id?: string | null;
  engine_key: string;
  task_type: TaskType;
  title: string;
  description?: string | null;
  generated_prompt?: string | null;
  risk_level?: RiskLevel | null;
  router_input?: RouterInput;
  metadata?: Record<string, unknown>;
};

export async function createBuildEngineHandoff(
  input: CreateHandoffInput,
): Promise<BuildEngineHandoff> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  const prompt =
    input.generated_prompt ??
    (input.router_input
      ? buildEnginePrompt(input.engine_key, input.router_input)
      : `# Handoff ${input.engine_key}\n\n${input.title}\n\n${input.description ?? ""}`);

  const payload = {
    user_id: u.user.id,
    brain_id: input.brain_id ?? null,
    project_id: input.project_id ?? null,
    engine_key: input.engine_key,
    task_type: input.task_type,
    title: input.title,
    description: input.description ?? null,
    generated_prompt: prompt,
    handoff_status: "draft",
    risk_level: input.risk_level ?? null,
    metadata: input.metadata ?? {},
  };

  const { data, error } = await supabase
    .from("build_engine_handoffs" as never)
    .insert(payload as never)
    .select()
    .single();
  if (error) throw error;
  const created = data as unknown as BuildEngineHandoff;
  await logBuildEngineEvent("build_engine_handoff_created", `Handoff creato per ${input.engine_key}`, {
    handoff_id: created.id,
    engine_key: created.engine_key,
    task_type: created.task_type,
  });
  return created;
}

export async function listBuildEngineHandoffs(
  brainId?: string | null,
): Promise<BuildEngineHandoff[]> {
  let q = supabase
    .from("build_engine_handoffs" as never)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as BuildEngineHandoff[];
}

export async function updateHandoffStatus(
  id: string,
  status: BuildEngineHandoff["handoff_status"],
): Promise<void> {
  const { error } = await supabase
    .from("build_engine_handoffs" as never)
    .update({ handoff_status: status } as never)
    .eq("id", id);
  if (error) throw error;
}

// ============================================================
// Logging
// ============================================================

export type BuildEngineEvent =
  | "build_engines_viewed"
  | "build_engine_recommended"
  | "build_engine_handoff_created"
  | "build_engine_handoff_copied"
  | "build_engine_action_created"
  | "build_engine_result_review_created"
  | "build_engine_opened_from_company_blueprint"
  | "build_engine_opened_from_company_os"
  | "build_engine_opened_from_operating_dashboard"
  | "build_engine_custom_created"
  | "build_engine_override_created"
  | "build_engine_updated"
  | "build_engine_disabled"
  | "build_engine_enabled"
  | "build_engine_override_reset"
  | "build_engine_handoff_archived"
  | "build_engine_router_prefilled_from_company_os"
  | "build_engine_router_prefilled_from_company_blueprint";

export async function logBuildEngineEvent(
  action: BuildEngineEvent,
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
