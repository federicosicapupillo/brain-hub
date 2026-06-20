import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Bot, ShieldCheck, ShieldAlert } from "lucide-react";
import {
  getUiOperatorConfigFn,
  listUiOperatorSessionsFn,
  listUiOperatorActionsFn,
} from "@/lib/ui-operator.functions";

export function UiOperatorMiniCard() {
  const cfgFn = useServerFn(getUiOperatorConfigFn);
  const sessionsFn = useServerFn(listUiOperatorSessionsFn);
  const actionsFn = useServerFn(listUiOperatorActionsFn);

  const cfg = useQuery({ queryKey: ["ui-operator-config"], queryFn: () => cfgFn({ data: {} }) });
  const sessions = useQuery({
    queryKey: ["ui-operator-sessions"],
    queryFn: () => sessionsFn({ data: {} }),
  });
  const actions = useQuery({
    queryKey: ["ui-operator-actions-all"],
    queryFn: () => actionsFn({ data: { session_id: null } }),
  });

  const openSessions =
    sessions.data?.sessions.filter((s) => s.status !== "stopped" && s.status !== "expired") ?? [];
  const proposed = actions.data?.actions.filter((a) => a.status === "proposed").length ?? 0;
  const blocked = actions.data?.actions.filter((a) => a.status === "blocked").length ?? 0;
  const configured = !!cfg.data?.configured;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bot className="h-4 w-4" /> UI Operator
          <Badge variant={configured ? "default" : "outline"} className="ml-auto">
            {configured ? "Browserbase pronto" : "Mock mode"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="h-3 w-3" /> Sessioni aperte: {openSessions.length}
          </Badge>
          <Badge variant="outline">Proposte: {proposed}</Badge>
          <Badge variant="outline" className="gap-1">
            <ShieldAlert className="h-3 w-3" /> Bloccate: {blocked}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Jack può aprire, osservare e proporre azioni nelle pagine interne. Niente click
          senza la tua conferma.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link to="/ui-operator-lab">
            Apri UI Operator Lab <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
