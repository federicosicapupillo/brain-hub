import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, FileText, ListChecks, Map as MapIcon, Plus, Sparkles, Wrench, FolderKanban } from "lucide-react";
import { toast } from "sonner";
import { findMeta, PROJECT_META, priorityColor, priorityLabel, seedMissingProjects } from "@/lib/projects-meta";
import { countLinksPerBrain } from "@/lib/project-links-api";
import { Link2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/progetti")({
  head: () => ({
    meta: [
      { title: "Progetti Collegati — Brain Hub" },
      { name: "description", content: "Dashboard operativa di tutti i tuoi progetti: file, prompt, roadmap, task e strumenti AI." },
    ],
  }),
  component: ProgettiLayout,
});

function ProgettiLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // If we're on a child detail route, only render the Outlet.
  if (pathname !== "/progetti") return <Outlet />;
  return <ProgettiDashboard />;
}

type BrainRow = {
  id: string; name: string; description: string | null; color: string;
  origin: string; kind: string; visibility: string; updated_at: string;
};

interface ProjectAggregate {
  brain: BrainRow;
  fileCount: number;
  openTasks: number;
  roadmapCount: number;
  promptNodes: number;
}

async function loadProjects(): Promise<ProjectAggregate[]> {
  const [b, s, t, r, n] = await Promise.all([
    supabase.from("brains").select("*").order("created_at", { ascending: true }),
    supabase.from("knowledge_sources").select("brain_id"),
    supabase.from("tasks").select("brain_id,status"),
    supabase.from("roadmap_items").select("brain_id"),
    supabase.from("brain_nodes").select("brain_id,type"),
  ]);
  if (b.error) throw b.error;
  const brains = (b.data ?? []) as BrainRow[];
  const sources = s.data ?? [];
  const tasks = t.data ?? [];
  const roadmap = r.data ?? [];
  const nodes = n.data ?? [];
  return brains.map((brain) => ({
    brain,
    fileCount: sources.filter((x) => x.brain_id === brain.id).length,
    openTasks: tasks.filter((x) => x.brain_id === brain.id && x.status !== "done" && x.status !== "completato").length,
    roadmapCount: roadmap.filter((x) => x.brain_id === brain.id).length,
    promptNodes: nodes.filter((x) => x.brain_id === brain.id && x.type === "prompt").length,
  }));
}

function ProgettiDashboard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["progetti-hub"], queryFn: loadProjects });
  const { data: linkCounts = {} } = useQuery({
    queryKey: ["project-links-counts"],
    queryFn: countLinksPerBrain,
  });
  const [seeding, setSeeding] = useState(false);

  const projects = data ?? [];
  const knownInDb = new Set(projects.map((p) => p.brain.name.toLowerCase()));
  const missing = PROJECT_META.filter((p) => !knownInDb.has(p.name.toLowerCase()));

  async function handleSeed() {
    setSeeding(true);
    try {
      const created = await seedMissingProjects();
      if (created.length === 0) toast("Tutti i progetti suggeriti sono già presenti.");
      else toast.success(`Creati ${created.length} progetti: ${created.join(", ")}`);
      qc.invalidateQueries({ queryKey: ["progetti-hub"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore creazione progetti");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-3rem)] p-4 lg:p-6">
      <PageHeader
        title="Progetti Collegati"
        subtitle="Tutti i tuoi progetti in un'unica dashboard operativa."
        actions={
          <Button onClick={handleSeed} disabled={seeding} variant="outline" className="gap-2">
            <Sparkles className="h-4 w-4" />
            {seeding ? "Creazione…" : missing.length > 0 ? `Aggiungi ${missing.length} progetti suggeriti` : "Progetti suggeriti aggiornati"}
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid h-64 place-items-center rounded-2xl border border-border bg-card/40 text-sm text-muted-foreground glass">
          Caricamento progetti…
        </div>
      ) : projects.length === 0 ? (
        <EmptyHub onSeed={handleSeed} seeding={seeding} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <FolderKanban className="h-4 w-4" />
            <span>{projects.length} progetti collegati</span>
            {missing.length > 0 && (
              <Badge variant="outline" className="ml-2 text-[10px]">
                {missing.length} suggeriti non ancora aggiunti
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.brain.id} project={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyHub({ onSeed, seeding }: { onSeed: () => void; seeding: boolean }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center glass">
      <div className="max-w-md">
        <div className="text-lg font-semibold text-gradient-primary">Nessun progetto ancora</div>
        <p className="mt-2 text-sm text-muted-foreground">
          Aggiungi i progetti suggeriti per partire subito con una struttura operativa, oppure crea cervelli dalla pagina Cervelli.
        </p>
        <Button onClick={onSeed} disabled={seeding} className="mt-4 bg-gradient-primary text-primary-foreground">
          {seeding ? "Creazione…" : "Aggiungi progetti suggeriti"}
        </Button>
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectAggregate }) {
  const { brain, fileCount, openTasks, roadmapCount, promptNodes } = project;
  const meta = findMeta(brain.name);

  return (
    <Card className="group flex flex-col overflow-hidden border-border/70 bg-card/60 transition hover:border-primary/60 hover:shadow-[0_0_28px_-10px_var(--primary)] glass">
      <div className="h-1.5 w-full" style={{ background: brain.color }} />
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: brain.color }} />
              <h3 className="truncate text-base font-semibold">{brain.name}</h3>
            </div>
            {meta && (
              <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{meta.category}</div>
            )}
          </div>
          {meta && (
            <Badge variant="outline" className={`shrink-0 text-[10px] ${priorityColor(meta.priority)}`}>
              {priorityLabel(meta.priority)}
            </Badge>
          )}
        </div>

        <p className="line-clamp-2 text-xs text-muted-foreground">
          {meta?.description ?? brain.description ?? "Nessuna descrizione."}
        </p>

        {meta && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="truncate">{meta.status}</span>
          </div>
        )}

        {meta && meta.tools.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {meta.tools.slice(0, 6).map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px] font-normal">
                {t}
              </Badge>
            ))}
            {meta.tools.length > 6 && (
              <Badge variant="outline" className="text-[10px]">+{meta.tools.length - 6}</Badge>
            )}
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 rounded-md border border-border/60 bg-background/40 p-2 text-center text-[11px]">
          <Stat icon={<FileText className="h-3 w-3" />} label="File" value={fileCount} />
          <Stat icon={<ListChecks className="h-3 w-3" />} label="Task" value={openTasks} />
          <Stat icon={<MapIcon className="h-3 w-3" />} label="Roadmap" value={roadmapCount} />
          <Stat icon={<Wrench className="h-3 w-3" />} label="Prompt" value={promptNodes} />
        </div>

        {meta?.nextAction && (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-[11px] text-foreground/90">
            <span className="font-medium text-primary">Prossima azione · </span>
            {meta.nextAction}
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <Button asChild size="sm" className="bg-gradient-primary text-primary-foreground">
            <Link to="/progetti/$brainId" params={{ brainId: brain.id }}>
              Apri progetto <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-[11px]">
            <Link to="/progetti/$brainId" params={{ brainId: brain.id }} search={{ tab: "roadmap" } as never}>
              Roadmap
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-[11px]">
            <Link to="/progetti/$brainId" params={{ brainId: brain.id }} search={{ tab: "prompts" } as never}>
              Prompt
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-[11px]">
            <Link to="/fonti" search={{ brain: brain.id } as never}>
              <Plus className="mr-1 h-3 w-3" /> Collegamento
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-1 text-muted-foreground">{icon}<span>{label}</span></div>
      <div className="font-semibold text-foreground">{value}</div>
    </div>
  );
}
