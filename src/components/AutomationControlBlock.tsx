import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, ShieldAlert, ArrowRight } from "lucide-react";
import {
  AutomationAction,
  RISK_TONE,
  STATUS_LABEL,
  listActions,
  ACTION_TYPE_LABEL,
} from "@/lib/action-queue";

export function AutomationControlBlock({ brainId }: { brainId: string }) {
  const { data: actions = [] } = useQuery<AutomationAction[]>({
    queryKey: ["action-queue-block", brainId],
    enabled: !!brainId,
    queryFn: () => listActions({ brainId }),
  });

  const stats = useMemo(() => {
    const pending = actions.filter(
      (a) => a.status === "pending_approval" || a.status === "suggested",
    );
    const high = actions.filter(
      (a) =>
        a.risk_level === "high" &&
        a.status !== "executed" &&
        a.status !== "rejected" &&
        a.status !== "cancelled",
    );
    const next = pending[0] ?? null;
    return { pendingCount: pending.length, highCount: high.length, next };
  }, [actions]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Bot className="h-4 w-4" /> Automation Control
            <Badge variant="outline" className="text-[10px]">Action Queue</Badge>
          </span>
          <Button asChild size="sm" variant="outline">
            <Link to="/action-queue">
              Apri <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Tile label="In attesa" value={stats.pendingCount} />
          <Tile label="High risk" value={stats.highCount} tone="red" />
          <Tile label="Totale" value={actions.length} />
        </div>
        {stats.next ? (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
            <div className="text-[10px] uppercase tracking-wide text-primary">
              Prossima da approvare
            </div>
            <div className="mt-0.5 text-sm font-medium">{stats.next.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Badge variant="outline" className="text-[10px]">
                {ACTION_TYPE_LABEL[stats.next.action_type]}
              </Badge>
              <Badge
                className={`border text-[10px] ${RISK_TONE[stats.next.risk_level]}`}
                variant="outline"
              >
                {stats.next.risk_level}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                {STATUS_LABEL[stats.next.status]}
              </Badge>
            </div>
          </div>
        ) : (
          <div className="rounded border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            Nessuna azione in attesa per questo progetto.
          </div>
        )}
        {stats.highCount > 0 && (
          <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/5 p-2 text-xs">
            <ShieldAlert className="h-3 w-3 text-red-500" />
            <span>
              {stats.highCount} azione/i high risk in coda — richiedono conferma esplicita.
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
      className={`rounded border p-2 ${tone === "red" ? "border-red-500/30 bg-red-500/5" : "border-border/60 bg-background/40"}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
