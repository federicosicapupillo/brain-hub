// ============================================================
// Brain Hub v3.10 — Jack Voice Command MVP — UI component
// ============================================================
// Push-to-talk. Web Speech API for STT (browser-local).
// ElevenLabs (server) for TTS. No audio storage, no automation.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Mic,
  MicOff,
  Loader2,
  Play,
  Send,
  Keyboard,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  resolveJackCommandIntent,
  getJackCommandSuggestions,
  logJackVoiceCommandEvent,
  type JackCommandResult,
} from "@/lib/jack-command-router";
import {
  synthesizeJackVoiceFromText,
  markJackVoicePlayed,
} from "@/lib/jack-voice.functions";
import type { DailyBriefRow } from "@/lib/daily-operating-brief";

type Props = {
  brainId?: string | null;
  briefId?: string | null;
  currentBrief?: DailyBriefRow | null;
};

type Phase =
  | "idle"
  | "listening"
  | "transcribed"
  | "resolving"
  | "speaking"
  | "ready"
  | "error";

// Minimal Web Speech API typings
type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};
type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>;
  resultIndex: number;
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function JackVoiceCommand({ brainId, briefId, currentBrief }: Props) {
  const synthFn = useServerFn(synthesizeJackVoiceFromText);
  const playedFn = useServerFn(markJackVoicePlayed);
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [textInput, setTextInput] = useState("");
  const [showText, setShowText] = useState(false);
  const [result, setResult] = useState<JackCommandResult | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [genId, setGenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastUrlRef = useRef<string | null>(null);

  const SpeechCtor = getSpeechRecognitionCtor();
  const sttSupported = !!SpeechCtor;

  useEffect(() => {
    void logJackVoiceCommandEvent("jack_voice_command_opened", "Apertura Jack voice", {
      brain_id: brainId ?? null,
      brief_id: briefId ?? null,
      stt_supported: sttSupported,
    });
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* noop */
      }
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startListening() {
    if (!SpeechCtor) {
      setShowText(true);
      return;
    }
    setError(null);
    setResult(null);
    setTranscript("");
    setAudioUrl(null);
    setGenId(null);
    try {
      const rec = new SpeechCtor();
      rec.lang = "it-IT";
      rec.continuous = false;
      rec.interimResults = true;
      let finalText = "";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        setTranscript((finalText + " " + interim).trim());
      };
      rec.onerror = (ev) => {
        const msg = ev.error ?? "speech_error";
        setError(msg);
        setPhase("error");
        void logJackVoiceCommandEvent(
          "jack_voice_command_failed",
          "SpeechRecognition error",
          { error: msg },
        );
      };
      rec.onend = () => {
        setPhase((p) => (p === "listening" ? "transcribed" : p));
        void logJackVoiceCommandEvent(
          "jack_voice_listening_stopped",
          "Stop ascolto microfono",
          {},
        );
        const t = (finalText || transcript).trim();
        if (t.length > 0) {
          void handleResolve(t);
        }
      };
      recRef.current = rec;
      rec.start();
      setPhase("listening");
      void logJackVoiceCommandEvent(
        "jack_voice_listening_started",
        "Start ascolto microfono",
        {},
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPhase("error");
    }
  }

  function stopListening() {
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
  }

  async function handleResolve(t: string) {
    void logJackVoiceCommandEvent(
      "jack_voice_transcript_received",
      "Transcript ricevuto",
      { transcript: t, length: t.length },
    );
    setPhase("resolving");
    try {
      const res = await resolveJackCommandIntent({
        transcript: t,
        context: { brainId: brainId ?? null },
      });
      setResult(res);
      void logJackVoiceCommandEvent(
        "jack_voice_intent_resolved",
        `Intent: ${res.intent}`,
        { intent: res.intent, source: res.source, matched: res.matched_phrases },
      );
      void logJackVoiceCommandEvent(
        "jack_voice_response_generated",
        "Risposta generata",
        { intent: res.intent, chars: res.response_text.length },
      );
      await speak(res.response_text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPhase("error");
      void logJackVoiceCommandEvent(
        "jack_voice_command_failed",
        "Resolve error",
        { error: msg },
      );
    }
  }

  async function speak(text: string) {
    if (!text.trim()) return;
    setPhase("speaking");
    try {
      const res = await synthFn({
        data: {
          text,
          brain_id: brainId ?? null,
          brief_id: briefId ?? null,
        },
      });
      const bin = atob(res.audio_base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: res.mime_type });
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
      const url = URL.createObjectURL(blob);
      lastUrlRef.current = url;
      setAudioUrl(url);
      setGenId(res.generation_id);
      setPhase("ready");
      setTimeout(() => {
        audioRef.current?.play().catch(() => {
          /* user gesture */
        });
      }, 100);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Non blocchiamo: il testo è già pronto, manca solo la voce
      setError("Audio Jack non disponibile: " + msg);
      setPhase("ready");
      toast.error("Voce Jack non disponibile (testo visibile sotto)");
    }
  }

  function onAudioPlay() {
    if (genId) {
      playedFn({ data: { generation_id: genId } }).catch(() => {});
    }
    void logJackVoiceCommandEvent(
      "jack_voice_response_spoken",
      "Audio Jack riprodotto",
      { generation_id: genId },
    );
  }

  async function handleSubmitText() {
    const t = textInput.trim();
    if (!t) return;
    setTranscript(t);
    setAudioUrl(null);
    setResult(null);
    setError(null);
    await handleResolve(t);
  }

  async function handleRepeat() {
    if (!result) return;
    await speak(result.response_text);
  }

  const suggestions = getJackCommandSuggestions();

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-center gap-2 flex-wrap">
        <Mic className="h-4 w-4" />
        <span className="font-medium text-sm">Parla con Jack</span>
        <Badge variant="outline" className="gap-1 text-[10px]">
          <ShieldCheck className="h-3 w-3" /> Read-only · no audio storage
        </Badge>
        <PhaseBadge phase={phase} />
        {!sttSupported ? (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
            STT non supportata
          </Badge>
        ) : null}
        <div className="ml-auto flex gap-2 flex-wrap">
          {phase === "listening" ? (
            <Button size="sm" variant="destructive" onClick={stopListening}>
              <MicOff className="mr-1 h-3 w-3" /> Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={startListening}
              disabled={phase === "resolving" || phase === "speaking"}
            >
              {phase === "resolving" || phase === "speaking" ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Mic className="mr-1 h-3 w-3" />
              )}
              Parla con Jack
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowText((s) => !s)}
          >
            <Keyboard className="mr-1 h-3 w-3" />
            {showText ? "Nascondi" : "Scrivi comando"}
          </Button>
          {result ? (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRepeat}
              disabled={phase === "speaking"}
            >
              <Play className="mr-1 h-3 w-3" /> Ripeti risposta
            </Button>
          ) : null}
        </div>
      </div>

      {showText || !sttSupported ? (
        <div className="space-y-2">
          <Textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Es. 'A che punto siamo?' oppure 'Email di oggi'"
            rows={2}
          />
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={handleSubmitText} disabled={!textInput.trim()}>
              <Send className="mr-1 h-3 w-3" /> Esegui comando testuale
            </Button>
            {suggestions.map((s) => (
              <Button
                key={s}
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setTextInput(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {transcript ? (
        <div className="text-xs">
          <span className="font-medium">Transcript:</span>{" "}
          <span className="text-muted-foreground">{transcript}</span>
        </div>
      ) : null}

      {result ? (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="secondary">{result.intent}</Badge>
            <span className="text-muted-foreground">fonte: {result.source}</span>
          </div>
          <p className="text-sm whitespace-pre-wrap">{result.response_text}</p>
          {result.cta ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const cta = result.cta!;
                navigate({
                  to: cta.to,
                  search: cta.search ?? undefined,
                } as never);
              }}
            >
              {result.cta.label}
            </Button>
          ) : null}
        </div>
      ) : null}

      {audioUrl ? (
        <audio
          ref={audioRef}
          controls
          src={audioUrl}
          onPlay={onAudioPlay}
          className="w-full"
        />
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 text-xs text-red-600">
          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <p className="text-[10px] text-muted-foreground">
        Solo lettura. Nessuna azione viene eseguita automaticamente: per
        approvare o eseguire, usa Action Queue.
      </p>
    </div>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const map: Record<Phase, { label: string; cls: string }> = {
    idle: { label: "pronto", cls: "" },
    listening: {
      label: "ascolto…",
      cls: "bg-red-500/10 text-red-600 border-red-500/30",
    },
    transcribed: {
      label: "trascritto",
      cls: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    },
    resolving: {
      label: "intent…",
      cls: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    },
    speaking: {
      label: "generazione voce…",
      cls: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    },
    ready: {
      label: "risposta pronta",
      cls: "bg-green-500/10 text-green-600 border-green-500/30",
    },
    error: {
      label: "errore",
      cls: "bg-red-500/10 text-red-600 border-red-500/30",
    },
  };
  const m = map[phase];
  return (
    <Badge variant="outline" className={m.cls}>
      {m.label}
    </Badge>
  );
}
