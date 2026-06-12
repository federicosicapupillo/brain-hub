import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Plug, ShieldAlert } from "lucide-react";
import {
  listToolLinks,
  recommendedToolsForPreset,
  summarizeTools,
  ToolLink,
} from "@/lib/tool-connections";
import { loadConfigForBrain } from "@/lib/project-console";

export function ToolConnectionsBlock({ brainId }: { brainId: string }) {
  const { data: links = [] } = useQuery<ToolLink[]>({
    queryKey: ["tool-connections-block", brainId],
    enabled: !!brainId,
    queryFn: () => listToolLinks(brainId),
  });
  const { data: config } = useQuery({
    queryKey: ["tool-connections-block-config", brainId],
    enabled: !!brainId,
    queryFn: () => loadConfigForBrain(brainId),
  });

  const summary = useMemo(() => {
    const recommended = recommendedToolsForPreset(config?.preset);
    return summarizeTools(links, recommended);
  }, [links, config]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Plug className="h-4 w-4" /> Tool Connections
          </span>
          <Button asChild size="sm" variant="outline">
            <Link to="/tool-connections" search={{ brain: brainId }}>
              Apri <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <Tile label="Collegati" value={summary.connected} />
          <Tile label="Mancanti" value={summary.missing} />
          <Tile label="Da configurare" value={summary.needs_setup} />
          <Tile
            label="Problemi"
            value={summary.broken}
            tone={summary.broken > 0 ? "red" : undefined}
          />
        </div>
        {summary.recommended_missing.length > 0 && (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
            <div className="text-[10px] uppercase tracking-wide text-amber-600">
              Consigliati mancanti
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {summary.recommended_missing.slice(0, 6).map((t) => (
                <Badge key={t} variant="outline" className="text-[10px]">
                  {t}
                </Badge>
              ))}
              {summary.recommended_missing.length > 6 && (
                <Badge variant="outline" className="text-[10px]">
                  +{summary.recommended_missing.length - 6}
                </Badge>
              )}
            </div>
          </div>
        )}
        {summary.required_missing.length > 0 && (
          <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/5 p-2 text-xs">
            <ShieldAlert className="h-3 w-3 text-red-500" />
            <span>
              {summary.required_missing.length} tool obbligatori mancanti:{" "}
              {summary.required_missing.join(", ")}
            </span>
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
  tone?: "red";
}) {
  return (
    <div
      className={`rounded border p-2 ${
        tone === "red"
          ? "border-red-500/30 bg-red-500/5"
          : "border-border/60 bg-background/40"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
