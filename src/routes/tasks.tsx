import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { tasks, brainById, agents } from "@/lib/demo-data";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/tasks")({
  head: () => ({ meta: [{ title: "Tasks — AI Brain" }] }),
  component: TasksPage,
});

const PRIORITY_TINT: Record<string, string> = {
  urgente: "border-red-500/40 bg-red-500/15 text-red-300",
  alta: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  media: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  bassa: "border-muted-foreground/40 bg-muted text-muted-foreground",
};

function TasksPage() {
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Tasks" subtitle="Lista operativa di tutti i task attivi." />
      <div className="overflow-hidden rounded-2xl border border-border bg-card/40 glass">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Titolo</TableHead>
              <TableHead>Priorità</TableHead>
              <TableHead>Cervello</TableHead>
              <TableHead>Agente</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead>Scadenza</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((t) => {
              const brain = brainById(t.brainId);
              const agent = agents.find((a) => a.id === t.agentId);
              return (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.title}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`capitalize ${PRIORITY_TINT[t.priority]}`}>{t.priority}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="h-2 w-2 rounded-full" style={{ background: brain?.color }} />
                      {brain?.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{agent?.name ?? "—"}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize">{t.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.due ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
