import { supabase } from "@/integrations/supabase/client";
import {
  ACTION_TYPE_RISK,
  ActionType,
  AutomationAction,
  RiskLevel,
  createAction,
} from "@/lib/action-queue";
import type { LogEventType } from "@/lib/automation-run";

export type RunbookStatus =
  | "draft"
  | "active"
  | "waiting_approval"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

export const RUNBOOK_STATUS_LABEL: Record<RunbookStatus, string> = {
  draft: "Bozza",
  active: "Attivo",
  waiting_approval: "In attesa approvazione",
  in_progress: "In corso",
  blocked: "Bloccato",
  completed: "Completato",
  cancelled: "Annullato",
  failed: "Fallito",
};

export const RUNBOOK_STATUS_TONE: Record<RunbookStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  active: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  waiting_approval: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  in_progress: "bg-primary/10 text-primary border-primary/30",
  blocked: "bg-red-500/10 text-red-600 border-red-500/30",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  failed: "bg-red-500/10 text-red-600 border-red-500/30",
};

export type RunbookStep = {
  title: string;
  description: string;
  action_type: ActionType;
  risk_level?: RiskLevel;
  blocking?: boolean;
  required_before_next?: boolean;
};

export type RunbookTemplate = {
  key: string;
  name: string;
  description: string;
  when_to_use: string;
  components: string[];
  risk_level: RiskLevel;
  steps: RunbookStep[];
};

