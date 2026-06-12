import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  CheckCircle2,
  Copy,
  GitBranch,
  ListChecks,
  RefreshCw,
  Send,
  Sparkles,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getAutomationRun,
  type ItemLike,
  type LogEventType,
} from "@/lib/automation-run";
import { enqueueFromCta } from "@/lib/action-queue-cta";
import type { ActionType, RiskLevel } from "@/lib/action-queue";

async function enqueueExecCta(
  row: { id: string; brain_id: string | null; roadmap_item_id: string | null; prompt_title: string; parent_execution_log_id?: string | null },
  cta: string,
  action_type: ActionType,
  risk_level: RiskLevel,
  extra: Record<string, unknown> = {},
) {
  try {
    await enqueueFromCta({
      source: "execution_tracking",
      source_block: "ExecutionTracking",
      source_cta: cta,
      action_type,
      risk_level,
      title: `${cta}: ${row.prompt_title}`,
      brain_id: row.brain_id,
      roadmap_item_id: row.roadmap_item_id,
      prompt_execution_log_id: row.id,
      parent_execution_log_id: row.parent_execution_log_id ?? null,
      extra,
    });
  } catch {
    // non-blocking
  }
}

type ClipItem = ItemLike & {
  content: string | null;
  content_type: string | null;
  target_tool: string | null;
  updated_at: string;
};
type Brain = { id: string; name: string };

type PELStatus =
  | "draft"
  | "prepared"
  | "inserted_in_lovable"
  | "sent_to_lovable_confirmed"
  | "result_pending"
  | "result_saved"
  | "completed"
  | "failed";

type PEL = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  project_id: string | null;
  brain_id: string | null;
  roadmap_item_id: string | null;
  task_id: string | null;
  execution_package_id: string | null;
  target_tool: string;
  prompt_title: string;
  prompt_content: string;
  status: PELStatus;
  receipt_json: Record<string, unknown> | null;
  result_text: string | null;
  result_type: string | null;
  internal_notes: string | null;
  retry_count: number;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  parent_execution_log_id: string | null;
  generation_goal: string | null;
  generated_prompt_text: string | null;
};

type GenerationGoal =
  | "correggi_errori"
  | "completa_modifica"
  | "migliora_ui"
  | "aggiorna_database"
  | "verifica_build"
  | "crea_test"
  | "pulizia_codice"
  | "prossimo_step_roadmap"
  | "prompt_generico";

const GENERATION_GOALS: { value: GenerationGoal; label: string }[] = [
  { value: "correggi_errori", label: "Correggi errori" },
  { value: "completa_modifica", label: "Completa modifica" },
  { value: "migliora_ui", label: "Migliora UI" },
  { value: "aggiorna_database", label: "Aggiorna database" },
  { value: "verifica_build", label: "Verifica build" },
  { value: "crea_test", label: "Crea test" },
  { value: "pulizia_codice", label: "Pulizia codice" },
  { value: "prossimo_step_roadmap", label: "Prossimo step roadmap" },
  { value: "prompt_generico", label: "Prompt generico" },
];

function suggestGoalFromResultType(rt: string | null | undefined): GenerationGoal {
  switch ((rt ?? "").toLowerCase()) {
    case "build_error":
    case "console_error":
      return "correggi_errori";
    case "partial_success":
      return "completa_modifica";
    case "database_change":
      return "aggiorna_database";
    case "file_change":
      return "verifica_build";
    case "build_success":
      return "prossimo_step_roadmap";
    default:
      return "prompt_generico";
  }
}

