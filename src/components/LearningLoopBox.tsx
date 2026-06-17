import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Brain,
  Sparkles,
  CheckCircle2,
  XCircle,
  PlayCircle,
  ExternalLink,
  RefreshCcw,
} from "lucide-react";
import {
  LearningLoopSuggestion,
  SUGGESTION_STATUS_LABEL,
  SUGGESTION_STATUS_TONE,
  SUGGESTION_TYPE_LABEL,
  SuggestionStatus,
  SuggestionType,
  acceptLearningSuggestion,
  applyLearningSuggestion,
  createActionFromSuggestion,
  createKnowledgeNoteFromSuggestion,
  createNextPromptFromSuggestion,
  generateSuggestionsFromReview,
  listLearningSuggestions,
  rejectLearningSuggestion,
} from "@/lib/learning-loop";
import { ResultReviewItem } from "@/lib/result-review";
import { useNavigate } from "@tanstack/react-router";

export function LearningLoopBox({ review }: { review: ResultReviewItem }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ["learning-loop", review.id],
    queryFn: () => listLearningSuggestions({ result_review_item_id: review.id }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["learning-loop", review.id] });

  async function run<T>(key: string, label: string, fn: () => Promise<T>) {
    setBusy(key);
    try {
      await fn();
      toast.success(label);
      refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    if (
      suggestions.length > 0 &&
      !window.confirm("Esistono già suggerimenti per questa review. Generare comunque nuovi suggerimenti?")
    ) {
      return;
    }
    await run("gen", "Suggerimenti generati", () =>
      generateSuggestionsFromReview(review.id, { force: suggestions.length > 0 }),
    );
  }

  const canGenerate = ["approved", "needs_fix", "failed"].includes(review.review_status);

  return (
    <div className="rounded border p-3 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-indigo-500" />
          <div>
            <div className="text-sm font-medium">Learning Loop</div>
            <div className="text-xs text-muted-foreground">
              Cosa ha imparato Brain Hub da questo risultato?
            </div>
          </div>
        </div>
        {canGenerate && (
          <Button size="sm" variant="outline" onClick={regenerate} disabled={busy === "gen"}>
            {suggestions.length === 0 ? (
              <>
                <Sparkles className="mr-2 h-4 w-4" /> Genera suggerimenti
              </>
            ) : (
              <>
                <RefreshCcw className="mr-2 h-4 w-4" /> Rigenera
              </>
            )}
          </Button>
        )}
      </div>

      {!canGenerate && suggestions.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nessun suggerimento consigliato per questo stato review.
        </p>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Caricamento…</p>
      ) : suggestions.length === 0 && canGenerate ? (
        <p className="text-xs text-muted-foreground">
          Nessun suggerimento ancora. Clicca "Genera suggerimenti".
        </p>
      ) : (
        <div className="space-y-2">
          {suggestions.map((s) => (
            <SuggestionRow
              key={s.id}
              s={s}
              busy={busy}
              onAccept={() => run(`acc-${s.id}`, "Accettato", () => acceptLearningSuggestion(s.id))}
              onReject={() => {
                const reason = window.prompt("Motivo (opzionale)") ?? undefined;
                run(`rej-${s.id}`, "Rifiutato", () => rejectLearningSuggestion(s.id, reason));
              }}
              onApply={() => run(`app-${s.id}`, "Applicato", () => applyLearningSuggestion(s.id))}
              onNextPrompt={() =>
                run(`np-${s.id}`, "Prompt creato e copiato", () => createNextPromptFromSuggestion(s.id))
              }
              onKnowledgeNote={() =>
                run(`kn-${s.id}`, "Nota knowledge creata", () => createKnowledgeNoteFromSuggestion(s.id))
              }
              onAction={() =>
                run(`act-${s.id}`, "Action creata", () => createActionFromSuggestion(s.id))
              }
              onOpenObject={() => {
                if (s.applied_object_type === "automation_action") {
                  navigate({ to: "/action-queue", search: {} });
                } else if (s.applied_object_type === "knowledge_source") {
                  navigate({ to: "/knowledge-map", search: {} });
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionRow({
  s,
  busy,
  onAccept,
  onReject,
  onApply,
  onNextPrompt,
  onKnowledgeNote,
  onAction,
  onOpenObject,
}: {
  s: LearningLoopSuggestion;
  busy: string | null;
  onAccept: () => void;
  onReject: () => void;
  onApply: () => void;
  onNextPrompt: () => void;
  onKnowledgeNote: () => void;
  onAction: () => void;
  onOpenObject: () => void;
}) {
  const type = s.suggestion_type as SuggestionType;
  const status = s.suggestion_status as SuggestionStatus;
  const isApplied = status === "applied";
  const isRejected = status === "rejected";
  return (
    <div className="rounded border bg-background p-2 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{SUGGESTION_TYPE_LABEL[type] ?? type}</Badge>
        <Badge variant="outline" className={SUGGESTION_STATUS_TONE[status]}>
          {SUGGESTION_STATUS_LABEL[status] ?? status}
        </Badge>
        {s.risk_level && <Badge variant="outline">Rischio: {s.risk_level}</Badge>}
      </div>
      <div className="text-sm font-medium">{s.title}</div>
      {s.description && <div className="text-xs text-muted-foreground">{s.description}</div>}

      {!isApplied && !isRejected && (
        <div className="flex flex-wrap gap-1 pt-1">
          {status === "suggested" && (
            <>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={onAccept}>
                <CheckCircle2 className="mr-1 h-3 w-3" /> Accetta
              </Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={onReject}>
                <XCircle className="mr-1 h-3 w-3" /> Rifiuta
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" disabled={!!busy} onClick={onApply}>
            <PlayCircle className="mr-1 h-3 w-3" /> Applica
          </Button>
          {type === "next_prompt" && (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={onNextPrompt}>
              <Sparkles className="mr-1 h-3 w-3" /> Crea prossimo prompt
            </Button>
          )}
          {type === "knowledge_note" && (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={onKnowledgeNote}>
              Crea nota knowledge
            </Button>
          )}
          {(type === "automation_action" || type === "issue_to_fix") && (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={onAction}>
              Crea action
            </Button>
          )}
        </div>
      )}

      {isApplied && s.applied_object_type && s.applied_object_type !== "next_prompt" && (
        <div className="pt-1">
          <Button size="sm" variant="ghost" onClick={onOpenObject}>
            <ExternalLink className="mr-1 h-3 w-3" /> Apri oggetto creato
          </Button>
        </div>
      )}
    </div>
  );
}