export const RUNBOOK_TEMPLATES: RunbookTemplate[] = [
  {
    key: "fix_lovable_error",
    name: "Fix errore Lovable",
    description: "Procedura per risolvere un prompt Lovable fallito e aggiornare la roadmap.",
    when_to_use: "Quando hai uno o più execution log con status failed.",
    components: ["Execution Tracking", "Next Prompt Generator", "Browser Bridge", "Roadmap"],
    risk_level: "high",
    steps: [
      {
        title: "Apri execution log fallito",
        description: "Identifica il log fallito da analizzare.",
        action_type: "review_pending_result",
        risk_level: "low",
      },
      {
        title: "Genera fix prompt",
        description: "Crea un prompt di correzione mirato.",
        action_type: "generate_fix_prompt",
        risk_level: "medium",
        required_before_next: true,
      },
      {
        title: "Approva fix prompt",
        description: "Revisiona e approva manualmente il prompt prima di inviarlo.",
        action_type: "manual_task",
        risk_level: "medium",
        required_before_next: true,
      },
      {
        title: "Inserisci in Lovable",
        description: "Invia il prompt a Lovable (richiede conferma esplicita).",
        action_type: "send_next_prompt",
        risk_level: "high",
        blocking: true,
        required_before_next: true,
      },
      {
        title: "Salva risultato Lovable",
        description: "Salva l'output ricevuto da Lovable.",
        action_type: "save_lovable_result",
        risk_level: "medium",
      },
      {
        title: "Aggiorna roadmap",
        description: "Segna l'item roadmap come risolto o ancora da correggere.",
        action_type: "mark_roadmap_completed",
        risk_level: "high",
      },
    ],
  },
  {
    key: "complete_lovable_feature",
    name: "Completa funzione Lovable",
    description: "Procedura standard per portare a termine una funzione richiesta a Lovable.",
    when_to_use: "Quando vuoi completare uno step di sviluppo dall'idea al risultato.",
    components: ["Next Prompt Generator", "Browser Bridge", "Execution Tracking"],
    risk_level: "high",
    steps: [
      {
        title: "Genera primo prompt",
        description: "Costruisci il primo prompt per la funzione.",
        action_type: "generate_first_prompt",
        risk_level: "medium",
        required_before_next: true,
      },
      {
        title: "Approva prompt",
        description: "Revisiona prima dell'invio.",
        action_type: "manual_task",
        risk_level: "medium",
      },
      {
        title: "Inserisci in Lovable",
        description: "Invia il prompt con conferma esplicita.",
        action_type: "send_next_prompt",
        risk_level: "high",
      },
      {
        title: "Salva risultato",
        description: "Salva l'output di Lovable.",
        action_type: "save_lovable_result",
        risk_level: "medium",
      },
    ],
  },
  {
    key: "start_roadmap_step",
    name: "Avvia nuovo step roadmap",
    description: "Avvia in modo guidato un nuovo step della roadmap.",
    when_to_use: "Quando hai un roadmap item senza prompt operativo.",
    components: ["Roadmap", "Next Prompt Generator", "Browser Bridge"],
    risk_level: "high",
    steps: [
      {
        title: "Seleziona roadmap item",
        description: "Identifica l'item da avviare.",
        action_type: "manual_task",
        risk_level: "low",
      },
      {
        title: "Genera primo prompt",
        description: "Crea il primo prompt collegato.",
        action_type: "generate_first_prompt",
        risk_level: "medium",
      },
      {
        title: "Approva prompt",
        description: "Revisiona prima dell'invio.",
        action_type: "manual_task",
        risk_level: "medium",
      },
      {
        title: "Inserisci in Lovable",
        description: "Invia con conferma esplicita.",
        action_type: "send_next_prompt",
        risk_level: "high",
      },
      {
        title: "Salva risultato",
        description: "Archivia l'output ricevuto.",
        action_type: "save_lovable_result",
        risk_level: "medium",
      },
      {
        title: "Aggiorna stato roadmap",
        description: "Conferma manualmente lo stato finale.",
        action_type: "mark_roadmap_completed",
        risk_level: "high",
      },
    ],
  },
  {
    key: "review_pending_result",
    name: "Revisiona result_pending",
    description: "Procedura per chiudere risultati Lovable rimasti in attesa.",
    when_to_use: "Quando hai uno o più log in stato result_pending.",
    components: ["Execution Tracking", "Browser Bridge"],
    risk_level: "medium",
    steps: [
      {
        title: "Apri execution log result_pending",
        description: "Identifica il risultato da chiudere.",
        action_type: "review_pending_result",
        risk_level: "low",
      },
      {
        title: "Salva risultato Lovable",
        description: "Archivia l'output ricevuto.",
        action_type: "save_lovable_result",
        risk_level: "medium",
      },
      {
        title: "Classifica e segna stato",
        description: "Marca come completato o fallito.",
        action_type: "manual_task",
        risk_level: "medium",
      },
    ],
  },
  {
    key: "link_logs_to_roadmap",
    name: "Collega log alla roadmap",
    description: "Procedura per ridurre i prompt scollegati dalla roadmap.",
    when_to_use: "Quando Project Health Check segnala log scollegati.",
    components: ["Execution Tracking", "Roadmap Intelligence"],
    risk_level: "medium",
    steps: [
      {
        title: "Identifica log scollegati",
        description: "Apri la lista dei log senza roadmap_item_id.",
        action_type: "manual_task",
        risk_level: "low",
      },
      {
        title: "Collega log alla roadmap",
        description: "Associa ogni log a un roadmap item.",
        action_type: "link_log_to_roadmap",
        risk_level: "medium",
      },
    ],
  },
  {
    key: "prepare_next_prompt",
    name: "Prepara prossimo prompt",
    description: "Genera in modo controllato il prossimo prompt da un risultato Lovable.",
    when_to_use: "Quando hai un risultato Lovable salvato e devi continuare il ciclo.",
    components: ["Next Prompt Generator", "Browser Bridge"],
    risk_level: "high",
    steps: [
      {
        title: "Genera prossimo prompt",
        description: "Crea il next prompt a partire dal risultato.",
        action_type: "generate_first_prompt",
        risk_level: "medium",
      },
      {
        title: "Approva prompt",
        description: "Revisiona prima di inviare.",
        action_type: "manual_task",
        risk_level: "medium",
      },
      {
        title: "Inserisci in Lovable",
        description: "Invia con conferma esplicita.",
        action_type: "send_next_prompt",
        risk_level: "high",
      },
    ],
  },
  {
    key: "project_health_check",
    name: "Health check progetto",
    description: "Esegui un giro di controllo completo sulla salute del progetto.",
    when_to_use: "Periodicamente o prima di una pubblicazione.",
    components: ["Project Health Check", "Roadmap Intelligence", "Action Queue"],
    risk_level: "low",
    steps: [
      {
        title: "Apri Project Console",
        description: "Verifica lo stato attuale dei blocchi.",
        action_type: "open_project_console",
        risk_level: "low",
      },
      {
        title: "Rivedi problemi rilevati",
        description: "Controlla critical, warning, incompletezze.",
        action_type: "manual_task",
        risk_level: "low",
      },
      {
        title: "Pianifica prossima azione",
        description: "Decidi la singola azione successiva.",
        action_type: "manual_task",
        risk_level: "low",
      },
    ],
  },
  {
    key: "clean_action_queue",
    name: "Pulizia action queue",
    description: "Procedura per ridurre la coda di azioni accumulate.",
    when_to_use: "Quando la Action Queue ha molte azioni vecchie o duplicate.",
    components: ["Action Queue"],
    risk_level: "low",
    steps: [
      {
        title: "Rivedi azioni pending",
        description: "Apri la coda e identifica le azioni da chiudere.",
        action_type: "manual_task",
        risk_level: "low",
      },
      {
        title: "Pulisci log scollegati",
        description: "Rimuovi o riassegna le azioni orfane.",
        action_type: "clean_orphan_logs",
        risk_level: "medium",
      },
    ],
  },
  {
    key: "manual_custom",
    name: "Manual workflow custom",
    description: "Crea un workflow personalizzato con un solo task manuale di partenza.",
    when_to_use: "Quando vuoi tracciare una procedura non standard.",
    components: ["Action Queue"],
    risk_level: "low",
    steps: [
      {
        title: "Task manuale",
        description: "Definisci tu cosa fare in questo step.",
        action_type: "manual_task",
        risk_level: "low",
      },
    ],
  },
];

