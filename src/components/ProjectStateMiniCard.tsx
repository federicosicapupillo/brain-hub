import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FolderKanban, ArrowRight } from "lucide-react";
import {
  getMultiProjectOverview,
  PRIORITY_TONE,
  PRIORITY_LABEL,
} from "@/lib/project-state-sync";

export function ProjectStateMiniCard({ brainId }: { brainId?: string | null }) {
  const { data: ov } = useQuery({
    queryKey: ["project-state-overview", brainId ?? null],
    queryFn: () => getMultiProjectOverview(brainId ?? null),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <FolderKanban className="h-4 w-4" /> Progetti collegati
        </CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/project-state">
            Apri <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!ov ? (
          <p className="text-muted-foreground">Carico…</p>
        ) : ov.total === 0 ? (
          <p className="text-muted-foreground">
            Nessuno snapshot. Vai a <Link to="/project-state" className="underline">Project State</Link> per creare i primi.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="font-semibold">{ov.total}</span> totali</div>
              <div><span className="font-semibold">{ov.active}</span> attivi</div>
              <div><span className="font-semibold">{ov.high_priority}</span> alta priorità</div>
              <div><span className="font-semibold">{ov.needs_update}</span> da aggiornare</div>
            </div>
            {ov.recommended_next && (
              <div className="rounded-md border bg-muted/40 p-2 text-xs">
                <div className="text-muted-foreground">Consigliato</div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{ov.recommended_next.project_name}</span>
                </div>
                {ov.recommended_next.next_action && (
                  <div className="mt-1">{ov.recommended_next.next_action}</div>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              {ov.projects.slice(0, 4).map((p) => (
                <Badge key={p.project_key} variant="outline" className={PRIORITY_TONE[p.priority]}>
                  {p.project_name} · {PRIORITY_LABEL[p.priority]}
                </Badge>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