function goalDirectives(goal: GenerationGoal, resultType: string | null | undefined): {
  obiettivo: string;
  modifica: string;
  vincoli: string;
} {
  const rt = (resultType ?? "").toLowerCase();
  switch (goal) {
    case "correggi_errori":
      return {
        obiettivo:
          rt === "console_error"
            ? "Correggi in modo mirato l'errore console riportato, senza toccare il resto."
            : "Correggi l'errore di build emerso nel risultato precedente. Non aggiungere nuove funzioni finche' la build non e' pulita.",
        modifica:
          "Analizza il messaggio d'errore nel risultato precedente, individua la causa e applica la fix minima necessaria.",
        vincoli:
          "Nessuna nuova funzionalita'. Nessuna refactor opportunistica. Solo la fix.",
      };
    case "completa_modifica":
      return {
        obiettivo: "Completa solo le parti mancanti del task precedente, senza rifare cio' che gia' funziona.",
        modifica: "Identifica nel risultato precedente cosa e' stato fatto e cosa manca. Implementa solo cio' che manca.",
        vincoli: "Non duplicare logiche gia' esistenti. Non modificare cio' che funziona.",
      };
    case "migliora_ui":
      return {
        obiettivo: "Migliora la UI mantenendo invariata la logica esistente.",
        modifica: "Applica miglioramenti grafici/UX coerenti col design system attuale.",
        vincoli: "Non modificare logica di business, RLS, schema database o componenti globali.",
      };
    case "aggiorna_database":
      return {
        obiettivo: "Aggiorna schema/dati richiesti e verifica RLS, compatibilita' dati e UI collegata.",
        modifica:
          "Crea migration sicura e non distruttiva. Aggiorna codice TypeScript / componenti che leggono i campi modificati.",
        vincoli:
          "Mantieni RLS per-utente. Non cancellare dati esistenti. Verifica retro-compatibilita'.",
      };
    case "verifica_build":
      return {
        obiettivo: "Verifica che build e TypeScript siano puliti e che non ci siano regressioni.",
        modifica: "Esegui build/typecheck, riporta eventuali errori e correggi solo quelli.",
        vincoli: "Nessuna nuova funzionalita'. Solo verifica e fix di errori emersi.",
      };
    case "crea_test":
      return {
        obiettivo: "Aggiungi test mirati sulla funzionalita' appena implementata.",
        modifica: "Crea test focalizzati sui casi d'uso principali e sui casi di errore.",
        vincoli: "Non modificare la logica testata se non per renderla testabile in modo minimo.",
      };
    case "pulizia_codice":
      return {
        obiettivo: "Esegui pulizia mirata del codice introdotto, senza alterare il comportamento.",
        modifica: "Rimuovi codice morto, duplicazioni, console.log e import inutilizzati introdotti dall'ultima modifica.",
        vincoli: "Nessuna modifica funzionale. Solo pulizia.",
      };
    case "prossimo_step_roadmap":
      return {
        obiettivo: "Avanza al prossimo step della roadmap basandoti sul risultato precedente.",
        modifica:
          "Implementa il prossimo task coerente con la roadmap del progetto, partendo dallo stato attuale.",
        vincoli: "Mantieni coerenza con le scelte gia' approvate. Non riscrivere parti gia' completate.",
      };
    case "prompt_generico":
    default:
      return {
        obiettivo: "Esegui il prossimo step operativo coerente con il contesto.",
        modifica: "Applica la modifica richiesta in modo minimale e tracciabile.",
        vincoli: "Mantieni coerenza con quanto gia' implementato.",
      };
  }
}

function buildNextPrompt(row: PEL, goal: GenerationGoal): string {
  const dir = goalDirectives(goal, row.result_type);
  const goalLabel = GENERATION_GOALS.find((g) => g.value === goal)?.label ?? goal;
  const title = `Prossimo step — ${goalLabel} — ${row.prompt_title}`;
  const contesto = [
    `Progetto / brain: ${row.brain_id ?? "—"}`,
    row.roadmap_item_id ? `Roadmap item: ${row.roadmap_item_id}` : null,
    row.task_id ? `Task collegato: ${row.task_id}` : null,
    `Tool destinazione: ${row.target_tool}`,
    `Stato precedente: ${row.status}`,
    `Tipo risultato: ${row.result_type ?? "non specificato"}`,
    row.retry_count > 0 ? `Retry effettuati: ${row.retry_count}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prevPrompt = (row.prompt_content || "").trim().slice(0, 1500);
  const prevResult = (row.result_text || "").trim().slice(0, 2000);
  const notes = (row.internal_notes || "").trim();

  return [
    `# TITOLO`,
    title,
    ``,
    `# CONTESTO`,
    contesto,
    notes ? `\nNote interne precedenti:\n${notes}` : ``,
    ``,
    `# RISULTATO PRECEDENTE`,
    `Prompt originario (estratto):`,
    "```",
    prevPrompt,
    "```",
    ``,
    `Risposta Lovable salvata:`,
    "```",
    prevResult,
    "```",
    ``,
    `# OBIETTIVO ORA`,
    dir.obiettivo,
    ``,
    `# MODIFICA SPECIFICA`,
    dir.modifica,
    ``,
    `# VINCOLI`,
    dir.vincoli,
    ``,
    `# NON MODIFICARE`,
    `- auth, login, signup, sessioni, RLS, policy Supabase`,
    `- sidebar globale, layout globale, route protette`,
    `- componenti condivisi non collegati a questa modifica`,
    `- Browser Bridge v0.2/v0.3 gia' implementati`,
    ``,
    `# RISULTATO ATTESO`,
    `Modifica applicata in modo minimale, tracciabile e coerente con il contesto.`,
    `Riassunto chiaro di cosa e' stato modificato e perche'.`,
    ``,
    `# VERIFICA FINALE`,
    `- build pulita`,
    `- nessun errore TypeScript`,
    `- nessun errore console nuovo`,
    `- nessuna regressione visibile nelle aree non toccate`,
  ]
    .filter((l) => l !== ``)
    .join("\n");
}


const STATUS_LABEL: Record<PELStatus, string> = {
  draft: "Bozza",
  prepared: "Preparato",
  inserted_in_lovable: "Inserito",
  sent_to_lovable_confirmed: "Inviato",
  result_pending: "In attesa risultato",
  result_saved: "Risultato salvato",
  completed: "Completato",
  failed: "Fallito",
};

