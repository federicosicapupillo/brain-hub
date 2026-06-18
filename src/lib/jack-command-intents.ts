// ============================================================
// Brain Hub v3.14 — Jack Command Router & Controlled Actions
// ============================================================
// Pure typed classifier + planner for Jack voice commands.
// No DB, no side effects, no external calls. Server functions
// (jack-controlled-actions.functions.ts) consume these to plan
// and persist controlled actions in Action Queue.
//
// Safety rules enforced here:
//   - Every plan is manual-first / approval-first / auditable.
//   - "esegui subito / senza chiedere / pubblica subito" → unsafe
//     command, requires_approval=true regardless.
//   - External tools (Telegram, Perplexity, social) → handoff /
//     approval request, never auto-executed.
// ============================================================

export type JackCommandIntent =
  | "prompt_generation"
  | "telegram_delivery"
  | "master_snapshot_update"
  | "market_research"
  | "tool_handoff"
  | "action_queue_create"
  | "roadmap_update"
  | "daily_brief_request"
  | "project_status_request"
  | "memory_update"
  | "unknown";

export type JackCommandRiskLevel = "low" | "medium" | "high";

export type JackCommandDeliveryTarget =
  | "none"
  | "telegram"
  | "ui_only"
  | "external_handoff";

export type JackCommandTool =
  | "internal_prompt_generator"
  | "internal_action_queue"
  | "internal_master_snapshot"
  | "internal_roadmap"
  | "internal_daily_brief"
  | "internal_project_status"
  | "internal_memory"
  | "perplexity"
  | "research_handoff"
  | "telegram_approval"
  | "none";

export type JackPlanStep = {
  id: string;
  label: string;
  kind: "read" | "create" | "draft" | "handoff" | "approval" | "log";
  blocking_approval?: boolean;
};

export type JackActionCandidate = {
  title: string;
  description: string;
  action_type:
    | "prompt_generation"
    | "master_snapshot_update_draft"
    | "research_handoff"
    | "telegram_delivery"
    | "roadmap_update"
    | "memory_update"
    | "controlled_command";
  priority: "low" | "medium" | "high";
};

export type JackCommandContextHint = {
  brainId?: string | null;
  brainName?: string | null;
  hasTelegramConnector?: boolean;
  hasPerplexityConnector?: boolean;
};

export type JackCommandClassification = {
  intent: JackCommandIntent;
  secondary_intent: JackCommandIntent | null;
  confidence: number;
  risk_level: JackCommandRiskLevel;
  requires_approval: boolean;
  recommended_tool: JackCommandTool;
  recommended_flow: string;
  delivery: JackCommandDeliveryTarget;
  reason: string;
  missing_information: string[];
  unsafe_request: boolean;
  action_candidate: JackActionCandidate;
};

export type JackControlledPlan = {
  classification: JackCommandClassification;
  steps: JackPlanStep[];
  safe_message: string;
  next_step: string;
  research_brief?: JackResearchBrief | null;
  master_snapshot_draft_hint?: JackMasterSnapshotDraftHint | null;
  telegram_delivery_hint?: JackTelegramDeliveryHint | null;
};

export type JackResearchBrief = {
  objective: string;
  market: string;
  region: string | null;
  company_criteria: string[];
  required_sources: string[];
  output_format: string;
  success_criteria: string;
};

export type JackMasterSnapshotDraftHint = {
  reason: string;
  summary: string;
  needs_daily_brief: boolean;
};

export type JackTelegramDeliveryHint = {
  delivery_kind: "approval" | "configure_required";
  message_preview: string;
};

// ---------- Lexicon ----------

const UNSAFE_PATTERNS: RegExp[] = [
  /\b(senza\s+chieder(?:m|t)i|senza\s+conferma|non\s+chiedermi|pubblica\s+subito|invia\s+subito|esegui\s+subito|fallo\s+subito\s+senza)/i,
  /\bbypass\b/i,
  /\bsenza\s+approvazione\b/i,
];

const TELEGRAM_PATTERNS: RegExp[] = [
  /\btelegram\b/i,
  /\bmandamel[oa]\b/i,
  /\binviamel[oa]\b/i,
  /\bmessaggio\s+telegram\b/i,
];

const PROMPT_PATTERNS: RegExp[] = [
  /\b(prossimo\s+prompt|next\s+prompt|crea\s+(?:il\s+)?prompt|nuovo\s+prompt|prepara\s+(?:il\s+)?prompt)\b/i,
  /\bprompt\s+per\s+lovable\b/i,
];

