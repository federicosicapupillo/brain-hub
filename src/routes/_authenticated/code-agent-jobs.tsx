import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  listCodeAgentJobs,
  getCodeAgentJob,
  approveCodeAgentJob,
  markCodeAgentJobReady,
  saveCodeAgentJobResult,
  createReviewFromCodeAgentJob,
  createNextActionFromCodeAgentJob,
  createMasterSnapshotDraftFromCodeAgentJob,
  getCodeAgentJobSummary,
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
  ArrowRight,
  CheckCircle2,
  CheckSquare,
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  ListChecks,
  Send,
  ShieldCheck,
} from "lucide-react";

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
const STATUSES: CodeAgentJobStatus[] = [
  "draft",
  "pending_approval",
  "ready",
  "sent_to_engine",
  "result_received",
  "review_created",
  "completed",
  "rejected",
  "failed",
];
const RISKS: CodeAgentRiskLevel[] = ["low", "medium", "high"];

function CodeAgentJobsPage() {
  const qc = useQueryClient();
  const [brainId, setBrainId] = useState<string | null>(null);
  const [engineFilter, setEngineFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [resultText, setResultText] = useState("");

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

  const filtered = useMemo(() => {
    return items.filter((j) => {
      if (engineFilter !== "all" && j.recommended_engine !== engineFilter) return false;
      if (statusFilter !== "all" && j.status !== statusFilter) return false;
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

  const handleApprove = async (j: CodeAgentJob) => {
    try {
      await approveCodeAgentJob(j.id);
      toast.success("Job approvato");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
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

  const handleSent = async (j: CodeAgentJob, engine: CodeAgentEngine) => {
    try {
      await markCodeAgentJobReady(j.id, engine);
      toast.success(`Segnato inviato a ${CODE_AGENT_ENGINE_REGISTRY[engine].label}`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleSaveResult = async () => {
    if (!openDetail) return;
    if (!resultText.trim()) {
      toast.error("Incolla il risultato prima di salvare");
      return;
    }
    try {
      await saveCodeAgentJobResult(openDetail.id, { text: resultText.trim() });
      toast.success("Risultato salvato");
      setResultText("");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleReview = async (j: CodeAgentJob) => {
    try {
      await createReviewFromCodeAgentJob(j.id);
      toast.success("Result Review creata");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleNext = async (j: CodeAgentJob) => {
    try {
      await createNextActionFromCodeAgentJob(j.id);
      toast.success("Next action creata");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleSnapshot = async (j: CodeAgentJob) => {
    try {
      const id = await createMasterSnapshotDraftFromCodeAgentJob(j.id);
      if (id) toast.success("Bozza Master Snapshot creata");
      else toast.error("Bozza non creata");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Code Agent Jobs — Orchestratore Codex / Claude Code"
        subtitle="Manual-first. Brain Hub prepara il job, sceglie engine, stima il rischio e richiede approvazione. Nessuna esecuzione automatica, niente commit/push/merge/deploy."
      />

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
            <Label className="text-xs">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{CODE_AGENT_STATUS_LABEL[s]}</SelectItem>
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
        <div className="grid gap-3 sm:grid-cols-4">
          <Tile label="Totali" value={summary.total} />
          <Tile label="Aperti" value={summary.open} />
          <Tile label="In attesa approvazione" value={summary.awaitingApproval} />
          <Tile label="Da revisionare" value={summary.awaitingReview} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Jobs ({filtered.length})</span>
            <Button asChild size="sm" variant="outline">
              <Link to="/action-queue">
                <ListChecks className="mr-1 h-3 w-3" /> Action Queue
              </Link>
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {filtered.length === 0 && (
            <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nessun job. Chiedi a Jack: "crea un job per Codex per correggere il bug X".
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

              <div>
                <Label className="text-xs">Comando</Label>
                <div className="rounded border bg-muted/30 p-2 text-sm">{openDetail.command_text}</div>
              </div>

              <div>
                <Label className="text-xs">Prompt generato</Label>
                <Textarea readOnly value={openDetail.prompt_text ?? ""} className="h-64 font-mono text-xs" />
              </div>

              <div className="flex flex-wrap gap-2">
                {openDetail.status === "pending_approval" && (
                  <Button size="sm" onClick={() => void handleApprove(openDetail)}>
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Approva
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => void handleCopy(openDetail)}>
                  <Copy className="mr-1 h-3 w-3" /> Copia prompt
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={openDetail.status === "pending_approval"}
                  onClick={() => void handleSent(openDetail, "codex_cloud")}
                >
                  <Send className="mr-1 h-3 w-3" /> Inviato a Codex
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={openDetail.status === "pending_approval"}
                  onClick={() => void handleSent(openDetail, "claude_code_cli")}
                >
                  <Send className="mr-1 h-3 w-3" /> Inviato a Claude Code
                </Button>
              </div>

              <div>
                <Label className="text-xs">Incolla risultato</Label>
                <Textarea
                  value={openDetail.result_text ?? resultText}
                  onChange={(e) => setResultText(e.target.value)}
                  placeholder="Incolla qui il diff / output / log…"
                  className="h-40 font-mono text-xs"
                  disabled={!!openDetail.result_text}
                />
                {!openDetail.result_text && (
                  <Button size="sm" className="mt-2" onClick={() => void handleSaveResult()}>
                    Salva risultato
                  </Button>
                )}
              </div>

              {openDetail.result_text && (
                <div className="flex flex-wrap gap-2">
                  {!openDetail.result_review_item_id && (
                    <Button size="sm" variant="outline" onClick={() => void handleReview(openDetail)}>
                      <CheckSquare className="mr-1 h-3 w-3" /> Crea Result Review
                    </Button>
                  )}
                  {!openDetail.next_action_id && (
                    <Button size="sm" variant="outline" onClick={() => void handleNext(openDetail)}>
                      <ArrowRight className="mr-1 h-3 w-3" /> Crea Next Action
                    </Button>
                  )}
                  {!openDetail.master_snapshot_draft_id && (
                    <Button size="sm" variant="outline" onClick={() => void handleSnapshot(openDetail)}>
                      <FileText className="mr-1 h-3 w-3" /> Master Snapshot draft
                    </Button>
                  )}
                  {openDetail.result_review_item_id && (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/result-review">
                        <ExternalLink className="mr-1 h-3 w-3" /> Apri Result Review
                      </Link>
                    </Button>
                  )}
                </div>
              )}
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
    </div>
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
