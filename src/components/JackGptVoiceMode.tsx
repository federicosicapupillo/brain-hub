import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  Mic,
  MicOff,
  Sparkles,
  ShieldCheck,
  Brain,
  FileText,
  Activity,
  RotateCcw,
  Radio,
} from "lucide-react";
import { toast } from "sonner";
import {
  getOpenAiRealtimeStatus,
  createJackRealtimeSession,
  type OpenAiRealtimeStatus,
  type CreateRealtimeSessionResult,
  REALTIME_CALLS_ENDPOINT,
  REALTIME_CLIENT_SECRETS_ENDPOINT,
} from "@/lib/openai-realtime.functions";
import { runJackGptTool, logJackGptEvent } from "@/lib/jack-gpt-tools";
import { createControlledJackActionFromPreview } from "@/lib/jack-controlled-actions.functions";
import { getAutomationActionById, type AutomationAction } from "@/lib/action-queue";
import {
  buildJackPreviewId,
  hashJackActionText,
  isExplicitJackConfirmation,
  redactJackIdempotencyKey,
  type PendingJackActionPreview,
} from "@/lib/jack-action-confirmation";
import { JACK_GPT_PRIVACY_NOTICE, JACK_GPT_SYSTEM_INSTRUCTIONS } from "@/lib/jack-gpt-instructions";
import { buildJackNaturalContext } from "@/lib/jack-natural-context.functions";
import {
  classifyRealtimeStartError,
  isActiveResponseInProgressError,
  SUGGESTED_REALTIME_MODELS,
  type ClassifiedRealtimeStartError,
} from "@/lib/jack-gpt-error-classifier";

type ConnState =
  | "idle"
  | "not_configured"
  | "checking"
  | "requesting_mic"
  | "creating_session"
  | "connecting"
  | "listening"
  | "speaking"
  | "error";

type MicState = "unknown" | "granted" | "denied" | "unavailable" | "unsupported";
type SessionMode = "none" | "full" | "minimal";
type LogKind = "user" | "jack" | "tool" | "system" | "error" | "warning";
type LogEntry = { id: string; ts: number; kind: LogKind; text: string };

type ResponseLifecycleState =
  | "idle"
  | "response_starting"
  | "response_active"
  | "response_finishing"
  | "tool_waiting"
  | "response_active_unknown"
  | "error";

type SafeCreateResponseOptions = { queueIfBusy?: boolean };

type ActiveSession = Extract<CreateRealtimeSessionResult, { ok: true; probe: false }>;

type RealtimeEvent = {
  type?: string;
  transcript?: string;
  delta?: string;
  response_id?: string;
  item_id?: string;
  response?: { id?: string; status?: string };
  item?: {
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  error?: { message?: string; code?: string; type?: string };
  call_id?: string;
  name?: string;
  arguments?: string;
};

type TestConnectionResult = {
  ok: boolean;
  configured: boolean;
  model: string | null;
  model_source: OpenAiRealtimeStatus["model_source"] | null;
  warning: string | null;
  privacy_mode: OpenAiRealtimeStatus["privacy_mode"] | null;
  server_time: string | null;
  message: string;
};

type RealtimeSessionTestResult = {
  ok: boolean;
  model: string | null;
  expires_at: number | null;
  openai_request_id: string | null;
  status_code: number | null;
  message: string;
};

type Diagnostics = {
  sessionMode: SessionMode;
  dataChannelState: RTCDataChannelState | "none";
  lastEventType: string | null;
  lastSafeError: string | null;
  lastErrorKind: string | null;
  lastToolCalled: string | null;
  cleanupCount: number;
  lastTest: TestConnectionResult | null;
  lastRealtimeProbe: RealtimeSessionTestResult | null;
  lastOpenAiStatus: number | null;
  lastOpenAiRequestId: string | null;
  sdpEndpointStatus: number | null;
  responseState: ResponseLifecycleState;
  activeResponseIdRedacted: string | null;
  pendingResponse: boolean;
  lastResponseCreateReason: string | null;
  lastResponseCreateAt: number | null;
  lastResponseDoneAt: number | null;
  skippedResponseCreateCount: number;
  duplicateResponseHandledCount: number;
};

type Props = { brainId?: string | null };

function classifyMediaError(err: unknown): { mic: MicState; friendly: string; technical: string } {
  const e = err as { name?: string; message?: string } | null;
  const name = e?.name ?? "";
  const message = e?.message ?? String(err ?? "");
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      mic: "denied",
      friendly: "Microfono non autorizzato. Concedi i permessi al sito e riprova.",
      technical: name,
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { mic: "unavailable", friendly: "Nessun microfono rilevato.", technical: name };
  }
  if (name === "NotReadableError") {
    return {
      mic: "unavailable",
      friendly: "Microfono occupato da un'altra applicazione.",
      technical: name,
    };
  }
  return { mic: "unknown", friendly: "Errore microfono.", technical: message.slice(0, 120) };
}

