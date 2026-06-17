import { supabase } from "@/integrations/supabase/client";
import {
  CreateHandoffInput,
  RouterInput,
  TaskType,
  buildEnginePrompt,
  createBuildEngineHandoff,
  getRecommendedBuildEngine,
} from "@/lib/build-engines";
import { createAction } from "@/lib/action-queue";
import { createReviewItem } from "@/lib/result-review";

// ============================================================
// Types
// ============================================================

export type MvpStatus =
  | "draft"
  | "generated"
  | "approved"
  | "handoff_created"
  | "in_build"
  | "result_review"
  | "archived";

export const MVP_STATUS_LABEL: Record<MvpStatus, string> = {
  draft: "Bozza",
  generated: "Generato",
  approved: "Approvato",
  handoff_created: "Handoff creato",
  in_build: "In build",
  result_review: "In review",
  archived: "Archiviato",
};

export type MvpScope = {
  must_have: string[];
  should_have: string[];
  later: string[];
};

export type MvpScreen = {
  name: string;
  purpose: string;
  audience: string;
};

export type MvpEntity = {
  name: string;
  fields: string[];
  relations: string[];
  sensitive: boolean;
  notes: string;
};

export type MvpRole = {
  name: string;
  permissions: string[];
  primary_actions: string[];
};

export type MvpIntegration = {
  name: string;
  reason: string;
  required_for_mvp: boolean;
};

export type MvpRisk = {
  category: "technical" | "privacy" | "ux" | "business" | "scope";
  description: string;
  mitigation: string;
};

export type MvpRoadmapPhase = {
  phase: string;
  goal: string;
  deliverables: string[];
};

export type MvpInputFeatures = {
  auth: boolean;
  dashboard: boolean;
  clients: boolean;
  tasks: boolean;
  documents: boolean;
  notifications: boolean;
  calendar: boolean;
  payments: boolean;
  chat: boolean;
  reports: boolean;
  admin_area: boolean;
  approval_workflow: boolean;
  ai_assistant: boolean;
  automations: boolean;
};

export type MvpInputConstraints = {
  budget_time: string;
  complexity: "low" | "medium" | "high";
  risk_level: "low" | "medium" | "high";
  sensitive_data: boolean;
  mobile_first: boolean;
  demo_commerciale: boolean;
  needs_public_deploy: boolean;
};

export type MvpInputIntegrations = {
  gmail: boolean;
  google_calendar: boolean;
  google_drive: boolean;
  telegram: boolean;
  whatsapp: boolean;
  stripe: boolean;
  supabase: boolean;
  github: boolean;
  n8n: boolean;
  crm: boolean;
  social: boolean;
  none: boolean;
};

