import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, RefreshCw } from "lucide-react";
import { sendTelegramApproval } from "@/lib/telegram-send.functions";
import {
  DELIVERY_STATUS_LABEL,
  DELIVERY_STATUS_TONE,
  type DeliveryStatus,
  logResendRequested,
  logSendFailed,
  logSendOk,
  logSendStarted,
} from "@/lib/telegram-connections";
import type { TelegramApprovalRequest } from "@/lib/telegram-approvals";

function normalizeDelivery(s: string | null | undefined): DeliveryStatus {
  if (s === "sending" || s === "sent" || s === "failed") return s;
  return "not_sent";
}

export function TelegramSendControls({
  request,
  onChanged,
  compact = false,
}: {
  request: TelegramApprovalRequest;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const delivery = normalizeDelivery(request.telegram_delivery_status);

  async function doSend(isResend: boolean) {
    if (sending) return;
    if (isResend) {
      if (!window.confirm("Reinviare la notifica Telegram?")) return;
      await logResendRequested(request.id);
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
      onChanged?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore invio";
      toast.error(msg);
      await logSendFailed(request.id, msg);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className={`text-[10px] ${DELIVERY_STATUS_TONE[delivery]}`}>
          Invio: {DELIVERY_STATUS_LABEL[delivery]}
        </Badge>
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
      {request.telegram_error_text && delivery === "failed" && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-[10px] text-red-700">
          {request.telegram_error_text}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {delivery === "not_sent" && (
          <Button size="sm" variant="outline" disabled={sending} onClick={() => doSend(false)}>
            <Send className="mr-1 h-3 w-3" /> Invia su Telegram
          </Button>
        )}
        {delivery === "sent" && (
          <Button size="sm" variant="ghost" disabled={sending} onClick={() => doSend(true)}>
            <RefreshCw className="mr-1 h-3 w-3" /> Reinvia
          </Button>
        )}
        {delivery === "failed" && (
          <Button size="sm" variant="outline" disabled={sending} onClick={() => doSend(true)}>
            <RefreshCw className="mr-1 h-3 w-3" /> Riprova invio
          </Button>
        )}
        {delivery === "sending" && (
          <span className="text-[10px] text-muted-foreground">Invio in corso…</span>
        )}
      </div>
    </div>
  );
}
