import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Plug,
  Send,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  APPROVAL_STATUS_LABEL,
  APPROVAL_STATUS_TONE,
  APPROVAL_TYPE_LABEL,
  ApprovalStatus,
  TelegramApprovalRequest,
  cancelApproval,
  listApprovalRequests,
  markReadyToSend,
  markSent,
  simulateApprove,
  simulateReject,
  summarizeApprovals,
} from "@/lib/telegram-approvals";
import { listToolLinks, normalizeStatus } from "@/lib/tool-connections";
import { RISK_TONE } from "@/lib/action-queue";
import { TelegramSettingsSection, TelegramDiagnosticsCard } from "@/components/TelegramSettingsSection";
import { TelegramSendControls } from "@/components/TelegramSendControls";

export const Route = createFileRoute("/_authenticated/telegram-approvals")({
  head: () => ({
    meta: [
      { title: "Telegram Approvals — Brain Hub" },
      {
        name: "description",
        content:
          "Livello di approvazione Telegram per azioni medium/high risk, workflow n8n, contenuti social e azioni operative.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  component: TelegramApprovalsRoute,
});

type BrainRow = { id: string; name: string; color: string };

function TelegramApprovalsRoute() {
  const { brain } = useSearch({ from: "/_authenticated/telegram-approvals" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [brainId, setBrainId] = useState<string | null>(brain ?? null);
  const [statusFilter, setStatusFilter] = useState<"all" | ApprovalStatus>("all");
  const [openDetail, setOpenDetail] = useState<TelegramApprovalRequest | null>(null);

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-min"],
    queryFn: async () => {
      const { data } = await supabase.from("brains").select("id,name,color").order("name");
      return (data ?? []) as BrainRow[];
    },
  });

  useEffect(() => {
    if (!brainId && brains.length > 0) setBrainId(brains[0].id);
  }, [brains, brainId]);

  useEffect(() => {
    if (brainId)
      navigate({ to: "/telegram-approvals", search: { brain: brainId }, replace: true });
  }, [brainId, navigate]);

  const { data: requests = [] } = useQuery({
    queryKey: ["telegram-approvals", brainId],
    queryFn: () => listApprovalRequests(brainId),
    enabled: !!brainId,
  });

  const { data: tools = [] } = useQuery({
    queryKey: ["tool-links-tg", brainId],
    queryFn: () => listToolLinks(brainId!),
    enabled: !!brainId,
  });

  const telegramTool = useMemo(
    () => tools.find((t) => t.tool_name.toLowerCase() === "telegram"),
    [tools],
  );
  const telegramStatus = telegramTool ? normalizeStatus(telegramTool.connection_status) : null;
  const telegramConnected = telegramStatus === "connected";

  const summary = useMemo(() => summarizeApprovals(requests), [requests]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return requests;
    return requests.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["telegram-approvals", brainId] });

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Telegram Approvals"
        subtitle="Brain Hub v1.7 — livello approvazioni Telegram per azioni operative importanti"
      />


      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Progetto</span>
            <Select value={brainId ?? ""} onValueChange={(v) => setBrainId(v)}>
              <SelectTrigger className="h-8 w-64">
                <SelectValue placeholder="Scegli progetto" />
              </SelectTrigger>
              <SelectContent>
                {brains.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            {telegramConnected ? (
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Telegram collegato
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
                <ShieldAlert className="mr-1 h-3 w-3" /> Telegram da configurare
              </Badge>
            )}
            <Button asChild size="sm" variant="outline">
              <Link to="/tool-connections" search={{ brain: brainId ?? undefined }}>
                <Plug className="mr-1 h-3 w-3" /> Tool Connections
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/action-queue" search={{ brain: brainId ?? undefined }}>
                Action Queue
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/operating-dashboard" search={{ brain: brainId ?? undefined }}>
                Operating Dashboard
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {!telegramConnected && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700">
          Telegram non è collegato per questo progetto. Puoi comunque creare richieste e simulare
          approvazione/rifiuto dalla UI. L'invio reale verrà attivato solo quando Telegram sarà
          configurato in modo sicuro (token gestiti via Lovable Cloud).
        </div>
      )}

      <TelegramWebhookSetupCard />

      <TelegramSettingsSection brainId={brainId} />
      <TelegramDiagnosticsCard brainId={brainId} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
        <Tile label="Totale" value={summary.total} />
        <Tile label="Pending" value={summary.pending} tone={summary.pending > 0 ? "amber" : undefined} />
        <Tile label="Approvate" value={summary.approved} tone="green" />
        <Tile label="Rifiutate" value={summary.rejected} tone={summary.rejected > 0 ? "red" : undefined} />
        <Tile label="High risk" value={summary.high_risk} tone={summary.high_risk > 0 ? "red" : undefined} />
        <Tile label="Da inviare" value={summary.ready_to_send} />
        <Tile label="Fallite" value={summary.failed} tone={summary.failed > 0 ? "red" : undefined} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Richieste di approvazione</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-8 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti gli stati</SelectItem>
                {(Object.keys(APPROVAL_STATUS_LABEL) as ApprovalStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {APPROVAL_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              Nessuna richiesta. Crea una richiesta dal dettaglio di una azione in Action Queue.
            </div>
          ) : (
            <ul className="space-y-2">
              {filtered.map((r) => (
                <li
                  key={r.id}
                  className="rounded border border-border/60 bg-background/40 p-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="outline" className={`text-[10px] ${APPROVAL_STATUS_TONE[r.status]}`}>
                          {APPROVAL_STATUS_LABEL[r.status]}
                        </Badge>
                        <Badge variant="outline" className={`text-[10px] ${RISK_TONE[r.risk_level as "low" | "medium" | "high"] ?? ""}`}>
                          {r.risk_level}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {APPROVAL_TYPE_LABEL[r.approval_type as keyof typeof APPROVAL_TYPE_LABEL] ?? r.approval_type}
                        </Badge>
                      </div>
                      <div className="mt-1 truncate font-medium">{r.title}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                        {r.automation_action_id ? " · collegata ad action" : ""}
                        {r.n8n_execution_log_id ? " · n8n log" : ""}
                        {r.runbook_instance_id ? " · runbook" : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" onClick={() => setOpenDetail(r)}>
                        Apri
                      </Button>
                      {["draft", "ready_to_send", "sent", "pending_response"].includes(r.status) && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              try {
                                await simulateApprove(r);
                                toast.success("Approvazione simulata");
                                refresh();
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Errore");
                              }
                            }}
                          >
                            <CheckCircle2 className="mr-1 h-3 w-3" /> Approva
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const reason = window.prompt("Motivo rifiuto?") ?? "";
                              if (!reason.trim()) return;
                              try {
                                await simulateReject(r, reason.trim());
                                toast.success("Rifiuto simulato");
                                refresh();
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Errore");
                              }
                            }}
                          >
                            <XCircle className="mr-1 h-3 w-3" /> Rifiuta
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              try {
                                await cancelApproval(r);
                                toast.success("Annullata");
                                refresh();
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Errore");
                              }
                            }}
                          >
                            Annulla
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!openDetail} onOpenChange={(o) => !o && setOpenDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{openDetail?.title}</DialogTitle>
          </DialogHeader>
          {openDetail && (
            <ApprovalDetail
              req={openDetail}
              telegramConnected={telegramConnected}
              onChanged={(r) => {
                setOpenDetail(r);
                refresh();
              }}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDetail(null)}>
              Chiudi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApprovalDetail({
  req,
  telegramConnected,
  onChanged,
}: {
  req: TelegramApprovalRequest;
  telegramConnected: boolean;
  onChanged: (r: TelegramApprovalRequest) => void;
}) {
  const [rejectionReason, setRejectionReason] = useState("");
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="outline" className={`text-[10px] ${APPROVAL_STATUS_TONE[req.status]}`}>
          {APPROVAL_STATUS_LABEL[req.status]}
        </Badge>
        <Badge variant="outline" className={`text-[10px] ${RISK_TONE[req.risk_level as "low" | "medium" | "high"] ?? ""}`}>
          rischio: {req.risk_level}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {APPROVAL_TYPE_LABEL[req.approval_type as keyof typeof APPROVAL_TYPE_LABEL] ?? req.approval_type}
        </Badge>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Anteprima messaggio Telegram
        </div>
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background/40 p-2 text-xs">
          {req.message_preview ?? "(nessuna anteprima)"}
        </pre>
      </div>

      {req.payload_preview && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Payload preview
          </div>
          <pre className="mt-1 max-h-48 overflow-auto rounded border border-border/60 bg-background/40 p-2 text-[10px]">
            {JSON.stringify(req.payload_preview, null, 2)}
          </pre>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Action</div>
          {req.automation_action_id ? (
            <Link
              to="/action-queue"
              search={{ brain: req.brain_id ?? undefined }}
              className="text-primary underline inline-flex items-center gap-1"
            >
              Apri <ExternalLink className="h-3 w-3" />
            </Link>
          ) : (
            <div className="text-muted-foreground">—</div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">n8n log</div>
          <div className="text-muted-foreground">{req.n8n_execution_log_id ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Runbook</div>
          <div className="text-muted-foreground">{req.runbook_instance_id ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Telegram chat</div>
          <div className="text-muted-foreground">{req.telegram_chat_id ?? "—"}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
          <div className="font-semibold text-emerald-700">Se approvi</div>
          <div className="text-emerald-900/80">
            La richiesta passa a "Approvata" e l'eventuale automation_action collegata viene
            marcata come approvata via Telegram. Nessuna esecuzione automatica.
          </div>
        </div>
        <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs">
          <div className="font-semibold text-red-700">Se rifiuti</div>
          <div className="text-red-900/80">
            La richiesta passa a "Rifiutata". L'azione collegata resta bloccata in attesa di nuova
            revisione, con motivazione salvata.
          </div>
        </div>
      </div>

      {!telegramConnected && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700">
          Telegram non configurato in Tool Connections — puoi comunque inviare la notifica reale se
          il server token è configurato e hai una destinazione abilitata.
        </div>
      )}

      <div className="rounded border border-sky-500/30 bg-sky-500/5 p-2">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-sky-700">
          Invio reale su Telegram
        </div>
        <TelegramSendControls request={req} onChanged={() => onChanged(req)} showHistory />
      </div>

      <div className="flex flex-wrap gap-2">
        {req.status === "draft" && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const next = await markReadyToSend(req);
                toast.success("Pronta da inviare");
                onChanged(next);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Errore");
              }
            }}
          >
            Segna pronta
          </Button>
        )}
        {req.status === "ready_to_send" && telegramConnected && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const next = await markSent(req);
                toast.success("Predisposta per invio (no invio reale)");
                onChanged(next);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Errore");
              }
            }}
          >
            Predisponi invio
          </Button>
        )}
        {["draft", "ready_to_send", "sent", "pending_response"].includes(req.status) && (
          <>
            <Button
              size="sm"
              onClick={async () => {
                try {
                  const next = await simulateApprove(req);
                  toast.success("Approvazione simulata");
                  onChanged(next);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Errore");
                }
              }}
            >
              <CheckCircle2 className="mr-1 h-3 w-3" /> Simula approvazione
            </Button>
          </>
        )}
      </div>

      {["draft", "ready_to_send", "sent", "pending_response"].includes(req.status) && (
        <div className="space-y-2 rounded border border-red-500/30 bg-red-500/5 p-2">
          <div className="text-xs font-semibold text-red-700">Simula rifiuto</div>
          <Textarea
            rows={2}
            placeholder="Motivo del rifiuto..."
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={!rejectionReason.trim()}
            onClick={async () => {
              try {
                const next = await simulateReject(req, rejectionReason.trim());
                toast.success("Rifiuto simulato");
                setRejectionReason("");
                onChanged(next);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Errore");
              }
            }}
          >
            <XCircle className="mr-1 h-3 w-3" /> Simula rifiuto
          </Button>
        </div>
      )}

      {req.rejection_reason && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs">
          <div className="font-semibold text-red-700">Motivo rifiuto</div>
          <div>{req.rejection_reason}</div>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground">
        Creata {new Date(req.created_at).toLocaleString()}
        {req.approved_at && ` · approvata ${new Date(req.approved_at).toLocaleString()}`}
        {req.rejected_at && ` · rifiutata ${new Date(req.rejected_at).toLocaleString()}`}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "red" | "amber" | "green";
}) {
  const cls =
    tone === "red"
      ? "border-red-500/30 bg-red-500/10 text-red-600"
      : tone === "amber"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
      : tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
      : "border-border bg-background/40";
  return (
    <div className={`rounded border p-2 text-center ${cls}`}>
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}
