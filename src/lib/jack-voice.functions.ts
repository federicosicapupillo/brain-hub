import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash } from "crypto";
import { JACK_VOICE_PROFILE } from "@/lib/jack-voice-profile";


const MAX_CHARS = 1800;

// Basic redaction of obvious secrets / long tokens before sending to TTS.
function redact(input: string): string {
  let out = input;
  // bearer / api keys
  out = out.replace(/(?:bearer\s+)?[A-Za-z0-9_-]{32,}/gi, "[REDACTED]");
  // jwt-like
  out = out.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED]");
  // long digit sequences (potential secrets / card-like)
  out = out.replace(/\b\d{12,}\b/g, "[REDACTED]");
  return out;
}

function clip(text: string, max = MAX_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function voiceIdPreview(id: string | undefined | null): string | null {
  if (!id) return null;
  if (id.length <= 6) return id.slice(0, 2) + "***";
  return id.slice(0, 3) + "***" + id.slice(-2);
}

// ---------------- Status ----------------

export const getJackVoiceStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    const modelId = process.env.ELEVENLABS_MODEL_ID;
    return {
      provider: "elevenlabs" as const,
      elevenlabs_configured: !!apiKey,
      voice_id_configured: !!voiceId,
      model_id_configured: !!modelId,
      max_chars: MAX_CHARS,
      profile: {
        name: JACK_VOICE_PROFILE.name,
        speed: JACK_VOICE_PROFILE.voice_settings.speed,
        style: JACK_VOICE_PROFILE.voice_settings.style,
        stability: JACK_VOICE_PROFILE.voice_settings.stability,
      },
      recommended_voices: JACK_VOICE_PROFILE.recommended_male_italian_voices.map(
        (v) => ({ name: v.name, notes: v.notes }),
      ),
    };
  });

// ---------------- Synth from text ----------------

type SynthInput = {
  text: string;
  brain_id?: string | null;
  brief_id?: string | null;
};

type SynthResult = {
  ok: true;
  generation_id: string;
  audio_base64: string;
  mime_type: string;
  provider: "elevenlabs";
  char_count: number;
  voice_id_preview: string | null;
  model_id: string | null;
};

async function callElevenLabs(
  text: string,
  apiKey: string,
  voiceId: string,
  modelId: string | undefined,
): Promise<{ buffer: ArrayBuffer; mime: string }> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId || "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${errText.slice(0, 200)}`);
  }
  const buffer = await res.arrayBuffer();
  return { buffer, mime: "audio/mpeg" };
}

