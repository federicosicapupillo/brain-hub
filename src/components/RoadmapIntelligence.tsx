import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  Link2,
  ListChecks,
  Map as MapIcon,
  Target,
  Zap,
} from "lucide-react";
import type { LogEventType } from "@/lib/automation-run";
import { enqueueFromCta } from "@/lib/action-queue-cta";
import { useNavigate } from "@tanstack/react-router";

type Brain = { id: string; name: string };

type RoadmapItem = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  phase: string | null;
  order_index: number;
  brain_id: string | null;
  metadata: Record<string, unknown> | null;
};

type PEL = {
  id: string;
  created_at: string;
  updated_at: string;
  brain_id: string | null;
  roadmap_item_id: string | null;
  task_id: string | null;
  project_id: string | null;
  status: string;
  prompt_title: string;
  result_type: string | null;
  result_text: string | null;
  parent_execution_log_id: string | null;
  generated_prompt_text: string | null;
};

type SuggestedStatus =
  | "not_started"
  | "in_progress"
  | "needs_review"
  | "needs_fix"
  | "blocked"
  | "completed";

type SuggestedAction =
  | "generate_first_prompt"
  | "save_or_verify_result"
  | "send_next_prompt"
  | "generate_fix_prompt"
  | "verify_and_mark"
  | "advance_to_next"
  | "wait";

type Suggestion = {
  status: SuggestedStatus;
  action: SuggestedAction;
  confidence: number; // 0..1
  reason: string;
};

const STATUS_LABELS: Record<SuggestedStatus, string> = {
  not_started: "Non iniziato",
  in_progress: "In corso",
  needs_review: "Da verificare",
  needs_fix: "Da correggere",
  blocked: "Bloccato",
  completed: "Completato",
};

const STATUS_COLORS: Record<SuggestedStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/15 text-blue-600",
  needs_review: "bg-amber-500/15 text-amber-700",
  needs_fix: "bg-orange-500/15 text-orange-700",
  blocked: "bg-red-500/15 text-red-700",
  completed: "bg-green-500/15 text-green-700",
};

const ACTION_LABELS: Record<SuggestedAction, string> = {
  generate_first_prompt: "Genera primo prompt operativo",
  save_or_verify_result: "Salva o verifica il risultato Lovable",
  send_next_prompt: "Invia il next prompt già generato",
  generate_fix_prompt: "Genera prompt di correzione",
  verify_and_mark: "Verifica risultato e segna completato/fallito",
  advance_to_next: "Passa al prossimo roadmap item",
  wait: "Attendi: nessuna azione richiesta",
};

const PEL_STATUS_LABELS: Record<string, string> = {
  draft: "Bozza",
  prepared: "Pronto",
  inserted_in_lovable: "Inserito in Lovable",
  sent_to_lovable_confirmed: "Inviato",
  result_pending: "In attesa risultato",
  result_saved: "Risultato salvato",
  completed: "Completato",
  failed: "Fallito",
};

function computeSuggestion(logs: PEL[]): Suggestion {
  if (logs.length === 0) {
    return {
      status: "not_started",
      action: "generate_first_prompt",
      confidence: 0.9,
      reason: "Nessun prompt collegato a questa roadmap item.",
    };
  }
  const hasFailed = logs.some((l) => l.status === "failed");
  const hasPending = logs.some((l) => l.status === "result_pending");
  const hasNextReady = logs.some(
    (l) =>
      (l.status === "draft" || l.status === "prepared") &&
      !!l.parent_execution_log_id,
  );
  const hasSavedNoComplete =
    logs.some((l) => l.status === "result_saved") &&
    !logs.some((l) => l.status === "completed");
  const allCompleted = logs.every((l) => l.status === "completed");

  if (hasFailed) {
    return {
      status: "needs_fix",
      action: "generate_fix_prompt",
      confidence: 0.85,
      reason: "Almeno un execution log è fallito.",
    };
  }
  if (hasPending) {
    return {
      status: "in_progress",
      action: "save_or_verify_result",
      confidence: 0.75,
      reason: "Ci sono prompt in attesa di risultato Lovable.",
    };
  }
  if (hasNextReady) {
    return {
      status: "in_progress",
      action: "send_next_prompt",
      confidence: 0.7,
      reason: "Esiste un next prompt pronto da inviare.",
    };
  }
  if (hasSavedNoComplete) {
    return {
      status: "needs_review",
      action: "verify_and_mark",
      confidence: 0.7,
      reason: "Risultato salvato ma non ancora confermato come completo.",
    };
  }
  if (allCompleted) {
    return {
      status: "completed",
      action: "advance_to_next",
      confidence: 0.9,
      reason: "Tutti i prompt collegati sono completati.",
    };
  }
  return {
    status: "in_progress",
    action: "wait",
    confidence: 0.5,
    reason: "Lavoro in corso, nessun problema rilevato.",
  };
}

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

