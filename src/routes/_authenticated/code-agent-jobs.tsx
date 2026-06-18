import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { isSuspectRepositoryRecord } from "@/lib/github-repository-parse";
import {
  listCodeAgentJobs,
  getCodeAgentJob,
  markCodeAgentJobReady,
  getCodeAgentJobSummary,
  getCodeAgentAvailableActions,
  getCodeAgentNextStep,
  CODE_AGENT_ENGINE_REGISTRY,
  CODE_AGENT_JOB_TYPE_LABEL,
  CODE_AGENT_STATUS_LABEL,
  CODE_AGENT_STATUS_TONE,
  CODE_AGENT_RISK_TONE,
  type CodeAgentEngine,
  type CodeAgentJob,
  type CodeAgentJobStatus,
  type CodeAgentJobType,
  type CodeAgentRiskLevel,
} from "@/lib/code-agent-orchestrator";
import {
  approveCodeAgentJobFn,
  rejectCodeAgentJobFn,
  markCodeAgentJobSentManuallyFn,
  saveCodeAgentJobResultFn,
  createReviewFromCodeAgentJobFn,
  createNextActionFromCodeAgentJobFn,
  createMasterSnapshotDraftFromCodeAgentJobFn,
  syncCodeAgentJobApprovalStatusFn,
  syncPendingCodeAgentApprovalsFn,
  createCodeAgentJobFromBrowserFn,
  updateCodeAgentJobRepositoryFn,
} from "@/lib/code-agent-orchestrator.functions";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CheckSquare,
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  Info,
  ListChecks,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { Input } from "@/components/ui/input";

const QA_TEST_COMMAND_TEXT = `TEST QA Code Agent — non eseguire codice.

Obiettivo:
Verificare che il ciclo Code Agent QA funzioni correttamente.

Task richiesto:
Prepara un handoff manuale per controllare che la route /code-agent-qa sia read-only, mostri correttamente job bloccati, job incoerenti, lifecycle checklist e runner readiness.

Vincoli:
- Non eseguire codice.
- Non chiamare API Codex o Claude.
- Non fare commit.
- Non fare push.
- Non aprire PR.
- Non fare deploy.
- Non inviare Telegram automaticamente.
- Usare solo flusso manual-first.

Output atteso:
- Prompt/handoff manuale pronto.
- Nessuna esecuzione automatica.
- Job tracciabile nella QA Console.`;


export const Route = createFileRoute("/_authenticated/code-agent-jobs")({
  head: () => ({
    meta: [
      { title: "Code Agent Jobs — Brain Hub" },
      {
        name: "description",
        content:
          "Orchestratore controllato per Codex / Claude Code: classifica, approva, prepara prompt, salva risultato manuale. Nessuna esecuzione automatica.",
      },
    ],
  }),
  component: CodeAgentJobsPage,
});

const ENGINES = Object.keys(CODE_AGENT_ENGINE_REGISTRY) as CodeAgentEngine[];
const STATUS_BUCKETS = [
  { id: "all", label: "Tutti" },
  { id: "draft", label: "Draft" },
  { id: "repo_missing", label: "Repository mancante" },
  { id: "repo_ambiguous", label: "Repository ambiguo" },
  { id: "pending_approval", label: "In attesa approvazione" },
  { id: "ready", label: "Pronti da inviare" },
  { id: "sent_no_result", label: "Inviati senza risultato" },
  { id: "result_to_review", label: "Risultati da revisionare" },
  { id: "review_ready", label: "Review pronte" },
  { id: "completed", label: "Completati/revisionati" },
  { id: "failed", label: "Falliti/annullati" },
] as const;
type StatusBucketId = (typeof STATUS_BUCKETS)[number]["id"];
const RISKS: CodeAgentRiskLevel[] = ["low", "medium", "high"];

function jobMatchesBucket(j: CodeAgentJob, bucket: StatusBucketId): boolean {
  if (bucket === "all") return true;
  const resolution =
    ((j.metadata?.repository_resolution as { status?: string } | undefined)?.status) ?? null;
  switch (bucket) {
    case "draft":
      return j.status === "draft";
    case "repo_missing":
      return !j.repository_id && resolution === "missing";
    case "repo_ambiguous":
      return !j.repository_id && resolution === "ambiguous";
    case "pending_approval":
      return j.status === "pending_approval";
    case "ready":
      return j.status === "ready";
    case "sent_no_result":
      return (
        (j.status === "sent_manually" || j.status === "sent_to_engine") && !j.result_text
      );
    case "result_to_review":
      return j.status === "result_received" && !j.result_review_item_id;
    case "review_ready":
      return j.status === "review_ready";
    case "completed":
      return j.status === "reviewed" || j.status === "completed";
    case "failed":
      return j.status === "failed" || j.status === "cancelled" || j.status === "rejected";
    default:
      return true;
  }
}

