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
} from "@/lib/openai-realtime.functions";
import { runJackGptTool, logJackGptEvent } from "@/lib/jack-gpt-tools";
import { JACK_GPT_PRIVACY_NOTICE } from "@/lib/jack-gpt-instructions";

type ConnState =
  | "idle"
  | "not_configured"
  | "checking"
  | "connecting"
  | "listening"
  | "speaking"
  | "error";

type LogEntry = {
  id: string;
  ts: number;
  kind: "user" | "jack" | "tool" | "system" | "error";
  text: string;
};

type Props = {
  brainId?: string | null;
};

export function JackGptVoiceMode({ brainId = null }: Props) {
  const [state, setState] = useState<ConnState>("checking");
  const [status, setStatus] = useState<{
    configured: boolean;
    model_configured: boolean;
    realtime_model: string | null;
  } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

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

  // Initial config check
  useEffect(() => {
    let active = true;
    statusFn()
      .then((res) => {
        if (!active) return;
        setStatus(res);
        setState(res.configured ? "idle" : "not_configured");
      })
      .catch(() => {
        if (!active) return;
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [statusFn]);

  // Log mount once
  useEffect(() => {
    void logFn({ data: { event: "jack_gpt_mode_opened", metadata: { brain_id: brainId } } }).catch(
      () => undefined,
    );
  }, [logFn, brainId]);

  const teardown = useCallback(() => {
    try {
      dcRef.current?.close();
    } catch {
      /* noop */
    }
    try {
      pcRef.current?.close();
    } catch {
      /* noop */
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    dcRef.current = null;
    pcRef.current = null;
    localStreamRef.current = null;
  }, []);

  const handleToolCall = useCallback(
    async (callId: string, name: string, argsRaw: string) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = argsRaw ? JSON.parse(argsRaw) : {};
      } catch {
        /* keep empty */
      }
      pushLog({ kind: "tool", text: `→ ${name}(${Object.keys(parsed).join(", ")})` });
      void logFn({
        data: { event: "jack_gpt_tool_called", metadata: { name, brain_id: brainId } },
      }).catch(() => undefined);
      const result = await toolFn({ data: { tool_name: name, arguments: parsed } });
      pushLog({
        kind: "tool",
        text: `← ${name}: ${result.ok ? "ok" : `error ${"error" in result ? result.error : ""}`}`,
      });
      void logFn({
        data: {
          event: "jack_gpt_tool_completed",
          metadata: { name, ok: result.ok, brain_id: brainId },
        },
      }).catch(() => undefined);
      const dc = dcRef.current;
      if (!dc || dc.readyState !== "open") return;
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
    },
    [toolFn, logFn, brainId, pushLog],
  );

  const handleDcMessage = useCallback(
    (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
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
            void logFn({
              data: { event: "jack_gpt_response_received", metadata: { brain_id: brainId } },
            }).catch(() => undefined);
            break;
          case "response.output_item.done": {
            const item = msg.item;
            if (item?.type === "function_call") {
              void handleToolCall(item.call_id, item.name, item.arguments ?? "");
            }
            break;
          }
          case "error":
            pushLog({ kind: "error", text: msg.error?.message ?? "Errore realtime" });
            break;
          default:
            break;
        }
      } catch {
        /* ignore non-json */
      }
    },
    [handleToolCall, logFn, brainId, pushLog],
  );

  const start = useCallback(async () => {
    if (!status?.configured) return;
    setState("connecting");
    setLog([]);
    void logFn({
      data: { event: "jack_gpt_session_requested", metadata: { brain_id: brainId } },
    }).catch(() => undefined);
    try {
      const session = await sessionFn({ data: { brain_id: brainId, mode: "jack_gpt" } });
      if (!session.ok) {
        setState("error");
        pushLog({ kind: "error", text: `Sessione fallita: ${session.error}` });
        void logFn({
          data: {
            event: "jack_gpt_session_failed",
            metadata: { error: session.error, brain_id: brainId },
          },
        }).catch(() => undefined);
        toast.error("Impossibile avviare Jack GPT Mode");
        return;
      }
      void logFn({
        data: {
          event: "jack_gpt_session_created",
          metadata: { model: session.realtime_model, brain_id: brainId },
        },
      }).catch(() => undefined);

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = audioElRef.current ?? new Audio();
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onopen = () => {
        setState("listening");
        pushLog({ kind: "system", text: "Connesso. Puoi parlare." });
        void logFn({
          data: { event: "jack_gpt_connected", metadata: { brain_id: brainId } },
        }).catch(() => undefined);
      };
      dc.onmessage = handleDcMessage;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const baseUrl = "https://api.openai.com/v1/realtime";
      const sdpRes = await fetch(`${baseUrl}?model=${encodeURIComponent(session.realtime_model)}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${session.client_secret}`,
          "Content-Type": "application/sdp",
          "OpenAI-Beta": "realtime=v1",
        },
      });
      if (!sdpRes.ok) {
        throw new Error(`SDP exchange failed: ${sdpRes.status}`);
      }
      const answer = { type: "answer" as const, sdp: await sdpRes.text() };
      await pc.setRemoteDescription(answer);
    } catch (err) {
      setState("error");
      pushLog({ kind: "error", text: String((err as Error).message ?? err) });
      teardown();
      toast.error("Connessione Jack GPT Mode fallita");
    }
  }, [status, sessionFn, logFn, handleDcMessage, brainId, pushLog, teardown]);

  const stop = useCallback(() => {
    teardown();
    setState(status?.configured ? "idle" : "not_configured");
    void logFn({
      data: { event: "jack_gpt_disconnected", metadata: { brain_id: brainId } },
    }).catch(() => undefined);
  }, [teardown, status, logFn, brainId]);

  useEffect(() => () => teardown(), [teardown]);

  const stateLabel: Record<ConnState, string> = {
    idle: "Pronto",
    not_configured: "Non configurato",
    checking: "Verifica…",
    connecting: "Connessione…",
    listening: "In ascolto",
    speaking: "Jack sta rispondendo",
    error: "Errore",
  };

  const stateTone: Record<ConnState, string> = {
    idle: "bg-muted text-muted-foreground",
    not_configured: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    checking: "bg-muted text-muted-foreground",
    connecting: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    listening: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    speaking: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    error: "bg-destructive/15 text-destructive",
  };

  const isLive = state === "listening" || state === "speaking" || state === "connecting";

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
          {status?.realtime_model ? (
            <span className="text-xs text-muted-foreground">{status.realtime_model}</span>
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
