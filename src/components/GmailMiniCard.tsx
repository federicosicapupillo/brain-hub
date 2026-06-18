import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail, ArrowRight } from "lucide-react";
import { getGmailSummary, type GmailSummary } from "@/lib/gmail-connector";

export function GmailMiniCard({ brainId }: { brainId: string | null }) {
  const [s, setS] = useState<GmailSummary | null>(null);
  useEffect(() => {
    let alive = true;
    getGmailSummary(brainId ?? null)
      .then((x) => alive && setS(x))
      .catch(() => alive && setS(null));
    return () => {
      alive = false;
    };
  }, [brainId]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Mail className="h-4 w-4" /> Email
          {s ? (
            <Badge variant={s.connected ? "default" : "outline"} className="ml-auto">
              {s.connected ? "Gmail collegato" : "Non collegato"}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {s ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Oggi" value={s.todayCount} />
              <Stat label="High" value={s.highPriorityCount} />
              <Stat label="Da action" value={s.actionSuggestedCount} />
            </div>
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link to="/gmail-connector" search={{ brain: brainId ?? undefined }}>
                Apri Gmail Connector <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">Caricamento…</p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
    </div>
  );
}