const STATUS_COLOR: Record<PELStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  prepared: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  inserted_in_lovable: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
  sent_to_lovable_confirmed: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  result_pending: "bg-amber-500/10 text-amber-200 border-amber-500/30",
  result_saved: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  completed: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  failed: "bg-red-500/10 text-red-300 border-red-500/30",
};

const RESULT_TYPES = [
  "build_success",
  "build_error",
  "console_error",
  "file_change",
  "database_change",
  "partial_success",
  "note",
] as const;

const PENDING_STATUSES: PELStatus[] = ["sent_to_lovable_confirmed", "result_pending"];

function buildCleanPrompt(item: ClipItem): string {
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  const pkg = (m.execution_package as Record<string, unknown> | undefined) ?? {};
  const p = (pkg.promptOnly as string | undefined)?.trim();
  if (p) return p;
  return (item.content ?? "").trim();
}

function isEligible(i: ClipItem): boolean {
  if (i.content_type !== "execution_package") return false;
  const run = getAutomationRun(i);
  const tool = (i.target_tool ?? "").toLowerCase();
  const target = (run.target ?? "").toLowerCase();
  if (tool !== "lovable" && target !== "lovable") return false;
  return ["approved", "queued", "running", "draft"].includes(run.run_status);
}

async function logBridgeEvent(itemId: string | null, action: LogEventType, notes: string) {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return;
    await supabase.from("clipboard_execution_logs").insert({
      user_id: u.user.id,
      clipboard_item_id: itemId,
      action,
      notes,
      metadata: { connector: "lovable_browser_bridge", source: "execution_tracking" },
    } as never);
  } catch {
    // best effort
  }
}

