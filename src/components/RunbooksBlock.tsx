import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, BookMarked, Play, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  RUNBOOK_STATUS_LABEL,
  RUNBOOK_STATUS_TONE,
  RunbookInstance,
  listRunbookInstances,
  startRunbook,
  suggestRunbookFromHealth,
} from "@/lib/runbooks";

type PEL = {
  id: string;
  status: string;
  roadmap_item_id: string | null;
};
type RM = { id: string; status: string };

export function RunbooksBlock({ brainId }: { brainId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: instances = [] } = useQuery<RunbookInstance[]>({
    queryKey: ["runbook-instances-block", brainId],
    enabled: !!brainId,
    queryFn: () => listRunbookInstances({ brainId }),
  });

  const { data: logs = [] } = useQuery<PEL[]>({
    queryKey: ["runbook-block-pels", brainId],
    enabled: !!brainId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_execution_logs")
        .select("id,status,roadmap_item_id")
        .eq("brain_id", brainId);
      if (error) throw error;
      return (data ?? []) as PEL[];
    },
  });

  const { data: roadmap = [] } = useQuery<RM[]>({
    queryKey: ["runbook-block-roadmap", brainId],
    enabled: !!brainId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roadmap_items")
        .select("id,status")
        .eq("brain_id", brainId);
      if (error) throw error;
      return (data ?? []) as RM[];
    },
  });

  const stats = useMemo(() => {
    const active = instances.filter(
      (i) => i.status === "active" || i.status === "in_progress" || i.status === "waiting_approval",
    );
    const blocked = instances.filter((i) => i.status === "blocked");
    const nextStep = active[0] ?? null;
    return { active, blocked, nextStep };
  }, [instances]);

  const suggestion = useMemo(() => {
    const failed = logs.filter((l) => l.status === "failed").length;
    const pending = logs.filter((l) => l.status === "result_pending").length;
    const linkedIds = new Set(logs.map((l) => l.roadmap_item_id).filter(Boolean));
    const roadmap_no_prompts = roadmap.filter((r) => !linkedIds.has(r.id) && r.status !== "completed").length;
    const unlinked = logs.filter((l) => !l.roadmap_item_id).length;
    return suggestRunbookFromHealth({ failed, pending, roadmap_no_prompts, unlinked });
  }, [logs, roadmap]);

  async function startSuggested() {
    if (!suggestion || !brainId) return;
    if (!window.confirm(`Avviare il runbook consigliato "${suggestion.name}"?\nVerranno create ${suggestion.steps.length} azioni nella Action Queue.`)) return;
    try {
      await startRunbook({ template_key: suggestion.key, brain_id: brainId });
      toast.success("Runbook avviato", {
        action: { label: "Apri Action Queue", onClick: () => void navigate({ to: "/action-queue", search: {} }) },
      });
      qc.invalidateQueries({ queryKey: ["runbook-instances-block"] });
      qc.invalidateQueries({ queryKey: ["action-queue-block"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore avvio runbook");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <BookMarked className="h-4 w-4" /> Runbooks
            <Badge variant="outline" className="text-[10px]">v0.9</Badge>
          </span>
          <Button asChild size="sm" variant="outline">
            <Link to="/runbooks">Apri <ArrowRight className="ml-1 h-3 w-3" /></Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Attivi" value={stats.active.length} />
          <Tile label="Bloccati" value={stats.blocked.length} tone={stats.blocked.length > 0 ? "red" : undefined} />
          <Tile label="Totale" value={instances.length} />
        </div>

        {suggestion ? (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
            <div className="text-[10px] uppercase tracking-wide text-primary">Runbook consigliato</div>
            <div className="mt-0.5 text-sm font-medium">{suggestion.name}</div>
            <div className="text-[11px] text-muted-foreground">{suggestion.when_to_use}</div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={startSuggested}>
                <Play className="mr-1 h-3 w-3" /> Avvia runbook consigliato
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/runbooks">Vedi dettagli</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded border border-dashed border-border p-2 text-center text-xs text-muted-foreground">
            Nessun runbook consigliato in questo momento.
          </div>
        )}

        {stats.nextStep && (
          <div className="rounded border border-border/60 bg-background/40 p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Prossimo step attivo</div>
            <div className="text-xs font-medium truncate">{stats.nextStep.title}</div>
            <div className="mt-1 flex items-center gap-1">
              <Badge className={`border text-[10px] ${RUNBOOK_STATUS_TONE[stats.nextStep.status]}`} variant="outline">
                {RUNBOOK_STATUS_LABEL[stats.nextStep.status]}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                Step {stats.nextStep.current_step_index + 1}/{stats.nextStep.total_steps}
              </Badge>
            </div>
          </div>
        )}

        {stats.blocked.length > 0 && (
          <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/5 p-2 text-xs">
            <ShieldAlert className="h-3 w-3 text-red-500" />
            <span>{stats.blocked.length} runbook bloccati — verifica la coda.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "red" }) {
  return (
    <div
      className={`rounded border p-2 ${tone === "red" ? "border-red-500/30 bg-red-500/5" : "border-border/60 bg-background/40"}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
