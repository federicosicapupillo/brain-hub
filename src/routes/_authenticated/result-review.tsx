import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckCircle2, Copy, ExternalLink, FileText, Sparkles, XCircle, Wrench, EyeOff } from "lucide-react";
import {
  REVIEW_STATUS_LABEL,
  REVIEW_STATUS_TONE,
  ReviewStatus,
  ReviewSourceType,
  SOURCE_TYPE_LABEL,
  ResultReviewItem,
  approveReviewItem,
  buildNextPromptFromReview,
  copyReviewResult,
  createActionFromReviewItem,
  createNextPromptFromReviewItem,
  createReviewItem,
  ignoreReviewItem,
  listResultReviewItems,
  logSourceOpened,
  markReviewItemFailed,
  markReviewItemNeedsFix,
  summarizeReviews,
} from "@/lib/result-review";
import { LearningLoopBox } from "@/components/LearningLoopBox";

export const Route = createFileRoute("/_authenticated/result-review")({
  head: () => ({
    meta: [
      { title: "Result Review — Brain Hub" },
      {
        name: "description",
        content:
          "Centro decisionale per rivedere i risultati di Lovable, Codex, n8n, Browser Bridge e azioni manuali.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  component: ResultReviewRoute,
});

type BrainRow = { id: string; name: string };

function ResultReviewRoute() {
  const { brain } = useSearch({ from: "/_authenticated/result-review" });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [brainId, setBrainId] = useState<string | null>(brain ?? null);
  const [sourceFilter, setSourceFilter] = useState<ReviewSourceType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | "all">("all");
  const [riskFilter, setRiskFilter] = useState<"all" | "low" | "medium" | "high">("all");
  const [openItem, setOpenItem] = useState<ResultReviewItem | null>(null);
  const [note, setNote] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualResult, setManualResult] = useState("");

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-min-rr"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brains").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as BrainRow[];
    },
  });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["result-review-items", brainId, sourceFilter, statusFilter, riskFilter],
    queryFn: () =>
      listResultReviewItems({
        brain_id: brainId ?? undefined,
        source_type: sourceFilter,
        review_status: statusFilter,
        risk_level: riskFilter,
      }),
  });

  const summary = useMemo(() => summarizeReviews(items), [items]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["result-review-items"] });

  async function handle(act: () => Promise<unknown>, label: string) {
    try {
      await act();
      toast.success(label);
      refresh();
      setOpenItem(null);
      setNote("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Result Review"
        subtitle="Rivedi i risultati prodotti da Lovable, Codex, n8n, Browser Bridge e azioni manuali. Decidi cosa è ok, cosa va corretto, cosa è fallito."
        actions={
          <MasterSnapshotUpdateButton
            source="result_review"
            brainId={brainId}
            defaultReason="Aggiornamento da Result Review"
          />
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={brainId ?? "all"} onValueChange={(v) => setBrainId(v === "all" ? null : v)}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Tutti i brain" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti i brain</SelectItem>
            {brains.map((b) => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as ReviewSourceType | "all")}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutte le origini</SelectItem>
            {Object.entries(SOURCE_TYPE_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ReviewStatus | "all")}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti gli stati</SelectItem>
            {Object.entries(REVIEW_STATUS_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={riskFilter} onValueChange={(v) => setRiskFilter(v as typeof riskFilter)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti i rischi</SelectItem>
            <SelectItem value="low">Basso</SelectItem>
            <SelectItem value="medium">Medio</SelectItem>
            <SelectItem value="high">Alto</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setManualOpen(true)}>
          <FileText className="mr-2 h-4 w-4" /> Nuova review manuale
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard label="Da rivedere" value={summary.pending} tone="bg-amber-500/10 text-amber-600" />
        <SummaryCard label="Approvati" value={summary.approved} tone="bg-emerald-500/10 text-emerald-600" />
        <SummaryCard label="Da correggere" value={summary.needs_fix} tone="bg-orange-500/10 text-orange-600" />
        <SummaryCard label="Falliti" value={summary.failed} tone="bg-red-500/10 text-red-600" />
        <SummaryCard label="Prossimi prompt" value={summary.next_prompt_created} tone="bg-indigo-500/10 text-indigo-600" />
      </div>

      <Card>
        <CardHeader><CardTitle>Risultati ({items.length})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessuna review. Creane una manuale o aprila da una action / esecuzione n8n.
            </p>
          ) : (
            <div className="divide-y">
              {items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => setOpenItem(it)}
                  className="flex w-full flex-col gap-1 py-3 text-left hover:bg-muted/40 px-2 rounded"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{it.title}</span>
                    <Badge variant="outline" className={REVIEW_STATUS_TONE[it.review_status]}>
                      {REVIEW_STATUS_LABEL[it.review_status]}
                    </Badge>
                    <Badge variant="outline">{SOURCE_TYPE_LABEL[it.source_type as ReviewSourceType] ?? it.source_type}</Badge>
                    {it.risk_level && <Badge variant="outline">Rischio: {it.risk_level}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(it.created_at).toLocaleString()}
                    {it.error_text ? ` — ⚠ ${it.error_text.slice(0, 80)}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!openItem} onOpenChange={(o) => { if (!o) { setOpenItem(null); setNote(""); } }}>
        <DialogContent className="max-w-2xl">
          {openItem && (
            <>
              <DialogHeader><DialogTitle>{openItem.title}</DialogTitle></DialogHeader>
              <div className="space-y-3 max-h-[60vh] overflow-auto">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={REVIEW_STATUS_TONE[openItem.review_status]}>
                    {REVIEW_STATUS_LABEL[openItem.review_status]}
                  </Badge>
                  <Badge variant="outline">{SOURCE_TYPE_LABEL[openItem.source_type as ReviewSourceType] ?? openItem.source_type}</Badge>
                  {openItem.risk_level && <Badge variant="outline">Rischio: {openItem.risk_level}</Badge>}
                </div>
                {openItem.result_text && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Output</div>
                    <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap break-words">{openItem.result_text}</pre>
                  </div>
                )}
                {openItem.error_text && (
                  <div>
                    <div className="text-xs font-medium text-red-600 mb-1">Errore</div>
                    <pre className="text-xs bg-red-500/5 p-3 rounded whitespace-pre-wrap break-words">{openItem.error_text}</pre>
                  </div>
                )}
                {openItem.review_note && (
                  <div className="text-xs text-muted-foreground">Nota: {openItem.review_note}</div>
                )}
                <Textarea
                  placeholder="Nota / motivo (per 'Da correggere' o 'Fallito')"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <LearningLoopBox review={openItem} />
              </div>
              <DialogFooter className="flex-wrap gap-2">
                <Button size="sm" onClick={() => handle(() => approveReviewItem(openItem.id), "Approvato")}>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Approva
                </Button>
                <Button size="sm" variant="outline" onClick={() => handle(() => markReviewItemNeedsFix(openItem.id, note || undefined), "Segnato da correggere")}>
                  <Wrench className="mr-2 h-4 w-4" /> Da correggere
                </Button>
                <Button size="sm" variant="outline" onClick={() => handle(() => markReviewItemFailed(openItem.id, note || undefined), "Segnato fallito")}>
                  <XCircle className="mr-2 h-4 w-4" /> Fallito
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handle(() => ignoreReviewItem(openItem.id), "Ignorato")}>
                  <EyeOff className="mr-2 h-4 w-4" /> Ignora
                </Button>
                <Button size="sm" variant="outline" onClick={async () => {
                  const p = await createNextPromptFromReviewItem(openItem);
                  if (navigator.clipboard) await navigator.clipboard.writeText(p);
                  toast.success("Prompt successivo generato e copiato");
                  refresh();
                }}>
                  <Sparkles className="mr-2 h-4 w-4" /> Genera prossimo prompt
                </Button>
                <Button size="sm" variant="outline" onClick={() => handle(() => createActionFromReviewItem(openItem), "Action creata")}>
                  Crea action
                </Button>
                <Button size="sm" variant="ghost" onClick={async () => {
                  await copyReviewResult(openItem);
                  toast.success("Risultato copiato");
                }}>
                  <Copy className="mr-2 h-4 w-4" /> Copia risultato
                </Button>
                {openItem.source_type === "automation_action" && openItem.source_id && (
                  <Button size="sm" variant="ghost" onClick={() => {
                    logSourceOpened(openItem);
                    navigate({ to: "/action-queue", search: {} });
                  }}>
                    <ExternalLink className="mr-2 h-4 w-4" /> Apri sorgente
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuova review manuale</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <input
              className="w-full border rounded px-3 py-2 bg-background"
              placeholder="Titolo"
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
            />
            <Textarea
              placeholder="Risultato / output da rivedere"
              value={manualResult}
              onChange={(e) => setManualResult(e.target.value)}
              rows={6}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setManualOpen(false)}>Annulla</Button>
            <Button
              disabled={!manualTitle.trim()}
              onClick={async () => {
                try {
                  await createReviewItem({
                    source_type: "manual",
                    title: manualTitle.trim(),
                    result_text: manualResult,
                    brain_id: brainId,
                  });
                  toast.success("Review creata");
                  setManualTitle("");
                  setManualResult("");
                  setManualOpen(false);
                  refresh();
                } catch (e: unknown) {
                  toast.error(e instanceof Error ? e.message : "Errore");
                }
              }}
            >Crea</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 inline-flex items-center rounded px-2 py-1 text-xl font-semibold ${tone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export { buildNextPromptFromReview };
