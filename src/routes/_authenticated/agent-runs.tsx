import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Play, Save, FileText, ShieldCheck, Sparkles, Copy, ClipboardPaste, FolderOpen, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { listAgents, type Agent } from "@/lib/agent-center";
import {
  listAgentRuns,
  createAgentRun,
  buildAgentRunContext,
  generateAgentRunPreview,
  completeAgentRun,
  createActionFromAgentRun,
  createReviewFromAgentRun,
  createCodeHandoffFromAgentRun,
  archiveAgentRun,
  getAgentRun,
  CONTEXT_SOURCE_LABEL,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  buildAgentAiPrompt,
  copyAgentAiPrompt,
  saveAgentAiResult,
  createActionFromAgentAiResult,
  createReviewFromAgentAiResult,
  createNextActionFromAgentAiResult,
  AI_PROVIDER_LABEL,
  AI_HANDOFF_STATUS_LABEL,
  type AgentRunLog,
  type AgentRunPreview,
  type ContextSourceKey,
  type AiProvider,
  type AiHandoffStatus,
} from "@/lib/agent-runs";

type Search = { brain?: string; agent?: string; run?: string };

export const Route = createFileRoute("/_authenticated/agent-runs")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
    agent: typeof s.agent === "string" ? s.agent : undefined,
    run: typeof s.run === "string" ? s.run : undefined,
  }),
  component: AgentRunsPage,
});

const ALL_SOURCES: ContextSourceKey[] = [
  "company_os",
  "company_blueprint",
  "action_queue",
  "result_review",
  "learning_loop",
  "loop_qa",
  "drive_knowledge",
  "calendar_upcoming",
  "calendar_suggestions",
  "github",
  "code_handoffs",
  "n8n_workflows",
  "telegram_approvals",
  "master_snapshot",
];

const DEFAULT_SOURCES: ContextSourceKey[] = [
  "action_queue",
  "result_review",
  "loop_qa",
];

function AgentRunsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/agent-runs" });
  const qc = useQueryClient();

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("brains")
        .select("id,name")
        .order("name");
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const [brainId, setBrainId] = useState<string | null>(search.brain ?? null);
  useEffect(() => {
    if (search.brain) setBrainId(search.brain);
  }, [search.brain]);

  const { data: agents = [] } = useQuery({
    queryKey: ["agents-for-runs", brainId],
    queryFn: () => listAgents(brainId),
  });

  const [agentId, setAgentId] = useState<string>(search.agent ?? "");
  useEffect(() => {
    if (search.agent) setAgentId(search.agent);
    else if (!agentId && agents[0]) setAgentId(agents[0].id);
  }, [search.agent, agents, agentId]);

  const selectedAgent: Agent | undefined = agents.find((a) => a.id === agentId);

  const [objective, setObjective] = useState("");
  const [sources, setSources] =
    useState<ContextSourceKey[]>(DEFAULT_SOURCES);
  const [preview, setPreview] = useState<AgentRunPreview | null>(null);
  const [currentRun, setCurrentRun] = useState<AgentRunLog | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleSource = (k: ContextSourceKey) => {
    setSources((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  };

  const { data: runs = [] } = useQuery({
    queryKey: ["agent-runs", brainId],
    queryFn: () => listAgentRuns(brainId),
  });

  const {
    data: openedRun,
    isLoading: openedRunLoading,
    error: openedRunError,
  } = useQuery({
    queryKey: ["agent-run-detail", search.run],
    queryFn: () => getAgentRun(search.run as string),
    enabled: !!search.run,
  });

  useEffect(() => {
    if (openedRun) setCurrentRun(openedRun);
  }, [openedRun]);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["agent-runs", brainId] });
    if (search.run) {
      await qc.invalidateQueries({ queryKey: ["agent-run-detail", search.run] });
    }
  };

  async function handleGeneratePreview() {
    if (!agentId || !objective.trim()) {
      toast.error("Seleziona un agente e inserisci un obiettivo");
      return;
    }
    setBusy(true);
    try {
      const ctx = await buildAgentRunContext({
        brain_id: brainId,
        sources,
      });
      const p = await generateAgentRunPreview({
        agent_id: agentId,
        brain_id: brainId,
        objective: objective.trim(),
        context: ctx,
      });
      setPreview(p);
      toast.success("Preview generata");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore preview");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveRun() {
    if (!preview || !agentId) return;
    setBusy(true);
    try {
      const ctx = await buildAgentRunContext({
        brain_id: brainId,
        sources,
      });
      const run = await createAgentRun({
        agent_id: agentId,
        brain_id: brainId,
        objective: objective.trim(),
        input_context: { sources, collected: ctx.collected },
        risk_level: preview.suggested_action?.risk_level ?? "low",
      });
      const completed = await completeAgentRun(run.id, {
        summary: preview.summary,
        json: preview as unknown as Record<string, unknown>,
      });
      setCurrentRun(completed);
      await invalidate();
      toast.success("Run salvata");
      void navigate({
        search: (prev) => ({ ...prev, run: completed.id }),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore salvataggio");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAction() {
    if (!currentRun) {
      toast.error("Salva prima la run");
      return;
    }
    setBusy(true);
    try {
      const a = await createActionFromAgentRun(currentRun.id);
      setCurrentRun((r) =>
        r ? { ...r, suggested_action_id: a.id, run_status: "action_created" } : r,
      );
      await invalidate();
      toast.success("Action suggerita creata");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore action");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateReview() {
    if (!currentRun) {
      toast.error("Salva prima la run");
      return;
    }
    setBusy(true);
    try {
      const r = await createReviewFromAgentRun(currentRun.id);
      setCurrentRun((cur) =>
        cur ? { ...cur, result_review_item_id: r.id, run_status: "review_created" } : cur,
      );
      await invalidate();
      toast.success("Result Review creata");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore review");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateHandoff(engine: "codex" | "claude_code") {
    if (!currentRun) {
      toast.error("Salva prima la run");
      return;
    }
    setBusy(true);
    try {
      const h = await createCodeHandoffFromAgentRun(currentRun.id, engine);
      setCurrentRun((cur) =>
        cur
          ? {
              ...cur,
              code_handoff_id: h.handoff_id,
              run_status: "code_handoff_created",
            }
          : cur,
      );
      await invalidate();
      toast.success(`Code Handoff ${engine} creato`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore handoff");
    } finally {
      setBusy(false);
    }
  }

  const isDeveloper = selectedAgent?.role === "developer";

  return (
    <div className="container mx-auto space-y-6 py-6">
      <PageHeader
        title="Agent Run Console"
        subtitle="Lancia run manuali e controllate degli agenti configurati. Nessuna esecuzione autonoma, nessuna API esterna."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Configurazione run
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Brain</Label>
              <Select
                value={brainId ?? "__all"}
                onValueChange={(v) => setBrainId(v === "__all" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona brain" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Tutti i brain</SelectItem>
                  {brains.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Agente</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona agente" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} — {a.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {agents.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nessun agente disponibile —{" "}
                  <Link to="/agent-center" className="underline">
                    apri Agent Center
                  </Link>
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Obiettivo</Label>
            <Textarea
              rows={3}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Es: rivedere action aperte e suggerire prossimi step"
            />
          </div>

          <div className="space-y-2">
            <Label>Contesti da includere</Label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {ALL_SOURCES.map((k) => (
                <label
                  key={k}
                  className="flex items-center gap-2 text-sm rounded border px-2 py-1.5"
                >
                  <Checkbox
                    checked={sources.includes(k)}
                    onCheckedChange={() => toggleSource(k)}
                  />
                  <span className="truncate">{CONTEXT_SOURCE_LABEL[k]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleGeneratePreview} disabled={busy}>
              <Play className="mr-1 h-4 w-4" /> Genera preview
            </Button>
            <Button
              variant="outline"
              onClick={handleSaveRun}
              disabled={busy || !preview}
            >
              <Save className="mr-1 h-4 w-4" /> Salva run
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview output</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm font-medium">{preview.summary}</div>
            <ul className="list-disc pl-5 text-sm space-y-1">
              {preview.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            {preview.suggested_action && (
              <div className="rounded border p-3 text-sm">
                <div className="font-medium">
                  Action suggerita: {preview.suggested_action.title}
                </div>
                <div className="text-muted-foreground">
                  {preview.suggested_action.description}
                </div>
              </div>
            )}
            {preview.notes.length > 0 && (
              <div className="text-xs text-amber-600 space-y-0.5">
                {preview.notes.map((n, i) => (
                  <div key={i}>⚠ {n}</div>
                ))}
              </div>
            )}
            {currentRun && (
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCreateAction}
                  disabled={busy || !!currentRun.suggested_action_id}
                >
                  Crea action
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCreateReview}
                  disabled={busy || !!currentRun.result_review_item_id}
                >
                  Crea Result Review
                </Button>
                {isDeveloper && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCreateHandoff("codex")}
                      disabled={busy || !!currentRun.code_handoff_id}
                    >
                      Crea Code Handoff (Codex)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCreateHandoff("claude_code")}
                      disabled={busy || !!currentRun.code_handoff_id}
                    >
                      Crea Code Handoff (Claude Code)
                    </Button>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {currentRun && (
        <AiHandoffCard
          run={currentRun}
          onRunUpdated={(r) => {
            setCurrentRun(r);
            void invalidate();
          }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Storico run ({runs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nessuna run ancora. Configura un agente e genera una preview.
            </p>
          )}
          <div className="space-y-2">
            {runs.map((r) => (
              <RunRow
                key={r.id}
                run={r}
                agentName={
                  agents.find((a) => a.id === r.agent_id)?.name ?? r.agent_id
                }
                onArchive={async () => {
                  await archiveAgentRun(r.id);
                  await invalidate();
                }}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RunRow({
  run,
  agentName,
  onArchive,
}: {
  run: AgentRunLog;
  agentName: string;
  onArchive: () => Promise<void>;
}) {
  const tone =
    RUN_STATUS_TONE[run.run_status as keyof typeof RUN_STATUS_TONE] ??
    "bg-muted text-muted-foreground border-muted";
  const label =
    RUN_STATUS_LABEL[run.run_status as keyof typeof RUN_STATUS_LABEL] ??
    run.run_status;
  return (
    <div className="flex items-start justify-between gap-3 rounded border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={tone}>
            {label}
          </Badge>
          <span className="text-xs text-muted-foreground">{agentName}</span>
        </div>
        <div className="text-sm font-medium truncate mt-1">{run.objective}</div>
        {run.output_summary && (
          <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
            {run.output_summary}
          </div>
        )}
        <div className="text-[11px] text-muted-foreground mt-1 flex gap-3 flex-wrap">
          <span>{new Date(run.created_at).toLocaleString()}</span>
          {run.suggested_action_id && <span>• action ✓</span>}
          {run.result_review_item_id && <span>• review ✓</span>}
          {run.code_handoff_id && <span>• handoff ✓</span>}
        </div>
      </div>
      {run.run_status !== "archived" && (
        <Button size="sm" variant="ghost" onClick={onArchive}>
          Archivia
        </Button>
      )}
    </div>
  );
}

function AiHandoffCard({
  run,
  onRunUpdated,
}: {
  run: AgentRunLog;
  onRunUpdated: (r: AgentRunLog) => void;
}) {
  const [provider, setProvider] = useState<AiProvider>(
    (run.ai_provider as AiProvider | null) ?? "chatgpt",
  );
  const [promptText, setPromptText] = useState<string>(run.ai_prompt_text ?? "");
  const [resultText, setResultText] = useState<string>(run.ai_result_text ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPromptText(run.ai_prompt_text ?? "");
    setResultText(run.ai_result_text ?? "");
    if (run.ai_provider) setProvider(run.ai_provider as AiProvider);
  }, [run.id, run.ai_prompt_text, run.ai_result_text, run.ai_provider]);

  const status =
    (run.ai_handoff_status as AiHandoffStatus | null) ?? "not_started";

  async function refresh() {
    const { getAgentRun } = await import("@/lib/agent-runs");
    const fresh = await getAgentRun(run.id);
    onRunUpdated(fresh);
  }

  async function handleBuild() {
    setBusy(true);
    try {
      const { prompt } = await buildAgentAiPrompt(run.id, provider);
      setPromptText(prompt);
      await refresh();
      toast.success("Prompt AI generato");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore prompt");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!promptText) {
      toast.error("Genera prima il prompt");
      return;
    }
    setBusy(true);
    try {
      await navigator.clipboard.writeText(promptText);
      await copyAgentAiPrompt(run.id);
      await refresh();
      toast.success("Prompt copiato");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore copia");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveResult() {
    if (!resultText.trim()) {
      toast.error("Incolla un risultato AI");
      return;
    }
    setBusy(true);
    try {
      await saveAgentAiResult(run.id, resultText);
      await refresh();
      toast.success("Risultato AI salvato");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore salvataggio");
    } finally {
      setBusy(false);
    }
  }

  async function handleAction() {
    setBusy(true);
    try {
      await createActionFromAgentAiResult(run.id);
      await refresh();
      toast.success("Action creata");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore action");
    } finally {
      setBusy(false);
    }
  }

  async function handleReview() {
    setBusy(true);
    try {
      await createReviewFromAgentAiResult(run.id);
      await refresh();
      toast.success("Result Review creata");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore review");
    } finally {
      setBusy(false);
    }
  }

  async function handleNext() {
    setBusy(true);
    try {
      await createNextActionFromAgentAiResult(run.id);
      await refresh();
      toast.success("Next action creata");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore next");
    } finally {
      setBusy(false);
    }
  }

  const runMeta = (run.metadata as Record<string, unknown> | null) ?? {};
  const riskWarning = runMeta["ai_risk_warning"] === true;
  const originalRisk = String(runMeta["ai_original_risk_level"] ?? "");
  const agentMaxRisk = String(runMeta["ai_agent_max_risk_level"] ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> AI Handoff (manuale)
          </span>
          <Badge variant="outline">{AI_HANDOFF_STATUS_LABEL[status]}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {riskWarning && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
            <strong>Attenzione:</strong> il rischio reale stimato dell'azione
            ({originalRisk || "?"}) supera il livello massimo consentito per
            questo agente ({agentMaxRisk || "?"}). Richiede revisione manuale —
            nessuna esecuzione automatica.
          </div>
        )}
        <div className="grid gap-2 md:grid-cols-[200px_1fr] items-center">
          <Label>Provider AI</Label>
          <Select
            value={provider}
            onValueChange={(v) => setProvider(v as AiProvider)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AI_PROVIDER_LABEL) as AiProvider[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {AI_PROVIDER_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleBuild} disabled={busy}>
            <Sparkles className="mr-1 h-4 w-4" /> Genera prompt AI
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopy}
            disabled={busy || !promptText}
          >
            <Copy className="mr-1 h-4 w-4" /> Copia prompt
          </Button>
        </div>

        {promptText && (
          <div className="space-y-1">
            <Label className="text-xs">Preview prompt</Label>
            <Textarea
              readOnly
              rows={10}
              value={promptText}
              className="font-mono text-xs"
            />
          </div>
        )}

        <div className="space-y-1 pt-2 border-t">
          <Label className="text-xs flex items-center gap-1">
            <ClipboardPaste className="h-3 w-3" /> Incolla risultato AI
          </Label>
          <Textarea
            rows={8}
            value={resultText}
            onChange={(e) => setResultText(e.target.value)}
            placeholder="Incolla qui il testo prodotto da ChatGPT / Claude / Gemini…"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={handleSaveResult} disabled={busy}>
              <Save className="mr-1 h-4 w-4" /> Salva risultato
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleAction}
              disabled={busy || !run.ai_result_text}
            >
              Crea action dal risultato
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleReview}
              disabled={busy || !run.ai_result_text}
            >
              Crea Result Review
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleNext}
              disabled={busy || !run.ai_result_text}
            >
              <ArrowRight className="mr-1 h-4 w-4" /> Crea Next Action
            </Button>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Nessuna API AI chiamata. Brain Hub prepara solo il prompt — usi
          l'AI esterna manualmente e incolli il risultato qui.
        </p>
      </CardContent>
    </Card>
  );
}
