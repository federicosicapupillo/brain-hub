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
  REALTIME_INPUT_TRANSCRIPTION_LANGUAGE,
  REALTIME_INPUT_TRANSCRIPTION_MODEL,
} from "@/lib/openai-realtime.functions";
import { runJackGptTool, logJackGptEvent } from "@/lib/jack-gpt-tools";
import { createControlledJackActionFromPreview } from "@/lib/jack-controlled-actions.functions";
import { getAutomationActionById, type AutomationAction } from "@/lib/action-queue";
import {
  saveJackActionPreviewFn,
  getPendingJackActionPreviewFn,
  cancelJackActionPreviewFn,
  confirmJackActionPreviewFn,
} from "@/lib/jack-action-previews.functions";
import {
  buildJackPreviewId,
  detectVoiceConfirmationIntent,
  hashJackActionText,
  
  normalizeVoiceConfirmationText,
  redactJackIdempotencyKey,
  type PendingJackActionPreview,
} from "@/lib/jack-action-confirmation";
import { JACK_GPT_PRIVACY_NOTICE, JACK_GPT_SYSTEM_INSTRUCTIONS } from "@/lib/jack-gpt-instructions";
import {
  GATED_VOICE_TOOLS,
  buildBlockedToolPayload,
  classifyUserUtterance,
  decideVoiceToolGate,
  isAssistantQuestion,
  type IgnoredUtteranceReason,
  type VoiceToolBlockedReason,
} from "@/lib/jack-voice-tool-gate";
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
type RealtimeTrackedEventType =
  | "conversation.item.input_audio_transcription.delta"
  | "conversation.item.input_audio_transcription.completed"
  | "conversation.item.input_audio_transcription.failed"
  | "input_audio_buffer.speech_started"
  | "input_audio_buffer.speech_stopped"
  | "response.created"
  | "response.done"
  | "response.output_audio.done"
  | "output_audio_buffer.stopped";

const TRACKED_REALTIME_EVENT_TYPES = new Set<string>([
  "conversation.item.input_audio_transcription.delta",
  "conversation.item.input_audio_transcription.completed",
  "conversation.item.input_audio_transcription.failed",
  "input_audio_buffer.speech_started",
  "input_audio_buffer.speech_stopped",
  "response.created",
  "response.done",
  "response.output_audio.done",
  "output_audio_buffer.stopped",
]);

function isRealtimeTrackedEventType(type: string): type is RealtimeTrackedEventType {
  return TRACKED_REALTIME_EVENT_TYPES.has(type);
}

