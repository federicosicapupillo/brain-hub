import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, BookOpen, AlertTriangle } from "lucide-react";
import { listKnowledgeSources, summarizeKnowledge, SOURCE_TYPE_LABEL } from "@/lib/knowledge-map";
import { loadConfigForBrain } from "@/lib/project-console";

export function KnowledgeMapBlock({ brainId }: { brainId: string }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["knowledge-sources-block", brainId],
    enabled: !!brainId,
    queryFn: () => listKnowledgeSources(brainId),
  });
  const { data: config } = useQuery({
    queryKey: ["knowledge-block-config", brainId],
    enabled: !!brainId,
    queryFn: () => loadConfigForBrain(brainId),
  });

  const summary = useMemo(() => summarizeKnowledge(rows, config?.preset), [rows, config]);
  const recent = rows.slice(0, 4);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Knowledge Map
          </span>
          <Button asChild size="sm" variant="outline">
            <Link to="/knowledge-map" search={{ brain: brainId }}>
              Apri <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <Tile label="Totale" value={summary.total} />
          <Tile
            label="Da verificare"
            value={summary.needs_review}
            tone={summary.needs_review > 0 ? "amber" : undefined}
          />
          <Tile
            label="Mancanti"
            value={summary.missing + summary.recommended_missing.length}
            tone={summary.missing + summary.recommended_missing.length > 0 ? "red" : undefined}
          />
          <Tile
            label="Critiche"
            value={summary.critical}
            tone={summary.critical > 0 ? "red" : undefined}
          />
        </div>
        {summary.recommended_missing.length > 0 && (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-amber-600">
              <AlertTriangle className="h-3 w-3" /> Consigliate mancanti
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {summary.recommended_missing.slice(0, 5).map((r) => (
                <Badge key={r.title} variant="outline" className="text-[10px]">
                  {r.title}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {recent.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Ultime fonti
            </div>
            <ul className="space-y-1">
              {recent.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded border border-border/60 bg-background/40 p-1.5 text-xs"
                >
                  <span className="truncate">{r.title}</span>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {SOURCE_TYPE_LABEL[r.source_type]}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "red" | "amber";
}) {
  return (
    <div
      className={`rounded border p-2 ${
        tone === "red"
          ? "border-red-500/30 bg-red-500/5"
          : tone === "amber"
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-border/60 bg-background/40"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