export type MvpBuildProject = {
  id: string;
  user_id: string;
  brain_id: string | null;
  company_os_profile_id: string | null;
  company_blueprint_id: string | null;
  title: string;
  idea_summary: string;
  target_users: string[];
  main_problem: string | null;
  value_proposition: string | null;
  mvp_scope: MvpScope | Record<string, unknown>;
  screens: MvpScreen[];
  data_model: MvpEntity[];
  user_roles: MvpRole[];
  integrations: MvpIntegration[];
  risks: MvpRisk[];
  success_criteria: string[];
  roadmap: MvpRoadmapPhase[];
  recommended_engine: string | null;
  build_engine_handoff_id: string | null;
  status: MvpStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MvpCreateInput = {
  brain_id?: string | null;
  company_os_profile_id?: string | null;
  company_blueprint_id?: string | null;
  title: string;
  idea_summary: string;
  target_users?: string[];
  main_problem?: string | null;
  value_proposition?: string | null;
  features?: Partial<MvpInputFeatures>;
  integrations?: Partial<MvpInputIntegrations>;
  constraints?: Partial<MvpInputConstraints>;
  daily_users?: string;
  approvers?: string;
  business_goal?: string;
  data_entities_hint?: string;
  metadata?: Record<string, unknown>;
};

export type MvpUpdateInput = Partial<
  Omit<MvpBuildProject, "id" | "user_id" | "created_at" | "updated_at">
>;

// ============================================================
// Sanitization
// ============================================================

const SENSITIVE = /(api[_-]?key|token|secret|password|authorization|bearer|webhook)/i;

function sanitizeMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

// ============================================================
// CRUD
// ============================================================

function rowToProject(r: Record<string, unknown>): MvpBuildProject {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    brain_id: (r.brain_id as string | null) ?? null,
    company_os_profile_id: (r.company_os_profile_id as string | null) ?? null,
    company_blueprint_id: (r.company_blueprint_id as string | null) ?? null,
    title: String(r.title ?? ""),
    idea_summary: String(r.idea_summary ?? ""),
    target_users: Array.isArray(r.target_users) ? (r.target_users as string[]) : [],
    main_problem: (r.main_problem as string | null) ?? null,
    value_proposition: (r.value_proposition as string | null) ?? null,
    mvp_scope: (r.mvp_scope as MvpScope) ?? { must_have: [], should_have: [], later: [] },
    screens: Array.isArray(r.screens) ? (r.screens as MvpScreen[]) : [],
    data_model: Array.isArray(r.data_model) ? (r.data_model as MvpEntity[]) : [],
    user_roles: Array.isArray(r.user_roles) ? (r.user_roles as MvpRole[]) : [],
    integrations: Array.isArray(r.integrations) ? (r.integrations as MvpIntegration[]) : [],
    risks: Array.isArray(r.risks) ? (r.risks as MvpRisk[]) : [],
    success_criteria: Array.isArray(r.success_criteria) ? (r.success_criteria as string[]) : [],
    roadmap: Array.isArray(r.roadmap) ? (r.roadmap as MvpRoadmapPhase[]) : [],
    recommended_engine: (r.recommended_engine as string | null) ?? null,
    build_engine_handoff_id: (r.build_engine_handoff_id as string | null) ?? null,
    status: (r.status as MvpStatus) ?? "draft",
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

export type MvpFilters = {
  brain_id?: string | null;
  status?: MvpStatus | null;
};

export async function listMvpProjects(filters: MvpFilters = {}): Promise<MvpBuildProject[]> {
  let q = supabase
    .from("mvp_build_projects" as never)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filters.brain_id) q = q.eq("brain_id", filters.brain_id);
  if (filters.status) q = q.eq("status", filters.status);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(rowToProject);
}

export async function getMvpProject(id: string): Promise<MvpBuildProject | null> {
  const { data, error } = await supabase
    .from("mvp_build_projects" as never)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToProject(data as Record<string, unknown>);
}

export async function createMvpProject(input: MvpCreateInput): Promise<MvpBuildProject> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  const payload = {
    user_id: u.user.id,
    brain_id: input.brain_id ?? null,
    company_os_profile_id: input.company_os_profile_id ?? null,
    company_blueprint_id: input.company_blueprint_id ?? null,
    title: input.title,
    idea_summary: input.idea_summary,
    target_users: input.target_users ?? [],
    main_problem: input.main_problem ?? null,
    value_proposition: input.value_proposition ?? null,
    status: "draft" as MvpStatus,
    metadata: sanitizeMetadata({
      ...(input.metadata ?? {}),
      wizard_features: input.features ?? {},
      wizard_integrations: input.integrations ?? {},
      wizard_constraints: input.constraints ?? {},
      daily_users: input.daily_users ?? "",
      approvers: input.approvers ?? "",
      business_goal: input.business_goal ?? "",
      data_entities_hint: input.data_entities_hint ?? "",
    }),
  };
  const { data, error } = await supabase
    .from("mvp_build_projects" as never)
    .insert(payload as never)
    .select()
    .single();
  if (error) throw error;
  const created = rowToProject(data as Record<string, unknown>);
  await logMvpFactoryEvent("mvp_project_created", `MVP creato: ${created.title}`, {
    mvp_project_id: created.id,
    brain_id: created.brain_id,
  });
  return created;
}

