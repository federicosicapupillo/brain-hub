import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail, ArrowRight, Sparkles } from "lucide-react";
import { getGmailSummary, type GmailSummary } from "@/lib/gmail-connector";
import { getGmailBrief, type GmailBrief } from "@/lib/gmail-intelligence";

export function GmailMiniCard({ brainId }: { brainId: string | null }) {
  const [s, setS] = useState<GmailSummary | null>(null);
  const [b, setB] = useState<GmailBrief | null>(null);

  useEffect(() => {
    let alive = true;
    getGmailSummary(brainId ?? null)
      .then((x) => alive && setS(x))
      .catch(() => alive && setS(null));
    getGmailBrief(brainId ?? null)
      .then((x) => alive && setB(x))
      .catch(() => alive && setB(null));
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
            <div className="grid grid-cols-4 gap-2 text-center">
              <Stat label="Oggi" value={s.todayCount} />
              <Stat label="Non lette" value={b?.today_unread ?? 0} />
              <Stat label="Important." value={b?.important_today ?? s.highPriorityCount} />
              <Stat label="Action" value={s.actionSuggestedCount} />
            </div>
            {b && b.top.length > 0 ? (
              <div className="space-y-1 rounded-md border bg-muted/30 p-2">
                <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <Sparkles className="h-3 w-3" /> Top importanti
                </div>
                <ul className="space-y-1">
                  {b.top.slice(0, 3).map((e) => (
                    <li key={e.id} className="truncate text-xs">
                      <span className="font-medium">{e.from_name ?? e.from_email ?? "—"}</span>
                      <span className="mx-1 text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{e.subject ?? "(senza oggetto)"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm" className="flex-1">
                <Link to="/gmail-intelligence" search={{ brain: brainId ?? undefined }}>
                  Intelligence <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="flex-1">
                <Link to="/gmail-connector" search={{ brain: brainId ?? undefined }}>
                  Connector
                </Link>
              </Button>
            </div>
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
