/**
 * Jack Voice Profile — configurazione del profilo vocale operativo italiano.
 *
 * Profilo target:
 * - Genere: maschile
 * - Lingua: italiano (con ElevenLabs multilingual v2)
 * - Stile: friendly, warm, conversational, energetic, confident, natural
 * - Ritmo: medio (leggermente calmato per chiarezza)
 * - Tono: coach/assistente personale operativo, sorridente ma professionale
 * - Da evitare: robotico, teatrale, radiofonico aggressivo, freddo, monotono
 */

export const JACK_VOICE_PROFILE = {
  name: "Jack — Italian Operational Coach",
  locale_hint: "it-IT",

  /**
   * Istruzioni natural-language per ElevenLabs TTS.
   * Controllano tono, accento, ritmo ed emozione.
   */
  instructions:
    "You are Jack, a warm and encouraging Italian operational assistant. " +
    "Speak with a friendly, natural, and confident tone — like a personal coach " +
    "helping review projects, emails, actions and daily decisions. " +
    "Use clear Italian pronunciation, medium pace, and a subtle smile in your voice. " +
    "Be professional yet conversational, energetic but never theatrical or aggressive. " +
    "Avoid robotic, cold, or monotone delivery. Keep it modern, approachable and motivating.",

  /**
   * Voice settings ottimizzati per il profilo descritto.
   *
   * stability 0.45     → leggermente espressivo per naturalezza, ma consistente
   * similarity_boost 0.80 → chiarezza alta, voce definita e riconoscibile
   * style 0.38         → caldo e amichevole, senza esagerare
   * use_speaker_boost  true → migliora chiarezza e somiglianza
   * speed 0.92         → ritmo medio: comodo, non lento, non frettoloso
   */
  voice_settings: {
    stability: 0.45,
    similarity_boost: 0.8,
    style: 0.38,
    use_speaker_boost: true,
    speed: 0.92,
  } as const,

  /**
   * Modello consigliato per italiano naturale.
   */
  default_model_id: "eleven_multilingual_v2",

  /**
   * Voice ID consigliati dalla libreria ElevenLabs (maschili, ottimi per italiano).
   *
   * Per attivare Jack, imposta ELEVENLABS_VOICE_ID con uno di questi ID
   * nei secrets Lovable.
   */
  recommended_male_italian_voices: [
    {
      id: "zQzg4D5vPjrKq6bE7K2r",
      name: "Matteo",
      notes: "Calda, naturale, amichevole. Ottima per assistente personale italiano.",
    },
    {
      id: "onwK4e9ZLuTAKqWW03F9",
      name: "Daniel",
      notes: "Profonda, professionale, chiara. Funziona molto bene in italiano.",
    },
    {
      id: "JBFqnCBsd6RMkjVDRZzb",
      name: "George",
      notes: "Professionale ma cordiale. Pronuncia italiana solida.",
    },
    {
      id: "TX3LPaxmHKxFdv7VOQHJ",
      name: "Liam",
      notes: "Giovane, energico, moderno. Buono per tono dinamico.",
    },
    {
      id: "IKne3meq5aSn9XLyUdCD",
      name: "Charlie",
      notes: "Neutra, versatile, buona per italiano con voice_settings caldi.",
    },
  ],

  /**
   * Se nessun voice_id è configurato, suggerisci all'utente di usare
   * la Voice Library di ElevenLabs per trovare "Matteo", "Paolo" o "Giovanni".
   */
  onboarding_hint:
    "Vai su https://elevenlabs.io/voice-library, cerca 'Matteo', 'Paolo' o 'Giovanni', " +
    "e imposta il Voice ID come secret ELEVENLABS_VOICE_ID per attivare Jack in italiano.",
} as const;

export type JackVoiceProfile = typeof JACK_VOICE_PROFILE;
