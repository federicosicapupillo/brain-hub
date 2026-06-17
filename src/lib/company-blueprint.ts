import { supabase } from "@/integrations/supabase/client";
import {
  CompanyOsProfile,
  DEPARTMENTS,
  Department,
  MODULES,
  PAIN_POINTS,
  PRESETS,
  PainPoint,
  TOOLS,
  getCompanyProfile,
  getRecommendedActions,
  listCompanyProfiles,
  recommendModules,
} from "@/lib/company-os";

export type BlueprintStatus = "draft" | "generated" | "approved" | "archived";

export type CompanyBlueprintRow = {
  id: string;
  user_id: string;
  brain_id: string;
  company_os_profile_id: string;
  title: string;
  blueprint_status: BlueprintStatus;
  executive_summary: string | null;
  blueprint_json: BlueprintContent;
  markdown_content: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type BlueprintActionItem = {
  title: string;
  department: string;
  priority: "low" | "medium" | "high";
  risk_level: "low" | "medium";
  reason: string;
};

export type BlueprintProblem = {
  id: string;
  problem: string;
  impact: string;
  module: string;
  firstAction: string;
};

export type BlueprintDepartment = {
  id: string;
  label: string;
  goal: string;
  monitor: string;
  recommendedTools: string[];
  recommendedRunbook: string;
  firstAction: string;
};

export type BlueprintToolMap = {
  connected: { name: string; status: string }[];
  recommended: string[];
  missing: string[];
  priorityConnections: string[];
};

export type BlueprintKnowledge = {
  existing: { title: string; type: string; tags: string[] }[];
  toUpload: string[];
  categories: string[];
};

export type BlueprintAutomation = {
  possible: string[];
  doNotYet: string[];
  needsApproval: string[];
  riskLevel: "low" | "medium" | "high";
};

export type BlueprintPlan = {
  thirty: string[];
  sixty: string[];
  ninety: string[];
};

export type BlueprintContent = {
  executiveSummary: {
    companyName: string;
    industry: string;
    mainGoal: string;
    operatingSnapshot: string;
    mainCriticality: string;
    brainHubPromise: string;
  };
  companySnapshot: {
    size: string;
    operatingModel: string;
    activeAreas: string[];
    preset: string | null;
    recommendedModules: string[];
  };
  problems: BlueprintProblem[];
  departments: BlueprintDepartment[];
  toolMap: BlueprintToolMap;
  knowledge: BlueprintKnowledge;
  automation: BlueprintAutomation;
  plan: BlueprintPlan;
  nextActions: BlueprintActionItem[];
  conclusion: {
    controlled: string;
    toConfigure: string;
    nextStep: string;
  };
};

export type BlueprintBundle = {
  profile: CompanyOsProfile | null;
  content: BlueprintContent | null;
  markdown: string;
  title: string;
};

function rowToBlueprint(r: {
  id: string;
  user_id: string;
  brain_id: string;
  company_os_profile_id: string;
  title: string;
  blueprint_status: string;
  executive_summary: string | null;
  blueprint_json: unknown;
  markdown_content: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}): CompanyBlueprintRow {
  return {
    id: r.id,
    user_id: r.user_id,
    brain_id: r.brain_id,
    company_os_profile_id: r.company_os_profile_id,
    title: r.title,
    blueprint_status: (r.blueprint_status as BlueprintStatus) ?? "draft",
    executive_summary: r.executive_summary,
    blueprint_json: (r.blueprint_json as BlueprintContent) ?? ({} as BlueprintContent),
    markdown_content: r.markdown_content,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const PROBLEM_MAP: Record<PainPoint, { impact: string; module: string; firstAction: string }> = {
  info_sparse: {
    impact: "Decisioni rallentate, perdita di tempo nella ricerca informazioni.",
    module: "Knowledge Map",
    firstAction: "Centralizza documenti chiave in Knowledge Map.",
  },
  attivita_non_tracciate: {
    impact: "Mancanza di visibilità sull'avanzamento operativo.",
    module: "Action Queue",
    firstAction: "Configura Action Queue come elenco unico di attività.",
  },
  mancanza_priorita: {
    impact: "Il team lavora su troppe cose senza un ordine chiaro.",
    module: "Operating Dashboard",
    firstAction: "Definisci le 3 priorità della settimana in Operating Dashboard.",
  },
  follow_up_dimenticati: {
    impact: "Lead persi, clienti trascurati, ricavi mancati.",
    module: "Runbooks",
    firstAction: "Crea un runbook ricorrente di follow-up.",
  },
  documenti_disorganizzati: {
    impact: "Procedure non condivise, errori operativi ricorrenti.",
    module: "Knowledge Map",
    firstAction: "Carica le procedure operative principali.",
  },
  automazioni_non_controllate: {
    impact: "Rischio operativo: automazioni eseguite senza supervisione.",
    module: "Telegram Approvals + Loop QA",
    firstAction: "Attiva approvazione su tutte le azioni high risk.",
  },
  strumenti_scollegati: {
    impact: "Doppio lavoro, dati duplicati, errori di allineamento.",
    module: "Tool Connections",
    firstAction: "Mappa gli strumenti già in uso in Tool Connections.",
  },
  no_dashboard_unica: {
    impact: "Stato del business non visibile in un solo posto.",
    module: "Operating Dashboard",
    firstAction: "Configura Operating Dashboard come cabina di regia.",
  },
  monitoraggio_progetti: {
    impact: "Progetti in ritardo, responsabilità poco chiare.",
    module: "Project Console",
    firstAction: "Configura una Project Console per ogni progetto attivo.",
  },
  difficolta_delegare: {
    impact: "Il titolare resta collo di bottiglia di ogni decisione.",
    module: "Runbooks + Action Queue",
    firstAction: "Trasforma 1 attività ricorrente in un runbook delegabile.",
  },
};

const DEPARTMENT_PLAYBOOK: Record<Department, {
  goal: string;
  monitor: string;
  recommendedTools: string[];
  recommendedRunbook: string;
  firstAction: string;
}> = {
  direzione: {
    goal: "Avere una visione operativa unica del business.",
    monitor: "KPI principali, decisioni in corso, salute del ciclo.",
    recommendedTools: ["Google Calendar", "Telegram"],
    recommendedRunbook: "Review settimanale direzionale",
    firstAction: "Configura Operating Dashboard con KPI principali.",
  },
  commerciale: {
    goal: "Aumentare conversione lead → cliente.",
    monitor: "Pipeline, follow-up, offerte aperte.",
    recommendedTools: ["Gmail", "CRM", "Telegram"],
    recommendedRunbook: "Follow-up clienti",
    firstAction: "Crea pipeline lead in Action Queue.",
  },
  marketing: {
    goal: "Generare domanda e visibilità qualificata.",
    monitor: "Calendario contenuti, performance campagne.",
    recommendedTools: ["Instagram", "Facebook", "LinkedIn"],
    recommendedRunbook: "Calendario contenuti",
    firstAction: "Definisci calendario contenuti del mese.",
  },
  hr: {
    goal: "Standardizzare hiring e onboarding.",
    monitor: "Posizioni aperte, onboarding in corso.",
    recommendedTools: ["Google Drive", "Notion"],
    recommendedRunbook: "Selezione candidati",
    firstAction: "Crea processo onboarding in Runbooks.",
  },
  operations: {
    goal: "Eseguire i processi ricorrenti senza errori.",
    monitor: "Checklist operative, colli di bottiglia.",
    recommendedTools: ["Google Drive", "Trello"],
    recommendedRunbook: "Checklist processi ricorrenti",
    firstAction: "Mappa i 3 processi operativi più critici.",
  },
  amministrazione: {
    goal: "Tenere sotto controllo scadenze e adempimenti.",
    monitor: "Scadenziario, fatture, adempimenti.",
    recommendedTools: ["Gmail", "Google Calendar"],
    recommendedRunbook: "Scadenziario mensile",
    firstAction: "Crea scadenziario in Action Queue.",
  },
  progetti: {
    goal: "Tenere ogni progetto sotto controllo end-to-end.",
    monitor: "Roadmap, prossima azione, blocchi.",
    recommendedTools: ["Notion", "Asana"],
    recommendedRunbook: "Kick-off progetto",
    firstAction: "Configura una Project Console per ogni progetto attivo.",
  },
  customer_care: {
    goal: "Rispondere ai clienti in modo rapido e tracciato.",
    monitor: "Ticket aperti, tempo di risposta.",
    recommendedTools: ["Gmail", "Telegram"],
    recommendedRunbook: "Gestione ticket",
    firstAction: "Crea runbook gestione ticket.",
  },
  content_social: {
    goal: "Produrre contenuti in modo continuo e di qualità.",
    monitor: "Pipeline contenuti, brief, pubblicazioni.",
    recommendedTools: ["Instagram", "TikTok", "YouTube"],
    recommendedRunbook: "Pipeline contenuti",
    firstAction: "Crea pipeline contenuti idea → pubblicazione.",
  },
  ai_automation: {
    goal: "Usare AI e automazioni in modo controllato.",
    monitor: "Workflow attivi, Loop QA, approvazioni.",
    recommendedTools: ["n8n", "Telegram", "Lovable"],
    recommendedRunbook: "Validazione AI output",
    firstAction: "Censisci automazioni esistenti in Automation Readiness.",
  },
  documenti_knowledge: {
    goal: "Costruire una memoria operativa aziendale.",
    monitor: "Documenti caricati, copertura procedure.",
    recommendedTools: ["Google Drive", "Notion"],
    recommendedRunbook: "Aggiornamento knowledge base",
    firstAction: "Carica le procedure operative principali.",
  },
};

export async function getCompanyBlueprintData(brainId: string): Promise<{
  profile: CompanyOsProfile | null;
  toolLinks: { tool_name: string; connection_status: string }[];
  runbooks: { title: string; status: string }[];
  knowledge: { title: string; source_type: string; tags: string[] }[];
  reviews: { review_status: string }[];
  suggestions: { suggestion_status: string }[];
}> {
  const profile = await getCompanyProfile(brainId);
  if (!profile) {
    return { profile: null, toolLinks: [], runbooks: [], knowledge: [], reviews: [], suggestions: [] };
  }
  const [tools, runbooks, knowledge, reviews, suggestions] = await Promise.all([
    supabase.from("project_tool_links").select("tool_name,connection_status").eq("brain_id", brainId).limit(200),
    supabase.from("runbook_instances").select("title,status").eq("brain_id", brainId).limit(200),
    supabase.from("knowledge_sources").select("title,source_type,tags").eq("brain_id", brainId).limit(200),
    supabase.from("result_review_items" as never).select("review_status").eq("brain_id", brainId).limit(500),
    supabase.from("learning_loop_suggestions" as never).select("suggestion_status").eq("brain_id", brainId).limit(500),
  ]);
  return {
    profile,
    toolLinks: (tools.data ?? []) as { tool_name: string; connection_status: string }[],
    runbooks: (runbooks.data ?? []) as { title: string; status: string }[],
    knowledge: (knowledge.data ?? []) as { title: string; source_type: string; tags: string[] }[],
    reviews: (reviews.data ?? []) as { review_status: string }[],
    suggestions: (suggestions.data ?? []) as { suggestion_status: string }[],
  };
}

function depLabel(id: string): string {
  return DEPARTMENTS.find((d) => d.id === id)?.label ?? id;
}
function painLabel(id: string): string {
  return PAIN_POINTS.find((p) => p.id === id)?.label ?? id;
}
function moduleLabel(id: string): string {
  return MODULES.find((m) => m.id === id)?.label ?? id;
}

export async function generateCompanyBlueprint(brainId: string): Promise<BlueprintBundle> {
  const data = await getCompanyBlueprintData(brainId);
  const profile = data.profile;
  if (!profile) {
    return { profile: null, content: null, markdown: "", title: "Blueprint operativo aziendale" };
  }
  const presetLabel = PRESETS.find((p) => p.id === profile.preset)?.label ?? null;
  const activeAreas = profile.active_departments.map(depLabel);
  const recommended = recommendModules(
    profile.active_departments as Department[],
    profile.pain_points as PainPoint[],
  ).map(moduleLabel);

  // Problems
  const problems: BlueprintProblem[] = (profile.pain_points as PainPoint[])
    .filter((p) => p in PROBLEM_MAP)
    .map((p) => {
      const meta = PROBLEM_MAP[p];
      return {
        id: p,
        problem: painLabel(p),
        impact: meta.impact,
        module: meta.module,
        firstAction: meta.firstAction,
      };
    });

  // Departments
  const departments: BlueprintDepartment[] = (profile.active_departments as Department[])
    .filter((d) => d in DEPARTMENT_PLAYBOOK)
    .map((d) => {
      const meta = DEPARTMENT_PLAYBOOK[d];
      return {
        id: d,
        label: depLabel(d),
        goal: meta.goal,
        monitor: meta.monitor,
        recommendedTools: meta.recommendedTools,
        recommendedRunbook: meta.recommendedRunbook,
        firstAction: meta.firstAction,
      };
    });

  // Tools
  const connectedNames = new Set(data.toolLinks.map((t) => t.tool_name.toLowerCase()));
  const presetTools = PRESETS.find((p) => p.id === profile.preset)?.recommendedTools ?? [];
  const recommendedToolLabels = presetTools
    .map((id) => TOOLS.find((t) => t.id === id)?.label ?? id);
  const missing = recommendedToolLabels.filter(
    (label) => !connectedNames.has(label.toLowerCase()),
  );
  const toolMap: BlueprintToolMap = {
    connected: data.toolLinks.map((t) => ({ name: t.tool_name, status: t.connection_status })),
    recommended: recommendedToolLabels,
    missing,
    priorityConnections: missing.slice(0, 3),
  };

  // Knowledge
  const knowledgeExisting = data.knowledge.slice(0, 10).map((k) => ({
    title: k.title,
    type: k.source_type,
    tags: k.tags ?? [],
  }));
  const knowledgeToUpload: string[] = [];
  if (knowledgeExisting.length === 0) knowledgeToUpload.push("Procedure operative principali");
  if (profile.active_departments.includes("hr")) knowledgeToUpload.push("Manuale onboarding");
  if (profile.active_departments.includes("commerciale")) knowledgeToUpload.push("Script vendita / pitch");
  if (profile.active_departments.includes("operations")) knowledgeToUpload.push("Checklist operative");
  if (profile.active_departments.includes("documenti_knowledge")) knowledgeToUpload.push("Tassonomia documenti");
  const categories = Array.from(new Set([
    "Procedure",
    "Clienti",
    "Prodotti / Servizi",
    ...(profile.active_departments.includes("marketing") ? ["Marketing"] : []),
    ...(profile.active_departments.includes("ai_automation") ? ["Automazioni"] : []),
  ]));

  // Automation
  const hasAi = profile.active_departments.includes("ai_automation");
  const automation: BlueprintAutomation = {
    possible: hasAi
      ? ["Follow-up automatico via Telegram", "Riassunto giornaliero Operating Dashboard", "Generazione bozze contenuti"]
      : ["Notifiche scadenze", "Riassunto settimanale operativo"],
    doNotYet: ["Risposte cliente automatiche senza review", "Pubblicazioni social senza approvazione"],
    needsApproval: ["Invio email massive", "Modifica dati cliente", "Esecuzione workflow n8n high risk"],
    riskLevel: hasAi ? "medium" : "low",
  };

  // Plan 30/60/90
  const plan: BlueprintPlan = {
    thirty: [
      "Completare configurazione Company OS",
      "Caricare i primi documenti in Knowledge Map",
      "Eseguire le prime 3 action consigliate",
      `Collegare i tool prioritari: ${toolMap.priorityConnections.join(", ") || "—"}`,
    ],
    sixty: [
      "Definire 2-3 runbook ricorrenti",
      "Attivare Result Review per output critici",
      "Iniziare Learning Loop su risultati ricorrenti",
      "Ottimizzare i processi operativi più frequenti",
    ],
    ninety: [
      "Attivare automazioni controllate solo dopo Loop QA pulito",
      "Configurare workflow n8n per i task ripetitivi",
      "Attivare Telegram Approvals per le azioni high risk",
      "Consolidare Operating Dashboard come cabina di regia",
    ],
  };

  // Next actions from recommended actions
  const recs = getRecommendedActions(profile.active_departments as Department[]);
  const nextActions: BlueprintActionItem[] = recs.slice(0, 8).map((r) => ({
    title: r.title,
    department: depLabel(r.department),
    priority: r.risk_level === "medium" ? "high" : "medium",
    risk_level: r.risk_level,
    reason: r.description,
  }));

  const mainCriticality = problems[0]?.problem ?? "Mancanza di un sistema operativo unico.";

  const content: BlueprintContent = {
    executiveSummary: {
      companyName: profile.company_name,
      industry: profile.industry ?? "—",
      mainGoal: profile.main_goal ?? "—",
      operatingSnapshot:
        `${activeAreas.length} aree operative attive, ${data.toolLinks.length} tool collegati, ${data.knowledge.length} fonti di knowledge.`,
      mainCriticality,
      brainHubPromise:
        "Brain Hub ti dà una sola cabina di regia per priorità, processi, knowledge e automazioni controllate.",
    },
    companySnapshot: {
      size: profile.company_size ?? "—",
      operatingModel: profile.operating_model ?? "—",
      activeAreas,
      preset: presetLabel,
      recommendedModules: recommended,
    },
    problems,
    departments,
    toolMap,
    knowledge: { existing: knowledgeExisting, toUpload: knowledgeToUpload, categories },
    automation,
    plan,
    nextActions,
    conclusion: {
      controlled:
        "Brain Hub controlla priorità operative, knowledge centralizzata, approvazioni e qualità dei risultati.",
      toConfigure: missing.length > 0
        ? `Da configurare: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}.`
        : "Configurazione base completa. Procedi con runbook e review.",
      nextStep: nextActions[0]?.title ?? "Apri Operating Dashboard per la review settimanale.",
    },
  };

  const markdown = renderMarkdown(content);
  return { profile, content, markdown, title: `Blueprint operativo — ${profile.company_name}` };
}

export function renderMarkdown(c: BlueprintContent): string {
  const lines: string[] = [];
  lines.push(`# Blueprint operativo aziendale — ${c.executiveSummary.companyName}`);
  lines.push("");
  lines.push("## Executive Summary");
  lines.push(`- **Azienda:** ${c.executiveSummary.companyName}`);
  lines.push(`- **Settore:** ${c.executiveSummary.industry}`);
  lines.push(`- **Obiettivo principale:** ${c.executiveSummary.mainGoal}`);
  lines.push(`- **Fotografia operativa:** ${c.executiveSummary.operatingSnapshot}`);
  lines.push(`- **Principale criticità:** ${c.executiveSummary.mainCriticality}`);
  lines.push(`- **Promessa Brain Hub:** ${c.executiveSummary.brainHubPromise}`);
  lines.push("");
  lines.push("## Company Snapshot");
  lines.push(`- **Dimensione:** ${c.companySnapshot.size}`);
  lines.push(`- **Modello operativo:** ${c.companySnapshot.operatingModel}`);
  lines.push(`- **Aree attive:** ${c.companySnapshot.activeAreas.join(", ") || "—"}`);
  lines.push(`- **Preset:** ${c.companySnapshot.preset ?? "—"}`);
  lines.push(`- **Moduli consigliati:** ${c.companySnapshot.recommendedModules.join(", ") || "—"}`);
  lines.push("");
  lines.push("## Problemi rilevati");
  if (c.problems.length === 0) lines.push("_Nessun problema selezionato._");
  for (const p of c.problems) {
    lines.push(`### ${p.problem}`);
    lines.push(`- **Impatto:** ${p.impact}`);
    lines.push(`- **Modulo Brain Hub:** ${p.module}`);
    lines.push(`- **Prima azione:** ${p.firstAction}`);
  }
  lines.push("");
  lines.push("## Aree operative");
  for (const d of c.departments) {
    lines.push(`### ${d.label}`);
    lines.push(`- **Obiettivo:** ${d.goal}`);
    lines.push(`- **Monitorare:** ${d.monitor}`);
    lines.push(`- **Strumenti consigliati:** ${d.recommendedTools.join(", ")}`);
    lines.push(`- **Runbook consigliato:** ${d.recommendedRunbook}`);
    lines.push(`- **Prima action:** ${d.firstAction}`);
  }
  lines.push("");
  lines.push("## Tool Map");
  lines.push(`- **Collegati:** ${c.toolMap.connected.map((t) => `${t.name} (${t.status})`).join(", ") || "—"}`);
  lines.push(`- **Consigliati:** ${c.toolMap.recommended.join(", ") || "—"}`);
  lines.push(`- **Mancanti:** ${c.toolMap.missing.join(", ") || "—"}`);
  lines.push(`- **Priorità di collegamento:** ${c.toolMap.priorityConnections.join(", ") || "—"}`);
  lines.push("");
  lines.push("## Knowledge Map Setup");
  lines.push(`- **Già presente:** ${c.knowledge.existing.map((k) => k.title).join(", ") || "—"}`);
  lines.push(`- **Da caricare:** ${c.knowledge.toUpload.join(", ") || "—"}`);
  lines.push(`- **Categorie consigliate:** ${c.knowledge.categories.join(", ")}`);
  lines.push("");
  lines.push("## Automation Readiness");
  lines.push(`- **Automazioni possibili:** ${c.automation.possible.join(", ")}`);
  lines.push(`- **Da NON fare subito:** ${c.automation.doNotYet.join(", ")}`);
  lines.push(`- **Con approvazione:** ${c.automation.needsApproval.join(", ")}`);
  lines.push(`- **Livello rischio:** ${c.automation.riskLevel}`);
  lines.push("");
  lines.push("## Piano operativo 30 / 60 / 90 giorni");
  lines.push("### 30 giorni");
  c.plan.thirty.forEach((s) => lines.push(`- ${s}`));
  lines.push("### 60 giorni");
  c.plan.sixty.forEach((s) => lines.push(`- ${s}`));
  lines.push("### 90 giorni");
  c.plan.ninety.forEach((s) => lines.push(`- ${s}`));
  lines.push("");
  lines.push("## Prossime azioni consigliate");
  for (const a of c.nextActions) {
    lines.push(`- **${a.title}** — ${a.department} · priorità ${a.priority} · rischio ${a.risk_level}`);
    lines.push(`  - ${a.reason}`);
  }
  lines.push("");
  lines.push("## Conclusione");
  lines.push(`- **Brain Hub controlla:** ${c.conclusion.controlled}`);
  lines.push(`- **Cosa configurare:** ${c.conclusion.toConfigure}`);
  lines.push(`- **Prossimo passo:** ${c.conclusion.nextStep}`);
  return lines.join("\n");
}

function sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const blocked = /(api[_-]?key|token|secret|password|authorization|bearer|webhook)/i;
  for (const [k, v] of Object.entries(meta)) {
    if (blocked.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function saveCompanyBlueprint(
  brainId: string,
  bundle: BlueprintBundle,
  status: BlueprintStatus = "generated",
): Promise<CompanyBlueprintRow | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user || !bundle.profile || !bundle.content) return null;
  const row = {
    user_id: u.user.id,
    brain_id: brainId,
    company_os_profile_id: bundle.profile.id,
    title: bundle.title,
    blueprint_status: status,
    executive_summary: bundle.content.executiveSummary.operatingSnapshot,
    blueprint_json: bundle.content as unknown as Record<string, unknown>,
    markdown_content: bundle.markdown,
    metadata: sanitizeMetadata({ generated_at: new Date().toISOString() }),
  };
  const { data, error } = await supabase
    .from("company_os_blueprints")
    .insert(row as never)
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return rowToBlueprint(data as never);
}

export async function listCompanyBlueprints(brainId?: string | null): Promise<CompanyBlueprintRow[]> {
  let q = supabase.from("company_os_blueprints").select("*").order("created_at", { ascending: false }).limit(50);
  if (brainId) q = q.eq("brain_id", brainId);
  const { data } = await q;
  return ((data ?? []) as never[]).map((r) => rowToBlueprint(r));
}

export async function getCompanyBlueprint(id: string): Promise<CompanyBlueprintRow | null> {
  const { data } = await supabase.from("company_os_blueprints").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  return rowToBlueprint(data as never);
}

export async function approveCompanyBlueprint(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("company_os_blueprints")
    .update({ blueprint_status: "approved" } as never)
    .eq("id", id);
  return !error;
}

export async function archiveCompanyBlueprint(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("company_os_blueprints")
    .update({ blueprint_status: "archived" } as never)
    .eq("id", id);
  return !error;
}

export async function copyCompanyBlueprint(id: string): Promise<string> {
  const bp = await getCompanyBlueprint(id);
  return bp?.markdown_content ?? "";
}

export async function createActionsFromBlueprint(id: string): Promise<number> {
  const bp = await getCompanyBlueprint(id);
  if (!bp) return 0;
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return 0;
  const actions = bp.blueprint_json?.nextActions ?? [];
  if (actions.length === 0) return 0;
  const rows = actions.map((a) => ({
    user_id: u.user!.id,
    brain_id: bp.brain_id,
    title: a.title,
    description: a.reason,
    action_type: "company_blueprint_setup",
    source: "company_blueprint",
    status: "suggested",
    priority: a.priority === "high" ? "high" : "medium",
    risk_level: a.risk_level,
    requires_confirmation: true,
    metadata: sanitizeMetadata({
      company_blueprint_id: bp.id,
      company_os_profile_id: bp.company_os_profile_id,
      department: a.department,
      reason: a.reason,
    }) as Record<string, unknown>,
  }));
  const { error } = await supabase.from("automation_actions").insert(rows as never);
  return error ? 0 : rows.length;
}

export type CompanyBlueprintEvent =
  | "company_blueprint_viewed"
  | "company_blueprint_generated"
  | "company_blueprint_saved"
  | "company_blueprint_copied"
  | "company_blueprint_approved"
  | "company_blueprint_archived"
  | "company_blueprint_actions_created"
  | "company_blueprint_opened_from_company_os"
  | "company_blueprint_opened_from_operating_dashboard"
  | "company_blueprint_opened_from_project_console";

export async function logCompanyBlueprintEvent(
  action: CompanyBlueprintEvent,
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

export async function getLatestBlueprint(brainId: string): Promise<CompanyBlueprintRow | null> {
  const list = await listCompanyBlueprints(brainId);
  return list[0] ?? null;
}

export async function hasBlueprint(brainId: string): Promise<boolean> {
  const list = await listCompanyBlueprints(brainId);
  return list.length > 0;
}

// Re-export helper
export { listCompanyProfiles };