export async function updateMvpProject(
  id: string,
  patch: MvpUpdateInput,
): Promise<MvpBuildProject | null> {
  const cleaned: Record<string, unknown> = { ...patch };
  if (cleaned.metadata !== undefined) {
    cleaned.metadata = sanitizeMetadata(cleaned.metadata as Record<string, unknown>);
  }
  const { data, error } = await supabase
    .from("mvp_build_projects" as never)
    .update(cleaned as never)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error || !data) return null;
  const updated = rowToProject(data as Record<string, unknown>);
  await logMvpFactoryEvent("mvp_project_updated", `MVP aggiornato: ${updated.title}`, {
    mvp_project_id: updated.id,
  });
  return updated;
}

export async function approveMvpProject(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("mvp_build_projects" as never)
    .update({ status: "approved" } as never)
    .eq("id", id);
  if (error) return false;
  await logMvpFactoryEvent("mvp_project_approved", `MVP approvato`, { mvp_project_id: id });
  return true;
}

export async function archiveMvpProject(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("mvp_build_projects" as never)
    .update({ status: "archived" } as never)
    .eq("id", id);
  if (error) return false;
  await logMvpFactoryEvent("mvp_project_archived", `MVP archiviato`, { mvp_project_id: id });
  return true;
}

// ============================================================
// MVP Spec Generation (heuristic, no AI)
// ============================================================

function readFeatures(p: MvpBuildProject): MvpInputFeatures {
  const m = (p.metadata?.wizard_features ?? {}) as Partial<MvpInputFeatures>;
  return {
    auth: m.auth ?? true,
    dashboard: m.dashboard ?? true,
    clients: m.clients ?? false,
    tasks: m.tasks ?? false,
    documents: m.documents ?? false,
    notifications: m.notifications ?? false,
    calendar: m.calendar ?? false,
    payments: m.payments ?? false,
    chat: m.chat ?? false,
    reports: m.reports ?? false,
    admin_area: m.admin_area ?? true,
    approval_workflow: m.approval_workflow ?? false,
    ai_assistant: m.ai_assistant ?? false,
    automations: m.automations ?? false,
  };
}

function readIntegrations(p: MvpBuildProject): MvpInputIntegrations {
  const m = (p.metadata?.wizard_integrations ?? {}) as Partial<MvpInputIntegrations>;
  return {
    gmail: !!m.gmail,
    google_calendar: !!m.google_calendar,
    google_drive: !!m.google_drive,
    telegram: !!m.telegram,
    whatsapp: !!m.whatsapp,
    stripe: !!m.stripe,
    supabase: m.supabase ?? true,
    github: !!m.github,
    n8n: !!m.n8n,
    crm: !!m.crm,
    social: !!m.social,
    none: !!m.none,
  };
}

function readConstraints(p: MvpBuildProject): MvpInputConstraints {
  const m = (p.metadata?.wizard_constraints ?? {}) as Partial<MvpInputConstraints>;
  return {
    budget_time: m.budget_time ?? "MVP rapido",
    complexity: m.complexity ?? "medium",
    risk_level: m.risk_level ?? "medium",
    sensitive_data: !!m.sensitive_data,
    mobile_first: !!m.mobile_first,
    demo_commerciale: !!m.demo_commerciale,
    needs_public_deploy: !!m.needs_public_deploy,
  };
}

