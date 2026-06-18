import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Volume2, Loader2, AlertCircle, RefreshCcw, Play } from "lucide-react";
import { toast } from "sonner";
import {
  getJackVoiceStatus,
  synthesizeJackVoiceFromText,
  markJackVoicePlayed,
} from "@/lib/jack-voice.functions";

type Props = {
  text: string | null | undefined;
  brainId?: string | null;
  briefId?: string | null;
};

export function JackVoicePlayer({ text, brainId, briefId }: Props) {
  const statusFn = useServerFn(getJackVoiceStatus);
  const synthFn = useServerFn(synthesizeJackVoiceFromText);
  const playedFn = useServerFn(markJackVoicePlayed);

  const statusQ = useQuery({
    queryKey: ["jack-voice-status"],
    queryFn: () => statusFn(),
  });

  const [busy, setBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [genId, setGenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    };
  }, []);

  const status = statusQ.data;
  const configured =
    !!status?.elevenlabs_configured && !!status?.voice_id_configured;
  const hasText = !!(text && text.trim().length > 0);
  const disabled = !configured || !hasText || busy;

  async function generate() {
    if (!hasText) return;
    setBusy(true);
    setError(null);
    try {
      const res = await synthFn({
        data: {
          text: text!,
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
      // Try auto-play
      setTimeout(() => {
        const el = audioRef.current;
        if (el) {
          el.play().catch(() => {
            /* user gesture required — handled by manual play */
          });
        }
      }, 100);
      toast.success("Audio Jack generato");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Errore TTS: " + msg);
    } finally {
      setBusy(false);
    }
  }

  function onPlay() {
    if (genId) {
      playedFn({ data: { generation_id: genId } }).catch(() => {});
    }
  }

  return (
    <div className="space-y-2 border rounded-md p-3 bg-muted/30">
      <div className="flex items-center gap-2 flex-wrap">
        <Volume2 className="h-4 w-4" />
        <span className="text-sm font-medium">Jack voice</span>
        {statusQ.isLoading ? (
          <Badge variant="outline">…</Badge>
        ) : configured ? (
          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
            ElevenLabs configurato
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
            Non configurato
          </Badge>
        )}
        {!hasText ? (
          <Badge variant="outline">Nessun voice_summary</Badge>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            onClick={generate}
            disabled={disabled}
            variant={audioUrl ? "outline" : "default"}
          >
            {busy ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : audioUrl ? (
              <RefreshCcw className="mr-1 h-3 w-3" />
            ) : (
              <Play className="mr-1 h-3 w-3" />
            )}
            {busy
              ? "Generazione in corso…"
              : audioUrl
                ? "Rigenera audio"
                : "Leggi con Jack"}
          </Button>
        </div>
      </div>

      {!configured && !statusQ.isLoading ? (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertCircle className="h-3 w-3 mt-0.5" />
          <span>
            Configura <code>ELEVENLABS_API_KEY</code> e{" "}
            <code>ELEVENLABS_VOICE_ID</code> nei secrets Lovable per attivare la
            voce di Jack.
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="text-xs text-red-600">{error}</div>
      ) : null}

      {audioUrl ? (
        <audio
          ref={audioRef}
          controls
          src={audioUrl}
          onPlay={onPlay}
          className="w-full"
        />
      ) : null}
    </div>
  );
}