const MASTER_SNAPSHOT_PATTERNS: RegExp[] = [
  /\bmaster\s+snapshot\b/i,
  /\baggiorna\s+(?:il\s+)?snapshot\b/i,
  /\bsnapshot\s+principale\b/i,
];

const ROADMAP_PATTERNS: RegExp[] = [
  /\broadmap\b/i,
  /\baggiungilo\s+alla\s+roadmap\b/i,
];

const RESEARCH_PATTERNS: RegExp[] = [
  /\b(ricerca|ricerche|cerca|scout(?:ing)?|market\s+research|analisi\s+di\s+mercato)\b/i,
  /\bperplexit[yi]\b/i,
];

const PERPLEXITY_PATTERNS: RegExp[] = [/\bperplexit[yi]\b/i];

const DAILY_BRIEF_PATTERNS: RegExp[] = [
  /\bdaily\s+brief\b/i,
  /\briepilogo\s+(?:di\s+)?oggi\b/i,
  /\bbrief\s+di\s+oggi\b/i,
];

const PROJECT_STATUS_PATTERNS: RegExp[] = [
  /\ba\s+che\s+punto\s+(?:siamo|sono)\b/i,
  /\bstato\s+(?:del\s+)?progetto\b/i,
];

const ACTION_PATTERNS: RegExp[] = [
  /\bcrea\s+(?:una\s+)?action\b/i,
  /\baggiungi\s+(?:una\s+)?azione\b/i,
];

const MEMORY_PATTERNS: RegExp[] = [
  /\bmemorizz[ao]\b/i,
  /\bricorda(?:tene)?\b/i,
];

const REGION_PATTERNS: RegExp[] = [
  /\b(toscana|liguria|lombardia|lazio|sicilia|piemonte|veneto|emilia[\s-]?romagna|italia|europa|francia|spagna|germania|uk|usa)\b/gi,
];

// ---------- Helpers ----------