function isModelClaimingConfirmation(text: string): boolean {
  const normalized = normalizeVoiceConfirmationText(text);
  return (
    /\bconferma\s+ricevuta\b/i.test(normalized) ||
    /\bprocedo\b/i.test(normalized) ||
    /\bconfermat[oa]\b/i.test(normalized) ||
    /\baction\s+creat[ao]\b/i.test(normalized) ||
    /\bazione\s+creat[ao]\b/i.test(normalized)
  );
}

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
  // v3.21.8 — Realtime input transcription + voice confirmation source of truth
  inputTranscriptionConfigured: boolean;
  inputTranscriptionModel: string | null;
  inputTranscriptionLanguage: string | null;
  lastInputTranscriptionEventType: RealtimeTrackedEventType | null;
  lastInputTranscriptLength: number | null;
  lastInputTranscriptHash: string | null;
  lastInputTranscriptReceivedAt: number | null;
  recentRealtimeEventTypes: RealtimeTrackedEventType[];
  inputTranscriptionCompletedSeen: boolean;
  inputTranscriptNonEmptySeen: boolean;
  modelClaimedConfirmationWithoutBridge: boolean;
  lastModelClaimAt: number | null;
  lastVoiceBridgeTriggeredAt: number | null;
  voiceConfirmationResponseSuppressed: boolean;
  // v3.21.7 — voice confirmation bridge diagnostics
  lastVoiceTranscriptDetected: boolean;
  lastVoiceConfirmationIntent: boolean;
  lastVoiceConfirmationIgnoredReason:
    | "none"
    | "no_pending_preview"
    | "duplicate"
    | "ambiguous"
    | "in_flight"
    | "preview_too_old"
    | null;
  voiceConfirmationInFlight: boolean;
  voiceConfirmationLastSource: "voice_router" | "ui_button" | null;
  // v3.22.1 — false-positive suppression diagnostics
  skippedBecauseNoPendingPreview: boolean;
  genericConfirmationIgnored: boolean;
  pendingPreviewExists: boolean;
  // v3.24.1 — tool failure visibility for voice recovery
  lastToolStatus: string | null;
  lastToolOk: boolean | null;
  lastToolErrorCode: string | null;
  lastToolSafeMessage: string | null;
  lastToolRequiresReauth: boolean;
  lastToolCacheStale: boolean;
  lastToolShouldNotCiteEmails: boolean;
  lastToolFailureRecoveryFiredAt: number | null;
  // v3.24.2 — voice tool gate / echo guard
  lastValidUserUtterance: string | null;
  lastValidUserUtteranceAt: number | null;
  lastIgnoredUserUtterance: string | null;
  lastIgnoredReason: IgnoredUtteranceReason | null;
  pendingToolConfirmation: boolean;
  lastToolBlockedReason: VoiceToolBlockedReason | null;
  lastToolGateDecision: "allowed" | "blocked" | null;
  lastAssistantAskedConfirmationAt: number | null;
  lastGmailSyncStatus: string | null;
  lastGmailSyncSafeMessage: string | null;
  lastGmailSyncErrorCode: string | null;
  lastGmailRequiresReauth: boolean;
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
    inputTranscriptionConfigured: false,
    inputTranscriptionModel: null,
    inputTranscriptionLanguage: null,
    lastInputTranscriptionEventType: null,
    lastInputTranscriptLength: null,
    lastInputTranscriptHash: null,
    lastInputTranscriptReceivedAt: null,
    recentRealtimeEventTypes: [],
    inputTranscriptionCompletedSeen: false,
    inputTranscriptNonEmptySeen: false,
    modelClaimedConfirmationWithoutBridge: false,
    lastModelClaimAt: null,
    lastVoiceBridgeTriggeredAt: null,
    voiceConfirmationResponseSuppressed: false,
    lastVoiceTranscriptDetected: false,
    lastVoiceConfirmationIntent: false,
    lastVoiceConfirmationIgnoredReason: null,
    voiceConfirmationInFlight: false,
    voiceConfirmationLastSource: null,
    skippedBecauseNoPendingPreview: false,
    genericConfirmationIgnored: false,
    pendingPreviewExists: false,
    lastToolStatus: null,
    lastToolOk: null,
    lastToolErrorCode: null,
    lastToolSafeMessage: null,
    lastToolRequiresReauth: false,
    lastToolCacheStale: false,
    lastToolShouldNotCiteEmails: false,
    lastToolFailureRecoveryFiredAt: null,
    lastValidUserUtterance: null,
    lastValidUserUtteranceAt: null,
    lastIgnoredUserUtterance: null,
    lastIgnoredReason: null,
    pendingToolConfirmation: false,
    lastToolBlockedReason: null,
    lastToolGateDecision: null,
    lastAssistantAskedConfirmationAt: null,
    lastGmailSyncStatus: null,
    lastGmailSyncSafeMessage: null,
    lastGmailSyncErrorCode: null,
    lastGmailRequiresReauth: false,
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
  // v3.21.7 — voice confirmation bridge
  const voiceConfirmationInFlightRef = useRef<boolean>(false);
  const voiceConfirmationDedupRef = useRef<{ normalized: string; at: number } | null>(null);
  const lastVoiceBridgeTriggeredAtRef = useRef<number | null>(null);
  const lastVoiceServerVerifiedAtRef = useRef<number | null>(null);
  const inputTranscriptionCompletedSeenRef = useRef<boolean>(false);
  const VOICE_CONFIRM_DEDUP_MS = 3000;
  const VOICE_CONFIRM_MAX_PREVIEW_AGE_MS = 10 * 60 * 1000;
  const confirmFromPreviewFn = useServerFn(createControlledJackActionFromPreview);
  // v3.21.6 — persistence bridge
  const savePreviewFn = useServerFn(saveJackActionPreviewFn);
  const restorePreviewFn = useServerFn(getPendingJackActionPreviewFn);
  const cancelPreviewFn = useServerFn(cancelJackActionPreviewFn);
  const confirmPreviewFn = useServerFn(confirmJackActionPreviewFn);
  type PreviewPersistenceStatus =
    | "local_only"
    | "saving"
    | "saved"
    | "restore_found"
    | "restore_missing"
    | "save_failed"
    | "confirmed";
  const [previewPersistenceStatus, setPreviewPersistenceStatus] =
    useState<PreviewPersistenceStatus>("local_only");
  const [previewDbStatus, setPreviewDbStatus] = useState<
    "pending" | "confirmed" | "cancelled" | "expired" | null
  >(null);
  const restoreAttemptedRef = useRef(false);

  // v3.24.2 — voice tool gate + echo guard refs
  const lastValidUserUtteranceRef = useRef<{ text: string; at: number } | null>(null);
  const lastAssistantSpokenTextRef = useRef<string | null>(null);
  const lastAssistantSpokenAtRef = useRef<number | null>(null);
  const lastAssistantAskedConfirmationAtRef = useRef<number | null>(null);


  const pushLog = useCallback((entry: Omit<LogEntry, "id" | "ts">) => {
    setLog((prev) => [
      ...prev.slice(-49),
      { ...entry, id: crypto.randomUUID(), ts: Date.now() },
    ]);
  }, []);

  const safeLog = useCallback(
    (event: string, metadata: Record<string, unknown> = {}) => {
      // v3.21.6 — JSON-roundtrip the payload so undefined values, Dates,
      // class instances, or non-serializable references never reach the
      // server-fn Seroval parser (which 500s on malformed payloads).
      let safeMeta: Record<string, unknown>;
      try {
        safeMeta = JSON.parse(
          JSON.stringify({ ...metadata, brain_id: brainId ?? null }),
        ) as Record<string, unknown>;
      } catch {
        safeMeta = { brain_id: brainId ?? null, _serialize_error: true };
      }
      void logFn({ data: { event, metadata: safeMeta } }).catch(
        () => undefined,
      );
    },
    [logFn, brainId],
  );

  const trackRealtimeEventType = useCallback(
    (eventType: string, transcript?: string | null) => {
      if (!isRealtimeTrackedEventType(eventType)) return;
      const transcriptText = typeof transcript === "string" ? transcript.trim() : "";
      const transcriptLength = transcriptText.length || null;
      const transcriptHash = transcriptText ? hashJackActionText(transcriptText) : null;
      const receivedAt = eventType === "conversation.item.input_audio_transcription.completed"
        ? Date.now()
        : null;
      if (eventType === "conversation.item.input_audio_transcription.completed") {
        inputTranscriptionCompletedSeenRef.current = true;
        safeLog("jack_realtime_input_transcription_completed_seen", {
          event_type: eventType,
          transcript_length: transcriptLength ?? 0,
          phrase_hash: transcriptHash,
          has_pending_preview: Boolean(pendingPreviewRef.current),
          preview_id: pendingPreviewRef.current?.preview_id ?? null,
        });
      }
      setDiagnostics((d) => ({
        ...d,
        lastInputTranscriptionEventType: eventType,
        lastInputTranscriptLength: transcriptLength ?? d.lastInputTranscriptLength,
        lastInputTranscriptHash: transcriptHash ?? d.lastInputTranscriptHash,
        lastInputTranscriptReceivedAt: receivedAt ?? d.lastInputTranscriptReceivedAt,
        recentRealtimeEventTypes: [...d.recentRealtimeEventTypes, eventType].slice(-10),
        inputTranscriptionCompletedSeen:
          d.inputTranscriptionCompletedSeen || eventType === "conversation.item.input_audio_transcription.completed",
        inputTranscriptNonEmptySeen: d.inputTranscriptNonEmptySeen || transcriptText.length > 0,
      }));
    },
    [safeLog],
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

  const suppressActiveRealtimeResponse = useCallback(
    (reason: string): boolean => {
      const dc = dcRef.current;
      let suppressed = false;
      pendingResponseCreateRef.current = null;
      setDiagnostics((d) => ({ ...d, pendingResponse: false }));
      if (dc && dc.readyState === "open" && responseInProgressRef.current) {
        try {
          dc.send(JSON.stringify({ type: "response.cancel" }));
          suppressed = true;
        } catch {
          suppressed = false;
        }
      }
      if (suppressed) {
        safeLog("jack_voice_confirmation_response_suppressed", {
          safe_message: reason,
          response_id: redactResponseId(activeResponseIdRef.current),
        });
      }
      setDiagnostics((d) => ({ ...d, voiceConfirmationResponseSuppressed: d.voiceConfirmationResponseSuppressed || suppressed }));
      return suppressed;
    },
    [safeLog],
  );

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
      // v3.24.2 — voice tool gate. Block gated tools if there is no recent
      // explicit user command / confirmation, especially right after Jack
      // has asked the user a question.
      if (GATED_VOICE_TOOLS.has(name)) {
        const gateNow = Date.now();
        const decision = decideVoiceToolGate({
          toolName: name,
          lastValidUserUtterance: lastValidUserUtteranceRef.current?.text ?? null,
          lastValidUserUtteranceAt: lastValidUserUtteranceRef.current?.at ?? null,
          lastAssistantQuestionAt: lastAssistantAskedConfirmationAtRef.current,
          lastAssistantQuestionText: lastAssistantSpokenTextRef.current,
          now: gateNow,
        });
        if (decision.status === "blocked") {
          processedToolCallIdsRef.current.add(callId);
          setDiagnostics((d) => ({
            ...d,
            lastToolGateDecision: "blocked",
            lastToolBlockedReason: decision.reason,
            pendingToolConfirmation: true,
          }));
          safeLog(
            decision.reason ===
              "tool_called_after_assistant_question_without_user_reply"
              ? "jack_voice_tool_blocked_after_assistant_question"
              : "jack_voice_tool_blocked_confirmation_required",
            {
              tool_name: name,
              reason: decision.reason,
              has_pending_assistant_question: Boolean(
                lastAssistantAskedConfirmationAtRef.current,
              ),
            },
          );
          pushLog({
            kind: "warning",
            text: `Tool ${name} bloccato: ${decision.reason}.`,
          });
          const dcBlock = dcRef.current;
          if (dcBlock && dcBlock.readyState === "open") {
            try {
              dcBlock.send(
                JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "function_call_output",
                    call_id: callId,
                    output: JSON.stringify(
                      buildBlockedToolPayload(
                        decision.reason,
                        decision.safe_message,
                      ),
                    ),
                  },
                }),
              );
            } catch {
              /* noop */
            }
            safeCreateResponse("tool_blocked_confirmation_required", {
              queueIfBusy: true,
            });
          }
          return;
        }
        setDiagnostics((d) => ({
          ...d,
          lastToolGateDecision: "allowed",
          lastToolBlockedReason: null,
          pendingToolConfirmation: false,
        }));
      }

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
      const resultRecord = result as Record<string, unknown>;
      const okFlag = resultRecord.ok === true;
      // v3.24.1 — for structured-failure tools (e.g. refresh_gmail_sync) the
      // dispatcher always returns a JSON-safe payload; the transcript should
      // show "ok" because the tool did NOT throw, even when ok:false.
      const structuredFailureTool = name === "refresh_gmail_sync";
      if (!okFlag && (result as { error?: string }).error === "tool_rejected") {
        safeLog("jack_gpt_tool_rejected", { name });
      }
      const transcriptOk = okFlag || structuredFailureTool;
      pushLog({
        kind: "tool",
        text: `← ${name}: ${transcriptOk ? "ok" : `errore ${(result as { error?: string }).error ?? ""}`}`,
      });
      // Capture rich diagnostics for the panel.
      const lastToolStatus =
        typeof resultRecord.status === "string" ? (resultRecord.status as string) : null;
      const lastToolErrorCode =
        typeof resultRecord.error_code === "string"
          ? (resultRecord.error_code as string)
          : null;
      const lastToolSafeMessage =
        typeof resultRecord.safe_message === "string"
          ? (resultRecord.safe_message as string)
          : null;
      const requiresReauth = resultRecord.requires_reauth === true;
      const cacheStale = resultRecord.cache_stale === true;
      const shouldNotCite = resultRecord.should_not_cite_emails === true;
      setDiagnostics((d) => ({
        ...d,
        lastToolStatus,
        lastToolOk: okFlag,
        lastToolErrorCode,
        lastToolSafeMessage,
        lastToolRequiresReauth: requiresReauth,
        lastToolCacheStale: cacheStale,
        lastToolShouldNotCiteEmails: shouldNotCite,
        ...(name === "refresh_gmail_sync"
          ? {
              lastGmailSyncStatus: lastToolStatus,
              lastGmailSyncSafeMessage: lastToolSafeMessage,
              lastGmailSyncErrorCode: lastToolErrorCode,
              lastGmailRequiresReauth: requiresReauth,
            }
          : {}),
      }));
      safeLog("jack_realtime_tool_call_completed", {
        tool_name: name,
        call_id: callId.slice(0, 8),
        ok: okFlag,
      });
      safeLog("jack_gpt_tool_completed", { name, ok: okFlag });
      // v3.24.1 — schedule a forced fallback assistant message if the model
      // doesn't speak within ~2s after a structured tool failure.
      if (structuredFailureTool && !okFlag && lastToolSafeMessage) {
        const startedAt = Date.now();
        safeLog("jack_voice_tool_failure_recovery_started", {
          tool_name: name,
          status: lastToolStatus,
          error_code: lastToolErrorCode,
          requires_reauth: requiresReauth,
          cache_stale: cacheStale,
          has_safe_message: true,
        });
        setDiagnostics((d) => ({ ...d, lastToolFailureRecoveryFiredAt: startedAt }));
        setTimeout(() => {
          // If the model already produced a response after the tool call, skip.
          if ((lastResponseDoneAtRef.current ?? 0) > startedAt) {
            safeLog("jack_voice_tool_failure_recovery_completed", {
              tool_name: name,
              outcome: "model_responded",
            });
            return;
          }
          const dcLocal = dcRef.current;
          if (!dcLocal || dcLocal.readyState !== "open") {
            safeLog("jack_voice_tool_failure_recovery_failed", {
              tool_name: name,
              reason: "dc_closed",
            });
            return;
          }
          try {
            const fallbackText =
              lastToolSafeMessage ??
              "Fede, Gmail non si è sincronizzato. Serve ricollegare Gmail o controllare il Gmail Connector.";
            dcLocal.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "text", text: fallbackText }],
                },
              }),
            );
            pushLog({ kind: "jack", text: fallbackText });
            safeLog("jack_voice_tool_failure_recovery_completed", {
              tool_name: name,
              outcome: "fallback_injected",
            });
          } catch {
            safeLog("jack_voice_tool_failure_recovery_failed", {
              tool_name: name,
              reason: "dc_send_throw",
            });
          }
        }, 2200);
      }
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
          lastVoiceBridgeTriggeredAtRef.current = null;
          lastVoiceServerVerifiedAtRef.current = null;
          setPendingActionPreview(currentPreview);
          setConfirmationStatus(null);
          setCreatedActionId(null);
          setPreviewDbStatus("pending");
          safeLog("jack_pending_action_preview_stored", {
            preview_id: currentPreview.preview_id,
            source: currentPreview.source,
            risk_level: currentPreview.risk_level,
            title_hash: hashJackActionText(currentPreview.title),
            idempotency_key: redactJackIdempotencyKey(currentPreview.idempotency_key),
          });
          // v3.21.6 — persist preview so refresh / route change / DB error
          // doesn't lose the proposal. Never creates a real action.
          setPreviewPersistenceStatus("saving");
          safeLog("jack_action_preview_save_started", {
            preview_id: currentPreview.preview_id,
            title_hash: hashJackActionText(currentPreview.title),
          });
          void savePreviewFn({
            data: {
              preview_id: currentPreview.preview_id,
              title: currentPreview.title,
              description: currentPreview.description ?? null,
              source: currentPreview.source ?? "jack",
              idempotency_key: currentPreview.idempotency_key,
              brain_id: currentPreview.brain_id ?? brainId ?? null,
              preview_payload: currentPreview as unknown as Record<string, unknown>,
              expires_in_minutes: 120,
              metadata: { tool: "preview_controlled_action" },
            },
          })
            .then((saveRes) => {
              if (saveRes.ok) {
                setPreviewPersistenceStatus("saved");
                safeLog("jack_action_preview_saved", {
                  preview_id: currentPreview.preview_id,
                  deduplicated: saveRes.deduplicated,
                });
              } else {
                setPreviewPersistenceStatus("save_failed");
                safeLog("jack_action_preview_save_failed", {
                  preview_id: currentPreview.preview_id,
                  error_code: saveRes.reason,
                });
              }
            })
            .catch((err: unknown) => {
              setPreviewPersistenceStatus("save_failed");
              safeLog("jack_action_preview_save_failed", {
                preview_id: currentPreview.preview_id,
                error_code: "exception",
                safe_message: String((err as Error)?.message ?? err).slice(0, 160),
              });
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

  // v3.19.6 / v3.21.5 — confirm pending preview through the server bridge,
  // then verify the created action is actually readable as the same user.
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
        return "rejected" as const;
      }
      if (confirmingPreviewIdRef.current === preview.preview_id) return "rejected" as const;
      confirmingPreviewIdRef.current = preview.preview_id;
      setConfirmingAction(true);
      setConfirmationStatus(`Sto verificando la conferma e creando la action: ${preview.title}`);

      const previewIdRedacted = `${preview.preview_id.slice(0, 8)}…`;
      const baseResult: LastActionCreateResult = {
        at: Date.now(),
        previewIdRedacted,
        confirmationSource: source,
        phase: "confirm_called",
        actionIdRedacted: null,
        actionTitle: null,
        deduplicated: null,
        verificationStatus: null,
        verificationSource: null,
        verificationBrainId: null,
        titleMatches: null,
        visibleInCurrentList: null,
        errorCode: null,
        safeMessage: null,
      };
      setLastActionCreateResult(baseResult);

      const baseEvent = {
        preview_id: preview.preview_id,
        confirmation_source: source,
        title_hash: hashJackActionText(preview.title),
        idempotency_key: redactJackIdempotencyKey(preview.idempotency_key),
        brain_id: preview.brain_id ?? brainId ?? null,
      };
      safeLog("jack_confirm_pending_preview_called", baseEvent);
      safeLog("jack_pending_preview_current_confirmed", baseEvent);
      safeLog("jack_action_create_from_preview_started", baseEvent);
      pushLog({
        kind: "system",
        text: `Verifico la conferma e creo la action: ${preview.title}`,
      });

      try {
        safeLog("jack_confirm_pending_preview_server_call_started", baseEvent);
        setLastActionCreateResult((prev) =>
          prev ? { ...prev, phase: "server_call_started" } : prev,
        );
        // v3.21.6 — confirm via persistent preview_id; server loads the saved
        // preview row, verifies pending+not-expired, then inserts the action.
        safeLog("jack_action_preview_confirm_started", baseEvent);
        const confirmRes = await confirmPreviewFn({
          data: {
            preview_id: preview.preview_id,
            confirmation_source: source,
          },
        });
        // Map persistent response onto the legacy shape used downstream.
        const res = confirmRes.ok
          ? {
              ok: true as const,
              action_id: confirmRes.action_id,
              action_title: confirmRes.title,
              deduplicated: confirmRes.deduplicated,
              reason: null as string | null,
              safe_message: null as string | null,
            }
          : {
              ok: false as const,
              action_id: null,
              action_title: null,
              deduplicated: false,
              reason: confirmRes.reason,
              safe_message: confirmRes.safe_message,
            };
        if (userTranscript && source === "voice_router") {
          // Best-effort: keep transcript hash off the wire entirely.
        }
        safeLog("jack_confirm_pending_preview_server_call_returned", {
          ...baseEvent,
          has_action_id: Boolean(res.action_id),
          deduplicated: Boolean(res.deduplicated),
          reason: res.reason ?? null,
        });
        // Eliminate dead-store lint by referencing the legacy server fn ref
        // (kept for backwards-compat callers; not invoked here).
        void confirmFromPreviewFn;

        if (!res.ok || !res.action_id || !res.action_title) {
          safeLog("jack_confirm_pending_preview_no_action_id", {
            ...baseEvent,
            reason: res.reason ?? "unknown",
          });
          safeLog("jack_action_create_from_preview_failed", {
            ...baseEvent,
            reason: res.reason ?? "unknown",
          });
          setLastActionCreateResult((prev) =>
            prev
              ? {
                  ...prev,
                  phase: res.action_id ? "server_failed" : "no_action_id",
                  errorCode: res.reason ?? "unknown",
                  safeMessage: res.safe_message ?? null,
                }
              : prev,
          );
          setConfirmationStatus(
            "La conferma è arrivata, ma il server non ha creato la action. La proposta resta pronta.",
          );
          pushLog({
            kind: "warning",
            text:
              res.safe_message ??
              "La conferma è arrivata, ma il server non ha creato la action. La proposta resta pronta.",
          });
          return "failed" as const;
        }

        const titleMatches = res.action_title.trim() === preview.title.trim();
        const actionIdRedacted = `${res.action_id.slice(0, 8)}…`;
        setLastActionCreateResult((prev) =>
          prev
            ? {
                ...prev,
                phase: "server_ok",
                actionIdRedacted,
                actionTitle: res.action_title ?? null,
                deduplicated: Boolean(res.deduplicated),
                titleMatches,
              }
            : prev,
        );

        if (!titleMatches) {
          safeLog("jack_action_created_title_mismatch", {
            ...baseEvent,
            action_id: res.action_id,
            deduplicated: Boolean(res.deduplicated),
          });
          setConfirmationStatus(
            "Errore: la action creata non corrisponde alla preview corrente. La proposta resta pronta.",
          );
          pushLog({
            kind: "error",
            text: "Errore: la action creata non corrisponde alla preview corrente. La proposta resta pronta.",
          });
          return "failed" as const;
        }

        safeLog("jack_action_create_from_preview_succeeded", {
          ...baseEvent,
          action_id: res.action_id,
          deduplicated: Boolean(res.deduplicated),
          mismatch: false,
        });

        // Broad invalidation across every action-queue-related cache key.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["action-queue"] }),
          queryClient.invalidateQueries({ queryKey: ["action-queue-brains"] }),
          queryClient.invalidateQueries({ queryKey: ["action-queue-workflows"] }),
          queryClient.invalidateQueries({ queryKey: ["automation-actions"] }),
          queryClient.invalidateQueries({ queryKey: ["actions"] }),
        ]);
        safeLog("jack_action_queue_refetch_requested", {
          ...baseEvent,
          action_id: res.action_id,
          deduplicated: Boolean(res.deduplicated),
        });

        // Immediate read-by-id verification: the same UI client reads
        // automation_actions under RLS; if RLS hides it, we report missing.
        safeLog("jack_confirm_pending_preview_verification_started", {
          ...baseEvent,
          action_id: res.action_id,
        });
        setLastActionCreateResult((prev) =>
          prev ? { ...prev, phase: "verification_started" } : prev,
        );
        let verified: AutomationAction | null = null;
        try {
          verified = await getAutomationActionById(res.action_id);
        } catch (verifyErr) {
          safeLog("jack_confirm_pending_preview_verification_missing", {
            ...baseEvent,
            action_id: res.action_id,
            error_code: "verify_query_failed",
            detail: String((verifyErr as Error).message ?? verifyErr).slice(0, 160),
          });
        }

        if (!verified) {
          safeLog("jack_confirm_pending_preview_verification_missing", {
            ...baseEvent,
            action_id: res.action_id,
            error_code: "not_found_under_rls",
          });
          setLastActionCreateResult((prev) =>
            prev
              ? {
                  ...prev,
                  phase: "verification_missing",
                  errorCode: "not_found_under_rls",
                }
              : prev,
          );
          setConfirmationStatus(
            "Action creata ma non visibile nella lista corrente. Controlla filtri o brain selezionato.",
          );
          pushLog({
            kind: "warning",
            text: `Action creata (${actionIdRedacted}) ma non visibile sotto l'utente corrente. Controlla filtri o brain.`,
          });
          if (source === "voice_router") {
            pushLog({
              kind: "jack",
              text: "Ho ricevuto la conferma, ma non sono riuscito a verificare la creazione della action.",
            });
          }
          return "missing" as const;
        }

        // Verify it actually shows up in the current /action-queue list
        // for this user's current brain filter.
        let visibleInCurrentList: boolean | null = null;
        try {
          const cached = queryClient.getQueriesData<AutomationAction[]>({
            queryKey: ["action-queue"],
          });
          visibleInCurrentList = cached.some(([, list]) =>
            Array.isArray(list) && list.some((a) => a?.id === res.action_id),
          );
        } catch {
          visibleInCurrentList = null;
        }

        safeLog("jack_confirm_pending_preview_verification_found", {
          ...baseEvent,
          action_id: res.action_id,
          status: verified.status,
          source: verified.source,
          visible_in_current_list: visibleInCurrentList,
        });
        if (source === "voice_router") {
          safeLog("jack_voice_confirmation_server_verified", {
            ...baseEvent,
            action_id: res.action_id,
            verification_status: "verification_found",
          });
          lastVoiceServerVerifiedAtRef.current = Date.now();
        }
        setLastActionCreateResult((prev) =>
          prev
            ? {
                ...prev,
                phase: "verification_found",
                verificationStatus: verified.status,
                verificationSource: verified.source,
                verificationBrainId: verified.brain_id ?? null,
                visibleInCurrentList,
              }
            : prev,
        );

        pushLog({
          kind: "system",
          text: res.deduplicated
            ? `Action già esistente verificata: ${res.action_title}`
            : `Action creata e verificata: ${res.action_title}`,
        });
        toast.success(res.deduplicated ? "Action già presente" : "Action creata", {
          description: res.action_title,
        });
        setConfirmationStatus(
          visibleInCurrentList === false
            ? `Action creata ma non visibile nella lista corrente (filtro/brain). ID ${actionIdRedacted}.`
            : `Action creata e verificata: ${res.action_title}`,
        );
        setCreatedActionId(res.action_id);
        setPreviewDbStatus("confirmed");
        setPreviewPersistenceStatus("confirmed");
        safeLog("jack_action_preview_confirmed", {
          ...baseEvent,
          action_id_redacted: actionIdRedacted,
          deduplicated: res.deduplicated,
        });
        try {
          pendingPreviewRef.current = null;
          setPendingActionPreview(null);
          if (source === "voice_router") {
            safeLog("jack_voice_confirmation_pending_cleared", {
              ...baseEvent,
              action_id: res.action_id,
              verification_status: "verification_found",
            });
          }
        } catch (clearErr) {
          if (source === "voice_router") {
            safeLog("jack_voice_confirmation_pending_clear_failed", {
              ...baseEvent,
              action_id: res.action_id,
              error_code: clearErr instanceof Error ? clearErr.name : "unknown",
            });
          }
        }
        if (source === "voice_router") {
          pushLog({
            kind: "jack",
            text: "Conferma completata. Ho creato la action in Action Queue.",
          });
        }

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
        return "verified" as const;
      } catch (err) {
        const detail = String((err as Error).message ?? err).slice(0, 160);
        safeLog("jack_confirm_pending_preview_server_call_failed", {
          ...baseEvent,
          detail,
        });
        safeLog("jack_action_preview_confirm_failed", {
          ...baseEvent,
          error_code: "server_call_threw",
          safe_message: detail,
        });
        safeLog("jack_action_create_from_preview_failed", {
          ...baseEvent,
          detail,
        });
        setLastActionCreateResult((prev) =>
          prev
            ? {
                ...prev,
                phase: "server_failed",
                errorCode: "server_call_threw",
                safeMessage: detail,
              }
            : prev,
        );
        setConfirmationStatus("Ho ricevuto la conferma, ma la creazione non è riuscita. La proposta resta pronta.");
        pushLog({
          kind: "error",
          text: "Ho ricevuto la conferma, ma la creazione non è riuscita. La proposta resta pronta.",
        });
        if (source === "voice_router") {
          pushLog({
            kind: "jack",
            text: "Ho ricevuto la conferma, ma non sono riuscito a verificare la creazione della action.",
          });
        }
        return "failed" as const;
      } finally {
        setConfirmingAction(false);
        confirmingPreviewIdRef.current = null;
      }
    },
    [confirmFromPreviewFn, confirmPreviewFn, brainId, safeLog, pushLog, safeCreateResponse, queryClient],
  );

  const cancelPendingPreview = useCallback(() => {
    const current = pendingPreviewRef.current;
    if (!current) return;
    safeLog("jack_pending_action_preview_cancelled", { source: current.source });
    pendingPreviewRef.current = null;
    setPendingActionPreview(null);
    setConfirmationStatus(null);
    setCreatedActionId(null);
    // v3.21.6 — flip persistent row to 'cancelled' (best-effort, never throws).
    void cancelPreviewFn({ data: { preview_id: current.preview_id } })
      .then((res) => {
        if (res.ok) {
          setPreviewDbStatus("cancelled");
          setPreviewPersistenceStatus("local_only");
        }
      })
      .catch(() => undefined);
    pushLog({ kind: "system", text: "Proposta annullata." });
  }, [safeLog, pushLog, cancelPreviewFn]);

  // v3.21.6 — restore pending preview on mount so refresh / route change
  // doesn't force the user to regenerate the proposal.
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    void restorePreviewFn({ data: { brain_id: brainId ?? null } })
      .then((res) => {
        if (!res.ok) return;
        if (!res.found) {
          setPreviewPersistenceStatus("restore_missing");
          safeLog("jack_action_preview_restore_missing", {});
          return;
        }
        // Don't clobber a fresher local preview generated in the meantime.
        if (pendingPreviewRef.current) return;
        const restored = res.preview.preview;
        pendingPreviewRef.current = restored;
        lastVoiceBridgeTriggeredAtRef.current = null;
        lastVoiceServerVerifiedAtRef.current = null;
        setPendingActionPreview(restored);
        setPreviewPersistenceStatus("restore_found");
        setPreviewDbStatus(res.preview.status);
        setConfirmationStatus(null);
        setCreatedActionId(null);
        safeLog("jack_action_preview_restored", {
          preview_id: restored.preview_id,
          status: res.preview.status,
          title_hash: hashJackActionText(restored.title),
        });
        pushLog({
          kind: "system",
          text: `Hai una action in attesa di conferma: ${restored.title}`,
        });
      })
      .catch(() => {
        setPreviewPersistenceStatus("restore_missing");
      });
  }, [restorePreviewFn, brainId, safeLog, pushLog]);

  const handleVoiceConfirmationTranscript = useCallback(
    (transcript: string, sourceEvent: string): void => {
      const normalized = normalizeVoiceConfirmationText(transcript);
      const phraseHash = hashJackActionText(normalized);
      const intent = detectVoiceConfirmationIntent(transcript);
      const preview = pendingPreviewRef.current;
      const baseMeta = {
        has_pending_preview: Boolean(preview),
        preview_id: preview?.preview_id ?? null,
        event_type: sourceEvent,
        transcript_length: transcript.length,
        phrase_hash: phraseHash,
        bridge_triggered: false,
        confirmation_source: "voice_router" as const,
      };

      safeLog("jack_voice_confirmation_transcript_received", {
        ...baseMeta,
        normalized_intent: intent,
      });
      setDiagnostics((d) => ({
        ...d,
        lastVoiceTranscriptDetected: true,
        lastVoiceConfirmationIntent: intent,
        lastVoiceConfirmationIgnoredReason: intent ? d.lastVoiceConfirmationIgnoredReason : "ambiguous",
      }));

      if (!intent) {
        safeLog("jack_voice_confirmation_ignored_ambiguous", {
          ...baseMeta,
          error_code: "no_explicit_phrase",
        });
        return;
      }

      if (!preview) {
        // v3.22.1 — Suppress false-positive warning for generic confirmation
        // phrases ("va bene", "ok", "sì", "perfetto") when no pending preview
        // exists. Only strong, explicit phrases that name the action are
        // surfaced softly; everything else is silently ignored so the text
        // flows to the normal Jack pipeline.
        const isStrongConfirmation =
          /\b(confermo|crea\s+(?:l['’]?\s*|questa\s+|quest['’]?\s*)?(?:action|azione|proposta)|approva|approval[oa])\b/i.test(
            normalized,
          );
        safeLog("jack_voice_confirmation_ignored_no_preview", {
          ...baseMeta,
          error_code: "no_pending_preview",
          generic_confirmation_ignored: !isStrongConfirmation,
          skipped_because_no_pending_preview: true,
          pending_preview_exists: false,
        });
        setDiagnostics((d) => ({
          ...d,
          lastVoiceConfirmationIgnoredReason: "no_pending_preview",
          skippedBecauseNoPendingPreview: true,
          genericConfirmationIgnored: !isStrongConfirmation,
          pendingPreviewExists: false,
        }));
        if (isStrongConfirmation) {
          pushLog({
            kind: "system",
            text: "Conferma esplicita ricevuta, ma non c'è una proposta pendente. Chiedi prima a Jack di prepararla.",
          });
        }
        return;
      }


      if (preview.confirmation_status !== "pending") {
        safeLog("jack_voice_confirmation_ignored_duplicate", {
          ...baseMeta,
          error_code: "preview_not_pending",
        });
        setDiagnostics((d) => ({ ...d, lastVoiceConfirmationIgnoredReason: "duplicate" }));
        return;
      }

      const now = Date.now();
      const dedup = voiceConfirmationDedupRef.current;
      if (dedup && dedup.normalized === normalized && now - dedup.at < VOICE_CONFIRM_DEDUP_MS) {
        safeLog("jack_voice_confirmation_ignored_duplicate", {
          ...baseMeta,
          error_code: "duplicate_transcript_within_window",
        });
        setDiagnostics((d) => ({ ...d, lastVoiceConfirmationIgnoredReason: "duplicate" }));
        return;
      }
      voiceConfirmationDedupRef.current = { normalized, at: now };

      if (voiceConfirmationInFlightRef.current || confirmingPreviewIdRef.current) {
        safeLog("jack_voice_confirmation_ignored_duplicate", {
          ...baseMeta,
          error_code: "confirmation_already_in_flight",
        });
        setDiagnostics((d) => ({ ...d, lastVoiceConfirmationIgnoredReason: "in_flight" }));
        return;
      }

      const createdAtMs = Date.parse(preview.created_at);
      if (Number.isFinite(createdAtMs) && now - createdAtMs > VOICE_CONFIRM_MAX_PREVIEW_AGE_MS) {
        safeLog("jack_voice_confirmation_ignored_ambiguous", {
          ...baseMeta,
          error_code: "preview_too_old",
        });
        setDiagnostics((d) => ({ ...d, lastVoiceConfirmationIgnoredReason: "preview_too_old" }));
        pushLog({ kind: "warning", text: "Proposta troppo vecchia, rigenerala prima di confermare." });
        return;
      }

      voiceConfirmationInFlightRef.current = true;
      lastVoiceBridgeTriggeredAtRef.current = now;
      const suppressed = suppressActiveRealtimeResponse("voice_confirmation_intent_detected");
      setDiagnostics((d) => ({
        ...d,
        voiceConfirmationInFlight: true,
        voiceConfirmationLastSource: "voice_router",
        lastVoiceConfirmationIgnoredReason: "none",
        lastVoiceBridgeTriggeredAt: now,
        voiceConfirmationResponseSuppressed: d.voiceConfirmationResponseSuppressed || suppressed,
      }));
      safeLog("jack_voice_confirmation_bridge_triggered", {
        ...baseMeta,
        bridge_triggered: true,
      });
      safeLog("jack_voice_confirmation_detected", {
        ...baseMeta,
        bridge_triggered: true,
      });
      pushLog({ kind: "system", text: "Conferma vocale intercettata: avvio il percorso controllato." });

      void (async () => {
        try {
          const result = await confirmPendingPreview("voice_router", transcript);
          safeLog("jack_voice_confirmation_confirm_completed", {
            ...baseMeta,
            bridge_triggered: true,
            verification_status: result,
          });
        } catch (err) {
          safeLog("jack_voice_confirmation_confirm_failed", {
            ...baseMeta,
            bridge_triggered: true,
            error_code: err instanceof Error ? err.name : "unknown",
          });
        } finally {
          voiceConfirmationInFlightRef.current = false;
          setDiagnostics((d) => ({ ...d, voiceConfirmationInFlight: false }));
        }
      })();
    },
    [confirmPendingPreview, pushLog, safeLog, suppressActiveRealtimeResponse],
  );




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
        trackRealtimeEventType(msg.type, msg.transcript ?? msg.delta ?? null);
      }
      switch (msg.type) {
        // GA + legacy session lifecycle
        case "session.created":
        case "session.updated":
          break;

        case "input_audio_buffer.speech_started":
          setState("listening");
          break;

        case "input_audio_buffer.speech_stopped":
        case "output_audio_buffer.stopped":
        case "response.output_audio.done":
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
          const transcript = String(msg.transcript);
          if (
            pendingPreviewRef.current &&
            isModelClaimingConfirmation(transcript) &&
            (!inputTranscriptionCompletedSeenRef.current ||
              !lastVoiceBridgeTriggeredAtRef.current ||
              !lastVoiceServerVerifiedAtRef.current ||
              lastVoiceServerVerifiedAtRef.current < lastVoiceBridgeTriggeredAtRef.current)
          ) {
            safeLog("jack_voice_confirmation_model_claim_without_bridge", {
              preview_id: pendingPreviewRef.current.preview_id,
              has_pending_preview: true,
              bridge_triggered: Boolean(lastVoiceBridgeTriggeredAtRef.current),
              transcript_length: transcript.length,
              phrase_hash: hashJackActionText(transcript),
              safe_message: "model_claimed_confirmation_without_bridge",
            });
            setDiagnostics((d) => ({
              ...d,
              modelClaimedConfirmationWithoutBridge: true,
              lastModelClaimAt: Date.now(),
            }));
            pushLog({
              kind: "warning",
              text: "Il modello ha dichiarato una conferma senza bridge verificato: non creo action.",
            });
            pushLog({
              kind: "jack",
              text: "Ho capito l’intenzione, ma non ho ancora completato la conferma controllata. Usa il pulsante o ripeti ‘confermo’.",
            });
            break;
          }
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
          pushLog({ kind: "jack", text: transcript });
          // v3.24.2 — track what Jack said, for echo guard + question gate.
          lastAssistantSpokenTextRef.current = transcript;
          lastAssistantSpokenAtRef.current = Date.now();
          if (isAssistantQuestion(transcript)) {
            lastAssistantAskedConfirmationAtRef.current = Date.now();
            setDiagnostics((d) => ({
              ...d,
              lastAssistantAskedConfirmationAt: Date.now(),
              pendingToolConfirmation: true,
            }));
          }
          break;
        }

        case "conversation.item.input_audio_transcription.delta":
          break;

        case "conversation.item.input_audio_transcription.failed":
          safeLog("jack_realtime_input_transcription_failed", {
            event_type: msg.type,
            error_code: msg.error?.code ?? msg.error?.type ?? "unknown",
            safe_message: msg.error?.message?.slice(0, 120) ?? null,
          });
          break;

        case "conversation.item.input_audio_transcription.completed":
          if (msg.transcript) {
            const transcript = String(msg.transcript);
            const nowTs = Date.now();
            const classification = classifyUserUtterance({
              text: transcript,
              assistantText: lastAssistantSpokenTextRef.current,
              assistantSpokeAt: lastAssistantSpokenAtRef.current,
              now: nowTs,
              hasPendingConfirmation: Boolean(pendingPreviewRef.current),
            });
            if (!classification.valid) {
              safeLog(
                classification.reason === "suspected_echo"
                  ? "jack_voice_user_utterance_ignored_suspected_echo"
                  : "jack_voice_user_utterance_ignored_too_ambiguous",
                {
                  reason: classification.reason,
                  transcript_length: transcript.length,
                  has_pending_preview: Boolean(pendingPreviewRef.current),
                  has_pending_assistant_question: Boolean(
                    lastAssistantAskedConfirmationAtRef.current,
                  ),
                },
              );
              setDiagnostics((d) => ({
                ...d,
                lastIgnoredUserUtterance: transcript.slice(0, 80),
                lastIgnoredReason: classification.reason,
              }));
              pushLog({
                kind: "warning",
                text: `Utterance ignorato (${classification.reason}): "${transcript.slice(0, 60)}"`,
              });
              // Still hand off to confirmation pipeline only if there is a
              // pending preview — voice confirmation has its own ambiguity
              // checks and won't treat echo as confirmation.
              if (pendingPreviewRef.current) {
                handleVoiceConfirmationTranscript(transcript, msg.type);
              }
              break;
            }
            lastValidUserUtteranceRef.current = { text: transcript, at: nowTs };
            // Once the user speaks, clear the "assistant just asked" gate if
            // the user actually answered after the question.
            if (
              lastAssistantAskedConfirmationAtRef.current &&
              nowTs > lastAssistantAskedConfirmationAtRef.current
            ) {
              setDiagnostics((d) => ({ ...d, pendingToolConfirmation: false }));
            }
            setDiagnostics((d) => ({
              ...d,
              lastValidUserUtterance: transcript.slice(0, 80),
              lastValidUserUtteranceAt: nowTs,
              lastIgnoredReason: null,
            }));
            pushLog({ kind: "user", text: transcript });
            handleVoiceConfirmationTranscript(transcript, msg.type);
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
    [handleToolCall, safeLog, pushLog, flushPendingResponse, handleVoiceConfirmationTranscript, trackRealtimeEventType],
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
              audio: {
                input: {
                  transcription: {
                    model: session.input_transcription_model,
                    language: session.input_transcription_language,
                  },
                },
                output: { voice: "alloy" },
              },
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
            setDiagnostics((d) => ({
              ...d,
              inputTranscriptionConfigured: session.input_transcription_configured,
              inputTranscriptionModel: session.input_transcription_model,
              inputTranscriptionLanguage: session.input_transcription_language,
            }));
            safeLog("jack_realtime_input_transcription_config_checked", {
              inputTranscriptionConfigured: session.input_transcription_configured,
              inputTranscriptionModel: session.input_transcription_model,
              inputTranscriptionLanguage: session.input_transcription_language,
              event_type: "session.update",
            });
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

        {lastActionCreateResult ? (
          <Card className="border-sky-500/30 bg-sky-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-sky-600" />
                Diagnostica conferma action (v3.21.6)
              </CardTitle>
              <CardDescription className="text-xs">
                Tracciamento del percorso preview → server → verifica.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div><span className="text-muted-foreground">Fase:</span> {lastActionCreateResult.phase}</div>
              <div><span className="text-muted-foreground">Fonte conferma:</span> {lastActionCreateResult.confirmationSource}</div>
              <div><span className="text-muted-foreground">Preview ID:</span> <code className="text-[10px]">{lastActionCreateResult.previewIdRedacted}</code></div>
              <div><span className="text-muted-foreground">Action ID:</span> {lastActionCreateResult.actionIdRedacted ? <code className="text-[10px]">{lastActionCreateResult.actionIdRedacted}</code> : "—"}</div>
              <div className="sm:col-span-2"><span className="text-muted-foreground">Titolo action:</span> {lastActionCreateResult.actionTitle ?? "—"}</div>
              <div><span className="text-muted-foreground">Title match:</span> {lastActionCreateResult.titleMatches === null ? "—" : lastActionCreateResult.titleMatches ? "sì" : "no"}</div>
              <div><span className="text-muted-foreground">Deduplicated:</span> {lastActionCreateResult.deduplicated === null ? "—" : lastActionCreateResult.deduplicated ? "sì" : "no"}</div>
              <div><span className="text-muted-foreground">Verifica status:</span> {lastActionCreateResult.verificationStatus ?? "—"}</div>
              <div><span className="text-muted-foreground">Verifica source:</span> {lastActionCreateResult.verificationSource ?? "—"}</div>
              <div><span className="text-muted-foreground">Verifica brain:</span> {lastActionCreateResult.verificationBrainId ? `${lastActionCreateResult.verificationBrainId.slice(0, 6)}…` : "—"}</div>
              <div><span className="text-muted-foreground">Visibile in lista:</span> {lastActionCreateResult.visibleInCurrentList === null ? "—" : lastActionCreateResult.visibleInCurrentList ? "sì" : "no (filtro/brain)"}</div>
              <div><span className="text-muted-foreground">Preview persistence:</span> {previewPersistenceStatus}</div>
              <div><span className="text-muted-foreground">Preview DB status:</span> {previewDbStatus ?? "—"}</div>
              <div className="sm:col-span-2 border-t pt-1 mt-1 text-[11px] font-medium text-muted-foreground">Bridge vocale (v3.21.8)</div>
              <div><span className="text-muted-foreground">Input transcription:</span> {diagnostics.inputTranscriptionConfigured ? "configurata" : "non configurata"}</div>
              <div><span className="text-muted-foreground">STT model:</span> {diagnostics.inputTranscriptionModel ?? REALTIME_INPUT_TRANSCRIPTION_MODEL}</div>
              <div><span className="text-muted-foreground">Transcript rilevato:</span> {diagnostics.lastVoiceTranscriptDetected ? "sì" : "—"}</div>
              <div><span className="text-muted-foreground">Intent vocale:</span> {diagnostics.lastVoiceConfirmationIntent ? "conferma" : "—"}</div>
              <div><span className="text-muted-foreground">Voce in corso:</span> {diagnostics.voiceConfirmationInFlight ? "sì" : "no"}</div>
              <div><span className="text-muted-foreground">Response soppressa:</span> {diagnostics.voiceConfirmationResponseSuppressed ? "sì" : "no"}</div>
              <div><span className="text-muted-foreground">Falsa conferma modello:</span> {diagnostics.modelClaimedConfirmationWithoutBridge ? "rilevata" : "—"}</div>
              <div><span className="text-muted-foreground">Voce ignorata:</span> {
                diagnostics.lastVoiceConfirmationIgnoredReason === "no_pending_preview" ? "nessuna action pending" :
                diagnostics.lastVoiceConfirmationIgnoredReason === "duplicate" ? "duplicato/in corso" :
                diagnostics.lastVoiceConfirmationIgnoredReason === "ambiguous" ? "frase ambigua" :
                diagnostics.lastVoiceConfirmationIgnoredReason === "in_flight" ? "conferma già in corso" :
                diagnostics.lastVoiceConfirmationIgnoredReason === "preview_too_old" ? "preview troppo vecchia" :
                "—"
              }</div>
              <div className="sm:col-span-2"><span className="text-muted-foreground">Errore:</span> {lastActionCreateResult.errorCode ?? "—"}</div>
              {lastActionCreateResult.safeMessage ? (
                <div className="sm:col-span-2"><span className="text-muted-foreground">Messaggio:</span> {lastActionCreateResult.safeMessage}</div>
              ) : null}
            </CardContent>
          </Card>
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
            <div><span className="text-muted-foreground">Last tool status:</span> {diagnostics.lastToolStatus ?? "—"}</div>
            <div><span className="text-muted-foreground">Last tool ok:</span> {diagnostics.lastToolOk === null ? "—" : diagnostics.lastToolOk ? "sì" : "no"}</div>
            <div><span className="text-muted-foreground">Last tool error code:</span> {diagnostics.lastToolErrorCode ?? "—"}</div>
            <div><span className="text-muted-foreground">Requires reauth:</span> {diagnostics.lastToolRequiresReauth ? "sì" : "no"}</div>
            <div><span className="text-muted-foreground">Cache stale:</span> {diagnostics.lastToolCacheStale ? "sì" : "no"}</div>
            <div><span className="text-muted-foreground">No cite emails:</span> {diagnostics.lastToolShouldNotCiteEmails ? "sì" : "no"}</div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Last tool safe message:</span> {diagnostics.lastToolSafeMessage ?? "—"}</div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Voice recovery fired:</span> {diagnostics.lastToolFailureRecoveryFiredAt ? new Date(diagnostics.lastToolFailureRecoveryFiredAt).toLocaleTimeString() : "—"}</div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Last safe error:</span> {diagnostics.lastSafeError ?? "—"}</div>
            <div><span className="text-muted-foreground">Cleanup:</span> {diagnostics.cleanupCount}</div>
            <div><span className="text-muted-foreground">Privacy:</span> {status?.privacy_mode ?? "ephemeral_token_only"}</div>
            <div className="sm:col-span-2 pt-1 border-t mt-1 font-medium text-muted-foreground">Realtime input transcription</div>
            <div><span className="text-muted-foreground">Configurata:</span> {diagnostics.inputTranscriptionConfigured ? "sì" : "no"}</div>
            <div><span className="text-muted-foreground">Lingua:</span> {diagnostics.inputTranscriptionLanguage ?? REALTIME_INPUT_TRANSCRIPTION_LANGUAGE}</div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Modello:</span> {diagnostics.inputTranscriptionModel ?? REALTIME_INPUT_TRANSCRIPTION_MODEL}</div>
            <div><span className="text-muted-foreground">Last STT event:</span> {diagnostics.lastInputTranscriptionEventType ?? "—"}</div>
            <div><span className="text-muted-foreground">Transcript non vuoto:</span> {diagnostics.inputTranscriptNonEmptySeen ? "sì" : "no"}</div>
            <div><span className="text-muted-foreground">Completed visto:</span> {diagnostics.inputTranscriptionCompletedSeen ? "sì" : "no"}</div>
            <div><span className="text-muted-foreground">Transcript length:</span> {diagnostics.lastInputTranscriptLength ?? "—"}</div>
            <div><span className="text-muted-foreground">Transcript hash:</span> {diagnostics.lastInputTranscriptHash ?? "—"}</div>
            <div><span className="text-muted-foreground">Ricevuto alle:</span> {diagnostics.lastInputTranscriptReceivedAt ? new Date(diagnostics.lastInputTranscriptReceivedAt).toLocaleTimeString() : "—"}</div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Ultimi event type:</span> {diagnostics.recentRealtimeEventTypes.length ? diagnostics.recentRealtimeEventTypes.join(" → ") : "—"}</div>
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
