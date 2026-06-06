import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { tasks, brainById, type TaskStatus } from "@/lib/demo-data";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/roadmap")({
  head: () => ({ meta: [{ title: "Roadmap — AI Brain" }] }),
  component: RoadmapPage,
});

const COLUMNS: { id: TaskStatus; label: string; tint: string }[] = [
  { id: "idee", label: "Idee", tint: "var(--neon-cyan)" },
  { id: "da-fare", label: "Da fare", tint: "var(--neon-violet)" },
  { id: "in-corso", label: "In corso", tint: "var(--neon-amber)" },
  { id: "da-validare", label: "Da validare", tint: "var(--neon-pink)" },
  { id: "completato", label: "Completato", tint: "var(--neon-emerald)" },
];

function RoadmapPage() {
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Roadmap" subtitle="Visualizza i flussi di lavoro per ogni cervello." />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => t.status === col.id);
          return (
            <div key={col.id} className="flex min-h-[320px] flex-col rounded-2xl border border-border bg-card/40 p-3 glass">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="h-2 w-2 rounded-full" style={{ background: col.tint }} />
                  {col.label}
                </div>
                <Badge variant="secondary" className="font-mono text-[10px]">{items.length}</Badge>
              </div>
              <div className="flex flex-col gap-2">
                {items.map((t) => {
                  const brain = brainById(t.brainId);
                  return (
                    <div
                      key={t.id}
                      className="cursor-grab rounded-lg border border-border/70 bg-background/50 p-2.5 text-sm transition hover:border-primary/60"
                    >
                      <div className="font-medium leading-snug">{t.title}</div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ background: brain?.color }} />
                        {brain?.name}
                        <span className="ml-auto capitalize">{t.priority}</span>
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border/60 p-3 text-center text-[11px] text-muted-foreground">
                    Nessun task
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
