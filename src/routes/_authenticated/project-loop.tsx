import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Workflow,
  Rocket,
  BrainCircuit,
  RefreshCw,
  ListChecks,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Copy,
  Gauge,
  Sparkles,
  Wand2,
  HeartPulse,
} from "lucide-react";

type HealthStatus = "healthy" | "needs_attention" | "blocked" | "empty";

const HEALTH_META: Record<HealthStatus, { label: string; cls: string; suggestion: string }> = {
  healthy: {
    label: "Healthy",
    cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    suggestion: "Continua il ciclo operativo",
  },
  needs_attention: {
    label: "Needs attention",
    cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    suggestion: "Genera un prompt dal prossimo roadmap item",
  },
  blocked: {
    label: "Blocked",
    cls: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    suggestion: "Risolvi item falliti o bloccati",
  },
  empty: {
    label: "Empty",
    cls: "bg-muted text-muted-foreground border-border",
    suggestion: "Crea roadmap iniziale del progetto",
  },
};

export const Route = createFileRoute("/_authenticated/project-loop")({
  head: () => ({ meta: [{ title: "Project Loop — AI Brain" }] }),
  component: ProjectLoopPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Pagina non trovata.</div>,
});

type Brain = { id: string; name: string; color: string | null; updated_at: string };
type RoadmapItem = {
  id: string;
  brain_id: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  updated_at: string;
};
type Task = {
  id: string;
  brain_id: string | null;
  title: string;
  status: string;
  updated_at: string;
};
type ClipboardItem = {
  id: string;
  brain_id: string | null;
  title: string;
  content: string;
  target_tool: string;
  source_tool: string;
  status: string;
  approval_status: string;
  automation_status: string;
  human_review_required: boolean;
  risk_level: string | null;
  output_result: string;
  next_action: string | null;
  source_url: string | null;
  project_tool_link_id: string | null;
  next_step_generated: boolean;
  updated_at: string;
};
type ExecLog = {
  id: string;
  clipboard_item_id: string;
  action: string;
  previous_status: string | null;
  new_status: string | null;
  notes: string | null;
  created_at: string;
};
type ProjectToolLink = {
  id: string;
  brain_id: string | null;
  tool_name: string;
  url: string | null;
};

async function fetchAll() {
  const [brainsRes, roadmapRes, tasksRes, itemsRes, logsRes, ptlRes] = await Promise.all([
    supabase.from("brains").select("id,name,color,updated_at").order("updated_at", { ascending: false }),
    supabase
      .from("roadmap_items")
      .select("id,brain_id,title,description,status,priority,updated_at")
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase
      .from("tasks")
      .select("id,brain_id,title,status,updated_at")
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase
      .from("clipboard_items")
      .select(
        "id,brain_id,title,content,target_tool,source_tool,status,approval_status,automation_status,human_review_required,risk_level,output_result,next_action,source_url,project_tool_link_id,next_step_generated,updated_at"
      )
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase
      .from("clipboard_execution_logs")
      .select("id,clipboard_item_id,action,previous_status,new_status,notes,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("project_tool_links").select("id,brain_id,tool_name,url"),
  ]);

  if (brainsRes.error) throw brainsRes.error;
  if (roadmapRes.error) throw roadmapRes.error;
  if (tasksRes.error) throw tasksRes.error;
  if (itemsRes.error) throw itemsRes.error;
  if (logsRes.error) throw logsRes.error;
  if (ptlRes.error) throw ptlRes.error;

  return {
    brains: (brainsRes.data ?? []) as Brain[],
    roadmap: (roadmapRes.data ?? []) as RoadmapItem[],
    tasks: (tasksRes.data ?? []) as Task[],
    items: (itemsRes.data ?? []) as ClipboardItem[],
    logs: (logsRes.data ?? []) as ExecLog[],
    projectLinks: (ptlRes.data ?? []) as ProjectToolLink[],
  };
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: typeof Workflow;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function isOpenRoadmap(r: RoadmapItem) {
  return !["done", "archived", "completed"].includes((r.status ?? "").toLowerCase());
}

async function copyText(text: string, label = "Testo copiato") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error("Impossibile copiare");
  }
}

function buildLovablePrompt(brain: Brain, r: RoadmapItem) {
  return `REGOLE DI SICUREZZA OBBLIGATORIE:
- Non modificare auth, login, signup, sessioni, RLS o policy Supabase esistenti.
- Non toccare dati, tabelle o logiche non richieste.
- Non rompere route, sidebar, link, layout globale o componenti condivisi.
- Non rimuovere funzionalità già funzionanti.
- Modifica solo i file strettamente necessari.
- Mantieni compatibilità TypeScript.
- Verifica build, console error e navigazione dopo le modifiche.

CONTESTO PROGETTO:
- Brain/Progetto: ${brain.name}
- Roadmap item: ${r.title}
- Priorità: ${r.priority ?? "—"}
- Stato attuale: ${r.status}

OBIETTIVO:
${r.description?.trim() || r.title}

COSA MODIFICARE:
- Implementare il roadmap item sopra descritto rispettando l'architettura esistente.
- Toccare solo i file strettamente necessari.

COSA NON MODIFICARE:
- Auth, login, signup, sessioni.
- RLS, policy Supabase, tabelle non correlate.
- Sidebar, layout globale, route esistenti non collegate.

OUTPUT ATTESO:
- Implementazione funzionante del roadmap item "${r.title}".
- Nessuna regressione sulle funzionalità esistenti.

CRITERI DI SUCCESSO:
- Build pulita senza errori TypeScript.
- Nessun errore in console.
- Navigazione e UI esistenti intatte.
- Funzionalità richiesta visibile e usabile.

RICHIESTA FINALE:
Procedi con build pulita e verifica i criteri sopra elencati.`;
}

