import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  REVIEW_STATUS_LABEL,
  REVIEW_STATUS_TONE,
  ResultReviewItem,
  ReviewSourceType,
  createReviewItemFromSource,
} from "@/lib/result-review";

async function logEvent(action: string, notes: string, metadata: Record<string, unknown>) {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("clipboard_execution_logs").insert({
      user_id: u.user.id,
      clipboard_item_id: null,
      action,
      notes,
      metadata,
    } as never);
  } catch {
    /* non-critical */
  }
}

type Props = {
  sourceType: ReviewSourceType;
  sourceId: string;
  title?: string;
  createdEvent?: string;
  openedEvent?: string;
  compact?: boolean;
};

export function ResultReviewBox({
  sourceType,
  sourceId,
  title = "Result Review",
  createdEvent,
  openedEvent,
  compact = false,
}: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["result-review-by-source", sourceType, sourceId],
    queryFn: async () => {
      const { data } = await supabase
        .from("result_review_items" as never)
        .select("*")
        .eq("source_type", sourceType)
        .eq("source_id", sourceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data ?? null) as unknown as ResultReviewItem | null;
    },
  });

  async function handleCreate() {
    setBusy(true);
    try {
      const item = await createReviewItemFromSource(sourceType, sourceId);
      if (createdEvent) {
        await logEvent(createdEvent, `Review creata da ${sourceType}`, {
          review_id: item.id,
          source_type: sourceType,
          source_id: sourceId,
        });
      }
      toast.success("Review creata");
      qc.invalidateQueries({ queryKey: ["result-review-by-source", sourceType, sourceId] });
      qc.invalidateQueries({ queryKey: ["result-review-items"] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen() {
    if (openedEvent && existing) {
      await logEvent(openedEvent, `Review aperta da ${sourceType}`, {
        review_id: existing.id,
        source_type: sourceType,
        source_id: sourceId,
      });
    }
    navigate({ to: "/result-review", search: {} });
  }

  return (
    <div className={`rounded border border-border/60 bg-background/40 p-2 ${compact ? "text-[11px]" : "text-xs"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">{title}</span>
          {existing && (
            <Badge variant="outline" className={REVIEW_STATUS_TONE[existing.review_status]}>
              {REVIEW_STATUS_LABEL[existing.review_status]}
            </Badge>
          )}
        </div>
        {existing ? (
          <Button size="sm" variant="outline" onClick={handleOpen}>
            Apri review <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy || isLoading} onClick={handleCreate}>
            {sourceType === "n8n_execution_log"
              ? "Crea review da questo risultato n8n"
              : "Crea review da questa action"}
          </Button>
        )}
      </div>
      {!existing && !isLoading && (
        <div className="mt-1 text-muted-foreground">
          Nessuna review collegata.{" "}
          <Link to="/result-review" search={{}} className="underline">Vai a Result Review</Link>
        </div>
      )}
    </div>
  );
}
