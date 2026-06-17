import { supabase } from "@/integrations/supabase/client";
import { getDriveKnowledgeSummary } from "@/lib/drive-knowledge";

export type SimpleStepStatus = "done" | "todo" | "warning";

export type SimpleProgressStep = {
  id: string;
  label: string;
  status: SimpleStepStatus;
  cta: { label: string; to: string };
};

export type SimpleHomeCard = {
  id:
    | "plan"
    | "mvp"
    | "actions"
    | "results"
    | "improvements"
    | "tools"
    | "knowledge"
    | "system";
  title: string;
  metric: string;
  hint: string;
  cta: { label: string; to: string };
  tone: "ok" | "warn" | "muted";
};

export type CompanyHomeSummary = {
  brainId: string | null;
  companyName: string | null;
  hasProfile: boolean;
  hasBlueprint: boolean;
  mvpCount: number;
  mvpActive: number;
  lastMvpTitle: string | null;
  pendingActions: number;
  highRiskActions: number;
  pendingResults: number;
  needsFixResults: number;
  pendingSuggestions: number;
  appliedSuggestions: number;
  toolsConfigured: number;
  toolsMissing: number;
  knowledgeCount: number;
  handoffsActive: number;
  driveConnections: number;
  driveConfigured: number;
  driveFilesMapped: number;
  driveKnowledgeCount: number;
  driveStatus: "not_configured" | "configured" | "mapped" | "knowledge_ready";
};

export type CompanyHomeNextAction = {
  key: string;
  title: string;
  description: string;
  cta: { label: string; to: string };
};

export type CompanySimpleHealth = {
  status: "healthy" | "attention" | "incomplete";
  reasons: string[];
};

export type CompanyHomeEvent =
  | "company_home_viewed"
  | "company_home_next_action_clicked"
  | "company_home_card_opened"
  | "company_home_expert_mode_opened"
  | "company_home_brain_selected"
  | "company_home_empty_state_opened"
  | "drive_opened_from_company_home";

export type CompanyHomeOption = {
  brainId: string;
  brainName: string;
  companyName: string | null;
  hasProfile: boolean;
  updatedAt: string | null;
};

type BrainRow = { id: string; name: string | null; updated_at: string | null };
type ProfileRow = {
  brain_id: string;
  company_name: string | null;
  updated_at: string | null;
};