function any(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

function captureRegions(text: string): string | null {
  const matches = text.match(REGION_PATTERNS);
  if (!matches || matches.length === 0) return null;
  return Array.from(new Set(matches.map((m) => m.trim()))).join(" / ");
}

function captureMarketHint(text: string): string {
  // very light extraction: take noun phrase after "aziende del/dei/nel/sul mercato"
  const m =
    text.match(/aziende\s+(?:nel|sul|del|dei|delle|della|di)\s+(?:mercato\s+(?:di|dei|del|delle|della)\s+|settore\s+(?:di|dei|del|delle|della)\s+)?([^.,]{3,80})/i) ||
    text.match(/mercato\s+(?:dei|del|delle|della|di)\s+([^.,]{3,80})/i) ||
    text.match(/settore\s+(?:dei|del|delle|della|di)\s+([^.,]{3,80})/i);
  if (m && m[1]) return m[1].trim();
  return "Non specificato — chiedere a Federico";
}

// ---------- Classifier ----------

export function classifyJackCommand(
  inputText: string,
  context: JackCommandContextHint = {},
): JackCommandClassification {
  const raw = (inputText ?? "").trim();
  const text = raw.toLowerCase();
  const unsafe = any(raw, UNSAFE_PATTERNS);

  const hasTelegram = any(raw, TELEGRAM_PATTERNS);
  const hasPrompt = any(raw, PROMPT_PATTERNS);
  const hasSnapshot = any(raw, MASTER_SNAPSHOT_PATTERNS);
  const hasResearch = any(raw, RESEARCH_PATTERNS);
  const hasRoadmap = any(raw, ROADMAP_PATTERNS);
  const hasDailyBrief = any(raw, DAILY_BRIEF_PATTERNS);
  const hasProjectStatus = any(raw, PROJECT_STATUS_PATTERNS);
  const hasAction = any(raw, ACTION_PATTERNS);
  const hasMemory = any(raw, MEMORY_PATTERNS);

  let intent: JackCommandIntent = "unknown";
  let secondary: JackCommandIntent | null = null;
  let recommendedTool: JackCommandTool = "none";
  let delivery: JackCommandDeliveryTarget = "ui_only";
  let risk: JackCommandRiskLevel = "low";
  let recommendedFlow = "manual_first";
  let confidence = 0.4;
  const missing: string[] = [];

  if (hasPrompt) {
    intent = "prompt_generation";
    recommendedTool = "internal_prompt_generator";
    risk = "medium";
    confidence = 0.85;
    recommendedFlow = "prompt → action suggerita → (telegram opzionale) → approvazione";
  } else if (hasSnapshot) {
    intent = "master_snapshot_update";
    recommendedTool = "internal_master_snapshot";
    risk = "medium";
    confidence = 0.85;
    recommendedFlow = "leggi daily brief → crea draft → resta in attesa di approvazione";
  } else if (hasResearch) {
    intent = "market_research";
    recommendedTool = context.hasPerplexityConnector
      ? "perplexity"
      : "research_handoff";
    risk = "medium";
    confidence = 0.8;
    recommendedFlow = "definisci brief → crea handoff → salva result review";
  } else if (hasRoadmap) {
    intent = "roadmap_update";
    recommendedTool = "internal_roadmap";
    risk = "medium";
    confidence = 0.75;
    recommendedFlow = "crea proposta item roadmap → approvazione manuale";
  } else if (hasDailyBrief) {
    intent = "daily_brief_request";
    recommendedTool = "internal_daily_brief";
    risk = "low";
    confidence = 0.8;
    recommendedFlow = "leggi daily brief e rispondi a voce";
  } else if (hasProjectStatus) {
    intent = "project_status_request";
    recommendedTool = "internal_project_status";
    risk = "low";
    confidence = 0.75;
    recommendedFlow = "leggi stato progetto e rispondi a voce";
  } else if (hasMemory) {
    intent = "memory_update";
    recommendedTool = "internal_memory";
    risk = "low";
    confidence = 0.8;
    recommendedFlow = "usa create_memory_entry (già controllato)";
  } else if (hasAction) {
    intent = "action_queue_create";
    recommendedTool = "internal_action_queue";
    risk = "medium";
    confidence = 0.7;
    recommendedFlow = "crea action suggerita → approvazione";
  } else if (hasTelegram) {
    intent = "telegram_delivery";
    recommendedTool = "telegram_approval";
    risk = "medium";
    confidence = 0.7;
    recommendedFlow = "prepara delivery → richiesta approvazione Telegram";
  }

  if (hasTelegram && intent !== "telegram_delivery") {
    secondary = "telegram_delivery";
    delivery = "telegram";
  } else if (intent === "telegram_delivery") {
    delivery = "telegram";
  } else if (intent === "market_research") {
    delivery = "external_handoff";
  } else if (intent === "master_snapshot_update") {
    delivery = "ui_only";
  }

  if (unsafe) {
    // Force safe defaults regardless of intent.
    risk = risk === "low" ? "medium" : "high";
  }

  const requiresApproval = unsafe || risk !== "low";

  // Missing-information heuristics
  if (intent === "market_research") {
    if (!captureRegions(raw)) missing.push("area geografica / mercato");
    if (/\baziende\b/i.test(raw) === false) missing.push("tipo di entità da cercare");
  }
  if (intent === "prompt_generation" && !context.brainId) {
    missing.push("progetto/brain di riferimento");
  }
  if (intent === "telegram_delivery" && context.hasTelegramConnector === false) {
    missing.push("connettore Telegram non configurato");
  }

  const reason = unsafe
    ? "Richiesta che chiede esecuzione automatica: forzata in approvazione manuale."
    : buildReason(intent, recommendedTool);

  const titleHint = raw.length > 0 ? raw.slice(0, 90) : "Comando vocale Jack";
  const action_candidate: JackActionCandidate = {
    title: titleForIntent(intent, titleHint),
    description: raw,
    action_type: actionTypeForIntent(intent),
    priority: risk === "high" ? "high" : risk === "medium" ? "medium" : "low",
  };

  return {
    intent,
    secondary_intent: secondary,
    confidence,
    risk_level: risk,
    requires_approval: requiresApproval,
    recommended_tool: recommendedTool,
    recommended_flow: recommendedFlow,
    delivery,
    reason,
    missing_information: missing,
    unsafe_request: unsafe,
    action_candidate,
  };
}

function buildReason(intent: JackCommandIntent, tool: JackCommandTool): string {
  switch (intent) {
    case "prompt_generation":
      return "Jack può preparare il prossimo prompt come action controllata, non lo invia da solo.";
    case "master_snapshot_update":
      return "Jack può creare solo un draft del Master Snapshot. L'approvazione resta manuale.";
    case "market_research":
      return tool === "perplexity"
        ? "Ricerca preparata come handoff: l'utente lancia Perplexity manualmente."
        : "Perplexity non risulta integrato: creo un handoff manuale di ricerca.";
    case "telegram_delivery":
      return "Telegram viene usato solo come delivery/approval: nessun invio automatico.";
    case "roadmap_update":
      return "Aggiornamento roadmap proposto come action suggerita.";
    case "memory_update":
      return "La memoria viene salvata tramite tool dedicato (create_memory_entry).";
    case "daily_brief_request":
    case "project_status_request":
      return "Lettura read-only: Jack risponde a voce senza azioni esterne.";
    case "action_queue_create":
      return "Action creata come suggerita, in attesa di review.";
    default:
      return "Intento non riconosciuto con sicurezza: trattato come comando da chiarire.";
  }
}

function titleForIntent(intent: JackCommandIntent, hint: string): string {
  switch (intent) {
    case "prompt_generation":
      return "Prepara prossimo prompt (voice)";
    case "master_snapshot_update":
      return "Bozza aggiornamento Master Snapshot (voice)";
    case "market_research":
      return `Ricerca: ${hint.slice(0, 60)}`;
    case "telegram_delivery":
      return "Delivery Telegram controllata (voice)";
    case "roadmap_update":
      return "Aggiornamento roadmap (voice)";
    case "memory_update":
      return "Aggiornamento memoria (voice)";
    case "action_queue_create":
      return `Action: ${hint.slice(0, 60)}`;
    case "daily_brief_request":
      return "Riepilogo daily brief (voice)";
    case "project_status_request":
      return "Stato progetto (voice)";
    default:
      return `Comando Jack: ${hint.slice(0, 60)}`;
  }
}

function actionTypeForIntent(
  intent: JackCommandIntent,
): JackActionCandidate["action_type"] {
  switch (intent) {
    case "prompt_generation":
      return "prompt_generation";
    case "master_snapshot_update":
      return "master_snapshot_update_draft";
    case "market_research":
      return "research_handoff";
    case "telegram_delivery":
      return "telegram_delivery";
    case "roadmap_update":
      return "roadmap_update";
    case "memory_update":
      return "memory_update";
    default:
      return "controlled_command";
  }
}

// ---------- Planner ----------

export function planControlledJackAction(
  inputText: string,
  context: JackCommandContextHint = {},
): JackControlledPlan {
  const classification = classifyJackCommand(inputText, context);
  const steps: JackPlanStep[] = [];
  let research: JackResearchBrief | null = null;
  let snapshotHint: JackMasterSnapshotDraftHint | null = null;
  let telegramHint: JackTelegramDeliveryHint | null = null;

  switch (classification.intent) {
    case "prompt_generation":
      steps.push(
        { id: "read_ctx", label: "Leggi contesto progetto/brain", kind: "read" },
        { id: "build_prompt", label: "Genera bozza prompt", kind: "draft" },
        {
          id: "create_action",
          label: "Crea action suggerita in Action Queue",
          kind: "create",
        },
      );
      break;
    case "master_snapshot_update":
      snapshotHint = {
        reason: "Aggiornamento richiesto a voce da Federico",
        summary: inputText.slice(0, 240),
        needs_daily_brief: true,
      };
      steps.push(
        { id: "read_brief", label: "Leggi ultimo Daily Brief", kind: "read" },
        { id: "read_activity", label: "Leggi attività recenti", kind: "read" },
        { id: "draft_snapshot", label: "Crea draft Master Snapshot", kind: "draft" },
        {
          id: "wait_approval",
          label: "Attendi approvazione manuale (no auto-current)",
          kind: "approval",
          blocking_approval: true,
        },
      );
      break;
    case "market_research": {
      const region = captureRegions(inputText);
      const market = captureMarketHint(inputText);
      research = {
        objective: inputText.slice(0, 200),
        market,
        region,
        company_criteria: ["nome", "settore", "dimensione stimata", "motivo del fit"],
        required_sources: ["sito ufficiale", "registro imprese", "press release recenti"],
        output_format:
          "Tabella: azienda | sito | settore | dimensione | motivazione | fonte",
        success_criteria: "Almeno 8 aziende rilevanti con fonti tracciabili",
      };
      steps.push(
        { id: "define_brief", label: "Definisci research brief", kind: "draft" },
        {
          id: "prepare_handoff",
          label:
            classification.recommended_tool === "perplexity"
              ? "Prepara handoff Perplexity (manuale)"
              : "Prepara handoff ricerca manuale",
          kind: "handoff",
        },
        { id: "save_review", label: "Salva risultato in Result Review", kind: "create" },
      );
      break;
    }
    case "telegram_delivery":
      telegramHint = {
        delivery_kind: context.hasTelegramConnector === false ? "configure_required" : "approval",
        message_preview: inputText.slice(0, 280),
      };
      steps.push(
        { id: "compose", label: "Componi delivery", kind: "draft" },
        {
          id: "approval",
          label: "Crea richiesta approvazione Telegram",
          kind: "approval",
          blocking_approval: true,
        },
      );
      break;
    case "roadmap_update":
      steps.push(
        { id: "propose_item", label: "Proponi item roadmap", kind: "create" },
        { id: "approval", label: "Attendi approvazione", kind: "approval", blocking_approval: true },
      );
      break;
    case "memory_update":
      steps.push(
        { id: "delegate", label: "Delega a create_memory_entry", kind: "create" },
      );
      break;
    case "daily_brief_request":
    case "project_status_request":
      steps.push({ id: "read", label: "Lettura read-only e risposta vocale", kind: "read" });
      break;
    case "action_queue_create":
      steps.push(
        { id: "create_action", label: "Crea action suggerita", kind: "create" },
        { id: "approval", label: "Attendi review umana", kind: "approval", blocking_approval: true },
      );
      break;
    default:
      steps.push({
        id: "clarify",
        label: "Chiedere chiarimenti a Federico",
        kind: "log",
      });
  }

  if (
    classification.secondary_intent === "telegram_delivery" &&
    classification.intent !== "telegram_delivery"
  ) {
    telegramHint = {
      delivery_kind: context.hasTelegramConnector === false ? "configure_required" : "approval",
      message_preview: inputText.slice(0, 280),
    };
    steps.push({
      id: "telegram_delivery",
      label: "Prepara delivery Telegram come richiesta approvazione",
      kind: "approval",
      blocking_approval: true,
    });
  }

  const safe_message = buildSafeMessage(classification, telegramHint);
  const next_step = buildNextStep(classification);

  return {
    classification,
    steps,
    safe_message,
    next_step,
    research_brief: research,
    master_snapshot_draft_hint: snapshotHint,
    telegram_delivery_hint: telegramHint,
  };
}

function buildSafeMessage(
  c: JackCommandClassification,
  telegram: JackTelegramDeliveryHint | null,
): string {
  if (c.unsafe_request) {
    return "Ok Fede, ma non eseguo niente in automatico: lo preparo come action controllata e resta in approvazione.";
  }
  switch (c.intent) {
    case "prompt_generation":
      return telegram
        ? "Ok Fede. Ti preparo il prompt come action controllata e creo una richiesta Telegram per inviartelo. Prima però resta in approvazione, così non parte niente senza conferma."
        : "Ok Fede, preparo il prossimo prompt come action suggerita: la trovi in Action Queue.";
    case "master_snapshot_update":
      return "Ok Fede, creo solo la bozza del Master Snapshot con il riepilogo di oggi. Non promuovo niente a corrente, lo approvi tu manualmente.";
    case "market_research":
      return c.recommended_tool === "perplexity"
        ? "Ok Fede, preparo il brief di ricerca e un handoff per Perplexity. Non lancio la query automaticamente."
        : "Ok Fede, preparo il brief di ricerca come handoff manuale: Perplexity non risulta ancora integrato.";
    case "telegram_delivery":
      return telegram?.delivery_kind === "configure_required"
        ? "Ok Fede, ma il connettore Telegram non risulta configurato: creo una action per attivarlo, niente messaggi automatici."
        : "Ok Fede, preparo una richiesta Telegram controllata: resta in approvazione finché non confermi tu.";
    case "roadmap_update":
      return "Ok Fede, lo aggiungo come proposta di roadmap. Approvi tu prima che diventi ufficiale.";
    case "memory_update":
      return "Ok, lo memorizzo come preferenza persistente e ti confermo lo stato.";
    case "daily_brief_request":
    case "project_status_request":
      return "Ok, ti riassumo a voce. Nessuna azione esterna.";
    case "action_queue_create":
      return "Ok Fede, creo la action come suggerita: la trovi in coda per la review.";
    default:
      return "Non sono sicuro di cosa fare: te lo lascio come action da chiarire, niente esecuzioni automatiche.";
  }
}

function buildNextStep(c: JackCommandClassification): string {
  if (c.missing_information.length > 0) {
    return `Chiedere a Federico: ${c.missing_information.join(", ")}`;
  }
  if (c.requires_approval) return "Apri Action Queue / Master Snapshot e approva manualmente";
  return "Rispondi a voce, nessuna ulteriore azione richiesta";
}
