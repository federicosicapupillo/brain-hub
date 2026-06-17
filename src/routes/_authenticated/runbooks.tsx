import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertTriangle,
  BookMarked,
  CheckCircle2,
  ChevronRight,
  ListChecks,
  Play,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  RISK_TONE,
  ACTION_TYPE_LABEL,
} from "@/lib/action-queue";
import {
  RUNBOOK_STATUS_LABEL,
  RUNBOOK_STATUS_TONE,
  RUNBOOK_TEMPLATES,
  RunbookInstance,
  RunbookTemplate,
  cancelRunbookInstance,
  listRunbookInstances,
  startRunbook,
} from "@/lib/runbooks";

export const Route = createFileRoute("/_authenticated/runbooks")({
  head: () => ({
    meta: [
      { title: "Runbooks — Brain Hub" },
      {
        name: "description",
        content:
          "Procedure operative guidate per Brain Hub: scegli un runbook, vedi gli step e crea automaticamente le azioni nella Action Queue.",
      },
    ],
  }),
  component: RunbooksRoute,
});

type BrainRow = { id: string; name: string };

function RunbooksRoute() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: brains = [] } = useQuery({
    queryKey: ["brains-min"],
    queryFn: async (): Promise<BrainRow[]> => {
      const { data, error } = await supabase.from("brains").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as BrainRow[];
    },
  });

  const [brainId, setBrainId] = useState<string>("");
  const effectiveBrainId = brainId || brains[0]?.id || "";

  const { data: instances = [] } = useQuery<RunbookInstance[]>({
    queryKey: ["runbook-instances", effectiveBrainId || "all"],
    queryFn: () => listRunbookInstances(effectiveBrainId ? { brainId: effectiveBrainId } : {}),
  });

  const [selected, setSelected] = useState<RunbookTemplate | null>(null);
  const [confirmStart, setConfirmStart] = useState<RunbookTemplate | null>(null);
  const [starting, setStarting] = useState(false);

  async function handleStart(t: RunbookTemplate) {
    if (!effectiveBrainId) {
      toast.error("Seleziona un progetto/cervello");
      return;
    }
    setStarting(true);
    try {
      const { instance, actions } = await startRunbook({
        template_key: t.key,
        brain_id: effectiveBrainId,
      });
      toast.success(`Runbook avviato: ${actions.length} step in Action Queue`, {
        action: {
          label: "Apri Action Queue",
          onClick: () => void navigate({ to: "/action-queue", search: {} }),
        },
      });
      qc.invalidateQueries({ queryKey: ["runbook-instances"] });
      qc.invalidateQueries({ queryKey: ["action-queue"] });
      setConfirmStart(null);
      setSelected(null);
      void instance;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore avvio runbook");
    } finally {
      setStarting(false);
    }
  }

  async function handleCancel(inst: RunbookInstance) {
    if (!window.confirm(`Annullare il runbook "${inst.title}"?`)) return;
    try {
      await cancelRunbookInstance(inst.id, inst.title);
      toast.success("Runbook annullato");
      qc.invalidateQueries({ queryKey: ["runbook-instances"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore annullamento");
    }
  }

  const activeInstances = useMemo(
    () => instances.filter((i) => i.status === "active" || i.status === "in_progress" || i.status === "waiting_approval"),
    [instances],
  );
  const blockedInstances = useMemo(() => instances.filter((i) => i.status === "blocked"), [instances]);

  return (
    <div className="min-h-[calc(100vh-3rem)] p-4 lg:p-6 space-y-4">
      <PageHeader
        title="Runbooks / Workflow Templates"
        subtitle="Procedure operative guidate. Ogni step diventa un'azione tracciabile nella Action Queue."
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BookMarked className="h-4 w-4" /> Template disponibili
            <Badge variant="outline" className="text-[10px]">v0.9</Badge>
          </CardTitle>
          <div className="w-64">
            <Select value={effectiveBrainId} onValueChange={setBrainId}>
              <SelectTrigger><SelectValue placeholder="Seleziona progetto…" /></SelectTrigger>
              <SelectContent>
                {brains.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {RUNBOOK_TEMPLATES.map((t) => (
              <div
                key={t.key}
                className="rounded-md border border-border/60 bg-background/40 p-3 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold">{t.name}</div>
                  <Badge className={`border text-[10px] ${RISK_TONE[t.risk_level]}`} variant="outline">
                    {t.risk_level}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground line-clamp-2">{t.description}</div>
                <div className="text-[10px] text-muted-foreground">
                  <span className="font-semibold">Quando: </span>{t.when_to_use}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary" className="text-[10px]">{t.steps.length} step</Badge>
                  {t.components.slice(0, 3).map((c) => (
                    <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
                  ))}
                </div>
                <div className="mt-1 flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setSelected(t)}>
                    Dettagli
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => setConfirmStart(t)}>
                    <Play className="mr-1 h-3 w-3" /> Avvia
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="h-4 w-4" /> Runbook attivi
            {activeInstances.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{activeInstances.length}</Badge>
            )}
            {blockedInstances.length > 0 && (
              <Badge className="border bg-red-500/10 text-red-600 border-red-500/30 text-[10px]" variant="outline">
                {blockedInstances.length} bloccati
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {instances.length === 0 ? (
            <div className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              Nessun runbook avviato per questo progetto.
            </div>
          ) : (
            <ul className="space-y-2">
              {instances.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 p-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{i.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <Badge className={`border text-[10px] ${RUNBOOK_STATUS_TONE[i.status]}`} variant="outline">
                        {RUNBOOK_STATUS_LABEL[i.status]}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        Step {i.current_step_index + 1}/{i.total_steps}
                      </Badge>
                      <Badge className={`border text-[10px] ${RISK_TONE[i.risk_level]}`} variant="outline">
                        {i.risk_level}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(i.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/action-queue" search={{}}>Apri coda</Link>
                    </Button>
                    {(i.status === "active" || i.status === "in_progress" || i.status === "waiting_approval" || i.status === "blocked") && (
                      <Button size="sm" variant="ghost" onClick={() => handleCancel(i)}>
                        <XCircle className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selected.name}
                  <Badge className={`border text-[10px] ${RISK_TONE[selected.risk_level]}`} variant="outline">
                    {selected.risk_level}
                  </Badge>
                </DialogTitle>
                <DialogDescription>{selected.description}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">Quando usarlo</div>
                  <div>{selected.when_to_use}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">Componenti coinvolti</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selected.components.map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Step previsti</div>
                  <ol className="space-y-1.5">
                    {selected.steps.map((s, idx) => (
                      <li
                        key={idx}
                        className="rounded border border-border/60 bg-background/40 p-2 flex items-start gap-2"
                      >
                        <Badge variant="outline" className="text-[10px] mt-0.5">{idx + 1}</Badge>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-sm font-medium">{s.title}</span>
                            <Badge
                              className={`border text-[10px] ${RISK_TONE[s.risk_level ?? "low"]}`}
                              variant="outline"
                            >
                              {s.risk_level ?? "low"}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              {ACTION_TYPE_LABEL[s.action_type]}
                            </Badge>
                            {s.blocking && (
                              <Badge variant="outline" className="text-[10px] text-red-600 border-red-500/30">
                                blocking
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{s.description}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] flex items-start gap-2">
                  <ShieldAlert className="h-3 w-3 mt-0.5 text-amber-600" />
                  <div>
                    Nessuno step verrà eseguito automaticamente. Verrà creata un'azione per ogni step nella Action Queue.
                    Step <strong>high</strong> e <strong>medium</strong> richiedono approvazione esplicita prima di poter essere preparati.
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelected(null)}>Chiudi</Button>
                <Button onClick={() => { setConfirmStart(selected); }}>
                  <Play className="mr-1 h-3 w-3" /> Avvia runbook
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmStart} onOpenChange={(o) => !o && setConfirmStart(null)}>
        <DialogContent>
          {confirmStart && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Conferma avvio runbook
                </DialogTitle>
                <DialogDescription>
                  Sto per creare <strong>{confirmStart.steps.length}</strong> azioni collegate nella Action Queue per il
                  progetto selezionato. Niente verrà eseguito automaticamente.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  Ogni step diventa un'azione approvabile/preparabile.
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  Step high/medium restano in attesa di approvazione manuale.
                </div>
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-3 w-3" />
                  Progetto: <strong>{brains.find((b) => b.id === effectiveBrainId)?.name ?? "—"}</strong>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmStart(null)} disabled={starting}>
                  Annulla
                </Button>
                <Button onClick={() => handleStart(confirmStart)} disabled={starting}>
                  {starting ? "Avvio…" : "Conferma e crea azioni"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