export function getTemplate(key: string): RunbookTemplate | undefined {
  return RUNBOOK_TEMPLATES.find((t) => t.key === key);
}

export type RunbookInstance = {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  project_id: string | null;
  brain_id: string | null;
  template_key: string;
  title: string;
  description: string | null;
  status: RunbookStatus;
  risk_level: RiskLevel;
  current_step_index: number;
  total_steps: number;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  metadata: Record<string, unknown>;
};

async function logEvent(
  action: LogEventType,
  notes: string,
  metadata: Record<string, unknown>,
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

export async function listRunbookInstances(filters: {
  brainId?: string | null;
} = {}): Promise<RunbookInstance[]> {
  let q = supabase
    .from("runbook_instances" as never)
    .select("*")
    .order("created_at", { ascending: false });
  if (filters.brainId) q = q.eq("brain_id", filters.brainId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as RunbookInstance[];
}

export async function startRunbook(input: {
  template_key: string;
  brain_id?: string | null;
  project_id?: string | null;
  roadmap_item_id?: string | null;
  prompt_execution_log_id?: string | null;
  note?: string;
}): Promise<{ instance: RunbookInstance; actions: AutomationAction[] }> {
  const template = getTemplate(input.template_key);
  if (!template) throw new Error(`Template runbook non trovato: ${input.template_key}`);

  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  await logEvent("runbook_template_selected", `Template selezionato: ${template.name}`, {
    template_key: template.key,
    brain_id: input.brain_id ?? null,
  });

  const instancePayload = {
    user_id: u.user.id,
    brain_id: input.brain_id ?? null,
    project_id: input.project_id ?? null,
    template_key: template.key,
    title: template.name,
    description: template.description,
    status: "active" as RunbookStatus,
    risk_level: template.risk_level,
    current_step_index: 0,
    total_steps: template.steps.length,
    started_at: new Date().toISOString(),
    metadata: {
      template_name: template.name,
      note: input.note ?? null,
      roadmap_item_id: input.roadmap_item_id ?? null,
      prompt_execution_log_id: input.prompt_execution_log_id ?? null,
    },
  };

  const { data: instData, error: instErr } = await supabase
    .from("runbook_instances" as never)
    .insert(instancePayload as never)
    .select()
    .single();
  if (instErr) throw instErr;
  const instance = instData as unknown as RunbookInstance;

  await logEvent("runbook_instance_created", `Runbook creato: ${instance.title}`, {
    runbook_instance_id: instance.id,
    template_key: template.key,
    total_steps: template.steps.length,
    brain_id: instance.brain_id,
  });

  // Create one automation_action per step
  const createdActions: AutomationAction[] = [];
  let previousActionId: string | null = null;
  for (let i = 0; i < template.steps.length; i++) {
    const step = template.steps[i];
    const risk = step.risk_level ?? ACTION_TYPE_RISK[step.action_type] ?? "low";
    const action = await createAction({
      source: "system_suggestion",
      action_type: step.action_type,
      title: `[${template.name}] ${step.title}`,
      description: step.description,
      risk_level: risk,
      brain_id: input.brain_id ?? null,
      project_id: input.project_id ?? null,
      roadmap_item_id: input.roadmap_item_id ?? null,
      prompt_execution_log_id: input.prompt_execution_log_id ?? null,
      metadata: {
        source_block: "Runbooks",
        source_cta: `Runbook: ${template.name}`,
        runbook_id: instance.id,
        runbook_instance_id: instance.id,
        runbook_template: template.key,
        runbook_step_index: i,
        runbook_total_steps: template.steps.length,
        runbook_step_title: step.title,
        previous_action_id: previousActionId,
        next_action_id: null,
        blocking: !!step.blocking,
        required_before_next: !!step.required_before_next,
      },
    });
    createdActions.push(action);
    await logEvent("runbook_step_action_created", `Step ${i + 1}/${template.steps.length}: ${step.title}`, {
      runbook_instance_id: instance.id,
      action_id: action.id,
      step_index: i,
    });
    previousActionId = action.id;
  }

  // Backfill next_action_id where possible
  for (let i = 0; i < createdActions.length - 1; i++) {
    const a = createdActions[i];
    const meta = { ...(a.metadata ?? {}), next_action_id: createdActions[i + 1].id };
    await supabase
      .from("automation_actions" as never)
      .update({ metadata: meta } as never)
      .eq("id", a.id);
  }

  await logEvent("runbook_instance_started", `Runbook avviato: ${instance.title}`, {
    runbook_instance_id: instance.id,
    actions: createdActions.length,
  });

  return { instance, actions: createdActions };
}

export async function cancelRunbookInstance(id: string, title: string) {
  const { error } = await supabase
    .from("runbook_instances" as never)
    .update({
      status: "cancelled" as RunbookStatus,
      cancelled_at: new Date().toISOString(),
    } as never)
    .eq("id", id);
  if (error) throw error;
  await logEvent("runbook_instance_cancelled", `Runbook annullato: ${title}`, {
    runbook_instance_id: id,
  });
}

export async function setRunbookStatus(
  id: string,
  status: RunbookStatus,
  patch: Partial<RunbookInstance> = {},
) {
  const { error } = await supabase
    .from("runbook_instances" as never)
    .update({ status, ...patch } as never)
    .eq("id", id);
  if (error) throw error;
}

/** Suggest a runbook template key from a Project Health Check signal. */
export function suggestRunbookFromHealth(signal: {
  failed: number;
  pending: number;
  roadmap_no_prompts: number;
  unlinked: number;
}): RunbookTemplate | null {
  if (signal.failed > 0) return getTemplate("fix_lovable_error") ?? null;
  if (signal.pending > 0) return getTemplate("review_pending_result") ?? null;
  if (signal.roadmap_no_prompts > 0) return getTemplate("start_roadmap_step") ?? null;
  if (signal.unlinked > 0) return getTemplate("link_logs_to_roadmap") ?? null;
  return null;
}