export const synthesizeJackVoiceFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SynthInput) => {
    if (!input || typeof input.text !== "string") {
      throw new Error("text obbligatorio");
    }
    const t = input.text.trim();
    if (!t) throw new Error("text vuoto");
    return {
      text: t,
      brain_id: input.brain_id ?? null,
      brief_id: input.brief_id ?? null,
    };
  })
  .handler(async ({ data, context }): Promise<SynthResult> => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    const modelId = process.env.ELEVENLABS_MODEL_ID || null;

    if (!apiKey || !voiceId) {
      // log event
      await context.supabase.from("clipboard_execution_logs").insert({
        user_id: context.userId,
        clipboard_item_id: null,
        action: "jack_voice_secret_missing" as never,
        notes: "ElevenLabs non configurato",
        metadata: {
          api_key: !!apiKey,
          voice_id: !!voiceId,
        },
      } as never);
      throw new Error(
        "ElevenLabs non configurato. Imposta ELEVENLABS_API_KEY e ELEVENLABS_VOICE_ID.",
      );
    }

    const safeText = clip(redact(data.text), MAX_CHARS);
    const charCount = safeText.length;
    const textHash = sha256Hex(safeText);

    // Create the row (status=started)
    const { data: row, error: insErr } = await context.supabase
      .from("jack_voice_generations" as never)
      .insert({
        user_id: context.userId,
        brain_id: data.brain_id,
        daily_operating_brief_id: data.brief_id,
        provider: "elevenlabs",
        voice_id_preview: voiceIdPreview(voiceId),
        model_id: modelId,
        text_hash: textHash,
        text_char_count: charCount,
        status: "started",
      } as never)
      .select("id")
      .single();

    if (insErr || !row) {
      throw new Error(`Errore creazione record: ${insErr?.message ?? "unknown"}`);
    }
    const generationId = (row as { id: string }).id;

    await context.supabase.from("clipboard_execution_logs").insert({
      user_id: context.userId,
      clipboard_item_id: null,
      action: "jack_voice_synthesis_started" as never,
      notes: `Sintesi voice avviata (${charCount} char)`,
      metadata: {
        generation_id: generationId,
        char_count: charCount,
        text_hash: textHash,
        brief_id: data.brief_id,
      },
    } as never);

    try {
      const { buffer, mime } = await callElevenLabs(safeText, apiKey, voiceId, modelId || undefined);
      const base64 = Buffer.from(buffer).toString("base64");

      await context.supabase
        .from("jack_voice_generations" as never)
        .update({
          status: "completed",
          generated_at: new Date().toISOString(),
        } as never)
        .eq("id", generationId);

      await context.supabase.from("clipboard_execution_logs").insert({
        user_id: context.userId,
        clipboard_item_id: null,
        action: "jack_voice_synthesis_completed" as never,
        notes: `Audio generato (${buffer.byteLength} bytes)`,
        metadata: {
          generation_id: generationId,
          bytes: buffer.byteLength,
          mime,
        },
      } as never);

      return {
        ok: true,
        generation_id: generationId,
        audio_base64: base64,
        mime_type: mime,
        provider: "elevenlabs",
        char_count: charCount,
        voice_id_preview: voiceIdPreview(voiceId),
        model_id: modelId,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await context.supabase
        .from("jack_voice_generations" as never)
        .update({
          status: "failed",
          error_text: msg.slice(0, 500),
        } as never)
        .eq("id", generationId);

      await context.supabase.from("clipboard_execution_logs").insert({
        user_id: context.userId,
        clipboard_item_id: null,
        action: "jack_voice_synthesis_failed" as never,
        notes: msg.slice(0, 300),
        metadata: { generation_id: generationId },
      } as never);
      throw e;
    }
  });

// ---------------- Synth from brief ----------------

export const synthesizeJackVoiceFromBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { brief_id: string }) => {
    if (!input?.brief_id) throw new Error("brief_id obbligatorio");
    return { brief_id: input.brief_id };
  })
  .handler(async ({ data, context }): Promise<SynthResult> => {
    const { data: brief, error } = await context.supabase
      .from("daily_operating_briefs" as never)
      .select("id, brain_id, voice_summary_text, executive_summary")
      .eq("id", data.brief_id)
      .maybeSingle();

    if (error || !brief) {
      throw new Error("Brief non trovato");
    }
    const b = brief as {
      id: string;
      brain_id: string | null;
      voice_summary_text: string | null;
      executive_summary: string | null;
    };

    const text =
      (b.voice_summary_text && b.voice_summary_text.trim()) ||
      (b.executive_summary ? b.executive_summary.slice(0, MAX_CHARS) : "");

    if (!text) throw new Error("Nessun voice_summary_text disponibile");

    return await synthesizeJackVoiceFromText({
      data: {
        text,
        brain_id: b.brain_id,
        brief_id: b.id,
      },
    });
  });

// ---------------- Mark played ----------------

export const markJackVoicePlayed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { generation_id: string }) => {
    if (!input?.generation_id) throw new Error("generation_id obbligatorio");
    return { generation_id: input.generation_id };
  })
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("jack_voice_generations" as never)
      .update({ played_at: new Date().toISOString() } as never)
      .eq("id", data.generation_id);

    await context.supabase.from("clipboard_execution_logs").insert({
      user_id: context.userId,
      clipboard_item_id: null,
      action: "jack_voice_played" as never,
      notes: "Audio riprodotto",
      metadata: { generation_id: data.generation_id },
    } as never);

    return { ok: true };
  });
