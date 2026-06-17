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
  listCodeEngineHandoffs,
  getCodeEngineHandoff,
  copyHandoffPrompt,
  markHandoffSentManually,
  saveHandoffResult,
  createReviewFromHandoff,
  createNextActionFromHandoff,
  getCodeEngineHandoffSummary,
  ENGINE_LABEL,
  HANDOFF_STATUS_LABEL,
  HANDOFF_STATUS_TONE,
  type CodeEngineHandoff,
  type HandoffEngine,
  type HandoffStatus,
} from "@/lib/code-engine-handoff";
import {
  ArrowRight,
  Copy,
  Send,
  CheckSquare,
  ListChecks,
  ExternalLink,
  GitBranch,
  Bot,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/code-handoffs")({
  component: CodeHandoffsPage,
});

const ENGINES: HandoffEngine[] = ["codex", "claude_code", "cursor", "github", "manual_developer"];
const STATUSES: HandoffStatus[] = [
  "draft",
  "ready",
  "copied",
  "sent_manually",
  "result_received",
  "review_created",
  "next_action_created",
  "completed",
  "failed",
];

function CodeHandoffsPage() {
  const qc = useQueryClient();
  const [brainId, setBrainId] = useState<string | null>(null);
  const [engineFilter, setEngineFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
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
    queryKey: ["code-handoffs", brainId],
    queryFn: () => listCodeEngineHandoffs(brainId ?? undefined),
  });

  const { data: summary } = useQuery({
    queryKey: ["code-handoffs-summary", brainId],
    queryFn: () => getCodeEngineHandoffSummary(brainId ?? undefined),
  });

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (engineFilter !== "all" && i.engine !== engineFilter) return false;
      if (statusFilter !== "all" && i.handoff_status !== statusFilter) return false;
      return true;
    });
  }, [items, engineFilter, statusFilter]);

  const { data: openDetail } = useQuery({
    queryKey: ["code-handoff-detail", openId],
    queryFn: () => (openId ? getCodeEngineHandoff(openId) : null),
    enabled: !!openId,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["code-handoffs"] });
    void qc.invalidateQueries({ queryKey: ["code-handoff-detail"] });
    void qc.invalidateQueries({ queryKey: ["code-handoffs-summary"] });
  };

  const handleCopy = async (h: CodeEngineHandoff) => {
    try {
      await copyHandoffPrompt(h.id);
      toast.success("Prompt copiato");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleSent = async (h: CodeEngineHandoff) => {
    try {
      await markHandoffSentManually(h.id);
      toast.success("Segnato come inviato");
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
      await saveHandoffResult(openDetail.id, { text: resultText.trim() });
      toast.success("Risultato salvato");
      setResultText("");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleReview = async (h: CodeEngineHandoff) => {
    try {
      await createReviewFromHandoff(h.id);
      toast.success("Result Review creata");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleNext = async (h: CodeEngineHandoff) => {
    try {
      await createNextActionFromHandoff(h.id);
      toast.success("Next action creata");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Code Handoffs — Codex / Claude Code"
        description="Console manuale per preparare prompt operativi, salvare risultati e creare Result Review. Nessun commit, push o PR automatico."
        icon={Bot}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtri</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
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
                  <SelectItem key={e} value={e}>{ENGINE_LABEL[e]}</SelectItem>
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
                  <SelectItem key={s} value={s}>{HANDOFF_STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {summary && (
        <div className="grid gap-3 sm:grid-cols-5">
          <Tile label="Totali" value={summary.total} />
          <Tile label="Aperti" value={summary.open} />
          <Tile label="In attesa risultato" value={summary.awaitingResult} />
          <Tile label="Da revisionare" value={summary.awaitingReview} />
          <Tile label="Revisionati" value={summary.reviewed} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Handoff ({filtered.length})</span>
            <Button asChild size="sm" variant="outline">
              <Link to="/action-queue">
                <ListChecks className="mr-1 h-3 w-3" /> Apri Action Queue
              </Link>
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {filtered.length === 0 && (
            <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nessun handoff. Crea un handoff da Action Queue su una code action.
            </div>
          )}
          {filtered.map((h) => (
            <div
              key={h.id}
              className="flex flex-col gap-2 rounded border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{ENGINE_LABEL[h.engine as HandoffEngine] ?? h.engine}</Badge>
                  <Badge variant="outline" className={HANDOFF_STATUS_TONE[h.handoff_status as HandoffStatus] ?? ""}>
                    {HANDOFF_STATUS_LABEL[h.handoff_status as HandoffStatus] ?? h.handoff_status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(h.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 truncate text-sm">
                  {typeof h.prompt_context.action_title === "string"
                    ? (h.prompt_context.action_title as string)
                    : "(action)"}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpenId(h.id)}>
                  Apri
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleCopy(h)}>
                  <Copy className="mr-1 h-3 w-3" /> Copia
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleSent(h)}>
                  <Send className="mr-1 h-3 w-3" /> Inviato
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!openId} onOpenChange={(v) => !v && (setOpenId(null), setResultText(""))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Handoff dettaglio</DialogTitle>
            <DialogDescription>
              Prompt manuale per {openDetail ? ENGINE_LABEL[openDetail.engine as HandoffEngine] : ""}.
              Nessuna API esterna chiamata.
            </DialogDescription>
          </DialogHeader>
          {openDetail && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{ENGINE_LABEL[openDetail.engine as HandoffEngine]}</Badge>
                <Badge variant="outline" className={HANDOFF_STATUS_TONE[openDetail.handoff_status as HandoffStatus] ?? ""}>
                  {HANDOFF_STATUS_LABEL[openDetail.handoff_status as HandoffStatus]}
                </Badge>
              </div>
              <div>
                <Label className="text-xs">Prompt</Label>
                <Textarea
                  readOnly
                  value={openDetail.prompt_text}
                  className="h-64 font-mono text-xs"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void handleCopy(openDetail)}>
                  <Copy className="mr-1 h-3 w-3" /> Copia prompt
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleSent(openDetail)}>
                  <Send className="mr-1 h-3 w-3" /> Segna inviato manualmente
                </Button>
              </div>

              <div>
                <Label className="text-xs">Incolla risultato Codex / Claude Code</Label>
                <Textarea
                  value={openDetail.result_text ?? resultText}
                  onChange={(e) => setResultText(e.target.value)}
                  placeholder="Incolla qui il risultato ricevuto…"
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