const STALE_PENDING_MS = 1000 * 60 * 60 * 24; // 24h

export function RoadmapIntelligence({ brainId: brainIdProp }: { brainId?: string } = {}) {
  const qc = useQueryClient();
  const [brainIdState, setBrainId] = useState<string>("");
  const brainId = brainIdProp ?? brainIdState;
  const lockedBrain = !!brainIdProp;
  const [confirmCompleteId, setConfirmCompleteId] = useState<string | null>(null);
  const [linkDialogPEL, setLinkDialogPEL] = useState<PEL | null>(null);
  const [linkTargetRoadmap, setLinkTargetRoadmap] = useState<string>("");

  const { data: brains = [] } = useQuery<Brain[]>({
    queryKey: ["roadmap-intel-brains"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brains")
        .select("id,name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Brain[];
    },
  });

  const effectiveBrain = brainId || brains[0]?.id || "";

  const { data: roadmap = [] } = useQuery<RoadmapItem[]>({
    queryKey: ["roadmap-intel-items", effectiveBrain],
    enabled: !!effectiveBrain,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roadmap_items")
        .select(
          "id,title,description,status,priority,phase,order_index,brain_id,metadata",
        )
        .eq("brain_id", effectiveBrain)
        .order("order_index");
      if (error) throw error;
      return (data ?? []) as RoadmapItem[];
    },
  });

  const { data: logs = [] } = useQuery<PEL[]>({
    queryKey: ["roadmap-intel-pels", effectiveBrain],
    enabled: !!effectiveBrain,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_execution_logs")
        .select(
          "id,created_at,updated_at,brain_id,roadmap_item_id,task_id,project_id,status,prompt_title,result_type,result_text,parent_execution_log_id,generated_prompt_text",
        )
        .eq("brain_id", effectiveBrain)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PEL[];
    },
  });

  const logsByRoadmap = useMemo(() => {
    const m = new Map<string, PEL[]>();
    for (const l of logs) {
      if (!l.roadmap_item_id) continue;
      const arr = m.get(l.roadmap_item_id) ?? [];
      arr.push(l);
      m.set(l.roadmap_item_id, arr);
    }
    return m;
  }, [logs]);

  const unlinkedLogs = useMemo(
    () => logs.filter((l) => !l.roadmap_item_id),
    [logs],
  );

  const summary = useMemo(() => {
    const total = logs.length;
    const linked = logs.filter((l) => l.roadmap_item_id).length;
    const completed = logs.filter((l) => l.status === "completed").length;
    const failed = logs.filter((l) => l.status === "failed").length;
    const pending = logs.filter((l) => l.status === "result_pending").length;
    return { total, linked, unlinked: total - linked, completed, failed, pending };
  }, [logs]);

  const problems = useMemo(() => {
    const list: { id: string; kind: string; label: string; pel?: PEL; roadmap?: RoadmapItem }[] = [];
    for (const l of logs) {
      if (l.status === "failed") {
        list.push({ id: `failed-${l.id}`, kind: "failed", label: `Prompt fallito: ${l.prompt_title}`, pel: l });
      }
      if (
        l.status === "result_pending" &&
        Date.now() - new Date(l.updated_at).getTime() > STALE_PENDING_MS
      ) {
        list.push({ id: `stale-${l.id}`, kind: "stale_pending", label: `In attesa risultato da >24h: ${l.prompt_title}`, pel: l });
      }
      if (l.status === "completed" && !l.roadmap_item_id) {
        list.push({ id: `unlinked-done-${l.id}`, kind: "completed_unlinked", label: `Completato ma senza roadmap: ${l.prompt_title}`, pel: l });
      }
      if (
        (l.status === "draft" || l.status === "prepared") &&
        l.parent_execution_log_id
      ) {
        list.push({ id: `next-not-sent-${l.id}`, kind: "next_not_sent", label: `Next prompt non inviato: ${l.prompt_title}`, pel: l });
      }
      if (l.status === "sent_to_lovable_confirmed" && !l.result_text) {
        list.push({ id: `no-result-${l.id}`, kind: "no_result", label: `Inviato senza risultato salvato: ${l.prompt_title}`, pel: l });
      }
    }
    for (const r of roadmap) {
      const linked = logsByRoadmap.get(r.id) ?? [];
      if (linked.length === 0 && r.status !== "completed") {
        list.push({ id: `roadmap-empty-${r.id}`, kind: "roadmap_empty", label: `Roadmap item senza prompt: ${r.title}`, roadmap: r });
      }
    }
    return list;
  }, [logs, roadmap, logsByRoadmap]);

  const nextStep = useMemo(() => {
    if (roadmap.length === 0) {
      return {
        label: "Crea o importa una roadmap per questo progetto",
        cta: "Vai a Roadmap",
      };
    }
    const failed = logs.find((l) => l.status === "failed");
    if (failed) {
      return { label: `Correggi il prompt fallito: ${failed.prompt_title}`, cta: "Genera fix prompt" };
    }
    const pending = logs.find((l) => l.status === "result_pending");
    if (pending) {
      return { label: `Salva/verifica risultato: ${pending.prompt_title}`, cta: "Salva risultato" };
    }
    const nextReady = logs.find(
      (l) => (l.status === "draft" || l.status === "prepared") && l.parent_execution_log_id,
    );
    if (nextReady) {
      return { label: `Invia il next prompt: ${nextReady.prompt_title}`, cta: "Invia next prompt" };
    }
    const emptyActive = roadmap.find(
      (r) => (r.status === "in_progress" || r.status === "active") && (logsByRoadmap.get(r.id) ?? []).length === 0,
    );
    if (emptyActive) {
      return { label: `Genera primo prompt per: ${emptyActive.title}`, cta: "Genera primo prompt" };
    }
    const allDone = roadmap.every((r) => {
      const ll = logsByRoadmap.get(r.id) ?? [];
      return ll.length > 0 && ll.every((x) => x.status === "completed");
    });
    if (allDone) {
      return { label: "Tutti gli item attivi sono completati: passa al prossimo roadmap item", cta: "Avanza roadmap" };
    }
    return { label: "Nessuna azione urgente: continua il ciclo normalmente", cta: "Ok" };
  }, [logs, roadmap, logsByRoadmap]);

  async function linkLogToRoadmap(pel: PEL, roadmapItemId: string) {
    const { error } = await supabase
      .from("prompt_execution_logs")
      .update({ roadmap_item_id: roadmapItemId } as never)
      .eq("id", pel.id);
    if (error) {
      toast.error(`Errore collegamento: ${error.message}`);
      return;
    }
    await logEvent("roadmap_item_execution_log_linked", "Execution log collegato a roadmap item", {
      execution_log_id: pel.id,
      roadmap_item_id: roadmapItemId,
      brain_id: pel.brain_id,
    });
    toast.success("Execution log collegato alla roadmap item");
    qc.invalidateQueries({ queryKey: ["roadmap-intel-pels"] });
    setLinkDialogPEL(null);
    setLinkTargetRoadmap("");
  }

  async function markRoadmapCompleted(item: RoadmapItem) {
    try {
      const { duplicated } = await enqueueFromCta({
        source: "roadmap_intelligence",
        source_block: "RoadmapIntelligence",
        source_cta: "Segna completata",
        action_type: "mark_roadmap_completed",
        title: `Segna roadmap completata: ${item.title}`,
        risk_level: "high",
        brain_id: item.brain_id,
        roadmap_item_id: item.id,
        extra: { suggested_reason: "manual_mark_completed" },
      });
      toast.success(
        duplicated
          ? "Azione già in coda — duplicato evitato"
          : "Azione aggiunta alla Action Queue (high risk: richiede approvazione)",
        {
          action: {
            label: "Apri Action Queue",
            onClick: () => void navigate({ to: "/action-queue" }),
          },
        },
      );
      setConfirmCompleteId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  async function markRoadmapNeedsFix(item: RoadmapItem) {
    try {
      const { duplicated } = await enqueueFromCta({
        source: "roadmap_intelligence",
        source_block: "RoadmapIntelligence",
        source_cta: "Segna da correggere",
        action_type: "mark_roadmap_needs_fix",
        title: `Segna roadmap da correggere: ${item.title}`,
        risk_level: "medium",
        brain_id: item.brain_id,
        roadmap_item_id: item.id,
        extra: { suggested_reason: "manual_mark_needs_fix" },
      });
      toast.success(
        duplicated
          ? "Azione già in coda — duplicato evitato"
          : "Azione aggiunta alla Action Queue",
        {
          action: {
            label: "Apri Action Queue",
            onClick: () => void navigate({ to: "/action-queue" }),
          },
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  async function persistSuggestion(item: RoadmapItem, s: Suggestion) {
    const prev = (item.metadata ?? {}) as Record<string, unknown>;
    const meta = {
      ...prev,
      roadmap_intelligence: {
        suggested_status: s.status,
        suggested_next_action: s.action,
        confidence_level: s.confidence,
        reason: s.reason,
        computed_at: new Date().toISOString(),
      },
    };
    const { error } = await supabase
      .from("roadmap_items")
      .update({ metadata: meta } as never)
      .eq("id", item.id);
    if (error) {
      toast.error(`Errore salvataggio: ${error.message}`);
      return;
    }
    await logEvent("roadmap_intelligence_status_suggested", `Suggerimento salvato: ${item.title}`, {
      roadmap_item_id: item.id,
      brain_id: item.brain_id,
      suggested_status: s.status,
      suggested_next_action: s.action,
      confidence_level: s.confidence,
    });
    toast.success("Suggerimento salvato in metadata");
    qc.invalidateQueries({ queryKey: ["roadmap-intel-items"] });
  }

  if (brains.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="h-4 w-4" /> Roadmap Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nessun brain disponibile. Crea un brain per attivare Roadmap Intelligence.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="h-4 w-4" /> Roadmap Intelligence
            <Badge variant="outline" className="ml-2 text-[10px]">v0.5</Badge>
          </CardTitle>
          {lockedBrain ? (
            <Badge variant="secondary" className="text-[10px]">
              {brains.find((b) => b.id === effectiveBrain)?.name ?? "Brain corrente"}
            </Badge>
          ) : (
            <Select value={effectiveBrain} onValueChange={setBrainId}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Seleziona brain" />
              </SelectTrigger>
              <SelectContent>
                {brains.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          {[
            { label: "Prompt totali", value: summary.total },
            { label: "Collegati", value: summary.linked },
            { label: "Scollegati", value: summary.unlinked },
            { label: "Completati", value: summary.completed },
            { label: "Falliti", value: summary.failed },
            { label: "In attesa", value: summary.pending },
          ].map((s) => (
            <div key={s.label} className="rounded border p-2 text-center">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-lg font-semibold">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Next step */}
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Target className="h-4 w-4 text-primary" /> Prossimo step consigliato
          </div>
          <p className="mt-1 text-sm">{nextStep.label}</p>
          <Badge variant="secondary" className="mt-2">{nextStep.cta}</Badge>
        </div>

        {/* Problems */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> Problemi da risolvere ({problems.length})
          </div>
          {problems.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nessun problema rilevato.</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-auto">
              {problems.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-[10px]">{p.kind}</Badge>
                    <span className="truncate">{p.label}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {p.pel && p.kind === "completed_unlinked" && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                        onClick={() => { setLinkDialogPEL(p.pel!); setLinkTargetRoadmap(""); }}>
                        Collega a roadmap
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                      onClick={async () => {
                        await logEvent("roadmap_intelligence_issue_ignored", `Problema ignorato: ${p.label}`, {
                          kind: p.kind, execution_log_id: p.pel?.id, roadmap_item_id: p.roadmap?.id,
                        });
                        toast.message("Ignorato");
                      }}>
                      Ignora
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Roadmap items list */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <MapIcon className="h-4 w-4" /> Roadmap items ({roadmap.length})
          </div>
          {roadmap.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nessun roadmap item per questo brain.</p>
          ) : (
            <div className="space-y-2">
              {roadmap.map((item) => {
                const ll = logsByRoadmap.get(item.id) ?? [];
                const completed = ll.filter((l) => l.status === "completed").length;
                const failed = ll.filter((l) => l.status === "failed").length;
                const pending = ll.filter((l) => l.status === "result_pending").length;
                const lastResult = ll.find((l) => l.result_text);
                const lastNext = ll.find((l) => l.generated_prompt_text);
                const suggestion = computeSuggestion(ll);
                return (
                  <div key={item.id} className="rounded border p-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                          <span className="truncate">{item.title}</span>
                          <Badge variant="outline" className="text-[10px]">{item.status}</Badge>
                          <Badge className={`text-[10px] ${STATUS_COLORS[suggestion.status]}`}>
                            Suggerito: {STATUS_LABELS[suggestion.status]}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            confidence {Math.round(suggestion.confidence * 100)}%
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Prompt: {ll.length} · Completati: {completed} · Falliti: {failed} · In attesa: {pending}
                        </div>
                        <div className="mt-1 text-xs">
                          <span className="text-muted-foreground">Azione:</span> {ACTION_LABELS[suggestion.action]}
                        </div>
                        {lastResult && (
                          <div className="mt-1 text-xs truncate">
                            <span className="text-muted-foreground">Ultimo risultato:</span> {lastResult.result_type ?? "?"} — {lastResult.prompt_title}
                          </div>
                        )}
                        {lastNext && (
                          <div className="mt-1 text-xs truncate">
                            <span className="text-muted-foreground">Ultimo next prompt:</span> {lastNext.prompt_title}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" className="h-7 text-[11px]"
                          onClick={() => persistSuggestion(item, suggestion)}>
                          <Zap className="h-3 w-3 mr-1" /> Salva suggerimento
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px]"
                          onClick={() => setConfirmCompleteId(item.id)}>
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Segna completata
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px]"
                          onClick={() => markRoadmapNeedsFix(item)}>
                          Segna da correggere
                        </Button>
                      </div>
                    </div>
                    {ll.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-muted-foreground cursor-pointer">
                          Vedi {ll.length} prompt collegati
                        </summary>
                        <div className="mt-1 space-y-1">
                          {ll.map((l) => (
                            <div key={l.id} className="flex items-center justify-between text-xs border-l-2 pl-2">
                              <span className="truncate">{l.prompt_title}</span>
                              <Badge variant="outline" className="text-[10px]">
                                {PEL_STATUS_LABELS[l.status] ?? l.status}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Unlinked logs */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Link2 className="h-4 w-4" /> Execution log scollegati ({unlinkedLogs.length})
          </div>
          {unlinkedLogs.length === 0 ? (
            <p className="text-xs text-muted-foreground">Tutti i prompt sono collegati a una roadmap item.</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-auto">
              {unlinkedLogs.slice(0, 20).map((l) => (
                <div key={l.id} className="flex items-center justify-between text-xs rounded border px-2 py-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-[10px]">Scollegato</Badge>
                    <span className="truncate">{l.prompt_title}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {PEL_STATUS_LABELS[l.status] ?? l.status}
                    </Badge>
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                    onClick={() => { setLinkDialogPEL(l); setLinkTargetRoadmap(""); }}>
                    Collega a roadmap
                  </Button>
                </div>
              ))}
              {unlinkedLogs.length > 20 && (
                <p className="text-[11px] text-muted-foreground">… altri {unlinkedLogs.length - 20} non mostrati</p>
              )}
            </div>
          )}
        </div>
      </CardContent>

      {/* Confirm complete dialog */}
      <Dialog open={!!confirmCompleteId} onOpenChange={(o) => !o && setConfirmCompleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confermi completamento roadmap item?</DialogTitle>
            <DialogDescription>
              Brain Hub suggerisce, tu confermi. Questa azione cambia lo stato della roadmap item a "completed".
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmCompleteId(null)}>Annulla</Button>
            <Button
              onClick={() => {
                const it = roadmap.find((r) => r.id === confirmCompleteId);
                if (it) markRoadmapCompleted(it);
              }}
            >
              Sì, segna completata
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link to roadmap dialog */}
      <Dialog open={!!linkDialogPEL} onOpenChange={(o) => !o && setLinkDialogPEL(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Collega prompt a roadmap item</DialogTitle>
            <DialogDescription>
              {linkDialogPEL?.prompt_title}
            </DialogDescription>
          </DialogHeader>
          <Select value={linkTargetRoadmap} onValueChange={setLinkTargetRoadmap}>
            <SelectTrigger>
              <SelectValue placeholder="Scegli un roadmap item" />
            </SelectTrigger>
            <SelectContent>
              {roadmap.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkDialogPEL(null)}>Annulla</Button>
            <Button
              disabled={!linkTargetRoadmap}
              onClick={() => linkDialogPEL && linkToRoadmapHandler()}
            >
              <ListChecks className="h-4 w-4 mr-1" /> Collega
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );

  function linkToRoadmapHandler() {
    if (linkDialogPEL && linkTargetRoadmap) {
      linkLogToRoadmap(linkDialogPEL, linkTargetRoadmap);
    }
  }
}