export function JackGptVoiceMode({ brainId = null }: Props) {
  const [state, setState] = useState<ConnState>("checking");
  const [status, setStatus] = useState<OpenAiRealtimeStatus | null>(null);
  const [micState, setMicState] = useState<MicState>("unknown");
  const [lastError, setLastError] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [testing, setTesting] = useState(false);
  const [probing, setProbing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics>({
    sessionMode: "none",
    dataChannelState: "none",
    lastEventType: null,
    lastSafeError: null,
    lastErrorKind: null,
    lastToolCalled: null,
    cleanupCount: 0,
    lastTest: null,
    lastRealtimeProbe: null,
    lastOpenAiStatus: null,
    lastOpenAiRequestId: null,
    sdpEndpointStatus: null,
    responseState: "idle",
    activeResponseIdRedacted: null,
    pendingResponse: false,
    lastResponseCreateReason: null,
    lastResponseCreateAt: null,
    lastResponseDoneAt: null,
    skippedResponseCreateCount: 0,
    duplicateResponseHandledCount: 0,
  });

  const responseInProgressRef = useRef(false);
  const activeResponseIdRef = useRef<string | null>(null);
  const pendingResponseCreateRef = useRef<{ reason: string } | null>(null);
  const lastResponseCreateAtRef = useRef<number>(0);
  const lastResponseDoneAtRef = useRef<number>(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const RESPONSE_CREATE_DEBOUNCE_MS = 400;

  // v3.21.2 — tool-call dedup + batching + transcript dedup
  const toolCallInFlightCountRef = useRef<number>(0);
  const processedToolCallIdsRef = useRef<Set<string>>(new Set());
  const lastToolCallKeyRef = useRef<{ key: string; at: number } | null>(null);
  const TOOL_CALL_CLIENT_DEDUP_MS = 3000;
  const transcriptDedupRef = useRef<{
    responseId: string | null;
    lastDelta: string | null;
    appendedDoneIds: Set<string>;
  }>({ responseId: null, lastDelta: null, appendedDoneIds: new Set() });

  function redactResponseId(id: string | null): string | null {
    if (!id) return null;
    if (id.length <= 10) return id;
    return `${id.slice(0, 6)}…${id.slice(-4)}`;
  }

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const sessionUpdateSentRef = useRef(false);
  const pendingToolsRef = useRef<ActiveSession | null>(null);

  const statusFn = useServerFn(getOpenAiRealtimeStatus);
  const sessionFn = useServerFn(createJackRealtimeSession);
  const toolFn = useServerFn(runJackGptTool);
  const logFn = useServerFn(logJackGptEvent);
  const contextFn = useServerFn(buildJackNaturalContext);
  const queryClient = useQueryClient();

  const contextSentRef = useRef(false);
  const lastContextRefreshRef = useRef<number>(0);
  const [contextStats, setContextStats] = useState<{
    chars: number;
    entries: number;
    priorities: number;
    refreshedAt: number | null;
  }>({ chars: 0, entries: 0, priorities: 0, refreshedAt: null });
  const [lastSavedMemory, setLastSavedMemory] = useState<{
    id: string | null;
    status: string | null;
    scope: string | null;
    persisted: boolean;
    includedInContext: boolean;
    deduped: boolean;
    at: number;
    reason: string | null;
  } | null>(null);
  const [lastControlled, setLastControlled] = useState<{
    intent: string | null;
    risk: string | null;
    actionId: string | null;
    recommendedTool: string | null;
    deliveryId: string | null;
    snapshotDraftId: string | null;
    researchHandoff: boolean;
    missing: string[];
    unsafe: boolean;
    at: number;
  } | null>(null);
  // v3.19.6 — pending action preview state for the UI confirmation bridge.
  const [pendingActionPreview, setPendingActionPreview] =
    useState<PendingJackActionPreview | null>(null);
  const [confirmingAction, setConfirmingAction] = useState(false);
  const [confirmationStatus, setConfirmationStatus] = useState<string | null>(null);
  const [createdActionId, setCreatedActionId] = useState<string | null>(null);
  // v3.21.5 — surfaced lifecycle of the preview-confirm bridge for debug UI.
  type LastActionCreateResult = {
    at: number;
    previewIdRedacted: string;
    confirmationSource: "ui_button" | "voice_router";
    phase:
      | "confirm_called"
      | "server_call_started"
      | "server_ok"
      | "server_failed"
      | "no_action_id"
      | "verification_started"
      | "verification_found"
      | "verification_missing";
    actionIdRedacted: string | null;
    actionTitle: string | null;
    deduplicated: boolean | null;
    verificationStatus: AutomationAction["status"] | null;
    verificationSource: AutomationAction["source"] | null;
    verificationBrainId: string | null;
    titleMatches: boolean | null;
    visibleInCurrentList: boolean | null;
    errorCode: string | null;
    safeMessage: string | null;
  };
  const [lastActionCreateResult, setLastActionCreateResult] =
    useState<LastActionCreateResult | null>(null);
  const pendingPreviewRef = useRef<PendingJackActionPreview | null>(null);
  const confirmingPreviewIdRef = useRef<string | null>(null);
  const confirmFromPreviewFn = useServerFn(createControlledJackActionFromPreview);


  const pushLog = useCallback((entry: Omit<LogEntry, "id" | "ts">) => {
    setLog((prev) => [
      ...prev.slice(-49),
      { ...entry, id: crypto.randomUUID(), ts: Date.now() },
    ]);
  }, []);

  const safeLog = useCallback(
    (event: string, metadata: Record<string, unknown> = {}) => {
      void logFn({ data: { event, metadata: { ...metadata, brain_id: brainId } } }).catch(
        () => undefined,
      );
    },
    [logFn, brainId],
  );

  /**
   * Build and inject the natural-memory context into the live Realtime
   * session via session.update. Idempotent on initial open; safe to call
   * again to refresh after a memory mutation. Never sends secrets.
   */
  const injectNaturalContext = useCallback(
    async (reason: "initial" | "refresh"): Promise<void> => {
      const dc = dcRef.current;
      if (!dc || dc.readyState !== "open") return;
      try {
        const res = await contextFn({ data: { brain_id: brainId } });
        if (!res.ok) {
          safeLog("jack_gpt_context_build_failed", { reason, detail: res.detail ?? null });
          return;
        }
        const base = JACK_GPT_SYSTEM_INSTRUCTIONS;
        const merged = res.summary_text
          ? `${base}\n\nCONTESTO ATTUALE (aggiornato ${new Date(res.generated_at).toLocaleTimeString()}):\n${res.summary_text}`
          : base;
        dc.send(
          JSON.stringify({
            type: "session.update",
            session: { type: "realtime", instructions: merged },
          }),
        );
        contextSentRef.current = true;
        lastContextRefreshRef.current = Date.now();
        setContextStats({
          chars: res.context_chars,
          entries: res.entry_count,
          priorities: res.top_priorities.length,
          refreshedAt: lastContextRefreshRef.current,
        });
        safeLog(
          reason === "initial" ? "jack_gpt_context_injected" : "jack_gpt_context_refreshed",
          {
            chars: res.context_chars,
            entries: res.entry_count,
            priorities: res.top_priorities.length,
          },
        );
      } catch (err) {
        safeLog("jack_gpt_context_build_failed", {
          reason,
          detail: String((err as Error).message ?? err).slice(0, 120),
        });
      }
    },
    [contextFn, brainId, safeLog],
  );

  /**
   * Centralized response.create sender. Prevents overlapping responses
   * (Realtime error: conversation_already_has_active_response).
   */
  const safeCreateResponse = useCallback(
    (reason: string, options: SafeCreateResponseOptions = {}): "sent" | "queued" | "skipped" => {
      const dc = dcRef.current;
      safeLog("jack_gpt_response_create_requested", { reason });
      if (!dc || dc.readyState !== "open") {
        setDiagnostics((d) => ({
          ...d,
          skippedResponseCreateCount: d.skippedResponseCreateCount + 1,
        }));
        safeLog("jack_gpt_response_create_skipped_active", { reason, why: "dc_not_open" });
        return "skipped";
      }
      const now = Date.now();
      const tooSoon = now - lastResponseCreateAtRef.current < RESPONSE_CREATE_DEBOUNCE_MS;
      if (responseInProgressRef.current || tooSoon) {
        if (options.queueIfBusy) {
          pendingResponseCreateRef.current = { reason };
          setDiagnostics((d) => ({ ...d, pendingResponse: true }));
          safeLog("jack_gpt_response_create_queued", { reason });
          return "queued";
        }
        setDiagnostics((d) => ({
          ...d,
          skippedResponseCreateCount: d.skippedResponseCreateCount + 1,
        }));
        safeLog("jack_gpt_response_create_skipped_active", {
          reason,
          why: responseInProgressRef.current ? "in_progress" : "debounced",
        });
        return "skipped";
      }
      try {
        dc.send(JSON.stringify({ type: "response.create" }));
        lastResponseCreateAtRef.current = now;
        setDiagnostics((d) => ({
          ...d,
          lastResponseCreateReason: reason,
          lastResponseCreateAt: now,
          responseState: "response_starting",
        }));
        safeLog("jack_gpt_response_create_sent", { reason });
        return "sent";
      } catch {
        return "skipped";
      }
    },
    [safeLog],
  );

  const flushPendingResponse = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const pending = pendingResponseCreateRef.current;
    if (!pending) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      const next = pendingResponseCreateRef.current;
      if (!next) return;
      if (responseInProgressRef.current) return;
      pendingResponseCreateRef.current = null;
      setDiagnostics((d) => ({ ...d, pendingResponse: false }));
      const outcome = safeCreateResponse(next.reason);
      safeLog("jack_gpt_response_queue_flushed", { reason: next.reason, outcome });
    }, RESPONSE_CREATE_DEBOUNCE_MS);
  }, [safeCreateResponse, safeLog]);

  useEffect(() => {
    let active = true;
    statusFn()
      .then((res) => {
        if (!active) return;
        setStatus(res);
        setState(res.configured ? "idle" : "not_configured");
        safeLog("jack_gpt_status_checked", {
          configured: res.configured,
          model: res.model,
          model_source: res.model_source,
          api_mode: res.api_mode,
        });
      })
      .catch((err) => {
        if (!active) return;
        setState("error");
        setLastError("Verifica configurazione fallita.");
        safeLog("jack_gpt_status_checked", { ok: false, detail: String(err).slice(0, 120) });
      });
    return () => {
      active = false;
    };
  }, [statusFn, safeLog]);

  useEffect(() => {
    safeLog("jack_gpt_mode_opened", { api_mode: "ga" });
  }, [safeLog]);

  const teardown = useCallback(() => {
    try { dcRef.current?.close(); } catch { /* noop */ }
    try {
      pcRef.current?.getSenders().forEach((s) => {
        try { s.track?.stop(); } catch { /* noop */ }
      });
    } catch { /* noop */ }
    try { pcRef.current?.close(); } catch { /* noop */ }
    localStreamRef.current?.getTracks().forEach((t) => {
      try { t.stop(); } catch { /* noop */ }
    });
    if (audioElRef.current) {
      try { audioElRef.current.srcObject = null; } catch { /* noop */ }
    }
    dcRef.current = null;
    pcRef.current = null;
    localStreamRef.current = null;
    sessionUpdateSentRef.current = false;
    pendingToolsRef.current = null;
    contextSentRef.current = false;
    lastContextRefreshRef.current = 0;
    setContextStats({ chars: 0, entries: 0, priorities: 0, refreshedAt: null });
    responseInProgressRef.current = false;
    activeResponseIdRef.current = null;
    pendingResponseCreateRef.current = null;
    toolCallInFlightCountRef.current = 0;
    processedToolCallIdsRef.current.clear();
    lastToolCallKeyRef.current = null;
    transcriptDedupRef.current = {
      responseId: null,
      lastDelta: null,
      appendedDoneIds: new Set(),
    };
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setDiagnostics((d) => ({
      ...d,
      sessionMode: "none",
      dataChannelState: "none",
      cleanupCount: d.cleanupCount + 1,
      responseState: "idle",
      activeResponseIdRedacted: null,
      pendingResponse: false,
    }));
    safeLog("jack_gpt_cleanup_completed");
  }, [safeLog]);

  const handleToolCall = useCallback(
    async (callId: string, name: string, argsRaw: string) => {
      // v3.21.2 — per-callId dedup (model occasionally re-emits the same call)
      if (processedToolCallIdsRef.current.has(callId)) {
        safeLog("jack_client_duplicate_tool_call_ignored", {
          tool_name: name,
          dedup_reason: "call_id_already_processed",
        });
        return;
      }
      // v3.21.2 — short-TTL identical (name+args) dedup
      const key = `${name}::${argsRaw ?? ""}`;
      const last = lastToolCallKeyRef.current;
      const now = Date.now();
      if (last && last.key === key && now - last.at < TOOL_CALL_CLIENT_DEDUP_MS) {
        processedToolCallIdsRef.current.add(callId);
        safeLog("jack_client_duplicate_tool_call_ignored", {
          tool_name: name,
          dedup_reason: "identical_args_within_ttl",
        });
        // Still must satisfy the model with an output for this call_id
        // so the response can complete; reuse a structured "deduped" marker.
        const dc = dcRef.current;
        if (dc && dc.readyState === "open") {
          try {
            dc.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: callId,
                  output: JSON.stringify({
                    ok: true,
                    deduped: true,
                    note: "duplicate_tool_call_ignored",
                  }),
                },
              }),
            );
          } catch { /* noop */ }
        }
        return;
      }
      processedToolCallIdsRef.current.add(callId);
      lastToolCallKeyRef.current = { key, at: now };
      toolCallInFlightCountRef.current += 1;

      pushLog({ kind: "tool", text: `→ ${name}` });
      setDiagnostics((d) => ({ ...d, lastToolCalled: name }));
      safeLog("jack_realtime_tool_call_started", {
        tool_name: name,
        call_id: callId.slice(0, 8),
      });
      safeLog("jack_gpt_tool_called", { name });
      const result = await toolFn({
        data: { tool_name: name, arguments: argsRaw ?? "" },
      });
      const okFlag = (result as { ok?: boolean }).ok === true;
      if (!okFlag && (result as { error?: string }).error === "tool_rejected") {
        safeLog("jack_gpt_tool_rejected", { name });
      }
      pushLog({
        kind: "tool",
        text: `← ${name}: ${okFlag ? "ok" : `errore ${(result as { error?: string }).error ?? ""}`}`,
      });
      safeLog("jack_realtime_tool_call_completed", {
        tool_name: name,
        call_id: callId.slice(0, 8),
        ok: okFlag,
      });
      safeLog("jack_gpt_tool_completed", { name, ok: okFlag });
      const dc = dcRef.current;
      toolCallInFlightCountRef.current = Math.max(
        0,
        toolCallInFlightCountRef.current - 1,
      );
      if (!dc || dc.readyState !== "open") return;
      try {
        dc.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify(result),
            },
          }),
        );
      } catch { /* noop */ }
      // v3.21.2 — single response.create per tool batch. Only the last
      // completing tool fires it; queueIfBusy + debounce in safeCreateResponse
      // collapse near-simultaneous attempts.
      if (toolCallInFlightCountRef.current === 0) {
        safeLog("jack_tool_response_batch_flushed", {
          tool_name: name,
          batch_size: processedToolCallIdsRef.current.size,
        });
        safeCreateResponse("tool_result", { queueIfBusy: true });
      } else {
        safeLog("jack_response_create_deduplicated", {
          dedup_reason: "tool_batch_pending",
          tool_name: name,
        });
      }
      // v3.13.1: capture persistence diagnostics + refresh injected context.
      if (name === "create_memory_entry") {
        const payload = (result as { payload?: Record<string, unknown> }).payload ?? {};
        const persisted = Boolean(payload.persisted);
        const includedInContext = Boolean(payload.included_in_context);
        const memId = (payload.entry_id as string | null) ?? null;
        const memStatus = (payload.status as string | null) ?? null;
        const memScope = (payload.scope as string | null) ?? null;
        setLastSavedMemory({
          id: memId,
          status: memStatus,
          scope: memScope,
          persisted,
          includedInContext,
          deduped: Boolean(payload.deduped),
          at: Date.now(),
          reason: (payload.reason as string | null) ?? null,
        });
        safeLog(persisted ? "jack_memory_entry_persisted" : "jack_memory_entry_persist_failed", {
          memory_id_redacted: memId ? `${memId.slice(0, 6)}…` : null,
          status: memStatus,
          scope: memScope,
          deduped: Boolean(payload.deduped),
        });
        if (persisted && !includedInContext) {
          pushLog({
            kind: "warning",
            text: "Memoria salvata ma non ancora inclusa nel contesto attivo.",
          });
          safeLog("jack_memory_entry_context_missing", {
            memory_id_redacted: memId ? `${memId.slice(0, 6)}…` : null,
          });
        } else if (persisted && includedInContext) {
          safeLog("jack_memory_entry_context_verified");
        }
        if (persisted) {
          void injectNaturalContext("refresh");
        }
      }
      // v3.19.6 — capture preview into UI state for the confirmation bridge.
      if (name === "preview_controlled_action" && okFlag) {
        const payload = (result as { payload?: Record<string, unknown> }).payload ?? {};
        const preview = (payload.preview as PendingJackActionPreview | undefined) ?? null;
        if (preview && preview.title && preview.idempotency_key) {
          const createdAt = preview.created_at ?? preview.generated_at ?? new Date().toISOString();
          const currentPreview: PendingJackActionPreview = {
            ...preview,
            preview_id: preview.preview_id ?? buildJackPreviewId(preview.idempotency_key, createdAt),
            created_at: createdAt,
            generated_at: preview.generated_at ?? createdAt,
          };
          const previous = pendingPreviewRef.current;
          if (previous) {
            safeLog("jack_pending_preview_replaced", {
              previous_preview_id: previous.preview_id,
              preview_id: currentPreview.preview_id,
              title_hash: hashJackActionText(currentPreview.title),
              idempotency_key: redactJackIdempotencyKey(currentPreview.idempotency_key),
            });
          }
          pendingPreviewRef.current = currentPreview;
          setPendingActionPreview(currentPreview);
          setConfirmationStatus(null);
          setCreatedActionId(null);
          safeLog("jack_pending_action_preview_stored", {
            preview_id: currentPreview.preview_id,
            source: currentPreview.source,
            risk_level: currentPreview.risk_level,
            title_hash: hashJackActionText(currentPreview.title),
            idempotency_key: redactJackIdempotencyKey(currentPreview.idempotency_key),
          });
        }
      }
      // v3.19.6 — model is hard-locked from create_controlled_action.
      if (name === "create_controlled_action") {
        safeLog("jack_model_write_tool_call_blocked", {
          tool_name: name,
          source: "client_dispatcher_observed",
        });
      }
      // v3.14: capture controlled-action diagnostics + sanitized events.
      if (name === "prepare_master_snapshot_update") {
        const payload = (result as { payload?: Record<string, unknown> }).payload ?? {};
        const intent = (payload.intent as string | undefined) ?? null;
        const risk = (payload.risk_level as string | undefined) ?? null;
        const actionId = (payload.action_id as string | null | undefined) ?? null;
        const recommendedTool = (payload.recommended_tool as string | undefined) ?? null;
        const deliveryId = (payload.telegram_delivery_id as string | null | undefined) ?? null;
        const snapshotId =
          (payload.master_snapshot_draft_id as string | null | undefined) ??
          (payload.draft_id as string | null | undefined) ??
          null;
        const research = Boolean(payload.research_handoff);
        const missing = Array.isArray(payload.missing_information)
          ? (payload.missing_information as string[])
          : [];
        const unsafe = Boolean(payload.unsafe_request);
        setLastControlled({
          intent,
          risk,
          actionId,
          recommendedTool,
          deliveryId,
          snapshotDraftId: snapshotId,
          researchHandoff: research,
          missing,
          unsafe,
          at: Date.now(),
        });
        if (intent) safeLog("jack_command_classified", { intent, risk_level: risk });
        if (actionId) {
          safeLog("jack_controlled_action_planned", { intent, risk_level: risk });
          safeLog("jack_controlled_action_created", {
            action_id_redacted: `${actionId.slice(0, 6)}…`,
            intent,
            risk_level: risk,
          });
        }
        if (snapshotId) {
          safeLog("jack_master_snapshot_update_prepared", {
            draft_id_redacted: `${snapshotId.slice(0, 6)}…`,
          });
        }
        if (deliveryId) {
          safeLog("jack_telegram_delivery_requested", {
            delivery_id_redacted: `${deliveryId.slice(0, 6)}…`,
          });
        }
        if (research) {
          safeLog("jack_research_handoff_created", {
            recommended_tool: recommendedTool,
          });
        }
        if (unsafe) safeLog("jack_command_rejected_unsafe", { intent });
        if (missing.length > 0) {
          safeLog("jack_command_missing_information", { missing_count: missing.length });
        }
      }
    },
    [toolFn, safeLog, pushLog, safeCreateResponse, injectNaturalContext],
  );

  // v3.19.6 — confirm pending preview through the server bridge.
  const confirmPendingPreview = useCallback(
    async (
      source: "ui_button" | "voice_router",
      userTranscript?: string | null,
    ) => {
      const preview = pendingPreviewRef.current;
      if (!preview) {
        safeLog("jack_action_confirmation_rejected_no_pending_preview", {
          source,
          reason: "no_pending_preview_in_client",
        });
        pushLog({
          kind: "warning",
          text: "Non ho una proposta pendente da confermare.",
        });
        return;
      }
      if (confirmingPreviewIdRef.current === preview.preview_id) return;
      confirmingPreviewIdRef.current = preview.preview_id;
      setConfirmingAction(true);
      setConfirmationStatus(`Conferma ricevuta. Creazione action in corso: ${preview.title}`);
      safeLog("jack_pending_preview_current_confirmed", {
        preview_id: preview.preview_id,
        confirmation_source: source,
        title_hash: hashJackActionText(preview.title),
        idempotency_key: redactJackIdempotencyKey(preview.idempotency_key),
      });
      safeLog("jack_action_create_from_preview_started", {
        preview_id: preview.preview_id,
        confirmation_source: source,
        title_hash: hashJackActionText(preview.title),
        idempotency_key: redactJackIdempotencyKey(preview.idempotency_key),
      });
      pushLog({
        kind: "system",
        text: `Conferma ricevuta. Creazione action in corso: ${preview.title}`,
      });
      try {
        const res = await confirmFromPreviewFn({
          data: {
            preview_id: preview.preview_id,
            title: preview.title,
            description: preview.description,
            reason: preview.reason,
            risk_level: preview.risk_level,
            source: preview.source,
            idempotency_key: preview.idempotency_key,
            brain_id: preview.brain_id ?? brainId ?? null,
            project_id: preview.project_id ?? null,
            confirmation_source: source,
            user_transcript: userTranscript ?? null,
          },
        });
        if (res.ok && res.action_id && res.action_title) {
          const titleMatches = res.action_title.trim() === preview.title.trim();
          if (!titleMatches) {
            safeLog("jack_action_created_title_mismatch", {
              preview_id: preview.preview_id,
              action_id: res.action_id,
              confirmation_source: source,
              title_hash: hashJackActionText(preview.title),
              idempotency_key: redactJackIdempotencyKey(preview.idempotency_key),
              deduplicated: Boolean(res.deduplicated),
              mismatch: true,
            });
            setConfirmationStatus("Errore: la action creata non corrisponde alla preview corrente. La proposta resta pronta.");
            pushLog({
              kind: "error",
              text: "Errore: la action creata non corrisponde alla preview corrente. La proposta resta pronta.",
            });
            return;
          }
          safeLog("jack_action_create_from_preview_succeeded", {
            preview_id: preview.preview_id,
            action_id: res.action_id,
            confirmation_source: source,
            title_hash: hashJackActionText(preview.title),
            idempotency_key: redactJackIdempotencyKey(preview.idempotency_key),
            deduplicated: Boolean(res.deduplicated),
            mismatch: false,
          });
          await queryClient.invalidateQueries({ queryKey: ["action-queue"] });
          safeLog("jack_action_queue_refetch_requested", {
            preview_id: preview.preview_id,
            action_id: res.action_id,
            confirmation_source: source,
            title_hash: hashJackActionText(preview.title),
            idempotency_key: redactJackIdempotencyKey(preview.idempotency_key),
            deduplicated: Boolean(res.deduplicated),
            mismatch: false,
          });
          pushLog({
            kind: "system",
            text: res.deduplicated
              ? `Action già esistente verificata: ${res.action_title}`
              : `Action creata: ${res.action_title}`,
          });
          toast.success(res.deduplicated ? "Action già presente" : "Action creata", {
            description: res.action_title,
          });
          setConfirmationStatus(`Action creata: ${res.action_title}`);
          setCreatedActionId(res.action_id);
          pendingPreviewRef.current = null;
          setPendingActionPreview(null);
          // Inform Jack via a function_call_output? No — we instead send a
          // synthetic conversation item so the model can acknowledge.
          const dc = dcRef.current;
          if (dc && dc.readyState === "open") {
            try {
              dc.send(
                JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "message",
                    role: "system",
                    content: [
                      {
                        type: "input_text",
                         text: `Action creata e verificata in Action Queue: "${res.action_title}". Solo ora comunica a Federico che la creazione è riuscita.`,
                      },
                    ],
                  },
                }),
              );
            } catch {
              /* noop */
            }
            safeCreateResponse("action_confirmed", { queueIfBusy: true });
          }
        } else {
          safeLog("jack_action_create_from_preview_failed", {
            preview_id: preview.preview_id,
            confirmation_source: source,
            title_hash: hashJackActionText(preview.title),
            idempotency_key: redactJackIdempotencyKey(preview.idempotency_key),
            reason: res.reason ?? "unknown",
          });
          setConfirmationStatus("Ho ricevuto la conferma, ma la creazione non è riuscita. La proposta resta pronta.");
          pushLog({
            kind: "warning",
            text: res.safe_message ?? "Ho ricevuto la conferma, ma la creazione non è riuscita. La proposta resta pronta.",
          });
        }
      } catch (err) {
        safeLog("jack_action_create_from_preview_failed", {
          preview_id: preview.preview_id,
          confirmation_source: source,
          title_hash: hashJackActionText(preview.title),
          idempotency_key: redactJackIdempotencyKey(preview.idempotency_key),
          detail: String((err as Error).message ?? err).slice(0, 160),
        });
        setConfirmationStatus("Ho ricevuto la conferma, ma la creazione non è riuscita. La proposta resta pronta.");
        pushLog({
          kind: "error",
          text: "Ho ricevuto la conferma, ma la creazione non è riuscita. La proposta resta pronta.",
        });
      } finally {
        setConfirmingAction(false);
        confirmingPreviewIdRef.current = null;
      }
    },
    [confirmFromPreviewFn, brainId, safeLog, pushLog, safeCreateResponse, queryClient],
  );

  const cancelPendingPreview = useCallback(() => {
    if (!pendingPreviewRef.current) return;
    safeLog("jack_pending_action_preview_cancelled", {
      source: pendingPreviewRef.current.source,
    });
    pendingPreviewRef.current = null;
    setPendingActionPreview(null);
    setConfirmationStatus(null);
    setCreatedActionId(null);
    pushLog({ kind: "system", text: "Proposta annullata." });
  }, [safeLog, pushLog]);



  const handleDcMessage = useCallback(
    (ev: MessageEvent<string>) => {
      let msg: RealtimeEvent;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "") as RealtimeEvent;
      } catch {
        return;
      }
      if (msg.type) {
        setDiagnostics((d) => ({ ...d, lastEventType: msg.type ?? d.lastEventType }));
      }
      switch (msg.type) {
        // GA + legacy session lifecycle
        case "session.created":
        case "session.updated":
          break;

        case "input_audio_buffer.speech_started":
          setState("listening");
          break;

        // GA response lifecycle
        case "response.created": {
          const id = msg.response?.id ?? null;
          // v3.21.2 — overlap detection: a new response while one is active.
          if (responseInProgressRef.current && activeResponseIdRef.current && id && activeResponseIdRef.current !== id) {
            safeLog("jack_audio_response_overlap_prevented", {
              response_id: redactResponseId(id),
              dedup_reason: "previous_response_still_active",
            });
          }
          responseInProgressRef.current = true;
          activeResponseIdRef.current = id;
          // reset transcript dedup window for the new response
          transcriptDedupRef.current = {
            responseId: id,
            lastDelta: null,
            appendedDoneIds: transcriptDedupRef.current.appendedDoneIds,
          };
          setState("speaking");
          setDiagnostics((d) => ({
            ...d,
            responseState: "response_active",
            activeResponseIdRedacted: redactResponseId(id),
          }));
          safeLog("jack_gpt_response_created", { has_id: Boolean(id) });
          break;
        }
        case "response.output_audio.delta":
        case "response.output_audio_transcript.delta":
        case "response.output_text.delta":
        // Legacy fallback
        case "response.audio.delta":
        case "response.audio_transcript.delta":
        case "response.text.delta": {
          // v3.21.2 — drop identical consecutive transcript deltas
          const delta = typeof msg.delta === "string" ? msg.delta : null;
          if (delta) {
            if (transcriptDedupRef.current.lastDelta === delta) {
              safeLog("jack_transcript_delta_deduplicated", {
                response_id: redactResponseId(transcriptDedupRef.current.responseId),
                dedup_reason: "identical_consecutive_delta",
              });
            } else {
              transcriptDedupRef.current.lastDelta = delta;
            }
          }
          setState("speaking");
          break;
        }

        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done":
        case "response.output_text.done": {
          if (!msg.transcript) break;
          // v3.21.2 — dedup .done events for the same item to avoid double append
          const doneKey = `${msg.response_id ?? activeResponseIdRef.current ?? ""}::${msg.item_id ?? ""}`;
          if (doneKey && transcriptDedupRef.current.appendedDoneIds.has(doneKey)) {
            safeLog("jack_transcript_delta_deduplicated", {
              response_id: redactResponseId(activeResponseIdRef.current),
              dedup_reason: "done_already_appended",
            });
            break;
          }
          if (doneKey) transcriptDedupRef.current.appendedDoneIds.add(doneKey);
          pushLog({ kind: "jack", text: String(msg.transcript) });
          break;
        }

        case "conversation.item.input_audio_transcription.completed":
          if (msg.transcript) {
            const transcript = String(msg.transcript);
            pushLog({ kind: "user", text: transcript });
            // v3.19.6 — deterministic voice router: if a pending preview
            // exists and the real user transcript is an explicit
            // confirmation, trigger the controlled creation server-side.
            if (
              pendingPreviewRef.current &&
              isExplicitJackConfirmation(transcript)
            ) {
              void confirmPendingPreview("voice_router", transcript);
            }
          }
          break;


        case "response.done":
        case "response.cancelled":
        case "response.failed":
        case "response.incomplete": {
          responseInProgressRef.current = false;
          activeResponseIdRef.current = null;
          lastResponseDoneAtRef.current = Date.now();
          // v3.21.2 — reset tool-batch counter so next turn starts clean.
          toolCallInFlightCountRef.current = 0;
          // Bound the processed callId set
          if (processedToolCallIdsRef.current.size > 200) {
            processedToolCallIdsRef.current.clear();
          }
          setState("listening");
          setDiagnostics((d) => ({
            ...d,
            responseState: "idle",
            activeResponseIdRedacted: null,
            lastResponseDoneAt: lastResponseDoneAtRef.current,
          }));
          safeLog("jack_gpt_response_done", { type: msg.type });
          if (pendingResponseCreateRef.current) flushPendingResponse();
          break;
        }

        // Tool/function calls — GA + legacy
        case "response.function_call_arguments.done":
          if (msg.call_id && msg.name) {
            setDiagnostics((d) => ({ ...d, responseState: "tool_waiting" }));
            void handleToolCall(msg.call_id, msg.name, msg.arguments ?? "");
          }
          break;
        case "response.output_item.done": {
          const item = msg.item;
          if (item?.type === "function_call" && item.call_id && item.name) {
            setDiagnostics((d) => ({ ...d, responseState: "tool_waiting" }));
            void handleToolCall(item.call_id, item.name, item.arguments ?? "");
          }
          break;
        }

        case "error": {
          const err = msg.error ?? {};
          if (isActiveResponseInProgressError(err)) {
            // Non-critical: overlap was rejected by the server. Reconcile lifecycle.
            responseInProgressRef.current = true;
            const friendly = "Jack stava ancora rispondendo: ho evitato una risposta duplicata.";
            pushLog({ kind: "warning", text: friendly });
            setDiagnostics((d) => ({
              ...d,
              responseState: activeResponseIdRef.current ? "response_active" : "response_active_unknown",
              lastErrorKind: "active_response_in_progress",
              lastSafeError: friendly,
              duplicateResponseHandledCount: d.duplicateResponseHandledCount + 1,
            }));
            safeLog("jack_gpt_active_response_error_handled", {
              has_active_id: Boolean(activeResponseIdRef.current),
            });
            break;
          }
          const m = err.message ?? "Errore realtime";
          pushLog({ kind: "error", text: m });
          setLastError(m);
          setDiagnostics((d) => ({ ...d, lastSafeError: m.slice(0, 160) }));
          break;
        }
        default:
          break;
      }
    },
    [handleToolCall, safeLog, pushLog, flushPendingResponse, confirmPendingPreview],
  );

  /** Connect WebRTC using a successfully-created realtime session (GA endpoint). */
  const connectWebRTC = useCallback(
    async (session: ActiveSession, stream: MediaStream) => {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pendingToolsRef.current = session;

      const audioEl = audioElRef.current ?? new Audio();
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };
      pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState;
        if (s === "failed" || s === "disconnected" || s === "closed") {
          setLastError((prev) => prev ?? "Connessione WebRTC interrotta.");
        }
      };

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      const updateDcState = () =>
        setDiagnostics((d) => ({ ...d, dataChannelState: dc.readyState }));
      dc.onopen = () => {
        updateDcState();
        setState("listening");
        pushLog({ kind: "system", text: "Connessione attiva. Puoi parlare." });
        safeLog("jack_gpt_data_channel_opened");
        safeLog("jack_gpt_connected");
        if (!sessionUpdateSentRef.current) {
          try {
            const sessionPayload: Record<string, unknown> = {
              type: "realtime",
              audio: { output: { voice: "alloy" } },
            };
            if (session.mode === "minimal") {
              if (session.instructions_for_update) {
                sessionPayload.instructions = session.instructions_for_update;
              }
              if (session.tools_for_update) {
                sessionPayload.tools = session.tools_for_update;
                sessionPayload.tool_choice = "auto";
              }
            }
            dc.send(JSON.stringify({ type: "session.update", session: sessionPayload }));
            sessionUpdateSentRef.current = true;
            safeLog("jack_gpt_session_update_sent", { mode: session.mode });
            // v3.13: inject natural memory context as additional instructions.
            void injectNaturalContext("initial");
          } catch { /* noop */ }
        }
      };
      dc.onclose = () => {
        updateDcState();
        safeLog("jack_gpt_data_channel_closed");
      };
      dc.onmessage = handleDcMessage;

      setState("connecting");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      safeLog("jack_gpt_webrtc_offer_created");

      // GA endpoint: no ?model=... in URL. Model is already on the session config.
      const sdpRes = await fetch(REALTIME_CALLS_ENDPOINT, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${session.client_secret}`,
          "Content-Type": "application/sdp",
        },
      });
      setDiagnostics((d) => ({ ...d, sdpEndpointStatus: sdpRes.status }));
      if (!sdpRes.ok) {
        throw new Error(`sdp_call_failed:${sdpRes.status}`);
      }
      safeLog("jack_gpt_webrtc_answer_received", { status: sdpRes.status });
      const answer: RTCSessionDescriptionInit = {
        type: "answer",
        sdp: await sdpRes.text(),
      };
      await pc.setRemoteDescription(answer);
      setDiagnostics((d) => ({ ...d, sessionMode: session.mode }));
    },
    [handleDcMessage, safeLog, pushLog],
  );

  const start = useCallback(async () => {
    if (!status?.configured) return;
    setLastError(null);
    setRetryNotice(null);
    setLog([]);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMicState("unsupported");
      setState("error");
      setLastError("Browser non compatibile con WebRTC/microfono.");
      return;
    }
    setState("requesting_mic");
    safeLog("jack_gpt_microphone_permission_requested");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicState("granted");
      safeLog("jack_gpt_microphone_permission_granted");
    } catch (err) {
      const info = classifyMediaError(err);
      setMicState(info.mic);
      setLastError(info.friendly);
      setState("error");
      safeLog("jack_gpt_microphone_permission_denied", { technical: info.technical });
      toast.error(info.friendly);
      return;
    }
    localStreamRef.current = stream;

    const attempt = async (
      minimal: boolean,
    ): Promise<{ ok: true } | { ok: false; classified: ClassifiedRealtimeStartError }> => {
      setState("creating_session");
      safeLog("jack_gpt_session_requested", { minimal, api_mode: "ga" });
      const session = await sessionFn({
        data: { brain_id: brainId, mode: "jack_gpt", minimal },
      });
      if (!session.ok) {
        const classified = classifyRealtimeStartError({
          error: session.error,
          status: session.status,
          detail: session.detail,
          openai_request_id: session.openai_request_id ?? null,
        });
        setDiagnostics((d) => ({
          ...d,
          lastOpenAiStatus: session.status ?? null,
          lastOpenAiRequestId: session.openai_request_id ?? null,
          lastErrorKind: classified.kind,
        }));
        return { ok: false, classified };
      }
      if (session.probe) {
        // Should not happen — we don't request probe in the live flow.
        return {
          ok: false,
          classified: classifyRealtimeStartError({ error: "unknown" }),
        };
      }
      setDiagnostics((d) => ({
        ...d,
        lastOpenAiRequestId: session.openai_request_id ?? null,
      }));
      safeLog("jack_gpt_session_created", {
        model: session.realtime_model,
        mode: session.mode,
        api_mode: session.api_mode,
      });
      try {
        await connectWebRTC(session, stream);
        return { ok: true };
      } catch (err) {
        const message = String((err as Error).message ?? err);
        const status = /sdp_call_failed:(\d+)/.exec(message)?.[1];
        const classified = classifyRealtimeStartError({
          error: status ? "sdp_call_failed" : "unknown",
          status: status ? Number(status) : undefined,
          message,
        });
        setDiagnostics((d) => ({ ...d, lastErrorKind: classified.kind }));
        teardown();
        return { ok: false, classified };
      }
    };

    const first = await attempt(false);
    if (first.ok) return;

    const c1 = first.classified;
    setDiagnostics((d) => ({ ...d, lastSafeError: c1.user_message }));
    safeLog("jack_gpt_session_full_failed", {
      kind: c1.kind,
      status: c1.status ?? null,
    });

    if (c1.kind === "model_not_available") {
      safeLog("jack_gpt_model_not_available", { status: c1.status ?? null });
      setLastError(c1.user_message);
      setState("error");
      teardown();
      toast.error("Realtime GA: modello/endpoint non disponibili");
      return;
    }

    if (!c1.retryable_with_minimal) {
      setLastError(c1.user_message);
      pushLog({ kind: "error", text: c1.user_message });
      setState("error");
      teardown();
      toast.error("Connessione Jack GPT Mode fallita");
      return;
    }

    setRetryNotice("Primo tentativo fallito, riprovo in modalità compatibile…");
    safeLog("jack_gpt_session_minimal_retry_started", { kind: c1.kind });
    pushLog({ kind: "system", text: "Riprovo in modalità compatibile…" });

    if (!localStreamRef.current || localStreamRef.current.getTracks().every((t) => t.readyState === "ended")) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
      } catch (err) {
        const info = classifyMediaError(err);
        setLastError(info.friendly);
        setState("error");
        safeLog("jack_gpt_session_minimal_retry_failed", { reason: "mic_reacquire" });
        return;
      }
    } else {
      stream = localStreamRef.current;
    }

    const second = await attempt(true);
    if (second.ok) {
      setRetryNotice("Modalità compatibile attiva: tools inviati dopo la connessione.");
      safeLog("jack_gpt_session_minimal_retry_succeeded");
      return;
    }
    const c2 = second.classified;
    safeLog("jack_gpt_session_minimal_retry_failed", {
      kind: c2.kind,
      status: c2.status ?? null,
    });
    setRetryNotice(null);
    setLastError(c2.user_message);
    pushLog({ kind: "error", text: c2.user_message });
    setState("error");
    teardown();
    toast.error("Connessione Jack GPT Mode fallita anche in modalità compatibile");
  }, [status, sessionFn, safeLog, brainId, pushLog, teardown, connectWebRTC]);

  const stop = useCallback(() => {
    teardown();
    setState(status?.configured ? "idle" : "not_configured");
    safeLog("jack_gpt_disconnected");
  }, [teardown, status, safeLog]);

  const resetVoice = useCallback(() => {
    safeLog("jack_gpt_reset_requested");
    teardown();
    setLog([]);
    setLastError(null);
    setRetryNotice(null);
    setMicState("unknown");
    setState(status?.configured ? "idle" : "not_configured");
    setDiagnostics((d) => ({
      ...d,
      sessionMode: "none",
      dataChannelState: "none",
      lastEventType: null,
      lastSafeError: null,
      lastErrorKind: null,
      lastToolCalled: null,
    }));
    safeLog("jack_gpt_reset_completed");
    toast.success("Reset completato: puoi riavviare Jack.");
  }, [teardown, status, safeLog]);

  const testConnection = useCallback(async () => {
    setTesting(true);
    safeLog("jack_gpt_connection_test_started");
    try {
      const res = await statusFn();
      setStatus(res);
      const message = res.configured
        ? `OpenAI configurato. Modello: ${res.model}${res.model_source === "fallback" ? " (fallback)" : ""}.`
        : "OpenAI non configurato: aggiungi OPENAI_API_KEY nei secrets.";
      const result: TestConnectionResult = {
        ok: res.configured,
        configured: res.configured,
        model: res.model,
        model_source: res.model_source,
        warning: res.model_warning,
        privacy_mode: res.privacy_mode,
        server_time: res.server_time,
        message,
      };
      setDiagnostics((d) => ({ ...d, lastTest: result }));
      safeLog("jack_gpt_connection_test_completed", {
        configured: res.configured,
        model: res.model,
      });
      if (res.configured) toast.success(message);
      else toast.warning(message);
    } catch (err) {
      const message = "Test configurazione fallito.";
      const result: TestConnectionResult = {
        ok: false,
        configured: false,
        model: null,
        model_source: null,
        warning: null,
        privacy_mode: null,
        server_time: null,
        message,
      };
      setDiagnostics((d) => ({ ...d, lastTest: result, lastSafeError: message }));
      safeLog("jack_gpt_connection_test_failed", { detail: String(err).slice(0, 120) });
      toast.error(message);
    } finally {
      setTesting(false);
    }
  }, [statusFn, safeLog]);

  /** Probe: mint a real client secret server-side then discard. No mic, no WebRTC. */
  const testRealtimeSession = useCallback(async () => {
    setProbing(true);
    safeLog("jack_gpt_realtime_probe_started");
    try {
      const res = await sessionFn({
        data: { brain_id: brainId, mode: "jack_gpt_probe", probe_only: true },
      });
      if (!res.ok) {
        const classified = classifyRealtimeStartError({
          error: res.error,
          status: res.status,
          detail: res.detail,
          openai_request_id: res.openai_request_id ?? null,
        });
        const probe: RealtimeSessionTestResult = {
          ok: false,
          model: null,
          expires_at: null,
          openai_request_id: res.openai_request_id ?? null,
          status_code: res.status ?? null,
          message: classified.user_message,
        };
        setDiagnostics((d) => ({
          ...d,
          lastRealtimeProbe: probe,
          lastOpenAiStatus: res.status ?? null,
          lastOpenAiRequestId: res.openai_request_id ?? null,
          lastErrorKind: classified.kind,
          lastSafeError: classified.user_message,
        }));
        safeLog("jack_gpt_realtime_probe_failed", {
          kind: classified.kind,
          status: res.status ?? null,
        });
        toast.error(classified.user_message);
        return;
      }
      if (!res.probe) {
        // Defensive: server returned a live session unexpectedly. Do nothing with the secret.
        toast.warning("Probe inatteso: ricevuta sessione live, scartata.");
        return;
      }
      const probe: RealtimeSessionTestResult = {
        ok: true,
        model: res.realtime_model,
        expires_at: res.expires_at,
        openai_request_id: res.openai_request_id ?? null,
        status_code: 200,
        message: res.message,
      };
      setDiagnostics((d) => ({
        ...d,
        lastRealtimeProbe: probe,
        lastOpenAiStatus: 200,
        lastOpenAiRequestId: res.openai_request_id ?? null,
      }));
      safeLog("jack_gpt_realtime_probe_succeeded", { model: res.realtime_model });
      toast.success(res.message);
    } catch (err) {
      const message = "Test Realtime session fallito (rete).";
      setDiagnostics((d) => ({
        ...d,
        lastRealtimeProbe: {
          ok: false,
          model: null,
          expires_at: null,
          openai_request_id: null,
          status_code: null,
          message,
        },
        lastSafeError: message,
      }));
      safeLog("jack_gpt_realtime_probe_failed", { detail: String(err).slice(0, 120) });
      toast.error(message);
    } finally {
      setProbing(false);
    }
  }, [sessionFn, safeLog, brainId]);

  useEffect(() => () => teardown(), [teardown]);

  const stateLabel: Record<ConnState, string> = {
    idle: "Pronto",
    not_configured: "Non configurato",
    checking: "Verifica…",
    requesting_mic: "Permesso microfono…",
    creating_session: "Sessione effimera…",
    connecting: "Connessione WebRTC…",
    listening: "In ascolto",
    speaking: "Jack sta rispondendo",
    error: "Errore",
  };

  const stateTone: Record<ConnState, string> = {
    idle: "bg-muted text-muted-foreground",
    not_configured: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    checking: "bg-muted text-muted-foreground",
    requesting_mic: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    creating_session: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    connecting: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    listening: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    speaking: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    error: "bg-destructive/15 text-destructive",
  };

  const micLabel: Record<MicState, string> = {
    unknown: "Microfono: non richiesto",
    granted: "Microfono: autorizzato",
    denied: "Microfono: non autorizzato",
    unavailable: "Microfono: non disponibile",
    unsupported: "Microfono: browser non compatibile",
  };

  const isLive =
    state === "listening" ||
    state === "speaking" ||
    state === "connecting" ||
    state === "requesting_mic" ||
    state === "creating_session";

  const isModelNotAvailable = diagnostics.lastErrorKind === "model_not_available";

  return (
    <Card className="border-violet-500/20">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-500" />
            Jack GPT Mode
          </CardTitle>
          <Badge variant="outline" className="border-violet-500/40 text-violet-700 dark:text-violet-300">
            OpenAI Realtime GA
          </Badge>
          <Badge className={stateTone[state]} variant="secondary">
            {stateLabel[state]}
          </Badge>
          {status?.model ? (
            <span className="text-xs text-muted-foreground">
              {status.configured ? "OpenAI configurato" : "OpenAI non configurato"} ·{" "}
              {status.model}
              {status.model_source === "fallback" ? " (fallback)" : ""}
            </span>
          ) : null}
        </div>
        <CardDescription>
          Conversazione vocale naturale (Realtime GA). Affianca Jack Classic (ElevenLabs).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Privacy</AlertTitle>
          <AlertDescription className="text-xs">{JACK_GPT_PRIVACY_NOTICE}</AlertDescription>
        </Alert>

        {state === "not_configured" ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>OpenAI non configurato</AlertTitle>
            <AlertDescription className="text-xs">
              Aggiungi <code>OPENAI_API_KEY</code> nei secrets del progetto per abilitare Jack GPT Mode.
              Opzionale: <code>OPENAI_REALTIME_MODEL</code>.
            </AlertDescription>
          </Alert>
        ) : null}

        {status?.model_warning ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Modello realtime</AlertTitle>
            <AlertDescription className="text-xs">{status.model_warning}</AlertDescription>
          </Alert>
        ) : null}

        {retryNotice ? (
          <Alert>
            <Activity className="h-4 w-4" />
            <AlertTitle>Modalità compatibile</AlertTitle>
            <AlertDescription className="text-xs">{retryNotice}</AlertDescription>
          </Alert>
        ) : null}

        {lastError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Ultimo errore</AlertTitle>
            <AlertDescription className="text-xs space-y-1">
              <p>{lastError}</p>
              {isModelNotAvailable ? (
                <p>Modelli suggeriti: {SUGGESTED_REALTIME_MODELS.join(", ")}.</p>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{micLabel[micState]}</span>
          <span>·</span>
          <span>Stato: {stateLabel[state]}</span>
          {status?.realtime_ready ? (
            <>
              <span>·</span>
              <span>Tool calling attivo</span>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {!isLive ? (
            <Button
              onClick={start}
              disabled={!status?.configured || state === "checking"}
              className="gap-2"
            >
              <Mic className="h-4 w-4" /> Avvia conversazione
            </Button>
          ) : (
            <Button onClick={stop} variant="destructive" className="gap-2">
              <MicOff className="h-4 w-4" /> Termina
            </Button>
          )}
          <Button
            onClick={testConnection}
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={testing}
          >
            <Activity className="h-4 w-4" /> {testing ? "Test in corso…" : "Test configurazione"}
          </Button>
          <Button
            onClick={testRealtimeSession}
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={probing || !status?.configured}
          >
            <Radio className="h-4 w-4" /> {probing ? "Probe in corso…" : "Test Realtime session"}
          </Button>
          <Button
            onClick={resetVoice}
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={isLive}
          >
            <RotateCcw className="h-4 w-4" /> Reset Jack Voice
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/jack-memory">
              <Brain className="h-4 w-4" /> Jack Memory
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/daily-brief">
              <FileText className="h-4 w-4" /> Daily Brief
            </Link>
          </Button>
        </div>

        {pendingActionPreview ? (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-amber-600" />
                  Proposta action — richiede conferma
                </CardTitle>
                <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
                  Richiede conferma
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  rischio: {pendingActionPreview.risk_level}
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Jack non può creare action da solo. Conferma con il pulsante o di' "sì, confermo".
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <div className="text-xs font-medium text-muted-foreground">Titolo</div>
                <div>{pendingActionPreview.title}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">Descrizione</div>
                <div className="text-xs">{pendingActionPreview.description}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">Motivo</div>
                <div className="text-xs">{pendingActionPreview.reason}</div>
              </div>
              {confirmationStatus ? (
                <Alert className="border-amber-500/30 bg-amber-500/5">
                  <AlertTitle className="text-sm">Stato conferma</AlertTitle>
                  <AlertDescription className="text-xs">{confirmationStatus}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={() => void confirmPendingPreview("ui_button")}
                  disabled={confirmingAction}
                  className="gap-2"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {confirmingAction ? "Creazione…" : "Conferma creazione action"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={cancelPendingPreview}
                  disabled={confirmingAction}
                >
                  Annulla
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {!pendingActionPreview && confirmationStatus ? (
          <Alert className="border-emerald-500/30 bg-emerald-500/5">
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle className="text-sm">{confirmationStatus}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2 pt-2 text-xs">
              <span>Verifica disponibile in Action Queue.</span>
              <Button asChild size="sm" variant="outline" className="gap-2">
                <Link to="/action-queue">
                  Apri Action Queue
                </Link>
              </Button>
              {createdActionId ? <span className="text-muted-foreground">ID verificato.</span> : null}
            </AlertDescription>
          </Alert>
        ) : null}



        <div className="rounded-md border bg-muted/30">
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-2">
            <Activity className="h-3.5 w-3.5" /> Diagnostica Jack GPT (Realtime GA)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 px-3 py-2 text-xs">
            <div><span className="text-muted-foreground">API mode:</span> {status?.api_mode ?? "ga"}</div>
            <div><span className="text-muted-foreground">OpenAI configurato:</span> {status?.configured ? "sì" : "no"}</div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Client secret endpoint:</span> <code className="text-[10px]">{REALTIME_CLIENT_SECRETS_ENDPOINT}</code></div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">WebRTC endpoint:</span> <code className="text-[10px]">{REALTIME_CALLS_ENDPOINT}</code></div>
            <div><span className="text-muted-foreground">Modello attivo:</span> {status?.model ?? "—"}</div>
            <div><span className="text-muted-foreground">Model source:</span> {status?.model_source ?? "—"}</div>
            <div><span className="text-muted-foreground">Session config mode:</span> {diagnostics.sessionMode}</div>
            <div><span className="text-muted-foreground">Mic:</span> {micLabel[micState].replace("Microfono: ", "")}</div>
            <div><span className="text-muted-foreground">Connection:</span> {stateLabel[state]}</div>
            <div><span className="text-muted-foreground">Data channel:</span> {diagnostics.dataChannelState}</div>
            <div><span className="text-muted-foreground">SDP endpoint status:</span> {diagnostics.sdpEndpointStatus ?? "—"}</div>
            <div><span className="text-muted-foreground">Last OpenAI status:</span> {diagnostics.lastOpenAiStatus ?? "—"}</div>
            <div><span className="text-muted-foreground">Last OpenAI request id:</span> {diagnostics.lastOpenAiRequestId ?? "—"}</div>
            <div><span className="text-muted-foreground">Last event:</span> {diagnostics.lastEventType ?? "—"}</div>
            <div><span className="text-muted-foreground">Last error kind:</span> {diagnostics.lastErrorKind ?? "—"}</div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Last tool:</span> {diagnostics.lastToolCalled ?? "—"}</div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Last safe error:</span> {diagnostics.lastSafeError ?? "—"}</div>
            <div><span className="text-muted-foreground">Cleanup:</span> {diagnostics.cleanupCount}</div>
            <div><span className="text-muted-foreground">Privacy:</span> {status?.privacy_mode ?? "ephemeral_token_only"}</div>
            <div className="sm:col-span-2 pt-1 border-t mt-1 font-medium text-muted-foreground">Natural memory context</div>
            <div><span className="text-muted-foreground">Iniettato:</span> {contextStats.refreshedAt ? "sì" : "no"}</div>
            <div><span className="text-muted-foreground">Caratteri:</span> {contextStats.chars}</div>
            <div><span className="text-muted-foreground">Entries usate:</span> {contextStats.entries}</div>
            <div><span className="text-muted-foreground">Priorità:</span> {contextStats.priorities}</div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Ultimo refresh:</span> {contextStats.refreshedAt ? new Date(contextStats.refreshedAt).toLocaleTimeString() : "—"}</div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Sorgente contesto:</span> persistent_db</div>
            <div><span className="text-muted-foreground">Ultima memoria salvata:</span> {lastSavedMemory?.id ? `${lastSavedMemory.id.slice(0, 6)}…` : "—"}</div>
            <div><span className="text-muted-foreground">Stato salvataggio:</span> {lastSavedMemory?.status ?? "—"}{lastSavedMemory?.deduped ? " (dedup)" : ""}</div>
            <div><span className="text-muted-foreground">Persisted:</span> {lastSavedMemory ? (lastSavedMemory.persisted ? "sì" : "no") : "—"}</div>
            <div><span className="text-muted-foreground">In contesto:</span> {lastSavedMemory ? (lastSavedMemory.includedInContext ? "sì" : "no") : "—"}</div>
            <div><span className="text-muted-foreground">Scope:</span> {lastSavedMemory?.scope ?? "—"}</div>
            <div><span className="text-muted-foreground">Reason:</span> {lastSavedMemory?.reason ?? "—"}</div>
            <div className="sm:col-span-2 pt-1 border-t mt-1 font-medium text-muted-foreground">Controlled command (v3.14)</div>
            <div><span className="text-muted-foreground">Last intent:</span> {lastControlled?.intent ?? "—"}</div>
            <div><span className="text-muted-foreground">Last risk:</span> {lastControlled?.risk ?? "—"}</div>
            <div><span className="text-muted-foreground">Last action id:</span> {lastControlled?.actionId ? `${lastControlled.actionId.slice(0, 6)}…` : "—"}</div>
            <div><span className="text-muted-foreground">Recommended tool:</span> {lastControlled?.recommendedTool ?? "—"}</div>
            <div><span className="text-muted-foreground">Last delivery req:</span> {lastControlled?.deliveryId ? `${lastControlled.deliveryId.slice(0, 6)}…` : "—"}</div>
            <div><span className="text-muted-foreground">Last snapshot draft:</span> {lastControlled?.snapshotDraftId ? `${lastControlled.snapshotDraftId.slice(0, 6)}…` : "—"}</div>
            <div><span className="text-muted-foreground">Research handoff:</span> {lastControlled?.researchHandoff ? "sì" : "no"}</div>
            <div><span className="text-muted-foreground">Unsafe rifiutato:</span> {lastControlled?.unsafe ? "sì" : "no"}</div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Missing info:</span> {lastControlled?.missing?.length ? lastControlled.missing.join(", ") : "—"}</div>
            <div className="sm:col-span-2 pt-1 border-t mt-1 font-medium text-muted-foreground">Response lifecycle</div>
            <div><span className="text-muted-foreground">Response state:</span> {diagnostics.responseState}</div>
            <div><span className="text-muted-foreground">Active response id:</span> {diagnostics.activeResponseIdRedacted ?? "—"}</div>
            <div><span className="text-muted-foreground">Pending response:</span> {diagnostics.pendingResponse ? "sì" : "no"}</div>
            <div><span className="text-muted-foreground">Last create reason:</span> {diagnostics.lastResponseCreateReason ?? "—"}</div>
            <div><span className="text-muted-foreground">Last create at:</span> {diagnostics.lastResponseCreateAt ? new Date(diagnostics.lastResponseCreateAt).toLocaleTimeString() : "—"}</div>
            <div><span className="text-muted-foreground">Last done at:</span> {diagnostics.lastResponseDoneAt ? new Date(diagnostics.lastResponseDoneAt).toLocaleTimeString() : "—"}</div>
            <div><span className="text-muted-foreground">Skipped create:</span> {diagnostics.skippedResponseCreateCount}</div>
            <div><span className="text-muted-foreground">Duplicate handled:</span> {diagnostics.duplicateResponseHandledCount}</div>
            {diagnostics.lastTest ? (
              <div className="sm:col-span-2 pt-1 border-t mt-1">
                <span className="text-muted-foreground">Ultimo test config:</span> {diagnostics.lastTest.message}
                {diagnostics.lastTest.server_time ? (
                  <span className="text-muted-foreground"> · {diagnostics.lastTest.server_time}</span>
                ) : null}
              </div>
            ) : null}
            {diagnostics.lastRealtimeProbe ? (
              <div className="sm:col-span-2 pt-1 border-t mt-1">
                <span className="text-muted-foreground">Ultimo Realtime probe:</span>{" "}
                {diagnostics.lastRealtimeProbe.ok ? "OK" : "FAIL"} · {diagnostics.lastRealtimeProbe.message}
                {diagnostics.lastRealtimeProbe.openai_request_id ? (
                  <span className="text-muted-foreground"> · req {diagnostics.lastRealtimeProbe.openai_request_id}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-md border bg-muted/30">
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            Trascrizione & tool log
          </div>
          <ScrollArea className="h-64">
            <div className="space-y-1 p-3 text-sm">
              {log.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  La conversazione apparirà qui. Nessun audio viene salvato.
                </p>
              ) : (
                log.map((entry) => (
                  <div
                    key={entry.id}
                    className={
                      entry.kind === "user"
                        ? "text-foreground"
                        : entry.kind === "jack"
                          ? "text-violet-600 dark:text-violet-300"
                          : entry.kind === "tool"
                            ? "text-blue-600 dark:text-blue-300 text-xs font-mono"
                            : entry.kind === "error"
                              ? "text-destructive text-xs"
                              : entry.kind === "warning"
                                ? "text-amber-600 dark:text-amber-300 text-xs"
                                : "text-muted-foreground text-xs"
                    }
                  >
                    <span className="opacity-60 mr-1">
                      {entry.kind === "user"
                        ? "Tu:"
                        : entry.kind === "jack"
                          ? "Jack:"
                          : entry.kind === "tool"
                            ? "Tool:"
                            : entry.kind === "error"
                              ? "Errore:"
                              : entry.kind === "warning"
                                ? "Avviso:"
                                : "•"}
                    </span>
                    {entry.text}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <audio ref={audioElRef} hidden />
      </CardContent>
    </Card>
  );
}