export async function listCompanyHomeOptions(): Promise<CompanyHomeOption[]> {
  const [brainsRes, profilesRes] = await Promise.all([
    supabase
      .from("brains")
      .select("id,name,updated_at")
      .order("updated_at", { ascending: false }),
    supabase
      .from("company_os_profiles")
      .select("brain_id,company_name,updated_at"),
  ]);
  const brains = (brainsRes.data ?? []) as BrainRow[];
  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const byBrain = new Map<string, ProfileRow>();
  for (const p of profiles) byBrain.set(p.brain_id, p);

  const opts: CompanyHomeOption[] = brains.map((b) => {
    const p = byBrain.get(b.id);
    return {
      brainId: b.id,
      brainName: b.name ?? "Brain",
      companyName: p?.company_name ?? null,
      hasProfile: !!p,
      updatedAt: p?.updated_at ?? b.updated_at,
    };
  });
  opts.sort((a, b) => {
    if (a.hasProfile !== b.hasProfile) return a.hasProfile ? -1 : 1;
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
  return opts;
}

export async function resolveCompanyHomeBrain(
  searchBrain?: string | null,
): Promise<string | null> {
  return resolveBrainId(searchBrain ?? null);
}

export function friendlyStatusLabel(raw: string | null | undefined): string {
  if (!raw) return "Da configurare";
  const s = String(raw).toLowerCase();
  if (["done", "completed", "ok", "applied", "approved", "ready", "connected"].includes(s))
    return "Completato";
  if (
    [
      "pending",
      "awaiting_approval",
      "draft",
      "proposed",
      "needs_review",
      "in_progress",
      "running",
      "generated",
    ].includes(s)
  )
    return "In lavorazione";
  if (["needs_fix", "rejected", "failed", "error", "blocked"].includes(s))
    return "Da controllare";
  if (["missing", "not_configured", "disconnected"].includes(s)) return "Da configurare";
  return "In lavorazione";
}

async function resolveBrainId(brainId?: string | null): Promise<string | null> {
  if (brainId) return brainId;
  const { data } = await supabase
    .from("company_os_profiles")
    .select("brain_id")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (data && data.length > 0) return data[0].brain_id as string;
  const { data: b } = await supabase
    .from("brains")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1);
  return b && b[0] ? (b[0].id as string) : null;
}

export async function getCompanyHomeSummary(
  brainId?: string | null,
): Promise<CompanyHomeSummary> {
  const resolved = await resolveBrainId(brainId);
  const empty: CompanyHomeSummary = {
    brainId: resolved,
    companyName: null,
    hasProfile: false,
    hasBlueprint: false,
    mvpCount: 0,
    mvpActive: 0,
    lastMvpTitle: null,
    pendingActions: 0,
    highRiskActions: 0,
    pendingResults: 0,
    needsFixResults: 0,
    pendingSuggestions: 0,
    appliedSuggestions: 0,
    toolsConfigured: 0,
    toolsMissing: 0,
    knowledgeCount: 0,
    handoffsActive: 0,
    driveConnections: 0,
    driveConfigured: 0,
    driveFilesMapped: 0,
    driveKnowledgeCount: 0,
    driveStatus: "not_configured",
  };
  if (!resolved) return empty;

  const [profile, blueprint, mvps, actions, results, suggestions, tools, knowledge, handoffs, drive] =
    await Promise.all([
      supabase
        .from("company_os_profiles")
        .select("company_name")
        .eq("brain_id", resolved)
        .maybeSingle(),
      supabase
        .from("company_os_blueprints")
        .select("id")
        .eq("brain_id", resolved)
        .limit(1),
      supabase
        .from("mvp_build_projects")
        .select("id,title,status,updated_at")
        .eq("brain_id", resolved)
        .order("updated_at", { ascending: false }),
      supabase
        .from("automation_actions")
        .select("id,status,risk_level")
        .eq("brain_id", resolved),
      supabase
        .from("result_review_items")
        .select("id,review_status")
        .eq("brain_id", resolved),
      supabase
        .from("learning_loop_suggestions")
        .select("id,suggestion_status")
        .eq("brain_id", resolved),
      supabase
        .from("project_tool_links")
        .select("id,connection_status,is_recommended")
        .eq("brain_id", resolved),
      supabase
        .from("knowledge_sources")
        .select("id", { count: "exact", head: true })
        .eq("brain_id", resolved),
      supabase
        .from("build_engine_handoffs")
        .select("id,handoff_status")
        .eq("brain_id", resolved),
      getDriveKnowledgeSummary(resolved).catch(() => null),
    ]);

  const actionRows = (actions.data ?? []) as Array<{ status: string; risk_level: string }>;
  const resultRows = (results.data ?? []) as Array<{ review_status: string }>;
  const suggestionRows = (suggestions.data ?? []) as Array<{ suggestion_status: string }>;
  const toolRows = (tools.data ?? []) as Array<{
    connection_status: string;
    is_recommended: boolean;
  }>;
  const mvpRows = (mvps.data ?? []) as Array<{ title: string; status: string }>;
  const handoffRows = (handoffs.data ?? []) as Array<{ handoff_status: string }>;

  return {
    brainId: resolved,
    companyName: profile.data?.company_name ?? null,
    hasProfile: !!profile.data,
    hasBlueprint: (blueprint.data?.length ?? 0) > 0,
    mvpCount: mvpRows.length,
    mvpActive: mvpRows.filter((m) =>
      ["draft", "generated", "approved", "in_progress"].includes(m.status),
    ).length,
    lastMvpTitle: mvpRows[0]?.title ?? null,
    pendingActions: actionRows.filter((a) =>
      ["pending", "awaiting_approval", "draft"].includes(a.status),
    ).length,
    highRiskActions: actionRows.filter(
      (a) =>
        ["pending", "awaiting_approval", "draft"].includes(a.status) && a.risk_level === "high",
    ).length,
    pendingResults: resultRows.filter((r) =>
      ["pending", "needs_review"].includes(r.review_status),
    ).length,
    needsFixResults: resultRows.filter((r) =>
      ["needs_fix", "rejected"].includes(r.review_status),
    ).length,
    pendingSuggestions: suggestionRows.filter((s) =>
      ["pending", "proposed"].includes(s.suggestion_status),
    ).length,
    appliedSuggestions: suggestionRows.filter((s) => s.suggestion_status === "applied").length,
    toolsConfigured: toolRows.filter((t) => t.connection_status === "connected").length,
    toolsMissing: toolRows.filter(
      (t) => t.is_recommended && t.connection_status !== "connected",
    ).length,
    knowledgeCount: knowledge.count ?? 0,
    handoffsActive: handoffRows.filter((h) =>
      ["ready", "sent", "in_progress"].includes(h.handoff_status),
    ).length,
    driveConnections: drive?.connections ?? 0,
    driveConfigured: drive?.configuredConnections ?? 0,
    driveFilesMapped: drive?.totalFiles ?? 0,
    driveKnowledgeCount: drive?.knowledgeSourcesCreated ?? 0,
    driveStatus:
      !drive || drive.connections === 0
        ? "not_configured"
        : drive.knowledgeSourcesCreated > 0
          ? "knowledge_ready"
          : drive.totalFiles > 0
            ? "mapped"
            : "configured",
  };
}

export function getCompanyNextBestAction(s: CompanyHomeSummary): CompanyHomeNextAction {
  if (!s.hasProfile) {
    return {
      key: "setup_profile",
      title: "Configura il profilo azienda",
      description: "Inizia descrivendo la tua azienda: reparti, obiettivi e strumenti.",
      cta: { label: "Apri profilo", to: "/company-os" },
    };
  }
  if (!s.hasBlueprint) {
    return {
      key: "generate_blueprint",
      title: "Genera il piano operativo",
      description: "Trasforma il profilo in un piano operativo aziendale leggibile.",
      cta: { label: "Genera piano", to: "/company-blueprint" },
    };
  }
  if (s.mvpCount === 0) {
    return {
      key: "create_mvp",
      title: "Crea il primo progetto/MVP",
      description: "Trasforma un'idea aziendale in un MVP strutturato e pronto da costruire.",
      cta: { label: "Nuovo progetto", to: "/mvp-factory" },
    };
  }
  if (s.pendingActions > 0) {
    return {
      key: "approve_actions",
      title: "Approva le azioni in attesa",
      description: `Ci sono ${s.pendingActions} azioni che richiedono la tua approvazione.`,
      cta: { label: "Apri azioni", to: "/action-queue" },
    };
  }
  if (s.pendingResults > 0) {
    return {
      key: "review_results",
      title: "Controlla i risultati",
      description: `Ci sono ${s.pendingResults} risultati da verificare prima di procedere.`,
      cta: { label: "Apri risultati", to: "/result-review" },
    };
  }
  if (s.pendingSuggestions > 0) {
    return {
      key: "review_suggestions",
      title: "Valuta i miglioramenti consigliati",
      description: `${s.pendingSuggestions} miglioramenti suggeriti dal sistema sono in attesa.`,
      cta: { label: "Apri miglioramenti", to: "/loop-qa" },
    };
  }
  if (s.toolsMissing > 0) {
    return {
      key: "connect_tools",
      title: "Collega gli strumenti aziendali",
      description: `Mancano ${s.toolsMissing} strumenti consigliati per il tuo flusso.`,
      cta: { label: "Apri strumenti", to: "/tool-connections" },
    };
  }
  return {
    key: "all_good",
    title: "Sistema operativo aziendale in ordine",
    description: "Nessuna azione urgente. Puoi pianificare nuovi progetti o miglioramenti.",
    cta: { label: "Apri piano operativo", to: "/company-blueprint" },
  };
}

export function getCompanyProgressSteps(s: CompanyHomeSummary): SimpleProgressStep[] {
  return [
    {
      id: "profile",
      label: "Profilo Azienda",
      status: s.hasProfile ? "done" : "todo",
      cta: { label: "Apri", to: "/company-os" },
    },
    {
      id: "plan",
      label: "Piano Operativo",
      status: s.hasBlueprint ? "done" : s.hasProfile ? "todo" : "todo",
      cta: { label: "Apri", to: "/company-blueprint" },
    },
    {
      id: "mvp",
      label: "Primo MVP",
      status: s.mvpCount > 0 ? "done" : "todo",
      cta: { label: "Apri", to: "/mvp-factory" },
    },
    {
      id: "engine",
      label: "Motore di sviluppo",
      status: s.handoffsActive > 0 ? "done" : s.mvpCount > 0 ? "todo" : "todo",
      cta: { label: "Apri", to: "/build-engines" },
    },
    {
      id: "actions",
      label: "Azioni",
      status:
        s.pendingActions === 0 ? "done" : s.highRiskActions > 0 ? "warning" : "todo",
      cta: { label: "Apri", to: "/action-queue" },
    },
    {
      id: "results",
      label: "Risultati",
      status:
        s.pendingResults === 0 && s.needsFixResults === 0
          ? "done"
          : s.needsFixResults > 0
            ? "warning"
            : "todo",
      cta: { label: "Apri", to: "/result-review" },
    },
    {
      id: "improvements",
      label: "Miglioramenti",
      status: s.pendingSuggestions === 0 ? "done" : "todo",
      cta: { label: "Apri", to: "/loop-qa" },
    },
  ];
}

export function getCompanySimpleHealth(s: CompanyHomeSummary): CompanySimpleHealth {
  const reasons: string[] = [];
  if (!s.hasProfile) reasons.push("Profilo azienda non configurato");
  if (!s.hasBlueprint) reasons.push("Piano operativo mancante");
  if (s.highRiskActions > 0)
    reasons.push(`${s.highRiskActions} azioni ad alto rischio in attesa`);
  if (s.needsFixResults > 0) reasons.push(`${s.needsFixResults} risultati da correggere`);
  if (s.toolsMissing > 0) reasons.push(`${s.toolsMissing} strumenti consigliati mancanti`);

  let status: CompanySimpleHealth["status"] = "healthy";
  if (!s.hasProfile || !s.hasBlueprint) status = "incomplete";
  else if (s.highRiskActions > 0 || s.needsFixResults > 0) status = "attention";
  else if (reasons.length > 0) status = "attention";

  return { status, reasons };
}

export function getCompanyHomeCards(s: CompanyHomeSummary): SimpleHomeCard[] {
  return [
    {
      id: "plan",
      title: "Piano operativo",
      metric: s.hasBlueprint ? "Presente" : "Assente",
      hint: s.hasBlueprint ? "Piano aziendale disponibile" : "Genera il piano dal profilo",
      cta: { label: "Apri piano", to: "/company-blueprint" },
      tone: s.hasBlueprint ? "ok" : "warn",
    },
    {
      id: "mvp",
      title: "Progetti in corso",
      metric: `${s.mvpActive} attivi`,
      hint: s.lastMvpTitle ? `Ultimo: ${s.lastMvpTitle}` : "Nessun progetto ancora",
      cta: { label: "Apri progetti", to: "/mvp-factory" },
      tone: s.mvpActive > 0 ? "ok" : "muted",
    },
    {
      id: "actions",
      title: "Azioni da approvare",
      metric: `${s.pendingActions} in attesa`,
      hint:
        s.highRiskActions > 0
          ? `${s.highRiskActions} ad alto rischio`
          : "Nessuna azione critica",
      cta: { label: "Apri azioni", to: "/action-queue" },
      tone: s.highRiskActions > 0 ? "warn" : s.pendingActions > 0 ? "muted" : "ok",
    },
    {
      id: "results",
      title: "Risultati da controllare",
      metric: `${s.pendingResults} da rivedere`,
      hint: s.needsFixResults > 0 ? `${s.needsFixResults} da correggere` : "Tutto sotto controllo",
      cta: { label: "Apri risultati", to: "/result-review" },
      tone: s.needsFixResults > 0 ? "warn" : s.pendingResults > 0 ? "muted" : "ok",
    },
    {
      id: "improvements",
      title: "Miglioramenti consigliati",
      metric: `${s.pendingSuggestions} suggeriti`,
      hint: `${s.appliedSuggestions} già applicati`,
      cta: { label: "Apri miglioramenti", to: "/loop-qa" },
      tone: s.pendingSuggestions > 0 ? "muted" : "ok",
    },
    {
      id: "tools",
      title: "Strumenti collegati",
      metric: `${s.toolsConfigured} collegati`,
      hint: s.toolsMissing > 0 ? `${s.toolsMissing} consigliati mancanti` : "Setup completo",
      cta: { label: "Apri strumenti", to: "/tool-connections" },
      tone: s.toolsMissing > 0 ? "warn" : "ok",
    },
    {
      id: "knowledge",
      title: "Documenti e conoscenza",
      metric: `${s.knowledgeCount} documenti`,
      hint:
        s.driveConnections > 0
          ? `Drive: ${s.driveFilesMapped} file mappati · ${s.driveKnowledgeCount} knowledge`
          : s.knowledgeCount > 0
            ? "Base di conoscenza attiva · Drive non collegato"
            : "Nessun documento caricato · Drive non collegato",
      cta: { label: "Apri documenti", to: "/drive-knowledge" },
      tone:
        s.driveStatus === "knowledge_ready" || s.knowledgeCount > 0
          ? "ok"
          : s.driveStatus === "mapped" || s.driveStatus === "configured"
            ? "muted"
            : "muted",
    },
  ];
}

export async function logCompanyHomeEvent(
  action: CompanyHomeEvent,
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
