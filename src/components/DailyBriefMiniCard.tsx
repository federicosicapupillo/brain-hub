import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight } from "lucide-react";
import {
  getTodayOperatingBrief,
  type DailyBriefRow,
} from "@/lib/daily-operating-brief";

export function DailyBriefMiniCard({ brainId }: { brainId: string | null }) {
  const [b, setB] = useState<DailyBriefRow | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    getTodayOperatingBrief(brainId ?? null)
      .then((x) => alive && setB(x))
      .catch(() => alive && setB(null));
    return () => {
      alive = false;
    };
  }, [brainId]);

  const present = !!b;
  const topWarning = b?.warnings_summary?.top?.[0]?.title ?? null;
  const nextAction = b?.next_actions?.[0]?.title ?? null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4" /> Daily Brief
          <Badge
            variant={present ? "default" : "outline"}
            className="ml-auto"
          >
            {b === undefined ? "…" : present ? "Oggi presente" : "Non generato"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {topWarning ? (
          <div className="text-xs">
            <span className="text-muted-foreground">Warning: </span>
            <span className="font-medium">{topWarning}</span>
          </div>
        ) : null}
        {nextAction ? (
          <div className="text-xs">
            <span className="text-muted-foreground">Prossima azione: </span>
            <span className="font-medium">{nextAction}</span>
          </div>
        ) : null}
        {!present && b !== undefined ? (
          <p className="text-xs text-muted-foreground">
            Nessun briefing per oggi. Genera quello operativo.
          </p>
        ) : null}
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link to="/daily-brief" search={{ brain: brainId ?? undefined }}>
            Apri Daily Brief <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