function suggestNextStep(output: string): string {
  const t = (output ?? "").toLowerCase();
  if (/(errore|error|failed|fail|fix|bug|exception|crash)/.test(t)) {
    return "Analizzare l'errore e applicare un bugfix mirato, poi verificare con test.";
  }
  if (/(done|created|added|implemented|completato|fatto|aggiunto)/.test(t)) {
    return "Verificare il risultato con test funzionali e pianificare il prossimo miglioramento.";
  }
  return "Analizzare il risultato e definire il prossimo intervento";
}

type LoopState =
  | "roadmap_missing"
  | "prompt_missing"
  | "prompt_ready"
  | "waiting_result"
  | "result_to_review"
  | "next_prompt_needed";

const LOOP_STATE_META: Record<LoopState, { label: string; cls: string }> = {
  roadmap_missing: { label: "Roadmap mancante", cls: "bg-muted text-muted-foreground border-border" },
  prompt_missing: { label: "Prompt da generare", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  prompt_ready: { label: "Prompt pronto", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  waiting_result: { label: "Attendo risultato", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
  result_to_review: { label: "Risultato da rielaborare", cls: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" },
  next_prompt_needed: { label: "Prossimo prompt", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
};

function computeLoopState(args: {
  lastRoadmap?: RoadmapItem;
  lastPrompt?: ClipboardItem;
}): LoopState {
  const { lastRoadmap, lastPrompt } = args;
  if (!lastRoadmap) return "roadmap_missing";
  if (!lastPrompt) return "prompt_missing";
  const hasOutput = !!(lastPrompt.output_result ?? "").trim();
  if (!hasOutput) {
    const sent = ["queued", "running", "completed", "sent", "copiato", "inviato_manualmente"].includes(
      (lastPrompt.automation_status ?? "").toLowerCase(),
    );
    return sent ? "waiting_result" : "prompt_ready";
  }
  if (!(lastPrompt.next_step_generated ?? false)) return "result_to_review";
  return "next_prompt_needed";
}

function ProjectLoopPage() {
  const queryClient = useQueryClient();
  const [genTarget, setGenTarget] = useState<{ brain: Brain; roadmap: RoadmapItem } | null>(null);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [nextStepItem, setNextStepItem] = useState<ClipboardItem | null>(null);
  const [saveResultItem, setSaveResultItem] = useState<ClipboardItem | null>(null);
  const [saveResultText, setSaveResultText] = useState("");
  const [nextStepForm, setNextStepForm] = useState<{
    suggestion: string;
    actionType: "roadmap" | "task" | "prompt";
    priority: string;
    riskLevel: string;
  }>({ suggestion: "", actionType: "roadmap", priority: "medium", riskLevel: "medium" });

  const { data, isLoading, error } = useQuery({
    queryKey: ["project-loop"],
    queryFn: fetchAll,
    refetchInterval: 20000,
  });

  const brains = data?.brains ?? [];
  const roadmap = data?.roadmap ?? [];
  const tasks = data?.tasks ?? [];
  const items = data?.items ?? [];
  const logs = data?.logs ?? [];
  const projectLinks = data?.projectLinks ?? [];

  // Active brains = with any open roadmap / task / clipboard item
  const activeBrainIds = new Set<string>();
  roadmap.filter(isOpenRoadmap).forEach((r) => r.brain_id && activeBrainIds.add(r.brain_id));
  items.forEach((i) => {
    if (i.brain_id && i.status !== "archived") activeBrainIds.add(i.brain_id);
  });

  const lovableItems = items.filter(
    (i) => i.target_tool === "Lovable" && i.status !== "archived"
  );

  const readyForLovable = lovableItems.filter((i) => i.automation_status === "ready_for_automation").length;
  const queuedLovable = lovableItems.filter((i) =>
    ["queued", "running"].includes(i.automation_status)
  ).length;
  const needsNextStep = (i: ClipboardItem) =>
    !!(i.output_result ?? "") &&
    (i.output_result ?? "").trim() !== "" &&
    !(i.next_step_generated ?? false) &&
    i.status !== "archived" &&
    (!i.target_tool || i.target_tool === "Lovable");

  const toReprocess = items.filter(needsNextStep).length;
  const recentSavedOutputs = items.filter(
    (i) => i.output_result && i.output_result.trim() !== ""
  ).length;
  const openRoadmap = roadmap.filter(isOpenRoadmap).length;

  const lovableQueue = lovableItems
    .filter((i) => {
      const hasOutput = !!(i.output_result ?? "").trim();
      if (hasOutput) return false;
      const st = (i.automation_status ?? "").toLowerCase();
      return ["ready_for_automation", "queued", "running", "failed", "sent", "copiato", "inviato_manualmente"].includes(st);
    })
    .slice(0, 20);

  const resultsToProcess = items.filter(needsNextStep).slice(0, 15);

  const lovableItemIds = new Set(lovableItems.map((i) => i.id));
  const recentLogs = logs.filter((l) => lovableItemIds.has(l.clipboard_item_id)).slice(0, 20);

  const brainsById = new Map(brains.map((b) => [b.id, b]));

  // Active project loop rows
  const activeRows = Array.from(activeBrainIds)
    .map((bid) => {
      const brain = brainsById.get(bid);
      if (!brain) return null;
      const lastRoadmap = roadmap.find((r) => r.brain_id === bid && isOpenRoadmap(r));
      const brainItems = items.filter((i) => i.brain_id === bid);
      const brainPrompts = brainItems.filter((i) => i.target_tool === "Lovable");
      const lastPrompt = brainPrompts[0];
      const lastOutput = brainItems.find((i) => i.output_result && i.output_result.trim() !== "");
      const nextAction = brainItems.find((i) => i.next_action && i.next_action.trim() !== "")?.next_action;
      const loopState = computeLoopState({ lastRoadmap, lastPrompt });
      return { brain, lastRoadmap, lastPrompt, lastOutput, nextAction, loopState };
    })
    .filter(Boolean) as Array<{
      brain: Brain;
      lastRoadmap?: RoadmapItem;
      lastPrompt?: ClipboardItem;
      lastOutput?: ClipboardItem;
      nextAction?: string | null;
      loopState: LoopState;
    }>;

  const projectLinkById = new Map(projectLinks.map((p) => [p.id, p]));

  // ============ Project Health ============
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const itemIdToBrain = new Map(items.map((i) => [i.id, i.brain_id]));
  const logsByBrain = new Map<string, ExecLog[]>();
  for (const l of logs) {
    const bid = itemIdToBrain.get(l.clipboard_item_id);
    if (!bid) continue;
    const arr = logsByBrain.get(bid) ?? [];
    arr.push(l);
    logsByBrain.set(bid, arr);
  }

  const healthRows = brains
    .map((brain) => {
      const bid = brain.id;
      const bRoadmap = roadmap.filter((r) => r.brain_id === bid);
      const bTasks = tasks.filter((t) => t.brain_id === bid);
      const bItems = items.filter((i) => i.brain_id === bid);
      const bLogs = logsByBrain.get(bid) ?? [];

      const openRoadmapCount = bRoadmap.filter(isOpenRoadmap).length;
      const openTasksCount = bTasks.filter(
        (t) => !["done", "completed", "completato", "archived"].includes((t.status ?? "").toLowerCase()),
      ).length;
      const readyPrompts = bItems.filter(
        (i) => i.target_tool === "Lovable" && i.automation_status === "ready_for_automation" && i.status !== "archived",
      ).length;
      const failedItems = bItems.filter(
        (i) => i.automation_status === "failed" || i.approval_status === "blocked",
      ).length;
      const lastLog = bLogs[0];
      const lastLogTs = lastLog ? new Date(lastLog.created_at).getTime() : 0;
      const hasRecentLog = lastLogTs >= sevenDaysAgo;

      const isEmpty = bRoadmap.length === 0 && bTasks.length === 0 && bItems.length === 0;

      let status: HealthStatus;
      if (isEmpty) status = "empty";
      else if (failedItems > 0) status = "blocked";
      else if (!hasRecentLog || (openRoadmapCount > 0 && readyPrompts === 0)) status = "needs_attention";
      else status = "healthy";

      return {
        brain,
        status,
        lastLog,
        openRoadmapCount,
        openTasksCount,
        readyPrompts,
        failedItems,
      };
    })
    .sort((a, b) => {
      const order: HealthStatus[] = ["blocked", "needs_attention", "empty", "healthy"];
      return order.indexOf(a.status) - order.indexOf(b.status);
    });

  const needsAttentionCount = healthRows.filter(
    (h) => h.status === "blocked" || h.status === "needs_attention",
  ).length;

  // ============ Project Loop Audit ============
  type AuditState = "ok" | "warning" | "alert";
  type AuditCheck = { key: string; label: string; state: AuditState; detail?: string; suggestion?: string };
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const nowTs = Date.now();
  const auditRows = brains
    .map((brain) => {
      const bid = brain.id;
      const bRoadmap = roadmap.filter((r) => r.brain_id === bid);
      const bItems = items.filter((i) => i.brain_id === bid);
      const bLogs = logsByBrain.get(bid) ?? [];
      const lovableItems = bItems.filter((i) => i.target_tool === "Lovable");
      const stale = lovableItems.filter(
        (i) =>
          ["ready_for_automation", "queued"].includes(i.automation_status) &&
          nowTs - new Date(i.updated_at).getTime() > ONE_DAY,
      );
      const withOutput = bItems.filter((i) => ((i.output_result ?? "").trim() !== ""));
      const noNext = withOutput.filter((i) => !(i.next_step_generated ?? false));
      const errs = bItems.filter(
        (i) => i.automation_status === "failed" || i.approval_status === "blocked",
      );
      const recentLog = bLogs.some((l) => new Date(l.created_at).getTime() >= sevenDaysAgo);

      const checks: AuditCheck[] = [
        {
          key: "roadmap",
          label: "Roadmap presente",
          state: bRoadmap.length > 0 ? "ok" : "warning",
          detail: `${bRoadmap.length} item`,
          suggestion: bRoadmap.length === 0 ? "Crea o importa la roadmap del progetto" : undefined,
        },
        {
          key: "prompts",
          label: "Prompt Lovable generati",
          state: lovableItems.length > 0 ? "ok" : "warning",
          detail: `${lovableItems.length} prompt`,
          suggestion: lovableItems.length === 0 ? "Genera un prompt Lovable dal roadmap item aperto" : undefined,
        },
        {
          key: "stale",
          label: "Prompt pronti ma non eseguiti",
          state: stale.length > 0 ? "warning" : "ok",
          detail: stale.length > 0 ? `${stale.length} fermi da >24h` : "Nessuno",
          suggestion: stale.length > 0 ? "Esegui i prompt in coda o archiviali" : undefined,
        },
        {
          key: "results",
          label: "Risultati salvati",
          state: withOutput.length > 0 ? "ok" : "warning",
          detail: `${withOutput.length} risultati`,
          suggestion: withOutput.length === 0 ? "Salva il risultato di un'esecuzione manuale" : undefined,
        },
        {
          key: "next",
          label: "Risultati senza prossimo step",
          state: noNext.length > 0 ? "warning" : "ok",
          detail: noNext.length > 0 ? `${noNext.length} senza next step` : "OK",
          suggestion: noNext.length > 0 ? "Genera prossimo step dal risultato" : undefined,
        },
        {
          key: "errors",
          label: "Errori o blocchi",
          state: errs.length > 0 ? "alert" : "ok",
          detail: errs.length > 0 ? `${errs.length} item` : "Nessuno",
          suggestion: errs.length > 0 ? "Risolvi item falliti o bloccati prima di proseguire" : undefined,
        },
        {
          key: "logs",
          label: "Log recenti (7 giorni)",
          state: recentLog ? "ok" : "warning",
          detail: recentLog ? "Presenti" : "Assenti",
          suggestion: !recentLog ? "Esegui un'azione per generare log recenti" : undefined,
        },
      ];

      let overall: AuditState = "ok";
      if (checks.some((c) => c.state === "alert")) overall = "alert";
      else if (checks.some((c) => c.state === "warning")) overall = "warning";

      const firstSugg = checks.find((c) => c.state === overall && c.suggestion)?.suggestion;
      const finalSuggestion = overall === "ok" ? "Ciclo operativo pronto" : (firstSugg ?? "Verifica i check evidenziati");

      return { brain, checks, overall, finalSuggestion };
    })
    .sort((a, b) => {
      const o: AuditState[] = ["alert", "warning", "ok"];
      return o.indexOf(a.overall) - o.indexOf(b.overall);
    });

  const AUDIT_META: Record<AuditState, { label: string; cls: string }> = {
    ok: { label: "OK", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
    warning: { label: "Warning", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    alert: { label: "Alert", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  };




  const savePromptMut = useMutation({
    mutationFn: async ({ brain, roadmap, prompt }: { brain: Brain; roadmap: RoadmapItem; prompt: string }) => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error("Utente non autenticato");
      const userId = userData.user.id;
      const execInstr = `Inviare il prompt a Lovable, attendere la modifica, verificare build/console/navigazione, poi salvare il risultato in Clipboard AI.`;
      const expected = `Implementazione del roadmap item "${roadmap.title}" senza regressioni, build pulita, nessun errore TS o console.`;
      const success = `- Build pulita\n- Nessun errore TypeScript\n- Nessun errore console\n- Funzionalità "${roadmap.title}" attiva e usabile\n- Nessuna regressione su auth/RLS/route esistenti`;

      const insertPayload = {
        user_id: userId,
        title: `Prompt Lovable — ${roadmap.title}`,
        content: prompt,
        content_type: "prompt",
        target_tool: "Lovable",
        source_tool: "Project Loop",
        brain_id: brain.id,
        status: "active",
        approval_status: "pending",
        automation_status: "ready_for_automation",
        human_review_required: true,
        execution_instructions: execInstr,
        expected_output: expected,
        success_criteria: success,
        risk_level: "medium",
        requires_approval: true,
        next_action: "Inviare a Lovable e salvare il risultato",
      };

      const { data: inserted, error: insErr } = await supabase
        .from("clipboard_items")
        .insert(insertPayload as never)
        .select("id")
        .single();
      if (insErr) throw insErr;

      const { error: logErr } = await supabase.from("clipboard_execution_logs").insert({
        clipboard_item_id: inserted.id,
        action: "generated_prompt_from_roadmap_item",
        notes: "Prompt Lovable generato da Project Loop",
        new_status: "ready_for_automation",
        user_id: userId,
        metadata: {
          roadmap_item_id: roadmap.id,
          brain_id: brain.id,
          target_tool: "Lovable",
        },
      } as never);
      if (logErr) throw logErr;
      return inserted.id;
    },
    onSuccess: () => {
      toast.success("Prompt salvato in Clipboard AI");
      setGenTarget(null);
      setGeneratedPrompt("");
      queryClient.invalidateQueries({ queryKey: ["project-loop"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const nextStepMut = useMutation({
    mutationFn: async ({
      item,
      suggestion,
      actionType,
      priority,
      riskLevel,
    }: {
      item: ClipboardItem;
      suggestion: string;
      actionType: "roadmap" | "task" | "prompt";
      priority: string;
      riskLevel: string;
    }) => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error("Utente non autenticato");
      const userId = userData.user.id;
      const title = suggestion.trim().slice(0, 200);
      if (!title) throw new Error("Inserisci un prossimo step");

      let newId: string | null = null;
      if (actionType === "roadmap") {
        const { data: ins, error } = await supabase
          .from("roadmap_items")
          .insert({
            user_id: userId,
            brain_id: item.brain_id,
            title,
            description: `Generato da output di "${item.title}".\n\nOutput originale:\n${item.output_result}`,
            status: "open",
            priority,
          } as never)
          .select("id")
          .single();
        if (error) throw error;
        newId = ins.id;
      } else if (actionType === "task") {
        const { data: ins, error } = await supabase
          .from("tasks")
          .insert({
            user_id: userId,
            brain_id: item.brain_id,
            title,
            description: `Generato da output di "${item.title}".\n\nOutput originale:\n${item.output_result}`,
            status: "todo",
            priority,
          } as never)
          .select("id")
          .single();
        if (error) throw error;
        newId = ins.id;
      } else {
        const promptContent = `REGOLE DI SICUREZZA OBBLIGATORIE:
- Non modificare auth, login, signup, sessioni, RLS o policy Supabase esistenti.
- Non toccare dati, tabelle o logiche non richieste.
- Non rompere route, sidebar, link, layout globale o componenti condivisi.
- Modifica solo i file strettamente necessari.
- Mantieni compatibilità TypeScript.

CONTESTO:
- Origine: output dell'item "${item.title}"
- Output precedente:
${item.output_result}

PROSSIMO STEP:
${suggestion}

OUTPUT ATTESO:
- Implementazione del prossimo step senza regressioni.

CRITERI DI SUCCESSO:
- Build pulita, nessun errore TypeScript, nessun errore console.
- Funzionalità richiesta visibile e usabile.`;
        const { data: ins, error } = await supabase
          .from("clipboard_items")
          .insert({
            user_id: userId,
            brain_id: item.brain_id,
            title: `Prompt Lovable — ${title}`,
            content: promptContent,
            content_type: "prompt",
            target_tool: "Lovable",
            source_tool: "Project Loop",
            status: "active",
            approval_status: "pending",
            automation_status: "ready_for_automation",
            human_review_required: true,
            execution_instructions:
              "Inviare a Lovable, verificare build/console/navigazione, salvare il risultato.",
            expected_output: "Implementazione del prossimo step senza regressioni.",
            success_criteria:
              "Build pulita · No errori TS · No errori console · Funzionalità attiva",
            risk_level: riskLevel,
            requires_approval: true,
            next_action: "Inviare a Lovable e salvare il risultato",
          } as never)
          .select("id")
          .single();
        if (error) throw error;
        newId = ins.id;
      }

      const { error: logErr } = await supabase.from("clipboard_execution_logs").insert({
        clipboard_item_id: item.id,
        action: "generated_next_step_from_result",
        notes: `Generato ${actionType} da output_result`,
        user_id: userId,
        metadata: {
          source_clipboard_item_id: item.id,
          action_type: actionType,
          brain_id: item.brain_id,
          new_record_id: newId,
        },
      } as never);
      if (logErr) throw logErr;

      const { error: flagErr } = await supabase
        .from("clipboard_items")
        .update({ next_step_generated: true } as never)
        .eq("id", item.id);
      if (flagErr) throw flagErr;

      return { newId, actionType };
    },
    onSuccess: ({ actionType }) => {
      const label =
        actionType === "roadmap"
          ? "Roadmap item creato"
          : actionType === "task"
          ? "Task creato"
          : "Prompt Lovable creato";
      toast.success(label);
      setNextStepItem(null);
      queryClient.invalidateQueries({ queryKey: ["project-loop"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveResultMut = useMutation({
    mutationFn: async ({ item, result }: { item: ClipboardItem; result: string }) => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error("Utente non autenticato");
      const userId = userData.user.id;
      const trimmed = result.trim();
      if (!trimmed) throw new Error("Inserisci il risultato Lovable");
      const { error: upErr } = await supabase
        .from("clipboard_items")
        .update({
          output_result: trimmed,
          automation_status: "completed",
          next_step_generated: false,
          next_action: "Rielaborare il risultato e generare il prossimo prompt",
        } as never)
        .eq("id", item.id);
      if (upErr) throw upErr;
      const { error: logErr } = await supabase.from("clipboard_execution_logs").insert({
        clipboard_item_id: item.id,
        action: "saved_lovable_result",
        notes: "Risultato Lovable salvato dal Project Loop",
        previous_status: item.automation_status,
        new_status: "completed",
        user_id: userId,
        metadata: { brain_id: item.brain_id },
      } as never);
      if (logErr) throw logErr;
    },
    onSuccess: () => {
      toast.success("Risultato Lovable salvato nel Project Loop");
      setSaveResultItem(null);
      setSaveResultText("");
      queryClient.invalidateQueries({ queryKey: ["project-loop"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markSentMut = useMutation({
    mutationFn: async (item: ClipboardItem) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error: upErr } = await supabase
        .from("clipboard_items")
        .update({ automation_status: "inviato_manualmente" } as never)
        .eq("id", item.id);
      if (upErr) throw upErr;
      await supabase.from("clipboard_execution_logs").insert({
        clipboard_item_id: item.id,
        action: "marked_sent_manually",
        previous_status: item.automation_status,
        new_status: "inviato_manualmente",
        notes: "Segnato come inviato manualmente",
        user_id: userData.user?.id,
        metadata: { brain_id: item.brain_id },
      } as never);
    },
    onSuccess: () => {
      toast.success("Prompt segnato come inviato");
      queryClient.invalidateQueries({ queryKey: ["project-loop"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNextStep(i: ClipboardItem) {
    setNextStepItem(i);
    setNextStepForm({
      suggestion: suggestNextStep(i.output_result),
      actionType: "roadmap",
      priority: "medium",
      riskLevel: "medium",
    });
  }

  function openSaveResult(i: ClipboardItem) {
    setSaveResultItem(i);
    setSaveResultText("");
  }

  function copyPrompt(content: string) {
    copyText(content, "Prompt copiato. Ora puoi incollarlo in Lovable.");
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Caricamento…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BrainCircuit className="h-6 w-6" /> Project Loop
          </h1>
          <p className="text-sm text-muted-foreground">
            Ciclo operativo Brain Hub: Idea → Roadmap → Prompt → Lovable → Risultato → Nuovo prompt.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/clipboard-ai">
              <ExternalLink className="mr-2 h-4 w-4" /> Apri Clipboard AI
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/automation-control">
              <Gauge className="mr-2 h-4 w-4" /> Apri Automation Control
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-7">
        <StatCard label="Progetti attivi" value={activeBrainIds.size} icon={Rocket} />
        <StatCard label="Progetti da attenzionare" value={needsAttentionCount} icon={HeartPulse} />
        <StatCard label="Roadmap aperti" value={openRoadmap} icon={ListChecks} />
        <StatCard label="Pronti per Lovable" value={readyForLovable} icon={Workflow} />
        <StatCard label="Prompt in coda" value={queuedLovable} icon={Clock} />
        <StatCard label="Da rielaborare" value={toReprocess} icon={AlertTriangle} />
        <StatCard label="Risultati salvati" value={recentSavedOutputs} icon={CheckCircle2} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartPulse className="h-4 w-4" /> Project Health
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {healthRows.length === 0 && (
            <div className="text-sm text-muted-foreground">Nessun progetto disponibile.</div>
          )}
          {healthRows.map((h) => {
            const meta = HEALTH_META[h.status];
            return (
              <div key={h.brain.id} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: h.brain.color ?? "var(--neon-violet)" }}
                    />
                    <span className="font-medium truncate">{h.brain.name}</span>
                    <Badge variant="outline" className={`text-[10px] ${meta.cls}`}>{meta.label}</Badge>
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/progetti/$brainId" params={{ brainId: h.brain.id }}>
                      <ExternalLink className="mr-1 h-3 w-3" /> Apri progetto
                    </Link>
                  </Button>
                </div>
                <div className="mt-2 grid gap-2 text-xs md:grid-cols-3 lg:grid-cols-6">
                  <div>
                    <div className="text-muted-foreground">Ultimo log</div>
                    <div className="truncate">
                      {h.lastLog ? new Date(h.lastLog.created_at).toLocaleString() : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Roadmap aperti</div>
                    <div>{h.openRoadmapCount}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Task aperti</div>
                    <div>{h.openTasksCount}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Prompt pronti</div>
                    <div>{h.readyPrompts}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Item falliti</div>
                    <div className={h.failedItems > 0 ? "text-rose-300 font-medium" : ""}>{h.failedItems}</div>
                  </div>
                  <div className="md:col-span-3 lg:col-span-1">
                    <div className="text-muted-foreground">Suggerimento</div>
                    <div className="truncate" title={meta.suggestion}>{meta.suggestion}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" /> Project Loop Audit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {auditRows.length === 0 && (
            <div className="text-sm text-muted-foreground">Nessun progetto disponibile.</div>
          )}
          {auditRows.map((a) => {
            const meta = AUDIT_META[a.overall];
            return (
              <div key={a.brain.id} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: a.brain.color ?? "var(--neon-violet)" }}
                    />
                    <span className="font-medium truncate">{a.brain.name}</span>
                    <Badge variant="outline" className={`text-[10px] ${meta.cls}`}>{meta.label}</Badge>
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/progetti/$brainId" params={{ brainId: a.brain.id }}>
                      <ExternalLink className="mr-1 h-3 w-3" /> Apri progetto
                    </Link>
                  </Button>
                </div>
                <div className="mt-2 grid gap-1.5 text-xs md:grid-cols-2">
                  {a.checks.map((c) => {
                    const cm = AUDIT_META[c.state];
                    const Icon = c.state === "ok" ? CheckCircle2 : c.state === "alert" ? AlertTriangle : Clock;
                    return (
                      <div key={c.key} className="flex items-start gap-2 rounded border border-border/40 px-2 py-1.5">
                        <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${c.state === "ok" ? "text-emerald-300" : c.state === "alert" ? "text-rose-300" : "text-amber-300"}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{c.label}</span>
                            <Badge variant="outline" className={`text-[9px] ${cm.cls}`}>{c.detail ?? cm.label}</Badge>
                          </div>
                          {c.suggestion && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">{c.suggestion}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 text-xs">
                  <span className="text-muted-foreground">Suggerimento finale: </span>
                  <span className="font-medium">{a.finalSuggestion}</span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>



      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4" /> Active Project Loop
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {activeRows.length === 0 && (
            <div className="text-sm text-muted-foreground">Nessun progetto attivo.</div>
          )}
          {activeRows.map(({ brain, lastRoadmap, lastPrompt, lastOutput, nextAction, loopState }) => {
            const stateMeta = LOOP_STATE_META[loopState];
            const renderCta = () => {
              if (loopState === "roadmap_missing") {
                return (
                  <Button asChild size="sm" variant="default" className="h-7 text-[11px]">
                    <Link to="/roadmap"><ListChecks className="mr-1 h-3 w-3" /> Crea roadmap iniziale</Link>
                  </Button>
                );
              }
              if (loopState === "prompt_missing") {
                return (
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      if (!lastRoadmap) return;
                      setGenTarget({ brain, roadmap: lastRoadmap });
                      setGeneratedPrompt(buildLovablePrompt(brain, lastRoadmap));
                    }}
                  >
                    <Wand2 className="mr-1 h-3 w-3" /> Genera Prompt Lovable
                  </Button>
                );
              }
              if (loopState === "prompt_ready") {
                return (
                  <>
                    <Button asChild size="sm" variant="default" className="h-7 text-[11px]">
                      <Link to="/clipboard-ai"><ExternalLink className="mr-1 h-3 w-3" /> Apri prompt</Link>
                    </Button>
                    {lastPrompt && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => copyPrompt(lastPrompt.content)}>
                        <Copy className="mr-1 h-3 w-3" /> Copia prompt
                      </Button>
                    )}
                    {lastPrompt && (
                      <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => openSaveResult(lastPrompt)}>
                        <Sparkles className="mr-1 h-3 w-3" /> Salva risultato Lovable
                      </Button>
                    )}
                  </>
                );
              }
              if (loopState === "waiting_result") {
                return lastPrompt ? (
                  <Button size="sm" variant="default" className="h-7 text-[11px]" onClick={() => openSaveResult(lastPrompt)}>
                    <Sparkles className="mr-1 h-3 w-3" /> Salva risultato Lovable
                  </Button>
                ) : null;
              }
              if (loopState === "result_to_review") {
                return lastPrompt ? (
                  <Button size="sm" variant="default" className="h-7 text-[11px]" onClick={() => openNextStep(lastPrompt)}>
                    <Wand2 className="mr-1 h-3 w-3" /> Rielabora risultato
                  </Button>
                ) : null;
              }
              if (loopState === "next_prompt_needed") {
                return lastPrompt ? (
                  <Button size="sm" variant="default" className="h-7 text-[11px]" onClick={() => openNextStep(lastPrompt)}>
                    <Wand2 className="mr-1 h-3 w-3" /> Genera prossimo prompt
                  </Button>
                ) : null;
              }
              return null;
            };
            return (
              <div key={brain.id} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: brain.color ?? "var(--neon-violet)" }}
                    />
                    <span className="font-medium">{brain.name}</span>
                    <Badge variant="outline" className={`text-[10px] ${stateMeta.cls}`}>{stateMeta.label}</Badge>
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/progetti/$brainId" params={{ brainId: brain.id }}>
                      <ExternalLink className="mr-1 h-3 w-3" /> Apri progetto
                    </Link>
                  </Button>
                </div>
                <div className="mt-2 grid gap-2 text-xs md:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <div className="text-muted-foreground">Roadmap aperto</div>
                    <div className="truncate">{lastRoadmap?.title ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Ultimo prompt</div>
                    <div className="truncate">{lastPrompt?.title ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Ultimo output</div>
                    <div className="truncate">
                      {lastOutput ? (lastOutput.output_result.slice(0, 60) + (lastOutput.output_result.length > 60 ? "…" : "")) : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Prossimo step</div>
                    <div className="truncate">{nextAction ?? "—"}</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">{renderCta()}</div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" /> Lovable Work Queue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {lovableQueue.length === 0 && (
            <div className="text-sm text-muted-foreground">Nessun item Lovable in coda.</div>
          )}
          {lovableQueue.map((i) => {
            const brain = i.brain_id ? brainsById.get(i.brain_id) : null;
            const ptl = i.project_tool_link_id ? projectLinkById.get(i.project_tool_link_id) : null;
            return (
              <div key={i.id} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{i.title || "(senza titolo)"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {brain?.name ?? "—"}
                      {ptl ? ` · ${ptl.tool_name}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {i.risk_level && (
                      <Badge variant="outline" className="text-[10px]">
                        risk: {i.risk_level}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">{i.approval_status}</Badge>
                    <Badge variant="default" className="text-[10px]">{i.automation_status}</Badge>
                    {i.next_step_generated && (
                      <Badge variant="outline" className="text-[10px]">
                        Prossimo step già generato
                      </Badge>
                    )}
                  </div>
                </div>
                {i.next_action && (
                  <div className="mt-1 text-xs text-muted-foreground">→ {i.next_action}</div>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => copyText(i.content, "Prompt copiato")}>
                    <Copy className="mr-1 h-3 w-3" /> Copia prompt
                  </Button>
                  {i.source_url && (
                    <Button asChild size="sm" variant="ghost">
                      <a href={i.source_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-1 h-3 w-3" /> Apri source
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" /> Results To Process
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {resultsToProcess.length === 0 && (
            <div className="text-sm text-muted-foreground">Nessun risultato da rielaborare.</div>
          )}
          {resultsToProcess.map((i) => {
            const brain = i.brain_id ? brainsById.get(i.brain_id) : null;
            return (
              <div key={i.id} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{i.title || "(senza titolo)"}</div>
                    <div className="text-xs text-muted-foreground">{brain?.name ?? "—"}</div>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{i.status}</Badge>
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{i.output_result}</div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => copyText(i.output_result, "Output copiato")}>
                    <Copy className="mr-1 h-3 w-3" /> Copia output
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setNextStepItem(i);
                      setNextStepForm({
                        suggestion: suggestNextStep(i.output_result),
                        actionType: "roadmap",
                        priority: "medium",
                        riskLevel: "medium",
                      });
                    }}
                  >
                    <Wand2 className="mr-1 h-3 w-3" /> Genera prossimo step
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/clipboard-ai">
                      <ExternalLink className="mr-1 h-3 w-3" /> Apri in Clipboard AI
                    </Link>
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" /> Recent Project Logs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {recentLogs.length === 0 && (
            <div className="text-sm text-muted-foreground">Nessun log recente.</div>
          )}
          {recentLogs.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 p-2 text-xs">
              <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span>
              <Badge variant="outline" className="text-[10px]">{l.action}</Badge>
              <span className="font-mono text-[10px] text-muted-foreground">
                {l.clipboard_item_id.slice(0, 8)}
              </span>
              {(l.previous_status || l.new_status) && (
                <span className="text-muted-foreground">
                  {l.previous_status ?? "—"} → {l.new_status ?? "—"}
                </span>
              )}
              {l.notes && <span className="truncate text-muted-foreground">· {l.notes}</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog
        open={!!genTarget}
        onOpenChange={(o) => {
          if (!o) {
            setGenTarget(null);
            setGeneratedPrompt("");
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4" /> Anteprima Prompt Lovable
            </DialogTitle>
          </DialogHeader>
          {genTarget && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">Progetto / Brain</div>
                  <div className="font-medium">{genTarget.brain.name}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Roadmap item</div>
                  <div className="font-medium truncate">{genTarget.roadmap.title}</div>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Prompt generato</div>
                <Textarea
                  value={generatedPrompt}
                  onChange={(e) => setGeneratedPrompt(e.target.value)}
                  className="min-h-[260px] font-mono text-xs"
                />
              </div>
              <div className="grid gap-2 text-xs md:grid-cols-2">
                <div className="rounded-md border border-border/60 p-2">
                  <div className="text-muted-foreground">Execution instructions</div>
                  <div>Inviare il prompt a Lovable, attendere la modifica, verificare build/console/navigazione, poi salvare il risultato.</div>
                </div>
                <div className="rounded-md border border-border/60 p-2">
                  <div className="text-muted-foreground">Expected output</div>
                  <div>Implementazione del roadmap item senza regressioni, build pulita.</div>
                </div>
                <div className="rounded-md border border-border/60 p-2 md:col-span-2">
                  <div className="text-muted-foreground">Success criteria</div>
                  <div>Build pulita · No errori TS · No errori console · Funzionalità attiva · Nessuna regressione auth/RLS.</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-[10px]">
                <Badge variant="outline">risk: medium</Badge>
                <Badge variant="secondary">requires_approval: true</Badge>
                <Badge variant="default">target: Lovable</Badge>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setGenTarget(null);
                setGeneratedPrompt("");
              }}
            >
              Chiudi
            </Button>
            <Button variant="outline" onClick={() => copyText(generatedPrompt, "Prompt copiato")}>
              <Copy className="mr-1 h-3 w-3" /> Copia prompt
            </Button>
            <Button
              disabled={!genTarget || !generatedPrompt.trim() || savePromptMut.isPending}
              onClick={() => {
                if (!genTarget) return;
                savePromptMut.mutate({
                  brain: genTarget.brain,
                  roadmap: genTarget.roadmap,
                  prompt: generatedPrompt,
                });
              }}
            >
              <Sparkles className="mr-1 h-3 w-3" />
              {savePromptMut.isPending ? "Salvataggio…" : "Salva in Clipboard AI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!nextStepItem}
        onOpenChange={(o) => {
          if (!o) setNextStepItem(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4" /> Genera prossimo step
            </DialogTitle>
          </DialogHeader>
          {nextStepItem && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">Item</div>
                  <div className="truncate font-medium">{nextStepItem.title || "(senza titolo)"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Progetto / Brain</div>
                  <div className="truncate font-medium">
                    {nextStepItem.brain_id ? brainsById.get(nextStepItem.brain_id)?.name ?? "—" : "—"}
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Output originale</div>
                <div className="max-h-32 overflow-y-auto rounded-md border border-border/60 p-2 text-xs whitespace-pre-wrap">
                  {nextStepItem.output_result}
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Prossimo step suggerito</div>
                <Textarea
                  value={nextStepForm.suggestion}
                  onChange={(e) => setNextStepForm((f) => ({ ...f, suggestion: e.target.value }))}
                  className="min-h-[100px] text-xs"
                />
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Tipo azione</div>
                  <Select
                    value={nextStepForm.actionType}
                    onValueChange={(v) =>
                      setNextStepForm((f) => ({ ...f, actionType: v as "roadmap" | "task" | "prompt" }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="roadmap">Crea roadmap item</SelectItem>
                      <SelectItem value="task">Crea task</SelectItem>
                      <SelectItem value="prompt">Crea nuovo prompt Lovable</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Priority</div>
                  <Input
                    value={nextStepForm.priority}
                    onChange={(e) => setNextStepForm((f) => ({ ...f, priority: e.target.value }))}
                    placeholder="low / medium / high"
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Risk level</div>
                  <Input
                    value={nextStepForm.riskLevel}
                    onChange={(e) => setNextStepForm((f) => ({ ...f, riskLevel: e.target.value }))}
                    placeholder="low / medium / high"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setNextStepItem(null)}>
              Chiudi
            </Button>
            <Button
              disabled={!nextStepItem || !nextStepForm.suggestion.trim() || nextStepMut.isPending}
              onClick={() => {
                if (!nextStepItem) return;
                nextStepMut.mutate({
                  item: nextStepItem,
                  suggestion: nextStepForm.suggestion,
                  actionType: nextStepForm.actionType,
                  priority: nextStepForm.priority || "medium",
                  riskLevel: nextStepForm.riskLevel || "medium",
                });
              }}
            >
              <Sparkles className="mr-1 h-3 w-3" />
              {nextStepMut.isPending ? "Salvataggio…" : "Salva prossimo step"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
