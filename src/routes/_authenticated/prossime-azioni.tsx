import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ListChecks, Map as MapIcon, Lightbulb, FolderKanban, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listTasks, listRoadmap, createTask, type Task, type RoadmapItem } from "@/lib/workspace-api";

export const Route = createFileRoute("/_authenticated/prossime-azioni")({
  head: () => ({ meta: [{ title: "Prossime Azioni — AI Brain" }] }),
  component: ProssimeAzioniPage,
});

interface BrainLite { id: string; name: string }
interface Suggestion {
  id: string;
  brain_id: string | null;
  brain_name: string;
  title: string;
  reason: string;
}

function ProssimeAzioniPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [brains, setBrains] = useState<BrainLite[]>([]);
  const [nodeCounts, setNodeCounts] = useState<Record<string, { total: number; review: number }>>({});
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const [t, r, br, nodes] = await Promise.all([
        listTasks(),
        listRoadmap(),
        supabase.from("brains").select("id,name").order("name"),
        supabase.from("brain_nodes").select("id,brain_id,type,tags"),
      ]);
      setTasks(t);
      setRoadmap(r);
      setBrains((br.data ?? []) as BrainLite[]);
      const counts: Record<string, { total: number; review: number }> = {};
      for (const n of (nodes.data ?? []) as Array<{ brain_id: string; tags: string[] | null }>) {
        const c = counts[n.brain_id] ?? { total: 0, review: 0 };
        c.total += 1;
        if ((n.tags ?? []).some((x) => /revisi|review|todo|bozza/i.test(x))) c.review += 1;
        counts[n.brain_id] = c;
      }
      setNodeCounts(counts);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  const brainName = (id: string | null) => brains.find((b) => b.id === id)?.name ?? "Senza progetto";

  const openTasks = useMemo(() => tasks.filter((t) => t.status !== "done" && t.status !== "completato"), [tasks]);
  const urgentTasks = useMemo(
    () => openTasks.filter((t) => t.priority === "urgent" || t.priority === "high"),
    [openTasks]
  );
  const openRoadmap = useMemo(() => roadmap.filter((r) => r.status !== "done" && r.status !== "completato"), [roadmap]);

  const tasksByBrain = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of openTasks) {
      const k = t.brain_id ?? "_none";
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return m;
  }, [openTasks]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const out: Suggestion[] = [];
    for (const b of brains) {
      const ts = tasksByBrain.get(b.id) ?? [];
      if (ts.length === 0) {
        out.push({
          id: `no-task-${b.id}`,
          brain_id: b.id,
          brain_name: b.name,
          title: "Crea almeno un task operativo per questo progetto.",
          reason: "Nessun task aperto associato al progetto.",
        });
      }
      const rms = openRoadmap.filter((r) => r.brain_id === b.id);
      if (rms.length === 0 && ts.length > 0) {
        out.push({
          id: `no-roadmap-${b.id}`,
          brain_id: b.id,
          brain_name: b.name,
          title: "Definisci una roadmap iniziale per questo progetto.",
          reason: "Il progetto ha task ma nessuna voce di roadmap attiva.",
        });
      }
      const nc = nodeCounts[b.id];
      if (!nc || nc.total === 0) {
        out.push({
          id: `no-content-${b.id}`,
          brain_id: b.id,
          brain_name: b.name,
          title: "Aggiungi i primi contenuti (prompt, file o note).",
          reason: "Il progetto non ha ancora contenuti salvati.",
        });
      }
    }
    return out;
  }, [brains, tasksByBrain, openRoadmap, nodeCounts]);

  const reviewNodes = useMemo(() => {
    const list: Array<{ brain_id: string; count: number }> = [];
    for (const [bid, c] of Object.entries(nodeCounts)) {
      if (c.review > 0) list.push({ brain_id: bid, count: c.review });
    }
    return list;
  }, [nodeCounts]);

  async function createFromSuggestion(s: Suggestion) {
    try {
      await createTask({
        title: s.title,
        description: `Generato da suggerimento — ${s.reason}`,
        brain_id: s.brain_id,
        priority: "medium",
      });
      toast.success("Task creato");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-6">
        <PageHeader title="Prossime Azioni" subtitle="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <PageHeader
        title="Prossime Azioni"
        subtitle="Cosa fare adesso: urgenze, task per progetto, roadmap e suggerimenti."
      />

      <Section icon={<AlertTriangle className="h-4 w-4 text-red-400" />} title={`Azioni urgenti (${urgentTasks.length})`}>
        {urgentTasks.length === 0 ? (
          <Empty>Nessuna azione urgente.</Empty>
        ) : (
          <div className="grid gap-2">
            {urgentTasks.map((t) => (
              <Row key={t.id}>
                <div className="flex-1">
                  <div className="font-medium">{t.title}</div>
                  <div className="text-xs text-muted-foreground">{brainName(t.brain_id)} · scadenza {t.due_date ?? "—"}</div>
                </div>
                <Badge variant="outline" className="capitalize">{t.priority}</Badge>
                <Link to="/tasks"><Button size="sm" variant="ghost">Apri</Button></Link>
              </Row>
            ))}
          </div>
        )}
      </Section>

      <Section icon={<FolderKanban className="h-4 w-4" />} title="Azioni per progetto">
        {brains.length === 0 ? (
          <Empty>Nessun progetto.</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {brains.map((b) => {
              const ts = tasksByBrain.get(b.id) ?? [];
              return (
                <Card key={b.id} className="bg-card/40 glass">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span>{b.name}</span>
                      <Badge variant="outline">{ts.length} task</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {ts.length === 0 ? (
                      <div className="text-xs text-muted-foreground">Nessun task aperto.</div>
                    ) : (
                      ts.slice(0, 5).map((t) => (
                        <div key={t.id} className="text-sm flex justify-between gap-2">
                          <span className="truncate">{t.title}</span>
                          <Badge variant="outline" className="capitalize text-[10px]">{t.status}</Badge>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <Section icon={<ListChecks className="h-4 w-4" />} title={`Task aperti (${openTasks.length})`}>
        {openTasks.length === 0 ? (
          <Empty>Nessun task aperto.</Empty>
        ) : (
          <div className="grid gap-2">
            {openTasks.slice(0, 20).map((t) => (
              <Row key={t.id}>
                <div className="flex-1">
                  <div className="font-medium">{t.title}</div>
                  <div className="text-xs text-muted-foreground">{brainName(t.brain_id)}</div>
                </div>
                <Badge variant="outline" className="capitalize">{t.status}</Badge>
              </Row>
            ))}
          </div>
        )}
      </Section>

      <Section icon={<MapIcon className="h-4 w-4" />} title={`Roadmap non completate (${openRoadmap.length})`}>
        {openRoadmap.length === 0 ? (
          <Empty>Nessuna voce di roadmap aperta.</Empty>
        ) : (
          <div className="grid gap-2">
            {openRoadmap.map((r) => (
              <Row key={r.id}>
                <div className="flex-1">
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground">{brainName(r.brain_id)} · {r.phase || "—"}</div>
                </div>
                <Badge variant="outline" className="capitalize">{r.status}</Badge>
              </Row>
            ))}
          </div>
        )}
      </Section>

      <Section icon={<ListChecks className="h-4 w-4" />} title="Contenuti da revisionare">
        {reviewNodes.length === 0 ? (
          <Empty>Nessun contenuto marcato come da revisionare (tag: review/revisione/todo/bozza).</Empty>
        ) : (
          <div className="grid gap-2">
            {reviewNodes.map((n) => (
              <Row key={n.brain_id}>
                <div className="flex-1">
                  <div className="font-medium">{brainName(n.brain_id)}</div>
                  <div className="text-xs text-muted-foreground">{n.count} contenuti da revisionare</div>
                </div>
                <Link to="/progetti/$brainId" params={{ brainId: n.brain_id }}>
                  <Button size="sm" variant="ghost">Apri progetto</Button>
                </Link>
              </Row>
            ))}
          </div>
        )}
      </Section>

      <Section icon={<Lightbulb className="h-4 w-4 text-amber-400" />} title={`Suggerimenti automatici (${suggestions.length})`}>
        {suggestions.length === 0 ? (
          <Empty>Nessun suggerimento. Tutto sotto controllo.</Empty>
        ) : (
          <div className="grid gap-2">
            {suggestions.map((s) => (
              <Row key={s.id}>
                <div className="flex-1">
                  <div className="font-medium flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-300">suggerimento</Badge>
                    {s.title}
                  </div>
                  <div className="text-xs text-muted-foreground">{s.brain_name} · {s.reason}</div>
                </div>
                <Button size="sm" onClick={() => createFromSuggestion(s)} className="bg-gradient-primary text-primary-foreground">
                  <Plus className="mr-1 h-3 w-3" /> Crea task
                </Button>
              </Row>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold">{icon}<span>{title}</span></div>
      {children}
    </section>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 rounded-xl border border-border bg-card/40 px-3 py-2 glass">{children}</div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border bg-card/30 p-4 text-sm text-muted-foreground glass">{children}</div>;
}
