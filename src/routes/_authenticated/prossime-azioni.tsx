import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, ListChecks, Map as MapIcon, Lightbulb, FolderKanban, Plus, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listTasks, listRoadmap, createTask, type Task, type RoadmapItem } from "@/lib/workspace-api";

export const Route = createFileRoute("/_authenticated/prossime-azioni")({
  head: () => ({ meta: [{ title: "Prossime Azioni — AI Brain" }] }),
  component: ProssimeAzioniPage,
});

interface BrainLite { id: string; name: string }

type SuggestionKind =
  | "task-review"      // priority 1
  | "no-task"          // priority 5
  | "roadmap-to-task"  // priority 3 — turn roadmap into actionable task
  | "no-roadmap"       // priority 6
  | "review-content"   // priority 4
  | "no-content";      // priority 7

interface Suggestion {
  id: string;
  kind: SuggestionKind;
  priority: number;       // lower = more important
  isPriority: boolean;    // shown when "Solo suggerimenti prioritari" is on
  brain_id: string | null;
  brain_name: string;
  reason: string;         // why it's suggested
  action: string;         // recommended action / task title if created
  roadmap_id?: string;
}

const KIND_LABEL: Record<SuggestionKind, string> = {
  "task-review": "Task da revisionare",
  "no-task": "Progetto senza task",
  "roadmap-to-task": "Roadmap → Task",
  "no-roadmap": "Progetto senza roadmap",
  "review-content": "Contenuto da revisionare",
  "no-content": "Progetto senza contenuti",
};

function ProssimeAzioniPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [brains, setBrains] = useState<BrainLite[]>([]);
  const [nodeCounts, setNodeCounts] = useState<Record<string, { total: number; review: number }>>({});
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [onlyPriority, setOnlyPriority] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const [t, r, br, nodes, sources] = await Promise.all([
        listTasks(),
        listRoadmap(),
        supabase.from("brains").select("id,name").order("name"),
        supabase.from("brain_nodes").select("id,brain_id,tags"),
        supabase.from("knowledge_sources").select("id,brain_id"),
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
      const sc: Record<string, number> = {};
      for (const s of (sources.data ?? []) as Array<{ brain_id: string | null }>) {
        if (!s.brain_id) continue;
        sc[s.brain_id] = (sc[s.brain_id] ?? 0) + 1;
      }
      setSourceCounts(sc);
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

  const roadmapByBrain = useMemo(() => {
    const m = new Map<string, RoadmapItem[]>();
    for (const r of openRoadmap) {
      const k = r.brain_id ?? "_none";
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  }, [openRoadmap]);

  // Build, dedupe and group suggestions by project, max 2 per project.
  const suggestionsGrouped = useMemo(() => {
    const all: Suggestion[] = [];

    // Per-task: review/blocked
    for (const t of openTasks) {
      if (t.status === "review" || t.status === "blocked") {
        all.push({
          id: `task-review-${t.id}`,
          kind: "task-review",
          priority: 1,
          isPriority: true,
          brain_id: t.brain_id,
          brain_name: brainName(t.brain_id),
          reason: `Task in stato "${t.status}": ${t.title}`,
          action: `Sbloccare task: ${t.title}`,
        });
      }
    }

    // Per-brain rules
    for (const b of brains) {
      const ts = tasksByBrain.get(b.id) ?? [];
      const rms = roadmapByBrain.get(b.id) ?? [];
      const nc = nodeCounts[b.id] ?? { total: 0, review: 0 };
      const srcCount = sourceCounts[b.id] ?? 0;
      const hasContent = nc.total > 0 || srcCount > 0;

      // Roadmap → task: each open roadmap item without a matching task title
      for (const rm of rms) {
        const already = ts.some((t) => t.title.toLowerCase().includes(rm.title.toLowerCase().slice(0, 20)));
        if (already) continue;
        all.push({
          id: `rm-to-task-${rm.id}`,
          kind: "roadmap-to-task",
          priority: 3,
          isPriority: true,
          brain_id: b.id,
          brain_name: b.name,
          reason: `Roadmap aperta senza task operativo: "${rm.title}"`,
          action: `Trasforma in task: ${rm.title}`,
          roadmap_id: rm.id,
        });
      }

      // Contenuti da revisionare
      if (nc.review > 0) {
        all.push({
          id: `review-${b.id}`,
          kind: "review-content",
          priority: 4,
          isPriority: true,
          brain_id: b.id,
          brain_name: b.name,
          reason: `${nc.review} contenuti marcati da revisionare`,
          action: `Revisiona contenuti del progetto ${b.name}`,
        });
      }

      // Progetto senza task
      if (ts.length === 0) {
        all.push({
          id: `no-task-${b.id}`,
          kind: "no-task",
          priority: 5,
          isPriority: true,
          brain_id: b.id,
          brain_name: b.name,
          reason: "Nessun task aperto nel progetto",
          action: `Crea primo task operativo per ${b.name}`,
        });
      }

      // Progetto senza roadmap (solo se ha task — altrimenti la mancanza di task è già il problema)
      if (rms.length === 0 && ts.length > 0) {
        all.push({
          id: `no-roadmap-${b.id}`,
          kind: "no-roadmap",
          priority: 6,
          isPriority: false,
          brain_id: b.id,
          brain_name: b.name,
          reason: "Nessuna voce di roadmap attiva",
          action: `Definisci roadmap iniziale per ${b.name}`,
        });
      }

      // Progetto senza contenuti — SKIP se ci sono brain_nodes o knowledge_sources
      if (!hasContent) {
        all.push({
          id: `no-content-${b.id}`,
          kind: "no-content",
          priority: 7,
          isPriority: false,
          brain_id: b.id,
          brain_name: b.name,
          reason: "Nessun contenuto (prompt, file, nota) salvato",
          action: `Aggiungi i primi contenuti a ${b.name}`,
        });
      }
    }

    // Sort globally by priority
    all.sort((a, b) => a.priority - b.priority);

    // Group by brain, cap 2 per project (keep the highest-priority two)
    const byBrain = new Map<string, Suggestion[]>();
    for (const s of all) {
      const k = s.brain_id ?? "_none";
      const arr = byBrain.get(k) ?? [];
      if (arr.length < 2) arr.push(s);
      byBrain.set(k, arr);
    }

    // Flatten back, preserving brain ordering by best priority then name
    const groups = Array.from(byBrain.entries()).map(([k, items]) => ({
      brain_id: k === "_none" ? null : k,
      brain_name: items[0]?.brain_name ?? "Senza progetto",
      best: Math.min(...items.map((i) => i.priority)),
      items,
    }));
    groups.sort((a, b) => a.best - b.best || a.brain_name.localeCompare(b.brain_name));
    return groups;
  }, [openTasks, brains, tasksByBrain, roadmapByBrain, nodeCounts, sourceCounts]);

  const filteredGroups = useMemo(() => {
    if (!onlyPriority) return suggestionsGrouped;
    return suggestionsGrouped
      .map((g) => ({ ...g, items: g.items.filter((i) => i.isPriority) }))
      .filter((g) => g.items.length > 0);
  }, [suggestionsGrouped, onlyPriority]);

  const totalSuggestions = filteredGroups.reduce((a, g) => a + g.items.length, 0);

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
        title: s.action,
        description: `Generato da suggerimento (${KIND_LABEL[s.kind]}) — ${s.reason}`,
        brain_id: s.brain_id,
        priority: "medium",
        status: "todo",
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
                <KindBadge label="Task reale" tone="cyan" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{t.title}</div>
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
                <KindBadge label="Task reale" tone="cyan" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{t.title}</div>
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
                <KindBadge label="Roadmap" tone="violet" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.title}</div>
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
                <KindBadge label="Contenuto da revisionare" tone="amber" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{brainName(n.brain_id)}</div>
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

      <Section
        icon={<Lightbulb className="h-4 w-4 text-amber-400" />}
        title={`Suggerimenti automatici (${totalSuggestions})`}
        actions={
          <div className="flex items-center gap-2">
            <Switch id="prio-only" checked={onlyPriority} onCheckedChange={setOnlyPriority} />
            <Label htmlFor="prio-only" className="text-xs text-muted-foreground">Solo suggerimenti prioritari</Label>
          </div>
        }
      >
        {filteredGroups.length === 0 ? (
          <Empty>Nessun suggerimento. Tutto sotto controllo.</Empty>
        ) : (
          <div className="grid gap-3">
            {filteredGroups.map((g) => (
              <Card key={g.brain_id ?? "_none"} className="bg-card/40 glass">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>{g.brain_name}</span>
                    {g.brain_id && (
                      <Link to="/progetti/$brainId" params={{ brainId: g.brain_id }}>
                        <Button size="sm" variant="ghost" className="h-7">
                          <ExternalLink className="mr-1 h-3 w-3" /> Apri progetto
                        </Button>
                      </Link>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {g.items.map((s) => (
                    <div key={s.id} className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2">
                      <KindBadge label="Suggerimento" tone="amber" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{s.action}</div>
                        <div className="text-xs text-muted-foreground">
                          <span className="mr-2 inline-block rounded border border-border bg-muted px-1.5 py-0.5 text-[10px]">{KIND_LABEL[s.kind]}</span>
                          {s.reason}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => createFromSuggestion(s)} className="bg-gradient-primary text-primary-foreground shrink-0">
                        <Plus className="mr-1 h-3 w-3" /> Crea task
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ icon, title, children, actions }: { icon: React.ReactNode; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">{icon}<span>{title}</span></div>
        {actions}
      </div>
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

function KindBadge({ label, tone }: { label: string; tone: "cyan" | "violet" | "amber" }) {
  const cls =
    tone === "cyan" ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
    : tone === "violet" ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
    : "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return <Badge variant="outline" className={`text-[10px] shrink-0 ${cls}`}>{label}</Badge>;
}
