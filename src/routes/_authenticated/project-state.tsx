import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { toast } from "sonner";
import {
  AlertTriangle,
  RefreshCw,
  Sparkles,
  ListChecks,
  Plus,
} from "lucide-react";
import {
  listProjectStateSnapshots,
  seedInitialProjectStates,
  updateProjectStateFromManualSummary,
  createActionFromProjectSnapshot,
  sortByPriority,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL_PS,
  FRESHNESS_LABEL,
  FRESHNESS_TONE,
  type ProjectStateSnapshot,
  type ProjectPriority,
  type ProjectStatus,
} from "@/lib/project-state-sync";

export const Route = createFileRoute("/_authenticated/project-state")({
  head: () => ({
    meta: [
      { title: "Project State — Brain Hub" },
      { name: "description", content: "Stato sintetico di tutti i progetti collegati a Jack." },
    ],
  }),
  component: ProjectStatePage,
});

function ProjectStatePage() {
  const qc = useQueryClient();
  const [priorityFilter, setPriorityFilter] = useState<"all" | ProjectPriority>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ProjectStatus>("all");
  const [seeding, setSeeding] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["project-state-snapshots"],
    queryFn: () => listProjectStateSnapshots(),
  });

  const filtered = useMemo(() => {
    let out = sortByPriority(rows);
    if (priorityFilter !== "all") out = out.filter((r) => r.priority === priorityFilter);
    if (statusFilter !== "all") out = out.filter((r) => r.status === statusFilter);
    return out;
  }, [rows, priorityFilter, statusFilter]);

  const onSeed = async () => {
    setSeeding(true);
    try {
      const res = await seedInitialProjectStates();
      toast.success(`Snapshot iniziali: ${res.created} creati, ${res.skipped} esistenti.`);
      await qc.invalidateQueries({ queryKey: ["project-state-snapshots"] });
    } catch (e) {
      toast.error(`Seed fallito: ${(e as Error).message}`);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Project State"
        subtitle="Stato sintetico di tutti i progetti collegati a Jack. Aggiornabile manualmente."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onSeed} disabled={seeding} variant="default">
          <Sparkles className="mr-2 h-4 w-4" />
          {seeding ? "Sto preparando…" : "Crea/aggiorna snapshot progetti iniziali"}
        </Button>
        <Button
          variant="outline"
          onClick={() => qc.invalidateQueries({ queryKey: ["project-state-snapshots"] })}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Ricarica
        </Button>
        <Button asChild variant="outline">
          <Link to="/connector-hub">
            <Plus className="mr-2 h-4 w-4" />
            Apri Connector Hub
          </Link>
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as typeof priorityFilter)}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Priorità" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutte le priorità</SelectItem>
              <SelectItem value="very_high">Molto alta</SelectItem>
              <SelectItem value="high">Alta</SelectItem>
              <SelectItem value="medium">Media</SelectItem>
              <SelectItem value="low">Bassa</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Stato" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli stati</SelectItem>
              <SelectItem value="active">Attivi</SelectItem>
              <SelectItem value="paused">In pausa</SelectItem>
              <SelectItem value="blocked">Bloccati</SelectItem>
              <SelectItem value="parked">Parcheggiati</SelectItem>
              <SelectItem value="completed">Completati</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground">Carico snapshot…</div>
      )}
      {!isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Nessuno snapshot. Clicca <strong>Crea/aggiorna snapshot progetti iniziali</strong> per partire.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.map((s) => (
          <ProjectStateCard key={s.id} snapshot={s} onRefresh={() => qc.invalidateQueries({ queryKey: ["project-state-snapshots"] })} />
        ))}
      </div>
    </div>
  );
}

function ProjectStateCard({
  snapshot,
  onRefresh,
}: {
  snapshot: ProjectStateSnapshot;
  onRefresh: () => void | Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  const onImport = async () => {
    if (!summary.trim()) {
      toast.error("Incolla un riepilogo prima di salvare.");
      return;
    }
    setBusy(true);
    try {
      const res = await updateProjectStateFromManualSummary(snapshot.project_key, summary);
      toast.success(
        res.needs_review
          ? "Riepilogo salvato — marcato come da rivedere."
          : "Stato progetto aggiornato.",
      );
      setSummary("");
      setEditing(false);
      await onRefresh();
    } catch (e) {
      toast.error(`Errore: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onCreateAction = async () => {
    setBusy(true);
    try {
      const res = await createActionFromProjectSnapshot(snapshot);
      if (res.duplicate_prevented) {
        toast.info("Esiste già una action aperta con questa prossima azione.");
      } else if (res.created) {
        toast.success("Action creata come 'suggested' in Action Queue.");
      } else {
        toast.error(`Impossibile creare action: ${res.reason ?? "?"}`);
      }
    } catch (e) {
      toast.error(`Errore: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{snapshot.project_name}</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={PRIORITY_TONE[snapshot.priority]}>
              {PRIORITY_LABEL[snapshot.priority]}
            </Badge>
            <Badge variant="outline">{STATUS_LABEL_PS[snapshot.status]}</Badge>
            <Badge variant="outline" className={FRESHNESS_TONE[snapshot.freshness_status]}>
              {FRESHNESS_LABEL[snapshot.freshness_status]}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {snapshot.current_state && (
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Stato attuale</div>
            <p className="mt-1 whitespace-pre-wrap">{snapshot.current_state}</p>
          </div>
        )}
        {snapshot.last_completed && (
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Ultima cosa completata</div>
            <p className="mt-1">{snapshot.last_completed}</p>
          </div>
        )}
        {snapshot.next_action && (
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Prossima azione</div>
            <p className="mt-1">{snapshot.next_action}</p>
          </div>
        )}
        {snapshot.blockers.length > 0 && (
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Blocchi
            </div>
            <ul className="mt-1 list-inside list-disc">
              {snapshot.blockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Aggiorna stato
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/jack-memory" search={{}}>Apri in Jack</Link>
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={!snapshot.next_action || busy}
            onClick={onCreateAction}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Crea action da prossima azione
          </Button>
        </div>

        {editing && (
          <div className="rounded-md border bg-muted/40 p-3 space-y-2">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <ListChecks className="h-3 w-3" /> Incolla l'ultimo riepilogo Lovable (parsing locale, no AI esterna).
            </div>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={"Esempio:\nUltima completata: integrazione Idealista feed\nProssima azione: pubblicare 5 annunci pilota\nBlocchi: validazione foto"}
              rows={6}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Annulla</Button>
              <Button size="sm" onClick={onImport} disabled={busy}>
                Salva riepilogo
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