function CodeAgentJobsPage() {
  const qc = useQueryClient();
  const [brainId, setBrainId] = useState<string | null>(null);
  const [engineFilter, setEngineFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [resultText, setResultText] = useState("");
  // v3.16.1 — manual create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [newCommandText, setNewCommandText] = useState("");
  const [newPreferredEngine, setNewPreferredEngine] = useState<CodeAgentEngine | "auto">("auto");
  const [newRiskHint, setNewRiskHint] = useState<CodeAgentRiskLevel | "auto">("auto");
  const [newRepositoryHint, setNewRepositoryHint] = useState("");
  const [newRepositoryId, setNewRepositoryId] = useState<string>("none");
  const [newNotes, setNewNotes] = useState("");
  const [newDeliveryPreference, setNewDeliveryPreference] = useState<"auto" | "manual" | "telegram">("auto");

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

  const { data: items = [] } = useQuery({
    queryKey: ["code-agent-jobs", brainId],
    queryFn: () => listCodeAgentJobs({ brainId }),
  });

  const { data: summary } = useQuery({
    queryKey: ["code-agent-jobs-summary", brainId],
    queryFn: () => getCodeAgentJobSummary(brainId),
  });

  const { data: repos = [] } = useQuery({
    queryKey: ["repo-registry-for-jobs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("github_repository_registry")
        .select("id,repository_name,repository_owner,repository_url,brain_id,project_id,default_branch,last_sync_at,connected_status")
        .is("archived_at" as never, null)
        .order("last_sync_at", { ascending: false });
      return (data ?? []) as Array<{
        id: string;
        repository_name: string | null;
        repository_owner: string | null;
        repository_url: string;
        brain_id: string | null;
        project_id: string | null;
        default_branch: string | null;
        last_sync_at: string | null;
        connected_status: string;
      }>;
    },
  });

  const filtered = useMemo(() => {
    return items.filter((j) => {
      if (engineFilter !== "all" && j.recommended_engine !== engineFilter) return false;
      if (!jobMatchesBucket(j, statusFilter as StatusBucketId)) return false;
      if (riskFilter !== "all" && j.risk_level !== riskFilter) return false;
      return true;
    });
  }, [items, engineFilter, statusFilter, riskFilter]);

  const { data: openDetail } = useQuery({
    queryKey: ["code-agent-job-detail", openId],
    queryFn: () => (openId ? getCodeAgentJob(openId) : null),
    enabled: !!openId,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["code-agent-jobs"] });
    void qc.invalidateQueries({ queryKey: ["code-agent-job-detail"] });
    void qc.invalidateQueries({ queryKey: ["code-agent-jobs-summary"] });
  };

  // v3.15.4 — Server function bindings (auth-enforced).
  const approveFn = useServerFn(approveCodeAgentJobFn);
  const rejectFn = useServerFn(rejectCodeAgentJobFn);
  const markSentFn = useServerFn(markCodeAgentJobSentManuallyFn);
  const saveResultFn = useServerFn(saveCodeAgentJobResultFn);
  const reviewFn = useServerFn(createReviewFromCodeAgentJobFn);
  const nextActionFn = useServerFn(createNextActionFromCodeAgentJobFn);
  const snapshotFn = useServerFn(createMasterSnapshotDraftFromCodeAgentJobFn);
  const syncOneFn = useServerFn(syncCodeAgentJobApprovalStatusFn);
  const syncBulkFn = useServerFn(syncPendingCodeAgentApprovalsFn);
  // v3.15.5 — creation + repository update behind authenticated server fns.
  const updateRepoFn = useServerFn(updateCodeAgentJobRepositoryFn);
  const createJobFn = useServerFn(createCodeAgentJobFromBrowserFn);

  function describeTransitionError(e: unknown): string {
    // Accept (a) native CodeAgentTransitionError-like instances (legacy local
    // calls), (b) Errors whose message is a SerializedCodeAgentError JSON
    // (server-function boundary), (c) anything else.
    let code: string | undefined;
    let msg = "Errore sconosciuto";
    if (e && typeof e === "object") {
      const anyE = e as { code?: unknown; message?: unknown; name?: unknown };
      if (typeof anyE.message === "string") msg = anyE.message;
      if (typeof anyE.code === "string") code = anyE.code;
      if (typeof anyE.message === "string" && anyE.message.startsWith("{")) {
        try {
          const parsed = JSON.parse(anyE.message) as {
            type?: string;
            code?: string;
            message?: string;
          };
          if (parsed && parsed.type === "code_agent_transition_error") {
            code = parsed.code ?? code;
            msg = parsed.message ?? msg;
          }
        } catch {
          /* not JSON */
        }
      }
    }
    switch (code) {
      case "code_agent_repository_required":
        return "Repository richiesto prima di procedere.";
      case "code_agent_approval_required":
        return "Serve approvazione prima dell'invio manuale.";
      case "code_agent_result_required":
        return "Serve un risultato prima di questa azione.";
      case "code_agent_terminal_status":
        return "Questo job è in uno stato finale.";
      case "code_agent_job_not_found":
        return "Job non trovato o non accessibile.";
      case "code_agent_user_scope_required":
        return "Devi essere autenticato.";
      case "code_agent_repository_not_found":
        return "Repository non trovato o non accessibile.";
      case "code_agent_repository_user_scope_required":
        return "Repository fuori dal tuo scope utente.";
      case "code_agent_repository_update_not_allowed":
        return "Non puoi modificare il repository di un job già inviato o completato.";
      case "code_agent_invalid_creation_input":
        return "Dati insufficienti per creare il job.";
      case "code_agent_transition_not_allowed":
        return msg;
      default:
        // Don't leak stack/payload — generic message for unknown errors.
        return msg && msg.length < 240 ? msg : "Operazione non riuscita.";
    }
  }

  const handleApprove = async (j: CodeAgentJob) => {
    try {
      await approveFn({ data: { jobId: j.id } });
      toast.success("Job approvato — pronto per handoff (nessuna esecuzione)");
      refresh();
    } catch (e) {
      toast.error(describeTransitionError(e));
      refresh();
    }
  };

  const handleReject = async (j: CodeAgentJob) => {
    try {
      await rejectFn({ data: { jobId: j.id, reason: null } });
      toast.success("Job rifiutato");
      refresh();
    } catch (e) {
      toast.error(describeTransitionError(e));
      refresh();
    }
  };

  const handleSyncApproval = async (j: CodeAgentJob) => {
    try {
      const r = await syncOneFn({ data: { jobId: j.id } });
      if (r.skipped) {
        toast.message(`Sync saltato · ${r.skip_reason ?? "stato non sincronizzabile"}`);
      } else {
        toast.success(`Sync · status=${r.status}`);
      }
      refresh();
    } catch (e) {
      toast.error(describeTransitionError(e));
      refresh();
    }
  };

  const handleBulkSync = async () => {
    try {
      const r = await syncBulkFn({ data: { brainId } });
      const errPart = r.errors.length > 0 ? `, ${r.errors.length} errori` : "";
      const skipPart = r.skipped > 0 ? `, ${r.skipped} saltati` : "";
      toast.success(
        `Sync · ${r.checked} controllati, ${r.approved} approvati, ${r.rejected} rifiutati, ${r.unchanged} invariati${skipPart}${errPart}`,
      );
      if (r.errors.length > 0) {
        const sample = r.errors
          .slice(0, 2)
          .map((x: { code: string }) => x.code)
          .join(", ");
        toast.error(`Errori bulk sync: ${sample}${r.errors.length > 2 ? "…" : ""}`);
      }
      refresh();
    } catch (e) {
      toast.error(describeTransitionError(e));
    }
  };

  const handleSetRepo = async (jobId: string, repositoryId: string) => {
    try {
      await updateRepoFn({ data: { jobId, repositoryId } });
      toast.success("Repository aggiornato sul job");
      refresh();
    } catch (e) {
      toast.error(describeTransitionError(e));
      refresh();
    }
  };

  const handleCopy = async (j: CodeAgentJob) => {
    try {
      await navigator.clipboard.writeText(j.prompt_text ?? "");
      toast.success("Prompt copiato");
    } catch {
      toast.error("Impossibile copiare");
    }
  };

  const handleSentManually = async (j: CodeAgentJob, engine: CodeAgentEngine) => {
    try {
      await markSentFn({ data: { jobId: j.id, engine } });
      toast.success(`Segnato inviato manualmente a ${CODE_AGENT_ENGINE_REGISTRY[engine].label}`);
      refresh();
    } catch (e) {
      toast.error(describeTransitionError(e)); refresh();
    }
  };

  // Keep legacy bindings reachable.
  void markCodeAgentJobReady;

  const resetCreateForm = () => {
    setNewCommandText("");
    setNewPreferredEngine("auto");
    setNewRiskHint("auto");
    setNewRepositoryHint("");
    setNewRepositoryId("none");
    setNewNotes("");
    setNewDeliveryPreference("auto");
  };

  const handleCreateJob = async () => {
    const cmd = newCommandText.trim();
    if (!cmd) {
      toast.error("Inserisci il comando/obiettivo del job");
      return;
    }
    setCreateSubmitting(true);
    try {
      await createJobFn({
        data: {
          commandText: cmd,
          brainId: brainId ?? null,
          preferredEngine: newPreferredEngine === "auto" ? null : newPreferredEngine,
          riskHint: newRiskHint === "auto" ? null : newRiskHint,
          repositoryHint: newRepositoryHint.trim() ? newRepositoryHint.trim() : null,
          repositoryId: newRepositoryId !== "none" ? newRepositoryId : null,
          notes: newNotes.trim() ? newNotes.trim() : null,
          deliveryPreference:
            newDeliveryPreference === "auto" ? null : newDeliveryPreference,
          source: "browser",
        },
      });
      toast.success("Code Agent Job creato");
      setCreateOpen(false);
      resetCreateForm();
      refresh();
    } catch (e) {
      toast.error(describeTransitionError(e));
    } finally {
      setCreateSubmitting(false);
    }
  };


  const handleSaveResult = async () => {
    if (!openDetail) return;
    if (!resultText.trim()) {
      toast.error("Incolla il risultato prima di salvare");
      return;
    }
    try {
      await saveResultFn({ data: { jobId: openDetail.id, text: resultText.trim() } });
      toast.success("Risultato salvato");
      setResultText("");
      refresh();
    } catch (e) {
      toast.error(describeTransitionError(e)); refresh();
    }
  };

  const handleReview = async (j: CodeAgentJob) => {
    try {
      await reviewFn({ data: { jobId: j.id } });
      toast.success("Result Review creata");
      refresh();
    } catch (e) {
      toast.error(describeTransitionError(e)); refresh();
    }
  };

  const handleNext = async (j: CodeAgentJob) => {
    try {
      await nextActionFn({ data: { jobId: j.id } });
      toast.success("Next action creata");
      refresh();
    } catch (e) {
      toast.error(describeTransitionError(e)); refresh();
    }
  };

  const handleSnapshot = async (j: CodeAgentJob) => {
    try {
      const r = await snapshotFn({ data: { jobId: j.id } });
      if (r.draft_id) toast.success("Bozza Master Snapshot creata");
      else toast.error("Bozza non creata");
      refresh();
    } catch (e) {
      toast.error(describeTransitionError(e)); refresh();
    }
  };


  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Code Agent Jobs — Orchestratore Codex / Claude Code"
          subtitle="Manual-first. Brain Hub prepara il job, sceglie engine, stima il rischio e richiede approvazione. Nessuna esecuzione automatica, niente commit/push/merge/deploy."
        />
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus className="mr-1 h-4 w-4" /> Nuovo Code Agent Job
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Filtri
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <div>
            <Label className="text-xs">Brain</Label>
            <Select
              value={brainId ?? "all"}
              onValueChange={(v) => setBrainId(v === "all" ? null : v)}
            >
              <SelectTrigger><SelectValue placeholder="Tutti" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                {brains.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Engine</Label>
            <Select value={engineFilter} onValueChange={setEngineFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                {ENGINES.map((e) => (
                  <SelectItem key={e} value={e}>{CODE_AGENT_ENGINE_REGISTRY[e].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status / bucket</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_BUCKETS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Risk</Label>
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                {RISKS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {summary && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Tile label="Totali" value={summary.total} />
            <Tile label="Aperti" value={summary.open} />
            <Tile label="In attesa approvazione" value={summary.awaitingApproval} />
            <Tile label="Da revisionare" value={summary.awaitingReview} />
          </div>
          <div className="grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-9">
            <BucketTile label="Draft" value={summary.buckets.draft} />
            <BucketTile label="Repo mancante" value={summary.buckets.missing_repository} tone={summary.buckets.missing_repository > 0 ? "red" : undefined} />
            <BucketTile label="Repo ambiguo" value={summary.buckets.ambiguous_repository} tone={summary.buckets.ambiguous_repository > 0 ? "amber" : undefined} />
            <BucketTile label="In approvazione" value={summary.buckets.pending_approval} tone={summary.buckets.pending_approval > 0 ? "amber" : undefined} />
            <BucketTile label="Pronti per invio" value={summary.buckets.ready_to_send} />
            <BucketTile label="Inviati senza risultato" value={summary.buckets.sent_without_result} tone={summary.buckets.sent_without_result > 0 ? "amber" : undefined} />
            <BucketTile label="Risultato da review" value={summary.buckets.result_to_review} tone={summary.buckets.result_to_review > 0 ? "amber" : undefined} />
            <BucketTile label="Reviewed" value={summary.buckets.reviewed} />
            <BucketTile label="Failed/cancelled" value={summary.buckets.failed_or_cancelled} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => void handleBulkSync()}>
              <RefreshCw className="mr-1 h-3 w-3" /> Sync approval pending
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Jobs ({filtered.length})</span>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-3 w-3" /> Nuovo Code Agent Job
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/action-queue">
                  <ListChecks className="mr-1 h-3 w-3" /> Action Queue
                </Link>
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {filtered.length === 0 && (
            <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground space-y-3">
              <div>
                Nessun job ancora. Puoi crearne uno manualmente oppure chiedere a Jack di prepararlo.
              </div>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1 h-3 w-3" /> Nuovo Code Agent Job
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/code-agent-qa">
                    <ShieldCheck className="mr-1 h-3 w-3" /> Apri Code Agent QA
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/github-operational">
                    <GitBranch className="mr-1 h-3 w-3" /> GitHub Operational
                  </Link>
                </Button>
              </div>
            </div>
          )}
          {filtered.map((j) => (
            <div
              key={j.id}
              className="flex flex-col gap-2 rounded border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {CODE_AGENT_ENGINE_REGISTRY[j.recommended_engine as CodeAgentEngine]?.label ?? j.recommended_engine}
                  </Badge>
                  <Badge variant="outline" className={CODE_AGENT_STATUS_TONE[j.status as CodeAgentJobStatus] ?? ""}>
                    {CODE_AGENT_STATUS_LABEL[j.status as CodeAgentJobStatus] ?? j.status}
                  </Badge>
                  <Badge variant="outline" className={CODE_AGENT_RISK_TONE[j.risk_level as CodeAgentRiskLevel] ?? ""}>
                    risk: {j.risk_level}
                  </Badge>
                  <Badge variant="outline">
                    {CODE_AGENT_JOB_TYPE_LABEL[j.job_type as CodeAgentJobType] ?? j.job_type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(j.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="truncate text-sm">{j.command_text}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {j.status === "pending_approval" && j.approval_status === "pending" && (
                  <Button size="sm" variant="default" onClick={() => void handleApprove(j)}>
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Approva
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setOpenId(j.id)}>
                  Apri
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleCopy(j)}>
                  <Copy className="mr-1 h-3 w-3" /> Copia prompt
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!openId} onOpenChange={(v) => !v && (setOpenId(null), setResultText(""))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Code Agent Job</DialogTitle>
            <DialogDescription>
              Manual-first. Nessuna API Codex/Claude chiamata. Niente commit/push/PR automatici.
            </DialogDescription>
          </DialogHeader>
          {openDetail && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {CODE_AGENT_ENGINE_REGISTRY[openDetail.recommended_engine as CodeAgentEngine]?.label ?? openDetail.recommended_engine}
                </Badge>
                <Badge variant="outline" className={CODE_AGENT_STATUS_TONE[openDetail.status as CodeAgentJobStatus] ?? ""}>
                  {CODE_AGENT_STATUS_LABEL[openDetail.status as CodeAgentJobStatus] ?? openDetail.status}
                </Badge>
                <Badge variant="outline" className={CODE_AGENT_RISK_TONE[openDetail.risk_level as CodeAgentRiskLevel] ?? ""}>
                  risk: {openDetail.risk_level}
                </Badge>
                <Badge variant="outline">
                  mode: {openDetail.execution_mode}
                </Badge>
              </div>

              {/* Operating state box */}
              <OperatingStateBox job={openDetail} />

              {/* Repository resolution */}
              <RepoBlock
                job={openDetail}
                repos={repos}
                onSetRepo={(rid) => void handleSetRepo(openDetail.id, rid)}
              />

              {openDetail.telegram_approval_id && (
                <div className="rounded border bg-amber-500/5 p-2 text-xs">
                  Telegram approval collegata: <code>{openDetail.telegram_approval_id}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-2 h-6 text-xs"
                    onClick={() => void handleSyncApproval(openDetail)}
                    disabled={!getCodeAgentAvailableActions(openDetail).canSyncApproval}
                  >
                    Sync stato approvazione
                  </Button>
                </div>
              )}

              <div>
                <Label className="text-xs">Comando</Label>
                <div className="rounded border bg-muted/30 p-2 text-sm">{openDetail.command_text}</div>
              </div>

              <div>
                <Label className="text-xs">Prompt generato</Label>
                <Textarea readOnly value={openDetail.prompt_text ?? ""} className="h-64 font-mono text-xs" />
              </div>

              {(() => {
                const actions = getCodeAgentAvailableActions(openDetail);
                return (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={!actions.canApprove} onClick={() => void handleApprove(openDetail)}>
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Approva
                    </Button>
                    <Button size="sm" variant="destructive" disabled={!actions.canReject} onClick={() => void handleReject(openDetail)}>
                      Rifiuta
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void handleCopy(openDetail)}>
                      <Copy className="mr-1 h-3 w-3" /> Copia prompt Codex
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void handleCopy(openDetail)}>
                      <Copy className="mr-1 h-3 w-3" /> Copia prompt Claude Code
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!actions.canSendManually}
                      onClick={() => void handleSentManually(openDetail, "codex_cloud")}
                    >
                      <Send className="mr-1 h-3 w-3" /> Segna inviato a Codex
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!actions.canSendManually}
                      onClick={() => void handleSentManually(openDetail, "claude_code_cli")}
                    >
                      <Send className="mr-1 h-3 w-3" /> Segna inviato a Claude Code
                    </Button>
                  </div>
                );
              })()}

              <div>
                <Label className="text-xs">Incolla risultato</Label>
                <Textarea
                  value={openDetail.result_text ?? resultText}
                  onChange={(e) => setResultText(e.target.value)}
                  placeholder="Incolla qui il diff / output / log…"
                  className="h-40 font-mono text-xs"
                  disabled={!getCodeAgentAvailableActions(openDetail).canSaveResult}
                />
                {!openDetail.result_text && (
                  <Button
                    size="sm"
                    className="mt-2"
                    disabled={!getCodeAgentAvailableActions(openDetail).canSaveResult}
                    onClick={() => void handleSaveResult()}
                  >
                    Salva risultato
                  </Button>
                )}
              </div>

              {(() => {
                const actions = getCodeAgentAvailableActions(openDetail);
                if (!openDetail.result_text) return null;
                return (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={!actions.canCreateReview} onClick={() => void handleReview(openDetail)}>
                      <CheckSquare className="mr-1 h-3 w-3" /> Crea Result Review
                    </Button>
                    <Button size="sm" variant="outline" disabled={!actions.canCreateNextAction || !!openDetail.next_action_id} onClick={() => void handleNext(openDetail)}>
                      <ArrowRight className="mr-1 h-3 w-3" /> Crea Next Action
                    </Button>
                    <Button size="sm" variant="outline" disabled={!actions.canCreateSnapshot} onClick={() => void handleSnapshot(openDetail)}>
                      <FileText className="mr-1 h-3 w-3" /> Master Snapshot draft
                    </Button>
                    {openDetail.result_review_item_id && (
                      <Button asChild size="sm" variant="outline">
                        <Link to="/result-review">
                          <ExternalLink className="mr-1 h-3 w-3" /> Apri Result Review
                        </Link>
                      </Button>
                    )}
                  </div>
                );
              })()}

              {/* Safety box */}
              <SafetyBox />
            </div>
          )}
          <DialogFooter className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/action-queue">
                <ListChecks className="mr-1 h-3 w-3" /> Action Queue
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/github-operational">
                <GitBranch className="mr-1 h-3 w-3" /> GitHub Operational
              </Link>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setOpenId(null), setResultText(""))}>
              Chiudi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecentBlocksSection brainId={brainId} />

      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          if (createSubmitting) return;
          setCreateOpen(o);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> Nuovo Code Agent Job
            </DialogTitle>
            <DialogDescription>
              Manual-first. Brain Hub crea solo il job: nessuna esecuzione, nessun commit, nessun deploy, nessuna chiamata a Codex/Claude.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Comando / obiettivo *</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setNewCommandText(QA_TEST_COMMAND_TEXT)}
                  disabled={createSubmitting}
                >
                  Compila test QA
                </Button>
              </div>
              <Textarea
                rows={6}
                value={newCommandText}
                onChange={(e) => setNewCommandText(e.target.value)}
                placeholder='Es: "Correggi il bug X nel file Y e prepara handoff manuale"'
                disabled={createSubmitting}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-xs">Engine preferito</Label>
                <Select
                  value={newPreferredEngine}
                  onValueChange={(v) => setNewPreferredEngine(v as CodeAgentEngine | "auto")}
                  disabled={createSubmitting}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    {ENGINES.map((eng) => (
                      <SelectItem key={eng} value={eng}>
                        {CODE_AGENT_ENGINE_REGISTRY[eng]?.label ?? eng}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Rischio (hint)</Label>
                <Select
                  value={newRiskHint}
                  onValueChange={(v) => setNewRiskHint(v as CodeAgentRiskLevel | "auto")}
                  disabled={createSubmitting}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Delivery</Label>
                <Select
                  value={newDeliveryPreference}
                  onValueChange={(v) =>
                    setNewDeliveryPreference(v as "auto" | "manual" | "telegram")
                  }
                  disabled={createSubmitting}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="telegram">Telegram (approval)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Repository (registry)</Label>
              {(() => {
                const validRepos = repos.filter(
                  (r) => !isSuspectRepositoryRecord(r),
                );
                const suspectCount = repos.length - validRepos.length;
                if (validRepos.length === 0) {
                  return (
                    <div className="rounded border border-dashed p-2 text-xs text-muted-foreground space-y-1">
                      <div>Nessun repository registrato.</div>
                      {suspectCount > 0 && (
                        <div className="text-amber-600">
                          {suspectCount} repository da controllare in GitHub Operational.
                        </div>
                      )}
                      <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                        <Link to="/github-operational">
                          <GitBranch className="mr-1 h-3 w-3" /> Apri GitHub Operational
                        </Link>
                      </Button>
                    </div>
                  );
                }
                return (
                  <div className="space-y-1">
                    <Select
                      value={newRepositoryId}
                      onValueChange={setNewRepositoryId}
                      disabled={createSubmitting}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nessuno (auto / hint)</SelectItem>
                        {validRepos.map((r) => {
                          const name = r.repository_owner
                            ? `${r.repository_owner}/${r.repository_name ?? ""}`
                            : r.repository_name ?? r.repository_url;
                          return (
                            <SelectItem key={r.id} value={r.id}>
                              {name}
                              {r.default_branch ? ` · ${r.default_branch}` : ""}
                              {r.connected_status ? ` · ${r.connected_status}` : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {suspectCount > 0 && (
                      <div className="text-[11px] text-amber-600">
                        Alcuni repository sono da controllare in GitHub Operational.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <div>
              <Label className="text-xs">Repository hint (fallback testuale)</Label>
              <Input
                value={newRepositoryHint}
                onChange={(e) => setNewRepositoryHint(e.target.value)}
                placeholder="es: owner/repo oppure nome del progetto"
                disabled={createSubmitting}
              />
            </div>
            <div>
              <Label className="text-xs">Note (opzionali)</Label>
              <Textarea
                rows={3}
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Contesto, vincoli, link utili…"
                disabled={createSubmitting}
              />
            </div>
            <div className="rounded border border-dashed p-2 text-xs text-muted-foreground">
              Brain: <span className="font-mono">{brainId ?? "(tutti / non specificato)"}</span>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={createSubmitting}
            >
              Annulla
            </Button>
            <Button onClick={handleCreateJob} disabled={createSubmitting || !newCommandText.trim()}>
              {createSubmitting ? "Creazione…" : "Crea job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type BlockedEventRow = {
  created_at: string;
  event_data: Record<string, unknown> | null;
  job_id: string | null;
};

function RecentBlocksSection({ brainId }: { brainId: string | null }) {
  const { data: events = [] } = useQuery({
    queryKey: ["code-agent-recent-blocks", brainId],
    queryFn: async (): Promise<BlockedEventRow[]> => {
      const sinceIso = new Date(Date.now() - 24 * 3_600_000).toISOString();
      let q = supabase
        .from("code_agent_job_events")
        .select("created_at,event_data,job_id")
        .eq("event_type", "code_agent_transition_blocked")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(5);
      if (brainId) {
        const { data: jobs } = await supabase
          .from("code_agent_jobs")
          .select("id")
          .eq("brain_id", brainId);
        const ids = (jobs ?? []).map((r: { id: string }) => r.id);
        if (ids.length === 0) return [];
        q = q.in("job_id", ids);
      }
      const { data } = await q;
      return (data ?? []) as BlockedEventRow[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> Ultimi blocchi transizione (24h)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="rounded border border-dashed p-4 text-center text-sm text-muted-foreground">
            Nessun blocco recente.
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((e, i) => {
              const d = e.event_data ?? {};
              const reason = (d.reason as string | undefined) ?? "—";
              const action = (d.requested_action as string | undefined) ?? "—";
              const target = (d.target_status as string | undefined) ?? "—";
              const status = (d.current_status as string | undefined) ?? "—";
              const approval = (d.current_approval_status as string | undefined) ?? "—";
              const repo =
                (d.repository_resolution_status as string | undefined) ?? "—";
              const risk = (d.risk_level as string | undefined) ?? "—";
              return (
                <div
                  key={`${e.created_at}-${i}`}
                  className="rounded border bg-amber-500/5 p-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      action: {action} → {target}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      reason: {reason}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      risk: {risk}
                    </Badge>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    status: <code>{status}</code> · approval:{" "}
                    <code>{approval}</code> · repo: <code>{repo}</code>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


function Tile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function BucketTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "amber" | "red";
}) {
  const cls =
    tone === "red"
      ? "border-red-500/30 bg-red-500/5"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-border/60";
  return (
    <div className={`rounded border p-2 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function OperatingStateBox({ job }: { job: CodeAgentJob }) {
  const actions = getCodeAgentAvailableActions(job);
  const next = getCodeAgentNextStep(job);
  const resolution = (job.metadata?.repository_resolution as { status?: string } | undefined) ?? null;
  const repoStatus = resolution?.status ?? (job.repository_id ? "resolved" : "missing");
  return (
    <div className="rounded border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Info className="h-3.5 w-3.5" /> Stato operativo
      </div>
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div>
          <div className="text-muted-foreground">Stato</div>
          <div className="font-medium">{CODE_AGENT_STATUS_LABEL[job.status as CodeAgentJobStatus] ?? job.status}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Approval</div>
          <div className="font-medium">{job.approval_status}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Repository</div>
          <div className="font-medium">{repoStatus}</div>
        </div>
      </div>
      {next.code !== "idle" && next.code !== "terminal" && (
        <div className="rounded border bg-background/60 p-2 text-xs">
          <span className="font-medium">Prossimo step: </span>
          {next.message || next.label}
        </div>
      )}
      {actions.blocked.length > 0 && (
        <div className="space-y-1">
          {actions.blocked.map((b, i) => (
            <div key={i} className="flex items-start gap-1 text-[11px] text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                <code className="text-[10px]">{b.action}</code> — {b.reason}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1 text-[10px]">
        {actions.canApprove && <Badge variant="outline">approva</Badge>}
        {actions.canReject && <Badge variant="outline">rifiuta</Badge>}
        {actions.canSyncApproval && <Badge variant="outline">sync approval</Badge>}
        {actions.canSendManually && <Badge variant="outline">invio manuale</Badge>}
        {actions.canSaveResult && <Badge variant="outline">salva risultato</Badge>}
        {actions.canCreateReview && <Badge variant="outline">crea review</Badge>}
        {actions.canCreateSnapshot && <Badge variant="outline">snapshot draft</Badge>}
      </div>
    </div>
  );
}

function SafetyBox() {
  const checks: Array<{ label: string; ok: boolean }> = [
    { label: "Creazione browser: server function", ok: true },
    { label: "Creazione Jack: server function", ok: true },
    { label: "Repository update: server function", ok: true },
    { label: "Transizioni: server function", ok: true },
    { label: "Result/Review/Snapshot: server function", ok: true },
    { label: "Runner reale: non attivo", ok: true },
    { label: "Codex/Claude API: non attive", ok: true },
    { label: "Telegram automatico: non attivo", ok: true },
  ];
  return (
    <div className="space-y-2">
      <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-[11px]">
        <div className="mb-1 flex items-center gap-2 font-semibold text-emerald-700">
          <ShieldCheck className="h-3.5 w-3.5" /> Stato sicurezza Code Agent
        </div>
        <ul className="grid grid-cols-1 gap-0.5 pl-1 sm:grid-cols-2">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="h-3 w-3 shrink-0" /> <span>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded border border-dashed bg-background/50 p-3 text-[11px] text-muted-foreground">
        <div className="mb-1 flex items-center gap-2 font-semibold text-foreground">
          <ShieldOff className="h-3.5 w-3.5" /> Cosa Brain Hub non farà
        </div>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>Non esegue codice né apre terminale</li>
          <li>Non modifica file nel repository</li>
          <li>Non fa commit / push / merge / PR / deploy</li>
          <li>Non invia Telegram automaticamente</li>
          <li>Prepara solo prompt, stati, review e azioni controllate</li>
        </ul>
      </div>
    </div>
  );
}

function RepoBlock({
  job,
  repos,
  onSetRepo,
}: {
  job: CodeAgentJob;
  repos: Array<{
    id: string;
    repository_name: string | null;
    repository_owner: string | null;
    repository_url: string;
    brain_id: string | null;
    project_id: string | null;
    default_branch: string | null;
    last_sync_at: string | null;
    connected_status: string;
  }>;
  onSetRepo: (rid: string) => void;
}) {
  const resolution = (job.metadata?.repository_resolution as { status?: string; reason?: string } | undefined) ?? null;
  const status = resolution?.status ?? (job.repository_id ? "resolved" : "missing");
  const tone =
    status === "resolved"
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
      : status === "ambiguous"
        ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
        : "bg-red-500/10 text-red-600 border-red-500/30";
  const currentRepo = repos.find((r) => r.id === job.repository_id) ?? null;
  const isRecent =
    !!currentRepo &&
    (resolution as { candidate_source?: string } | null)?.candidate_source === "recent";
  // updateCodeAgentJobRepositoryFn rejects updates on terminal/sent jobs server-side.
  // Hide the selector locally to match the server contract.
  const terminalLike: ReadonlyArray<CodeAgentJobStatus> = [
    "sent_to_engine",
    "sent_manually",
    "result_received",
    "review_ready",
    "reviewed",
    "completed",
    "failed",
    "cancelled",
    "rejected",
  ];
  const canChangeRepo = !terminalLike.includes(job.status as CodeAgentJobStatus);
  return (
    <div className="rounded border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4" />
        <span className="text-xs font-medium">Repository</span>
        <Badge variant="outline" className={tone}>{status}</Badge>
      </div>
      {status === "missing" && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700">
          <AlertTriangle className="mr-1 inline h-3 w-3" /> Repository mancante — Brain Hub non invierà prompt tecnici finché il repository non è confermato.
        </div>
      )}
      {status === "ambiguous" && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700">
          <AlertTriangle className="mr-1 inline h-3 w-3" /> Più repository possibili — seleziona manualmente prima di approvare.
        </div>
      )}
      {currentRepo ? (
        <div className="space-y-0.5 text-xs">
          <div className="text-sm">
            <code>
              {currentRepo.repository_owner
                ? `${currentRepo.repository_owner}/${currentRepo.repository_name ?? ""}`
                : currentRepo.repository_name ?? currentRepo.repository_url}
            </code>
          </div>
          {currentRepo.default_branch && (
            <div className="text-muted-foreground">
              Default branch: <code>{currentRepo.default_branch}</code>
            </div>
          )}
          {currentRepo.last_sync_at && (
            <div className="text-muted-foreground">
              Ultimo sync: {new Date(currentRepo.last_sync_at).toLocaleString()}
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          {resolution?.reason ?? "Nessun repository risolto. Seleziona manualmente."}
        </div>
      )}
      {isRecent && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700">
          Risolto usando repository recente — verifica prima di inviare.
        </div>
      )}
      {canChangeRepo && repos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select onValueChange={(rid) => onSetRepo(rid)}>
            <SelectTrigger className="h-8 w-72 text-xs">
              <SelectValue
                placeholder={currentRepo ? "Cambia repository…" : "Scegli repository…"}
              />
            </SelectTrigger>
            <SelectContent>
              {repos.map((r) => {
                const name = r.repository_owner
                  ? `${r.repository_owner}/${r.repository_name ?? ""}`
                  : r.repository_name ?? r.repository_url;
                return (
                  <SelectItem key={r.id} value={r.id}>
                    {name}
                    {r.default_branch ? ` · ${r.default_branch}` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}
      {canChangeRepo && repos.length === 0 && (
        <div className="rounded border border-dashed p-2 text-xs text-muted-foreground">
          Nessun repository registrato. Collega o sincronizza un repository da GitHub Operational.
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
          <Link to="/github-operational">
            <GitBranch className="mr-1 h-3 w-3" /> Apri GitHub Operational
          </Link>
        </Button>
      </div>
    </div>
  );
}