function buildScope(features: MvpInputFeatures): MvpScope {
  const must: string[] = [];
  const should: string[] = [];
  const later: string[] = [];
  if (features.auth) must.push("Login / autenticazione utenti");
  if (features.dashboard) must.push("Dashboard principale");
  if (features.admin_area) must.push("Area admin minima");
  if (features.clients) must.push("Gestione clienti / anagrafica");
  if (features.tasks) must.push("Gestione attività / task");
  if (features.documents) should.push("Gestione documenti / upload");
  if (features.notifications) should.push("Sistema notifiche");
  if (features.calendar) should.push("Calendario / scheduling");
  if (features.reports) should.push("Report base");
  if (features.approval_workflow) should.push("Workflow approvazione");
  if (features.chat) later.push("Chat in-app");
  if (features.payments) later.push("Integrazione pagamenti");
  if (features.ai_assistant) later.push("AI assistant");
  if (features.automations) later.push("Automazioni avanzate");
  if (must.length === 0) must.push("Una schermata principale funzionante");
  return { must_have: must, should_have: should, later };
}

function buildScreens(features: MvpInputFeatures): MvpScreen[] {
  const out: MvpScreen[] = [];
  if (features.auth) out.push({ name: "Login", purpose: "Autenticazione utente", audience: "Tutti" });
  if (features.dashboard) out.push({ name: "Dashboard", purpose: "Overview operativa", audience: "Utenti loggati" });
  if (features.clients) {
    out.push({ name: "Lista clienti", purpose: "Elenco filtrabile", audience: "Operatori" });
    out.push({ name: "Dettaglio cliente", purpose: "Scheda completa", audience: "Operatori" });
  }
  if (features.tasks) {
    out.push({ name: "Lista task", purpose: "Attività operative", audience: "Operatori" });
    out.push({ name: "Form nuovo task", purpose: "Creazione/modifica task", audience: "Operatori" });
  }
  if (features.documents) out.push({ name: "Documenti", purpose: "Upload e consultazione", audience: "Operatori" });
  if (features.calendar) out.push({ name: "Calendario", purpose: "Vista temporale eventi", audience: "Operatori" });
  if (features.reports) out.push({ name: "Report", purpose: "Metriche e KPI", audience: "Admin / Manager" });
  if (features.notifications) out.push({ name: "Notifiche", purpose: "Centro notifiche", audience: "Tutti" });
  if (features.admin_area) out.push({ name: "Admin", purpose: "Gestione utenti e configurazione", audience: "Admin" });
  out.push({ name: "Impostazioni", purpose: "Profilo e preferenze", audience: "Utenti loggati" });
  return out;
}