async function fetchData() {
  const [itemsRes, brainsRes, pelRes] = await Promise.all([
    supabase
      .from("clipboard_items")
      .select(
        "id,brain_id,project_id,title,content,content_type,target_tool,automation_status,risk_level,success_criteria,expected_output,execution_instructions,metadata,updated_at",
      )
      .eq("content_type", "execution_package")
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase.from("brains").select("id,name"),
    supabase
      .from("prompt_execution_logs")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (brainsRes.error) throw brainsRes.error;
  if (pelRes.error) throw pelRes.error;
  return {
    items: (itemsRes.data ?? []) as ClipItem[],
    brains: (brainsRes.data ?? []) as Brain[],
    pel: (pelRes.data ?? []) as PEL[],
  };
}

export function ExecutionTracking() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["execution-tracking"],
    queryFn: fetchData,
    refetchInterval: 30000,
  });

  const [resultDrafts, setResultDrafts] = useState<
    Record<string, { text: string; type: string; notes: string }>
  >({});
  const [genDrafts, setGenDrafts] = useState<
    Record<string, { goal: GenerationGoal; text: string; open: boolean }>
  >({});
  const [showHistory, setShowHistory] = useState(false);

  const items = data?.items ?? [];
  const brains = data?.brains ?? [];
  const pel = data?.pel ?? [];
  const brainMap = useMemo(() => new Map(brains.map((b) => [b.id, b])), [brains]);
  const eligible = useMemo(() => items.filter(isEligible), [items]);

  // Latest pel per execution_package_id
  const latestByItem = useMemo(() => {
    const m = new Map<string, PEL>();
    for (const r of pel) {
      if (!r.execution_package_id) continue;
      if (!m.has(r.execution_package_id)) m.set(r.execution_package_id, r);
    }
    return m;
  }, [pel]);

  const activeRows = useMemo(
    () => pel.filter((r) => r.status !== "completed" && r.status !== "failed").slice(0, 50),
    [pel],
  );

  // Children map: parent_id -> child pel rows
  const childrenByParent = useMemo(() => {
    const m = new Map<string, PEL[]>();
    for (const r of pel) {
      if (!r.parent_execution_log_id) continue;
      const arr = m.get(r.parent_execution_log_id) ?? [];
      arr.push(r);
      m.set(r.parent_execution_log_id, arr);
    }
    return m;
  }, [pel]);
  const pelById = useMemo(() => new Map(pel.map((r) => [r.id, r])), [pel]);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["execution-tracking"] });
  }

  async function getUserId(): Promise<string | null> {
    const { data: u } = await supabase.auth.getUser();
    return u?.user?.id ?? null;
  }

  async function preparePelForItem(item: ClipItem): Promise<PEL | null> {
    const uid = await getUserId();
    if (!uid) {
      toast.error("Non autenticato");
      return null;
    }
    const prompt = buildCleanPrompt(item);
    if (!prompt) {
      toast.error("Prompt vuoto");
      return null;
    }
    const existing = latestByItem.get(item.id);
    if (existing && existing.status !== "completed" && existing.status !== "failed") {
      return existing;
    }
    const { data: ins, error: insErr } = await supabase
      .from("prompt_execution_logs")
      .insert({
        user_id: uid,
        project_id: item.project_id ?? null,
        brain_id: item.brain_id ?? null,
        execution_package_id: item.id,
        target_tool: "lovable",
        prompt_title: item.title || "(senza titolo)",
        prompt_content: prompt,
        status: "prepared" as PELStatus,
        metadata: { source: "browser_bridge_v0.3" },
      } as never)
      .select()
      .single();
    if (insErr) {
      toast.error(insErr.message);
      return null;
    }
    toast.success("Tracking preparato");
    refresh();
    return ins as unknown as PEL;
  }

  async function patchPel(row: PEL, patch: Partial<PEL>) {
    const { error: upErr } = await supabase
      .from("prompt_execution_logs")
      .update(patch as never)
      .eq("id", row.id);
    if (upErr) {
      toast.error(upErr.message);
      return false;
    }
    refresh();
    return true;
  }

  async function copyPrompt(row: PEL) {
    try {
      await navigator.clipboard.writeText(row.prompt_content);
      toast.success("Prompt copiato");
    } catch {
      toast.error("Copia non riuscita");
    }
  }

  async function markInserted(row: PEL) {
    const ok = await patchPel(row, { status: "inserted_in_lovable" });
    if (!ok) return;
    await logBridgeEvent(
      row.execution_package_id,
      "lovable_browser_bridge_prompt_inserted",
      `Prompt inserito (tracking): ${row.prompt_title}`,
    );
    toast.success("Stato: inserito in Lovable");
  }

  async function markSentConfirmed(row: PEL, options: { retry?: boolean } = {}) {
    if (!options.retry && PENDING_STATUSES.includes(row.status)) {
      const ok = window.confirm(
        "Questo prompt risulta gia' inviato a Lovable. Vuoi davvero inviarlo di nuovo?",
      );
      if (!ok) return;
      await logBridgeEvent(
        row.execution_package_id,
        "lovable_browser_bridge_prompt_retry_requested",
        `Retry richiesto: ${row.prompt_title}`,
      );
      return markSentConfirmed(row, { retry: true });
    }

    const confirmMsg = options.retry
      ? "Confermi RE-INVIO del prompt (retry registrato)?"
      : "Confermi che hai inviato il prompt a Lovable con conferma esplicita?";
    const ok = window.confirm(confirmMsg);
    if (!ok) return;

    const receipt = {
      source: "lovable_browser_bridge",
      status: "sent",
      sent_at: new Date().toISOString(),
      retry: !!options.retry,
      prompt_title: row.prompt_title,
      prompt_preview: row.prompt_content.slice(0, 300),
    };

    const patched = await patchPel(row, {
      status: "result_pending",
      receipt_json: receipt,
      retry_count: options.retry ? (row.retry_count ?? 0) + 1 : row.retry_count,
    });
    if (!patched) return;
    await logBridgeEvent(
      row.execution_package_id,
      "lovable_browser_bridge_prompt_sent_confirmed",
      `Invio confermato (tracking)${options.retry ? " [retry]" : ""}: ${row.prompt_title}`,
    );
    toast.success("Stato: inviato, in attesa risultato");
  }

  async function saveResult(row: PEL) {
    const draft = resultDrafts[row.id] ?? { text: "", type: "note", notes: "" };
    if (!draft.text.trim()) {
      toast.error("Incolla la risposta di Lovable");
      return;
    }
    const ok = await patchPel(row, {
      status: "result_saved",
      result_text: draft.text,
      result_type: draft.type,
      internal_notes: draft.notes || null,
    });
    if (!ok) return;
    await logBridgeEvent(
      row.execution_package_id,
      "lovable_browser_bridge_result_saved",
      `Risultato salvato (${draft.type}): ${row.prompt_title}`,
    );
    setResultDrafts((s) => ({ ...s, [row.id]: { text: "", type: "note", notes: "" } }));
    toast.success("Risultato salvato");
    void enqueueExecCta(row, "Salva risultato", "save_lovable_result", "medium", {
      result_type: draft.type,
      result_status: "result_saved",
      suggested_reason: "result_saved_from_execution_tracking",
    });
  }

  async function markCompleted(row: PEL) {
    const ok = await patchPel(row, { status: "completed" });
    if (!ok) return;
    await logBridgeEvent(
      row.execution_package_id,
      "lovable_browser_bridge_prompt_completed",
      `Prompt completato: ${row.prompt_title}`,
    );
    toast.success("Completato");
    void enqueueExecCta(
      row,
      "Segna come completato",
      row.roadmap_item_id ? "mark_roadmap_completed" : "manual_task",
      row.roadmap_item_id ? "high" : "medium",
      { result_status: "completed", suggested_reason: "marked_completed" },
    );
  }

  async function markFailed(row: PEL) {
    const reason = window.prompt("Motivo del fallimento (opzionale):") ?? "";
    const ok = await patchPel(row, {
      status: "failed",
      last_error: reason || row.last_error,
    });
    if (!ok) return;
    await logBridgeEvent(
      row.execution_package_id,
      "lovable_browser_bridge_prompt_failed",
      `Prompt fallito: ${row.prompt_title}${reason ? ` — ${reason}` : ""}`,
    );
    toast.success("Segnato come fallito");
    void enqueueExecCta(row, "Segna come fallito", "mark_roadmap_needs_fix", "medium", {
      result_status: "failed",
      suggested_reason: "marked_failed",
      failure_reason: reason || undefined,
    });
  }

  async function copyReceipt(row: PEL) {
    if (!row.receipt_json) {
      toast.error("Nessun receipt disponibile");
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(row.receipt_json, null, 2));
      toast.success("Receipt copiato");
    } catch {
      toast.error("Copia non riuscita");
    }
  }

  function brainNameOf(row: PEL): string {
    if (!row.brain_id) return "—";
    return brainMap.get(row.brain_id)?.name ?? "—";
  }

  // ─── Next Prompt Generator (v0.4) ──────────────────────────────────────────

  function openGenerator(row: PEL) {
    const cur = genDrafts[row.id];
    if (cur?.open) {
      setGenDrafts((s) => ({ ...s, [row.id]: { ...cur, open: false } }));
      return;
    }
    const goal = (row.generation_goal as GenerationGoal) || suggestGoalFromResultType(row.result_type);
    const text = row.generated_prompt_text || buildNextPrompt(row, goal);
    setGenDrafts((s) => ({ ...s, [row.id]: { goal, text, open: true } }));
  }

  function regenerate(row: PEL) {
    const cur = genDrafts[row.id];
    const goal = cur?.goal ?? suggestGoalFromResultType(row.result_type);
    const text = buildNextPrompt(row, goal);
    setGenDrafts((s) => ({ ...s, [row.id]: { goal, text, open: true } }));
  }

  function setGenGoal(row: PEL, goal: GenerationGoal) {
    const cur = genDrafts[row.id];
    const text = buildNextPrompt(row, goal);
    setGenDrafts((s) => ({ ...s, [row.id]: { goal, text, open: cur?.open ?? true } }));
  }

  function setGenText(rowId: string, text: string) {
    const cur = genDrafts[rowId];
    if (!cur) return;
    setGenDrafts((s) => ({ ...s, [rowId]: { ...cur, text } }));
  }

  async function persistGenerated(row: PEL, draft: { goal: GenerationGoal; text: string }) {
    await patchPel(row, {
      generation_goal: draft.goal,
      generated_prompt_text: draft.text,
    });
  }

  async function copyGenerated(row: PEL) {
    const draft = genDrafts[row.id];
    if (!draft?.text.trim()) {
      toast.error("Nessun prompt generato");
      return;
    }
    try {
      await navigator.clipboard.writeText(draft.text);
      toast.success("Prossimo prompt copiato");
      await persistGenerated(row, draft);
    } catch {
      toast.error("Copia non riuscita");
    }
  }

  async function createChildPel(
    parent: PEL,
    draft: { goal: GenerationGoal; text: string },
    initialStatus: PELStatus,
  ): Promise<PEL | null> {
    const uid = await getUserId();
    if (!uid) {
      toast.error("Non autenticato");
      return null;
    }
    const title = `[Next · ${draft.goal}] ${parent.prompt_title}`.slice(0, 240);
    const { data: ins, error: insErr } = await supabase
      .from("prompt_execution_logs")
      .insert({
        user_id: uid,
        project_id: parent.project_id,
        brain_id: parent.brain_id,
        roadmap_item_id: parent.roadmap_item_id,
        task_id: parent.task_id,
        execution_package_id: parent.execution_package_id,
        target_tool: parent.target_tool,
        prompt_title: title,
        prompt_content: draft.text,
        status: initialStatus as PELStatus,
        parent_execution_log_id: parent.id,
        generation_goal: draft.goal,
        metadata: {
          source: "browser_bridge_v0.4",
          generated_from_result: true,
          generation_goal: draft.goal,
          parent_pel_id: parent.id,
          parent_execution_package_id: parent.execution_package_id,
        },
      } as never)
      .select()
      .single();
    if (insErr) {
      toast.error(insErr.message);
      return null;
    }
    await persistGenerated(parent, draft);
    refresh();
    return ins as unknown as PEL;
  }

  async function saveAsExecutionPackage(parent: PEL) {
    const draft = genDrafts[parent.id];
    if (!draft?.text.trim()) {
      toast.error("Nessun prompt generato");
      return;
    }
    const uid = await getUserId();
    if (!uid) {
      toast.error("Non autenticato");
      return;
    }
    const title = `[Next · ${draft.goal}] ${parent.prompt_title}`.slice(0, 240);
    const { data: ci, error: ciErr } = await supabase
      .from("clipboard_items")
      .insert({
        user_id: uid,
        brain_id: parent.brain_id,
        project_id: parent.project_id,
        title,
        content: draft.text,
        source_tool: "brain_hub",
        target_tool: parent.target_tool || "lovable",
        content_type: "execution_package",
        status: "saved",
        notes: `Generato da Browser Bridge v0.4 — parent PEL: ${parent.id}`,
        metadata: {
          generated_from_result: true,
          generation_goal: draft.goal,
          parent_pel_id: parent.id,
          parent_execution_package_id: parent.execution_package_id,
          execution_package: { promptOnly: draft.text },
        },
        human_review_required: true,
        requires_approval: true,
        approval_status: "pending",
      } as never)
      .select()
      .single();
    if (ciErr) {
      toast.error(ciErr.message);
      return;
    }
    // Create linked child pel referencing the new clipboard_item
    const uid2 = uid;
    await supabase.from("prompt_execution_logs").insert({
      user_id: uid2,
      project_id: parent.project_id,
      brain_id: parent.brain_id,
      roadmap_item_id: parent.roadmap_item_id,
      task_id: parent.task_id,
      execution_package_id: (ci as { id: string }).id,
      target_tool: parent.target_tool || "lovable",
      prompt_title: title,
      prompt_content: draft.text,
      status: "prepared" as PELStatus,
      parent_execution_log_id: parent.id,
      generation_goal: draft.goal,
      metadata: {
        source: "browser_bridge_v0.4",
        generated_from_result: true,
        generation_goal: draft.goal,
        parent_pel_id: parent.id,
      },
    } as never);
    await persistGenerated(parent, draft);
    refresh();
    toast.success("Salvato come nuovo Execution Package");
    void enqueueExecCta(parent, "Salva come nuovo execution package", "generate_first_prompt", "medium", {
      child_clipboard_item_id: (ci as { id: string }).id,
      suggested_reason: "next_prompt_saved_as_package",
    });
  }

  async function insertChildInLovable(parent: PEL) {
    const draft = genDrafts[parent.id];
    if (!draft?.text.trim()) {
      toast.error("Nessun prompt generato");
      return;
    }
    const child = await createChildPel(parent, draft, "inserted_in_lovable");
    if (!child) return;
    try {
      await navigator.clipboard.writeText(draft.text);
    } catch {
      // best effort
    }
    await logBridgeEvent(
      parent.execution_package_id,
      "lovable_browser_bridge_prompt_inserted",
      `Next prompt generato e copiato per Browser Bridge: ${child.prompt_title}`,
    );
    toast.success("Prompt copiato. Aprilo nel popup Browser Bridge.");
    void enqueueExecCta(parent, "Inserisci in Lovable", "send_next_prompt", "high", {
      child_pel_id: child.id,
      suggested_reason: "next_prompt_inserted_in_lovable",
    });
  }

  async function insertChildAndSendConfirmed(parent: PEL) {
    const draft = genDrafts[parent.id];
    if (!draft?.text.trim()) {
      toast.error("Nessun prompt generato");
      return;
    }
    const ok = window.confirm(
      "Confermi creazione del prossimo prompt come 'inviato con conferma'? Dovrai comunque incollarlo nel popup Browser Bridge e confermare l'invio in Chrome.",
    );
    if (!ok) return;
    const child = await createChildPel(parent, draft, "result_pending");
    if (!child) return;
    try {
      await navigator.clipboard.writeText(draft.text);
    } catch {
      // best effort
    }
    const receipt = {
      source: "lovable_browser_bridge",
      status: "sent",
      sent_at: new Date().toISOString(),
      generated_from_parent: parent.id,
      prompt_title: child.prompt_title,
      prompt_preview: draft.text.slice(0, 300),
    };
    await supabase
      .from("prompt_execution_logs")
      .update({ receipt_json: receipt } as never)
      .eq("id", child.id);
    await logBridgeEvent(
      parent.execution_package_id,
      "lovable_browser_bridge_prompt_sent_confirmed",
      `Next prompt: invio confermato (tracking): ${child.prompt_title}`,
    );
    refresh();
    toast.success("Prompt copiato e tracciato come inviato. Incollalo in Browser Bridge.");
    void enqueueExecCta(parent, "Inserisci e invia con conferma", "send_next_prompt", "high", {
      child_pel_id: child.id,
      suggested_reason: "next_prompt_send_confirmed",
    });
  }


  function renderRow(row: PEL, includeResultBlock = true) {
    const draft = resultDrafts[row.id] ?? { text: "", type: "note", notes: "" };
    const gen = genDrafts[row.id];
    const linkedRoadmap = row.roadmap_item_id;
    const linkedTask = row.task_id;
    const parent = row.parent_execution_log_id ? pelById.get(row.parent_execution_log_id) : null;
    const children = childrenByParent.get(row.id) ?? [];
    const canGenerateNext =
      !!row.result_text && ["result_saved", "completed", "failed"].includes(row.status);
    return (
      <div key={row.id} className="rounded-md border border-border/60 p-3 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{row.prompt_title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {brainNameOf(row)} · {row.target_tool} · agg. {new Date(row.updated_at).toLocaleString()}
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
              {linkedRoadmap && <Badge variant="outline">roadmap: {linkedRoadmap.slice(0, 8)}</Badge>}
              {linkedTask && <Badge variant="outline">task: {linkedTask.slice(0, 8)}</Badge>}
              {parent && (
                <Badge variant="outline" className="gap-1 bg-violet-500/10 text-violet-300 border-violet-500/30">
                  <GitBranch className="h-3 w-3" /> Generato da: {parent.prompt_title.slice(0, 28)}
                </Badge>
              )}
              {children.length > 0 && (
                <Badge variant="outline" className="bg-violet-500/10 text-violet-300 border-violet-500/30">
                  Next prompt × {children.length}
                </Badge>
              )}
              {row.generation_goal && (
                <Badge variant="outline" className="text-[10px]">goal: {row.generation_goal}</Badge>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="outline" className={STATUS_COLOR[row.status]}>
              {STATUS_LABEL[row.status]}
            </Badge>
            {row.retry_count > 0 && (
              <Badge variant="outline" className="text-[10px]">retry × {row.retry_count}</Badge>
            )}
          </div>
        </div>

        {row.last_error && (
          <div className="rounded bg-red-500/10 border border-red-500/30 p-2 text-xs text-red-200">
            Errore: {row.last_error}
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => copyPrompt(row)}>
            <Copy className="mr-1 h-3 w-3" /> Copia prompt
          </Button>
          {row.status !== "completed" && row.status !== "failed" && (
            <>
              <Button size="sm" variant="outline" onClick={() => markInserted(row)}>
                Segna inserito
              </Button>
              <Button size="sm" variant="outline" onClick={() => markSentConfirmed(row)}>
                <Send className="mr-1 h-3 w-3" /> Inviato con conferma
              </Button>
            </>
          )}
          {row.receipt_json && (
            <Button size="sm" variant="outline" onClick={() => copyReceipt(row)}>
              Copia receipt JSON
            </Button>
          )}
        </div>

        {row.result_text && (
          <div className="rounded bg-muted/40 border border-border/40 p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Risultato salvato {row.result_type ? `· ${row.result_type}` : ""}
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[11px] max-h-40 overflow-auto">
              {row.result_text}
            </pre>
            {row.internal_notes && (
              <div className="mt-1 text-[11px] text-muted-foreground">Note: {row.internal_notes}</div>
            )}
          </div>
        )}

        {includeResultBlock && row.status !== "completed" && row.status !== "failed" && (
          <div className="rounded border border-dashed border-border/60 p-2 space-y-2">
            <div className="text-xs font-medium">Salva risultato Lovable</div>
            <Textarea
              placeholder="Incolla qui la risposta di Lovable"
              value={draft.text}
              onChange={(e) =>
                setResultDrafts((s) => ({ ...s, [row.id]: { ...draft, text: e.target.value } }))
              }
              className="min-h-[80px] font-mono text-xs"
            />
            <div className="flex flex-wrap gap-2">
              <Select
                value={draft.type}
                onValueChange={(v) =>
                  setResultDrafts((s) => ({ ...s, [row.id]: { ...draft, type: v } }))
                }
              >
                <SelectTrigger className="h-8 w-[180px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESULT_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                placeholder="Note interne (opzionale)"
                value={draft.notes}
                onChange={(e) =>
                  setResultDrafts((s) => ({ ...s, [row.id]: { ...draft, notes: e.target.value } }))
                }
                className="h-8 flex-1 min-w-[160px] rounded-md border border-border bg-background px-2 text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" onClick={() => saveResult(row)}>
                Salva risultato
              </Button>
              <Button size="sm" variant="outline" onClick={() => markCompleted(row)}>
                <CheckCircle2 className="mr-1 h-3 w-3" /> Segna completato
              </Button>
              <Button size="sm" variant="outline" onClick={() => markFailed(row)}>
                <XCircle className="mr-1 h-3 w-3" /> Segna fallito
              </Button>
            </div>
          </div>
        )}

        {canGenerateNext && (
          <div className="rounded border border-violet-500/30 bg-violet-500/5 p-2 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-violet-400" /> Next Prompt Generator
                <Badge variant="outline" className="ml-1 text-[10px]">v0.4</Badge>
              </div>
              <Button size="sm" variant="outline" onClick={() => openGenerator(row)}>
                {gen?.open ? "Chiudi" : row.generated_prompt_text ? "Riapri prompt generato" : "Genera prossimo prompt"}
              </Button>
            </div>

            {gen?.open && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Obiettivo prossimo prompt:</span>
                  <Select
                    value={gen.goal}
                    onValueChange={(v) => setGenGoal(row, v as GenerationGoal)}
                  >
                    <SelectTrigger className="h-8 w-[220px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GENERATION_GOALS.map((g) => (
                        <SelectItem key={g.value} value={g.value} className="text-xs">
                          {g.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => regenerate(row)}>
                    <RefreshCw className="mr-1 h-3 w-3" /> Rigenera
                  </Button>
                </div>

                <Textarea
                  value={gen.text}
                  onChange={(e) => setGenText(row.id, e.target.value)}
                  className="min-h-[200px] font-mono text-[11px]"
                />

                <div className="flex flex-wrap gap-1">
                  <Button size="sm" onClick={() => copyGenerated(row)}>
                    <Copy className="mr-1 h-3 w-3" /> Copia prossimo prompt
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => saveAsExecutionPackage(row)}>
                    Salva come nuovo execution package
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => insertChildInLovable(row)}>
                    Inserisci in Lovable
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => insertChildAndSendConfirmed(row)}>
                    <Send className="mr-1 h-3 w-3" /> Inserisci e invia con conferma
                  </Button>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  "Inserisci…" copia il prompt negli appunti e crea un nuovo tracking figlio collegato.
                  L'inserimento e l'invio reali avvengono nel popup Browser Bridge sul tuo Chrome (v0.2/v0.3).
                </div>
              </>
            )}

            {children.length > 0 && (
              <div className="space-y-1 pt-1">
                <div className="text-[11px] text-muted-foreground">Prompt figli generati:</div>
                {children.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/40 bg-background/40 p-1.5 text-[11px]"
                  >
                    <span className="truncate flex-1 min-w-0">{c.prompt_title}</span>
                    <Badge variant="outline" className={STATUS_COLOR[c.status]}>
                      {STATUS_LABEL[c.status]}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }


  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-cyan-400" /> Execution Tracking
            <Badge variant="outline" className="ml-1 text-[10px]">v0.4</Badge>
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshCw className="mr-1 h-3 w-3" /> Aggiorna
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowHistory((v) => !v)}>
              <ListChecks className="mr-1 h-3 w-3" /> {showHistory ? "Nascondi storico" : "Mostra storico"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Traccia il ciclo completo prompt → inserito → inviato con conferma → risultato salvato → completato/fallito.
          Il Browser Bridge v0.2 continua a funzionare; questa sezione registra ogni passaggio e collega il risultato all'execution package.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading && <div className="text-sm text-muted-foreground">Caricamento…</div>}
        {error && <div className="text-sm text-destructive">{(error as Error).message}</div>}

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Execution Package Lovable idonei ({eligible.length})
          </div>
          {!isLoading && eligible.length === 0 && (
            <div className="rounded-md border border-border/60 p-3 text-sm text-muted-foreground">
              Nessun Execution Package Lovable idoneo.
            </div>
          )}
          {eligible.map((it) => {
            const existing = latestByItem.get(it.id);
            const brain = it.brain_id ? brainMap.get(it.brain_id) : null;
            return (
              <div key={it.id} className="rounded-md border border-border/60 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{it.title || "(senza titolo)"}</div>
                    <div className="truncate text-xs text-muted-foreground">{brain?.name ?? "—"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {existing ? (
                      <Badge variant="outline" className={STATUS_COLOR[existing.status]}>
                        {STATUS_LABEL[existing.status]}
                      </Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => preparePelForItem(it)}>
                        Prepara tracking
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Tracking attivi ({activeRows.length})
          </div>
          {activeRows.length === 0 && (
            <div className="rounded-md border border-border/60 p-3 text-sm text-muted-foreground">
              Nessun tracking attivo.
            </div>
          )}
          {activeRows.map((r) => renderRow(r))}
        </div>

        {showHistory && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Storico completo (ultimi {pel.length})
            </div>
            {pel.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">
                    <span className="text-muted-foreground">
                      {new Date(r.updated_at).toLocaleString()} ·
                    </span>{" "}
                    <span className="font-medium">{r.prompt_title}</span>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {brainNameOf(r)} · {r.target_tool}
                    {r.retry_count > 0 ? ` · retry × ${r.retry_count}` : ""}
                    {r.parent_execution_log_id ? " · generato da risultato precedente" : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {r.parent_execution_log_id && (
                    <Badge variant="outline" className="bg-violet-500/10 text-violet-300 border-violet-500/30 text-[10px] gap-1">
                      <GitBranch className="h-3 w-3" /> Next
                    </Badge>
                  )}
                  <Badge variant="outline" className={STATUS_COLOR[r.status]}>
                    {STATUS_LABEL[r.status]}
                  </Badge>
                  <Button size="sm" variant="ghost" onClick={() => copyPrompt(r)}>
                    Copia prompt
                  </Button>
                  {r.receipt_json && (
                    <Button size="sm" variant="ghost" onClick={() => copyReceipt(r)}>
                      Receipt
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
