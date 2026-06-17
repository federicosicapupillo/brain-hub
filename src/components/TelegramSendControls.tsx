import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, History, RefreshCw, Send, Unlock } from "lucide-react";
import { sendTelegramApproval, checkTelegramTokenConfig } from "@/lib/telegram-send.functions";
import {
  DELIVERY_STATUS_LABEL,
  DELIVERY_STATUS_TONE,
  type DeliveryStatus,
  getTelegramDeliveryAge,
  isTelegramDeliveryStale,
  listDeliveryAttempts,
  listTelegramConnections,
  logResendRequested,
  logRetryStarted,
  logSendFailed,
  logSendOk,
  logSendStarted,
  logStaleDetected,
  markTelegramDeliveryFailedManual,
} from "@/lib/telegram-connections";
import type { TelegramApprovalRequest } from "@/lib/telegram-approvals";

function normalizeDelivery(s: string | null | undefined): DeliveryStatus {
  if (s === "sending" || s === "sent" || s === "failed") return s;
  return "not_sent";
}

function formatAge(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s fa`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m fa`;
  const h = Math.round(m / 60);
  return `${h}h fa`;
}

export function TelegramSendControls({
  request,
  onChanged,
  compact = false,
  showHistory = false,
}: {
  request: TelegramApprovalRequest;
  onChanged?: () => void;
  compact?: boolean;
  showHistory?: boolean;
}) {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const delivery = normalizeDelivery(request.telegram_delivery_status);
  const stale = isTelegramDeliveryStale(request);
  const age = getTelegramDeliveryAge(request);

  const { data: tokenStatus } = useQuery({
    queryKey: ["telegram-token-config"],
    queryFn: () => checkTelegramTokenConfig(),
    staleTime: 30_000,
  });
  const { data: connections = [] } = useQuery({
    queryKey: ["telegram-connections", request.brain_id],
    queryFn: () => listTelegramConnections(request.brain_id),
    staleTime: 30_000,
  });
  const { data: attempts = [] } = useQuery({
    queryKey: ["telegram-delivery-attempts", request.id],
    queryFn: () => listDeliveryAttempts(request.id),
    enabled: showHistory,
  });

  useEffect(() => {
    if (stale) {
      void logStaleDetected(request.id, age ?? 0);
    }
  }, [stale, request.id, age]);

  const tokenConfigured = !!tokenStatus?.configured;
  const hasEnabled = connections.some((c) => c.is_enabled);

  async function doSend(mode: "send" | "resend" | "retry") {
    if (sending) return;
    if (!tokenConfigured) {
      toast.error("Token server Telegram non configurato.");
      return;
    }
    if (!hasEnabled) {
      toast.error("Nessuna destinazione Telegram abilitata.");
      return;
    }
    if (mode === "resend") {
      if (!window.confirm("Reinviare la notifica Telegram? È già stata inviata.")) return;
      await logResendRequested(request.id);
    }
    if (mode === "retry") {
      await logRetryStarted(request.id);
    }
    setSending(true);
    try {
      await logSendStarted(request.id);
      const res = await sendTelegramApproval({
        data: {
          approval_request_id: request.id,
          origin_url: window.location.origin,
        },
      });
      if (res.ok) {
        toast.success("Notifica Telegram inviata");
        await logSendOk(request.id, res.message_id, res.chat_id);
      } else {
        toast.error(res.error ?? "Invio fallito");
        await logSendFailed(request.id, res.error ?? "unknown");
      }
      qc.invalidateQueries({ queryKey: ["telegram-approvals"] });
      qc.invalidateQueries({ queryKey: ["telegram-approvals-action"] });
      qc.invalidateQueries({ queryKey: ["telegram-delivery-attempts", request.id] });
      onChanged?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore invio";
      toast.error(msg);
      await logSendFailed(request.id, msg);
    } finally {
      setSending(false);
    }
  }

  async function unblockAndRetry() {
    try {
      await markTelegramDeliveryFailedManual(
        request.id,
        "Invio sospeso oltre 5 minuti — sbloccato manualmente",
      );
      qc.invalidateQueries({ queryKey: ["telegram-approvals"] });
      qc.invalidateQueries({ queryKey: ["telegram-approvals-action"] });
      await doSend("retry");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore sblocco");
    }
  }

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className={`text-[10px] ${DELIVERY_STATUS_TONE[delivery]}`}>
          Invio: {DELIVERY_STATUS_LABEL[delivery]}
        </Badge>
        {stale && (
          <Badge
            variant="outline"
            className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700"
          >
            <AlertTriangle className="mr-1 h-3 w-3" /> Sospeso da {formatAge(age)}
          </Badge>
        )}
        {request.telegram_sent_at && (
          <span className="text-[10px] text-muted-foreground">
            {new Date(request.telegram_sent_at).toLocaleString()}
          </span>
        )}
        {request.telegram_chat_id && (
          <span className="text-[10px] text-muted-foreground">chat: {request.telegram_chat_id}</span>
        )}
        {request.telegram_message_id && (
          <span className="text-[10px] text-muted-foreground">msg #{request.telegram_message_id}</span>
        )}
      </div>

      {!tokenConfigured && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700">
          Token server Telegram non configurato. L'invio reale è disabilitato finché
          <code> TELEGRAM_BOT_TOKEN </code> non è impostato lato server.
        </div>
      )}
      {tokenConfigured && !hasEnabled && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700">
          Nessuna destinazione Telegram abilitata. Configurane una in Telegram Approvals.
        </div>
      )}
      {stale && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700">
          Invio rimasto sospeso. Non viene segnato come inviato automaticamente: sblocca e
          riprova manualmente.
        </div>
      )}
      {request.telegram_error_text && delivery === "failed" && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-[10px] text-red-700">
          {request.telegram_error_text}
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {delivery === "not_sent" && !stale && (
          <Button size="sm" variant="outline" disabled={sending} onClick={() => doSend("send")}>
            <Send className="mr-1 h-3 w-3" /> Invia su Telegram
          </Button>
        )}
        {delivery === "sent" && (
          <Button size="sm" variant="ghost" disabled={sending} onClick={() => doSend("resend")}>
            <RefreshCw className="mr-1 h-3 w-3" /> Reinvia
          </Button>
        )}
        {delivery === "failed" && (
          <Button size="sm" variant="outline" disabled={sending} onClick={() => doSend("retry")}>
            <RefreshCw className="mr-1 h-3 w-3" /> Riprova invio
          </Button>
        )}
        {delivery === "sending" && !stale && (
          <span className="text-[10px] text-muted-foreground">Invio in corso…</span>
        )}
        {stale && (
          <Button
            size="sm"
            variant="outline"
            disabled={sending}
            onClick={unblockAndRetry}
            className="border-amber-500/40 text-amber-700"
          >
            <Unlock className="mr-1 h-3 w-3" /> Sblocca e riprova
          </Button>
        )}
      </div>

      {showHistory && attempts.length > 0 && (
        <div className="rounded border border-border/60 bg-background/40 p-2 text-[10px]">
          <div className="mb-1 flex items-center gap-1 font-medium text-muted-foreground">
            <History className="h-3 w-3" /> Storico invii ({attempts.length})
          </div>
          <ul className="space-y-1">
            {attempts.slice(0, 5).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-1">
                <Badge
                  variant="outline"
                  className={`text-[9px] ${
                    DELIVERY_STATUS_TONE[normalizeDelivery(a.delivery_status)]
                  }`}
                >
                  #{a.attempt_number} {a.delivery_status}
                </Badge>
                <span className="text-muted-foreground">
                  {new Date(a.created_at).toLocaleString()}
                </span>
                {a.telegram_message_id && (
                  <span className="text-muted-foreground">msg {a.telegram_message_id}</span>
                )}
                {a.error_text && (
                  <span className="truncate text-red-600" title={a.error_text}>
                    {a.error_text.slice(0, 80)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
