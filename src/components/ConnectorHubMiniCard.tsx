import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plug } from "lucide-react";
import { getConnectorHubSummary } from "@/lib/connector-hub";

export function ConnectorHubMiniCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["connector-hub", "summary"],
    queryFn: getConnectorHubSummary,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4" /> Connector Hub
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading || !data ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="Read-only" value={data.read_only} />
              <Stat label="Connessi" value={data.connected} />
              <Stat label="Warning" value={data.warnings + data.errors} />
              <Stat label="Manuali" value={data.manual} />
              <Stat label="Fonti mappate" value={data.mappings_total} />
              <Stat label="Progetti collegati" value={data.projects_with_mappings} />
            </div>
            {data.not_configured > 0 ? (
              <Badge variant="outline" className="bg-muted">
                {data.not_configured} non ancora configurati
              </Badge>
            ) : null}
            <Button asChild size="sm" variant="outline" className="w-full">
              <Link to="/connector-hub">Apri Connector Hub</Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}