function buildDataModel(
  features: MvpInputFeatures,
  constraints: MvpInputConstraints,
  hint: string,
): MvpEntity[] {
  const sensitive = constraints.sensitive_data;
  const entities: MvpEntity[] = [];
  if (features.auth) {
    entities.push({
      name: "users",
      fields: ["id", "email", "display_name", "role", "created_at"],
      relations: ["user_roles"],
      sensitive: true,
      notes: "RLS user-scoped. No password in DB (managed by auth).",
    });
  }
  if (features.clients) {
    entities.push({
      name: "clients",
      fields: ["id", "user_id", "name", "email", "phone", "notes", "created_at"],
      relations: ["users"],
      sensitive,
      notes: sensitive ? "Dati personali: RLS owner-only + audit." : "RLS user-scoped.",
    });
  }
  if (features.tasks) {
    entities.push({
      name: "tasks",
      fields: ["id", "user_id", "title", "status", "priority", "due_date", "assignee_id"],
      relations: ["users", "clients"],
      sensitive: false,
      notes: "Index su status e assignee_id.",
    });
  }
  if (features.documents) {
    entities.push({
      name: "documents",
      fields: ["id", "user_id", "title", "file_path", "mime_type", "size_bytes"],
      relations: ["users"],
      sensitive,
      notes: "Storage privato. Bucket non pubblico.",
    });
  }
  if (features.calendar) {
    entities.push({
      name: "events",
      fields: ["id", "user_id", "title", "starts_at", "ends_at", "location"],
      relations: ["users"],
      sensitive: false,
      notes: "Index su starts_at.",
    });
  }
  if (features.notifications) {
    entities.push({
      name: "notifications",
      fields: ["id", "user_id", "title", "body", "read_at"],
      relations: ["users"],
      sensitive: false,
      notes: "RLS user-scoped.",
    });
  }
  if (features.payments) {
    entities.push({
      name: "orders",
      fields: ["id", "user_id", "amount_cents", "currency", "status", "external_id"],
      relations: ["users"],
      sensitive: true,
      notes: "Webhook firmato. Mai chiavi segrete in client.",
    });
  }
  if (hint) {
    const guesses = hint
      .split(/[,;\n]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    for (const g of guesses) {
      if (!entities.find((e) => e.name === g)) {
        entities.push({
          name: g,
          fields: ["id", "user_id", "name", "created_at"],
          relations: [],
          sensitive: false,
          notes: "Da definire con utente.",
        });
      }
    }
  }
  return entities;
}

function buildRoles(features: MvpInputFeatures, approvers: string): MvpRole[] {
  const roles: MvpRole[] = [
    {
      name: "user",
      permissions: ["read own data", "manage own data"],
      primary_actions: ["accedere", "creare/modificare elementi propri"],
    },
  ];
  if (features.admin_area) {
    roles.push({
      name: "admin",
      permissions: ["full access", "manage users"],
      primary_actions: ["configurare sistema", "gestire utenti"],
    });
  }
  if (features.approval_workflow || approvers.trim()) {
    roles.push({
      name: "approver",
      permissions: ["approve / reject"],
      primary_actions: ["approvare richieste", "richiedere modifiche"],
    });
  }
  return roles;
}

function buildIntegrations(integ: MvpInputIntegrations): MvpIntegration[] {
  if (integ.none) return [];
  const out: MvpIntegration[] = [];
  const push = (cond: boolean, name: string, reason: string, required = false) => {
    if (cond) out.push({ name, reason, required_for_mvp: required });
  };
  push(integ.supabase, "Supabase", "Auth, DB, storage", true);
  push(integ.gmail, "Gmail", "Invio email / notifiche", false);
  push(integ.google_calendar, "Google Calendar", "Sync eventi", false);
  push(integ.google_drive, "Google Drive", "Storage file", false);
  push(integ.telegram, "Telegram", "Approvazioni / notifiche", false);
  push(integ.whatsapp, "WhatsApp", "Messaggi cliente", false);
  push(integ.stripe, "Stripe", "Pagamenti", false);
  push(integ.github, "GitHub", "Repo / CI", false);
  push(integ.n8n, "n8n", "Workflow / automazioni", false);
  push(integ.crm, "CRM", "Sync contatti", false);
  push(integ.social, "Social", "Distribuzione contenuti", false);
  return out;
}

function buildRisks(
  features: MvpInputFeatures,
  constraints: MvpInputConstraints,
): MvpRisk[] {
  const risks: MvpRisk[] = [];
  if (constraints.sensitive_data) {
    risks.push({
      category: "privacy",
      description: "Trattamento dati personali / sensibili",
      mitigation: "RLS per riga, audit log, niente segreti in client",
    });
  }
  if (features.payments) {
    risks.push({
      category: "business",
      description: "Pagamenti: rischio errori transazionali",
      mitigation: "Webhook firmato + sandbox prima di andare live",
    });
  }
  if (constraints.complexity === "high") {
    risks.push({
      category: "scope",
      description: "Scope troppo ampio per un MVP",
      mitigation: "Stringere il must-have, rimandare il resto",
    });
  }
  if (constraints.risk_level === "high") {
    risks.push({
      category: "technical",
      description: "Rischio tecnico elevato",
      mitigation: "Approvazione manuale di ogni step sensibile",
    });
  }
  risks.push({
    category: "ux",
    description: "UI confusa per utenti reali",
    mitigation: "Test su 3-5 utenti prima dello scale",
  });
  return risks;
}

function buildSuccessCriteria(features: MvpInputFeatures): string[] {
  const c: string[] = [
    "Login funzionante",
    "Almeno 1 flusso end-to-end completabile",
    "Nessun errore bloccante sui flussi principali",
  ];
  if (features.dashboard) c.push("Dashboard mostra dati reali");
  if (features.reports) c.push("Almeno un report leggibile");
  if (features.approval_workflow) c.push("Approvazione testata da un utente reale");
  c.push("Tempo medio per completare il flusso principale < 2 minuti");
  return c;
}

function buildRoadmap(
  features: MvpInputFeatures,
  constraints: MvpInputConstraints,
): MvpRoadmapPhase[] {
  return [
    {
      phase: "Fase 1 — Prototipo",
      goal: "Skeleton navigabile",
      deliverables: [
        "Routing e layout",
        features.auth ? "Login base" : "Mock utente",
        "Schermate vuote ma collegate",
      ],
    },
    {
      phase: "Fase 2 — MVP funzionante",
      goal: "Flussi must-have completabili",
      deliverables: [
        "DB / persistenza dei must-have",
        "Form principali funzionanti",
        "Validazione minima",
      ],
    },
    {
      phase: "Fase 3 — Test utenti",
      goal: "Validare su utenti reali",
      deliverables: [
        "Test interno su 3-5 utenti",
        "Log dei problemi rilevati",
        constraints.needs_public_deploy ? "Deploy preview pubblica" : "Demo controllata",
      ],
    },
    {
      phase: "Fase 4 — Iterazione",
      goal: "Correggere problemi, valutare scale",
      deliverables: [
        "Backlog di fix prioritari",
        "Decisione go/no-go sul livello successivo",
      ],
    },
  ];
}

function recommendEngine(
  features: MvpInputFeatures,
  constraints: MvpInputConstraints,
): { engine: string; reason: string; routerInput: RouterInput; taskType: TaskType } {
  const needsUi = true;
  const needsBackend = features.auth || features.clients || features.tasks || features.payments;
  const routerInput: RouterInput = {
    task_title: "Nuovo MVP",
    task_type: "new_mvp",
    needs_ui: needsUi,
    needs_backend: needsBackend,
    needs_database: needsBackend,
    needs_deploy: constraints.needs_public_deploy,
    complexity: constraints.complexity,
    risk_level: constraints.risk_level,
  };
  const top = getRecommendedBuildEngine(routerInput);
  const engine = top?.engine_key ?? "lovable";
  const reason = top?.reasons?.[0] ?? "MVP web app con UI + backend rapido";
  return { engine, reason, routerInput, taskType: "new_mvp" };
}

export async function generateMvpSpec(id: string): Promise<MvpBuildProject | null> {
  const project = await getMvpProject(id);
  if (!project) return null;

  const features = readFeatures(project);
  const integrations = readIntegrations(project);
  const constraints = readConstraints(project);
  const hint = String(project.metadata?.data_entities_hint ?? "");

  const scope = buildScope(features);
  const screens = buildScreens(features);
  const dataModel = buildDataModel(features, constraints, hint);
  const roles = buildRoles(features, String(project.metadata?.approvers ?? ""));
  const integ = buildIntegrations(integrations);
  const risks = buildRisks(features, constraints);
  const success = buildSuccessCriteria(features);
  const roadmap = buildRoadmap(features, constraints);
  const rec = recommendEngine(features, constraints);

  const patch: MvpUpdateInput = {
    mvp_scope: scope,
    screens,
    data_model: dataModel,
    user_roles: roles,
    integrations: integ,
    risks,
    success_criteria: success,
    roadmap,
    recommended_engine: rec.engine,
    status: "generated",
    metadata: sanitizeMetadata({
      ...project.metadata,
      generated_at: new Date().toISOString(),
      router_input: rec.routerInput,
      recommendation_reason: rec.reason,
    }),
  };
  const updated = await updateMvpProject(id, patch);
  if (updated) {
    await logMvpFactoryEvent("mvp_spec_generated", `Spec generata per ${updated.title}`, {
      mvp_project_id: updated.id,
      recommended_engine: updated.recommended_engine,
    });
  }
  return updated;
}

// ============================================================
// Build Engine handoff
// ============================================================

export async function createBuildEngineHandoffFromMvp(id: string): Promise<string | null> {
  const project = await getMvpProject(id);
  if (!project || !project.recommended_engine) return null;

  const router =
    (project.metadata?.router_input as RouterInput | undefined) ?? {
      task_title: project.title,
      task_type: "new_mvp" as TaskType,
      needs_ui: true,
      needs_backend: true,
    };

  const prompt = buildEnginePrompt(project.recommended_engine, {
    ...router,
    task_title: project.title,
    task_description: renderMvpMarkdown(project),
  });

  const input: CreateHandoffInput = {
    brain_id: project.brain_id,
    engine_key: project.recommended_engine,
    task_type: "new_mvp",
    title: `MVP: ${project.title}`,
    description: project.idea_summary,
    generated_prompt: prompt,
    risk_level: (router.risk_level as "low" | "medium" | "high" | undefined) ?? "medium",
    metadata: sanitizeMetadata({
      source: "mvp_factory",
      source_id: project.id,
      mvp_project_id: project.id,
      recommended_engine: project.recommended_engine,
      task_type: "new_mvp",
      reason: "generated_from_mvp_spec",
    }),
  };

  const handoff = await createBuildEngineHandoff(input);
  await updateMvpProject(id, {
    build_engine_handoff_id: handoff.id,
    status: "handoff_created",
  });
  await logMvpFactoryEvent("mvp_handoff_created", `Handoff Build Engine creato`, {
    mvp_project_id: id,
    handoff_id: handoff.id,
    engine_key: handoff.engine_key,
  });
  return handoff.id;
}

// ============================================================
// Action queue integration
// ============================================================

export async function createActionsFromMvp(id: string): Promise<number> {
  const project = await getMvpProject(id);
  if (!project) return 0;
  const scope = project.mvp_scope as MvpScope;
  const items = Array.isArray(scope?.must_have) ? scope.must_have : [];
  if (items.length === 0) return 0;

  let count = 0;
  for (const title of items.slice(0, 8)) {
    try {
      await createAction({
        source: "system_suggestion",
        action_type: "manual_task",
        title: `MVP must-have: ${title}`,
        description: `Da costruire per MVP "${project.title}".`,
        priority: "medium",
        risk_level: "low",
        brain_id: project.brain_id,
        metadata: {
          source: "mvp_factory",
          mvp_project_id: project.id,
          recommended_engine: project.recommended_engine,
          action_type_alias: "mvp_build_task",
        },
      });
      count++;
    } catch {
      // ignore single failures
    }
  }
  if (count > 0) {
    await logMvpFactoryEvent("mvp_action_created", `Create ${count} action da MVP`, {
      mvp_project_id: id,
      count,
    });
  }
  return count;
}

// ============================================================
// Result review integration
// ============================================================

export async function createResultReviewFromMvp(id: string): Promise<string | null> {
  const project = await getMvpProject(id);
  if (!project) return null;
  try {
    const review = await createReviewItem({
      source_type: "manual",
      source_id: project.id,
      title: `Review MVP: ${project.title}`,
      result_text: renderMvpMarkdown(project),
      brain_id: project.brain_id,
      risk_level:
        (project.metadata?.wizard_constraints as MvpInputConstraints | undefined)?.risk_level ??
        "medium",
      metadata: {
        source_type_alias: "mvp_factory",
        mvp_project_id: project.id,
        build_engine_handoff_id: project.build_engine_handoff_id,
        recommended_engine: project.recommended_engine,
      },
    });
    await updateMvpProject(id, { status: "result_review" });
    await logMvpFactoryEvent("mvp_review_created", `Result review creata`, {
      mvp_project_id: id,
      review_id: review.id,
    });
    return review.id;
  } catch {
    return null;
  }
}

// ============================================================
// Markdown rendering
// ============================================================

export function renderMvpMarkdown(p: MvpBuildProject): string {
  const lines: string[] = [];
  const scope = p.mvp_scope as MvpScope;
  lines.push(`# MVP Spec — ${p.title}`);
  lines.push("");
  lines.push("## Executive Summary");
  lines.push(`- **Idea:** ${p.idea_summary}`);
  if (p.value_proposition) lines.push(`- **Promessa:** ${p.value_proposition}`);
  if (p.main_problem) lines.push(`- **Problema:** ${p.main_problem}`);
  if (p.target_users.length) lines.push(`- **Target:** ${p.target_users.join(", ")}`);
  lines.push("");
  lines.push("## Utenti e ruoli");
  for (const r of p.user_roles) {
    lines.push(`### ${r.name}`);
    lines.push(`- Permessi: ${r.permissions.join(", ")}`);
    lines.push(`- Azioni: ${r.primary_actions.join(", ")}`);
  }
  lines.push("");
  lines.push("## MVP Scope");
  lines.push("### Must have");
  (scope?.must_have ?? []).forEach((s) => lines.push(`- ${s}`));
  lines.push("### Should have");
  (scope?.should_have ?? []).forEach((s) => lines.push(`- ${s}`));
  lines.push("### Later");
  (scope?.later ?? []).forEach((s) => lines.push(`- ${s}`));
  lines.push("");
  lines.push("## Schermate principali");
  for (const s of p.screens) lines.push(`- **${s.name}** — ${s.purpose} (${s.audience})`);
  lines.push("");
  lines.push("## Data Model");
  for (const e of p.data_model) {
    lines.push(`### ${e.name}${e.sensitive ? " (sensibile)" : ""}`);
    lines.push(`- Campi: ${e.fields.join(", ")}`);
    if (e.relations.length) lines.push(`- Relazioni: ${e.relations.join(", ")}`);
    lines.push(`- Note: ${e.notes}`);
  }
  lines.push("");
  lines.push("## Integrazioni");
  if (p.integrations.length === 0) lines.push("- Nessuna per MVP");
  for (const i of p.integrations) {
    lines.push(`- **${i.name}** — ${i.reason} ${i.required_for_mvp ? "(richiesta)" : "(opzionale)"}`);
  }
  lines.push("");
  lines.push("## Rischi");
  for (const r of p.risks) {
    lines.push(`- **${r.category}**: ${r.description} — _Mitigazione:_ ${r.mitigation}`);
  }
  lines.push("");
  lines.push("## Roadmap di sviluppo");
  for (const ph of p.roadmap) {
    lines.push(`### ${ph.phase}`);
    lines.push(`- Obiettivo: ${ph.goal}`);
    ph.deliverables.forEach((d) => lines.push(`  - ${d}`));
  }
  lines.push("");
  lines.push("## Criteri di successo");
  p.success_criteria.forEach((s) => lines.push(`- ${s}`));
  lines.push("");
  lines.push("## Build Engine consigliato");
  lines.push(`- ${p.recommended_engine ?? "—"}`);
  return lines.join("\n");
}

// ============================================================
// Events
// ============================================================

export type MvpFactoryEvent =
  | "mvp_factory_viewed"
  | "mvp_project_created"
  | "mvp_project_updated"
  | "mvp_spec_generated"
  | "mvp_project_approved"
  | "mvp_project_archived"
  | "mvp_handoff_created"
  | "mvp_action_created"
  | "mvp_review_created"
  | "mvp_opened_from_company_os"
  | "mvp_opened_from_company_blueprint"
  | "mvp_opened_from_operating_dashboard"
  | "mvp_opened_from_project_console";

export async function logMvpFactoryEvent(
  action: MvpFactoryEvent,
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
    metadata: sanitizeMetadata(metadata),
  } as never);
}
