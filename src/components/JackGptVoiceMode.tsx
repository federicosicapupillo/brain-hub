import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
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
} from "lucide-react";
import { toast } from "sonner";
import {
  getOpenAiRealtimeStatus,
  createJackRealtimeSession,
  type OpenAiRealtimeStatus,
} from "@/lib/openai-realtime.functions";
import { runJackGptTool, logJackGptEvent } from "@/lib/jack-gpt-tools";
import { JACK_GPT_PRIVACY_NOTICE } from "@/lib/jack-gpt-instructions";

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

type LogKind = "user" | "jack" | "tool" | "system" | "error";
type LogEntry = { id: string; ts: number; kind: LogKind; text: string };

type RealtimeEvent = {
  type?: string;
  transcript?: string;
  item?: {
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  error?: { message?: string; code?: string };
  call_id?: string;
  name?: string;
  arguments?: string;
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
  const [log, setLog] = useState<LogEntry[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const sessionUpdateSentRef = useRef(false);

  const statusFn = useServerFn(getOpenAiRealtimeStatus);
  const sessionFn = useServerFn(createJackRealtimeSession);
  const toolFn = useServerFn(runJackGptTool);
  const logFn = useServerFn(logJackGptEvent);

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

  // Initial config check
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
    safeLog("jack_gpt_mode_opened");
  }, [safeLog]);

  const teardown = useCallback(() => {
    try {
      dcRef.current?.close();
    } catch {
      /* noop */
    }
    try {
      pcRef.current?.getSenders().forEach((s) => {
        try {
          s.track?.stop();
        } catch {
          /* noop */
        }
      });
    } catch {
      /* noop */
    }
    try {
      pcRef.current?.close();
    } catch {
      /* noop */
    }
    localStreamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* noop */
      }
    });
    if (audioElRef.current) {
      try {
        audioElRef.current.srcObject = null;
      } catch {
        /* noop */
      }
    }
    dcRef.current = null;
    pcRef.current = null;
    localStreamRef.current = null;
    sessionUpdateSentRef.current = false;
    safeLog("jack_gpt_cleanup_completed");
  }, [safeLog]);

  const handleToolCall = useCallback(
    async (callId: string, name: string, argsRaw: string) => {
      pushLog({ kind: "tool", text: `→ ${name}` });
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
      safeLog("jack_gpt_tool_completed", { name, ok: okFlag });
      const dc = dcRef.current;
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
        dc.send(JSON.stringify({ type: "response.create" }));
      } catch {
        /* noop */
      }
    },
    [toolFn, safeLog, pushLog],
  );

  const handleDcMessage = useCallback(
    (ev: MessageEvent<string>) => {
      let msg: RealtimeEvent;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "") as RealtimeEvent;
      } catch {
        return;
      }
      switch (msg.type) {
        case "session.created":
        case "session.updated":
          break;
        case "input_audio_buffer.speech_started":
          setState("listening");
          break;
        case "response.audio.delta":
        case "response.audio_transcript.delta":
          setState("speaking");
          break;
        case "response.audio_transcript.done":
          if (msg.transcript) pushLog({ kind: "jack", text: String(msg.transcript) });
          break;
        case "conversation.item.input_audio_transcription.completed":
          if (msg.transcript) pushLog({ kind: "user", text: String(msg.transcript) });
          break;
        case "response.done":
          setState("listening");
          safeLog("jack_gpt_response_received");
          break;
        case "response.function_call_arguments.done":
          if (msg.call_id && msg.name) {
            void handleToolCall(msg.call_id, msg.name, msg.arguments ?? "");
          }
          break;
        case "response.output_item.done": {
          const item = msg.item;
          if (item?.type === "function_call" && item.call_id && item.name) {
            void handleToolCall(item.call_id, item.name, item.arguments ?? "");
          }
          break;
        }
        case "error": {
          const m = msg.error?.message ?? "Errore realtime";
          pushLog({ kind: "error", text: m });
          setLastError(m);
          break;
        }
        default:
          // unknown event types are intentionally ignored
          break;
      }
    },
    [handleToolCall, safeLog, pushLog],
  );

  const start = useCallback(async () => {
    if (!status?.configured) return;
    setLastError(null);
    setLog([]);

    // 1) Microphone permission first — surface early.
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

    // 2) Create ephemeral session.
    setState("creating_session");
    safeLog("jack_gpt_session_requested");
    try {
      const session = await sessionFn({ data: { brain_id: brainId, mode: "jack_gpt" } });
      if (!session.ok) {
        setState("error");
        const msg = `Sessione fallita (${session.error}). Controlla i secrets OpenAI.`;
        setLastError(msg);
        pushLog({ kind: "error", text: msg });
        safeLog("jack_gpt_session_failed", { error: session.error });
        toast.error("Impossibile avviare Jack GPT Mode");
        teardown();
        return;
      }
      safeLog("jack_gpt_session_created", {
        model: session.realtime_model,
        mode: session.mode,
      });

      // 3) WebRTC setup.
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = audioElRef.current ?? new Audio();
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };
      pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState;
        if (s === "failed" || s === "disconnected" || s === "closed") {
          if (state !== "idle") {
            setLastError("Connessione WebRTC interrotta.");
          }
        }
      };

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onopen = () => {
        setState("listening");
        pushLog({ kind: "system", text: "Connessione attiva. Puoi parlare." });
        safeLog("jack_gpt_data_channel_opened");
        safeLog("jack_gpt_connected");
        // Always send a defensive session.update with instructions to ensure persona.
        if (!sessionUpdateSentRef.current) {
          try {
            dc.send(
              JSON.stringify({
                type: "session.update",
                session: {
                  // server already injected these in "full" mode; harmless reaffirmation
                  modalities: ["audio", "text"],
                  voice: "alloy",
                },
              }),
            );
            sessionUpdateSentRef.current = true;
            safeLog("jack_gpt_session_update_sent");
          } catch {
            /* noop */
          }
        }
      };
      dc.onclose = () => {
        safeLog("jack_gpt_data_channel_closed");
      };
      dc.onmessage = handleDcMessage;

      setState("connecting");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      safeLog("jack_gpt_webrtc_offer_created");

      const baseUrl = "https://api.openai.com/v1/realtime";
      const sdpRes = await fetch(
        `${baseUrl}?model=${encodeURIComponent(session.realtime_model)}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${session.client_secret}`,
            "Content-Type": "application/sdp",
            "OpenAI-Beta": "realtime=v1",
          },
        },
      );
      if (!sdpRes.ok) {
        throw new Error(`SDP exchange failed: ${sdpRes.status}`);
      }
      safeLog("jack_gpt_webrtc_answer_received");
      const answer: RTCSessionDescriptionInit = {
        type: "answer",
        sdp: await sdpRes.text(),
      };
      await pc.setRemoteDescription(answer);
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      setState("error");
      setLastError(msg);
      pushLog({ kind: "error", text: msg });
      teardown();
      toast.error("Connessione Jack GPT Mode fallita");
    }
  }, [status, sessionFn, safeLog, handleDcMessage, brainId, pushLog, teardown, state]);

  const stop = useCallback(() => {
    teardown();
    setState(status?.configured ? "idle" : "not_configured");
    safeLog("jack_gpt_disconnected");
  }, [teardown, status, safeLog]);

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

  return (
    <Card className="border-violet-500/20">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-500" />
            Jack GPT Mode
          </CardTitle>
          <Badge variant="outline" className="border-violet-500/40 text-violet-700 dark:text-violet-300">
            OpenAI Realtime
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
          Conversazione vocale naturale con Jack. Affianca Jack Classic (ElevenLabs), non lo sostituisce.
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

        {lastError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Ultimo errore</AlertTitle>
            <AlertDescription className="text-xs">{lastError}</AlertDescription>
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
