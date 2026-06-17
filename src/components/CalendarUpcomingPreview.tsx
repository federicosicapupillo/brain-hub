// ============================================================
// Brain Hub v3.0 — Calendar preview (Company Home / Operating Dashboard)
// ============================================================
// READ-ONLY. Mostra i prossimi eventi senza modificare nulla.
// ============================================================

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarClock, CalendarDays } from "lucide-react";
import {
  getCalendarKnowledgeSummary,
  listUpcomingCalendarEvents,
} from "@/lib/calendar-knowledge";

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function CalendarUpcomingPreview({
  brainId,
  compact = false,
}: {
  brainId?: string | null;
  compact?: boolean;
}) {
  const { data: summary } = useQuery({
    queryKey: ["calendar-summary", brainId ?? null],
    queryFn: () => getCalendarKnowledgeSummary(brainId ?? null),
  });
  const { data: events = [] } = useQuery({
    queryKey: ["calendar-upcoming", brainId ?? null, compact ? "compact" : "full"],
    queryFn: () =>
      listUpcomingCalendarEvents({
        brainId: brainId ?? null,
        limit: compact ? 3 : 6,
      }),
  });

  const isConfigured = (summary?.connections ?? 0) > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarClock className="h-4 w-4" />
          Prossimi eventi calendario
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            Oggi: {summary?.eventsToday ?? 0}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            7 giorni: {summary?.eventsThisWeek ?? 0}
          </Badge>
          <Badge
            variant="outline"
            className={
              isConfigured
                ? "border-emerald-500/40 text-emerald-600 text-[10px]"
                : "border-amber-500/40 text-amber-600 text-[10px]"
            }
          >
            {isConfigured ? "collegato" : "non configurato"}
          </Badge>
        </div>
        {events.length === 0 ? (
          <p className="text-muted-foreground">
            {isConfigured
              ? "Nessun evento futuro in agenda."
              : "Collega Google Calendar per vedere riunioni e scadenze."}
          </p>
        ) : (
          <ul className="space-y-1">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-1 first:border-t-0 first:pt-0"
              >
                <CalendarDays className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{e.title}</span>
                <span className="text-muted-foreground">{fmtWhen(e.start_at)}</span>
                {e.calendar_name && (
                  <span className="text-muted-foreground">· {e.calendar_name}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <Button asChild size="sm" variant="outline" className="w-full">
          <Link to="/calendar-knowledge" search={{ brain: brainId ?? undefined }}>
            Apri Calendar <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
