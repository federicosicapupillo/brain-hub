// ============================================================
// Brain Hub v3.11 — Jack Memory Core
// ============================================================
// READ-ONLY identity/context memory for Jack.
// Does NOT replace Master Snapshot (project source of truth).
// No secret storage, no external API, no automatic actions.
// ============================================================

import { supabase } from "@/integrations/supabase/client";

export type JackMemoryStatus = "draft" | "current" | "archived";

export type JackMemoryDocument = {
  id: string;
  user_id: string;
  title: string;
  version: string | null;
  status: JackMemoryStatus;
  content_markdown: string;
  content_hash: string;
  source_filename: string | null;
  imported_at: string;
  approved_at: string | null;
  archived_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type JackMemorySections = {
  identity: string | null;
  style: string | null;
  background: string | null;
  projects: string | null;
  aliases: string | null;
  security: string | null;
  privacy: string | null;
  behavior: string | null;
  news: string | null;
  other: Record<string, string>;
};

export type SecretWarning = {
  pattern: string;
  example: string; // redacted hint, not the secret itself
  line: number;
};

export type ImportJackMemoryInput = {
  title: string;
  filename?: string | null;
  markdown: string;
  version?: string | null;
  /** If true, allow import even if secret patterns are detected. */
  acknowledgeSecretWarnings?: boolean;
};

export type ImportJackMemoryResult =
  | { kind: "imported"; document: JackMemoryDocument; warnings: SecretWarning[] }
  | { kind: "duplicate"; existing: JackMemoryDocument }
  | { kind: "blocked_secret_warning"; warnings: SecretWarning[] };

// ----------------------------------------------------------------
// Hash + section parsing
// ----------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SECTION_MAP: Array<{ key: keyof Omit<JackMemorySections, "other">; patterns: RegExp[] }> = [
  { key: "identity", patterns: [/identit/i, /chi (sono|è federico)/i, /profilo/i] },
  { key: "style", patterns: [/stile/i, /tono/i, /comunicaz/i] },
  { key: "background", patterns: [/background/i, /esperienza/i, /storia/i] },
  { key: "projects", patterns: [/progett/i] },
  { key: "aliases", patterns: [/alias/i, /nomi alternativi/i] },
  { key: "security", patterns: [/sicurezza/i, /security/i] },
  { key: "privacy", patterns: [/privacy/i, /dati personali/i] },
  { key: "behavior", patterns: [/comportamento/i, /regole jack/i, /jack deve/i] },
  { key: "news", patterns: [/news/i, /settori/i] },
];

export function extractJackMemorySections(markdown: string): JackMemorySections {
  const sections: JackMemorySections = {
    identity: null,
    style: null,
    background: null,
    projects: null,
    aliases: null,
    security: null,
    privacy: null,
    behavior: null,
    news: null,
    other: {},
  };
  if (!markdown) return sections;

  const lines = markdown.split(/\r?\n/);
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  const blocks: Array<{ heading: string; body: string }> = [];

  const flush = () => {
    if (currentHeading !== null) {
      blocks.push({ heading: currentHeading, body: buffer.join("\n").trim() });
    }
    buffer = [];
  };

  for (const line of lines) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      flush();
      currentHeading = h[1].trim();
    } else if (currentHeading !== null) {
      buffer.push(line);
    }
  }
  flush();

  for (const block of blocks) {
    let assigned = false;
    for (const { key, patterns } of SECTION_MAP) {
      if (patterns.some((p) => p.test(block.heading))) {
        sections[key] = sections[key]
          ? `${sections[key]}\n\n## ${block.heading}\n${block.body}`
          : block.body;
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      sections.other[block.heading] = block.body;
    }
  }
  return sections;
}

// ----------------------------------------------------------------
// Secret detection
// ----------------------------------------------------------------

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "OpenAI/SK-like key", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "Bearer token", re: /\bBearer\s+[A-Za-z0-9._\-]{20,}\b/gi },
  { name: "Generic API key", re: /\b(api[_-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/gi },
  { name: "Password", re: /\b(password|passwd|pwd)\s*[:=]\s*\S{6,}/gi },
  { name: "Webhook secret", re: /\b(webhook[_-]?secret|hmac[_-]?secret)\s*[:=]\s*\S{6,}/gi },
  { name: "JWT token", re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g },
  { name: "Telegram bot token", re: /\b\d{9,}:[A-Za-z0-9_\-]{30,}\b/g },
];

export function detectSecretPatterns(markdown: string): SecretWarning[] {
  const warnings: SecretWarning[] = [];
  const lines = markdown.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const { name, re } of SECRET_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (m) {
        warnings.push({
          pattern: name,
          example: m[0].slice(0, 6) + "…[REDACTED]",
          line: idx + 1,
        });
      }
    }
  });
  return warnings;
}

// ----------------------------------------------------------------
// CRUD
// ----------------------------------------------------------------

async function getUserIdOrThrow(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Utente non autenticato");
  return data.user.id;
}

export async function listJackMemoryDocuments(): Promise<JackMemoryDocument[]> {
  const { data, error } = await supabase
    .from("jack_memory_documents")
    .select("*")
    .order("imported_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as JackMemoryDocument[];
}

export async function getCurrentJackMemoryDocument(): Promise<JackMemoryDocument | null> {
  const { data, error } = await supabase
    .from("jack_memory_documents")
    .select("*")
    .eq("status", "current")
    .maybeSingle();
  if (error) throw error;
  return (data as JackMemoryDocument | null) ?? null;
}

export async function importJackMemoryMarkdown(
  input: ImportJackMemoryInput,
): Promise<ImportJackMemoryResult> {
  const userId = await getUserIdOrThrow();
  const markdown = (input.markdown ?? "").trim();
  if (!markdown) throw new Error("Markdown vuoto");

  const hash = await sha256Hex(markdown);

  // Duplicate check
  const { data: dup } = await supabase
    .from("jack_memory_documents")
    .select("*")
    .eq("content_hash", hash)
    .maybeSingle();
  if (dup) {
    await logJackMemoryEvent("jack_memory_import_blocked_duplicate", { id: (dup as JackMemoryDocument).id });
    return { kind: "duplicate", existing: dup as JackMemoryDocument };
  }

  const warnings = detectSecretPatterns(markdown);
  if (warnings.length > 0 && !input.acknowledgeSecretWarnings) {
    await logJackMemoryEvent("jack_memory_import_blocked_secret_warning", {
      warning_count: warnings.length,
      patterns: warnings.map((w) => w.pattern),
    });
    return { kind: "blocked_secret_warning", warnings };
  }

  await logJackMemoryEvent("jack_memory_import_started", {
    title: input.title,
    filename: input.filename ?? null,
    bytes: markdown.length,
  });

  const { data, error } = await supabase
    .from("jack_memory_documents")
    .insert({
      user_id: userId,
      title: input.title,
      version: input.version ?? null,
      status: "draft",
      content_markdown: markdown,
      content_hash: hash,
      source_filename: input.filename ?? null,
      metadata: {
        secret_warnings: warnings,
        acknowledged_secret_warnings: warnings.length > 0,
      },
    })
    .select("*")
    .single();
  if (error) throw error;

  await logJackMemoryEvent("jack_memory_imported", {
    id: (data as JackMemoryDocument).id,
    warning_count: warnings.length,
  });

  return { kind: "imported", document: data as JackMemoryDocument, warnings };
}

export async function approveJackMemoryDocument(id: string): Promise<JackMemoryDocument> {
  const userId = await getUserIdOrThrow();
  // Archive existing current first
  const { error: archErr } = await supabase
    .from("jack_memory_documents")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "current");
  if (archErr) throw archErr;

  const { data, error } = await supabase
    .from("jack_memory_documents")
    .update({ status: "current", approved_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  await logJackMemoryEvent("jack_memory_approved_current", { id });
  return data as JackMemoryDocument;
}

export async function archiveJackMemoryDocument(id: string): Promise<void> {
  const { error } = await supabase
    .from("jack_memory_documents")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  await logJackMemoryEvent("jack_memory_archived", { id });
}

// ----------------------------------------------------------------
// Context lookup for Jack
// ----------------------------------------------------------------

export type JackMemoryContextScope =
  | "identity"
  | "behavior"
  | "projects"
  | "aliases"
  | "news"
  | "all";

export type JackMemoryContext = {
  status: "ready" | "missing";
  documentId: string | null;
  importedAt: string | null;
  sections: JackMemorySections | null;
  excerpt: string | null;
};

export async function getJackMemoryContext(
  options?: { scopes?: JackMemoryContextScope[]; maxChars?: number },
): Promise<JackMemoryContext> {
  const doc = await getCurrentJackMemoryDocument();
  if (!doc) {
    return { status: "missing", documentId: null, importedAt: null, sections: null, excerpt: null };
  }
  const sections = extractJackMemorySections(doc.content_markdown);
  const scopes = options?.scopes ?? ["all"];
  const maxChars = options?.maxChars ?? 1500;

  let excerpt = "";
  const pick = (key: keyof Omit<JackMemorySections, "other">) => {
    const v = sections[key];
    if (v) excerpt += `\n[${key}]\n${v}\n`;
  };

  if (scopes.includes("all")) {
    for (const k of ["identity", "behavior", "projects", "aliases"] as const) pick(k);
  } else {
    for (const s of scopes) {
      if (s === "identity") pick("identity");
      if (s === "behavior") pick("behavior");
      if (s === "projects") pick("projects");
      if (s === "aliases") pick("aliases");
      if (s === "news") pick("news");
    }
  }

  if (excerpt.length > maxChars) excerpt = excerpt.slice(0, maxChars) + "…";

  await logJackMemoryEvent("jack_memory_context_used", {
    document_id: doc.id,
    scopes,
    excerpt_bytes: excerpt.length,
  });

  return {
    status: "ready",
    documentId: doc.id,
    importedAt: doc.imported_at,
    sections,
    excerpt: excerpt.trim() || null,
  };
}

export type JackMemorySearchHit = {
  line: number;
  text: string;
  heading: string | null;
};

export async function searchJackMemory(query: string): Promise<JackMemorySearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const doc = await getCurrentJackMemoryDocument();
  if (!doc) return [];
  const lines = doc.content_markdown.split(/\r?\n/);
  const hits: JackMemorySearchHit[] = [];
  let heading: string | null = null;
  lines.forEach((line, idx) => {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) heading = h[1].trim();
    if (line.toLowerCase().includes(q)) {
      hits.push({ line: idx + 1, text: line.trim(), heading });
    }
  });
  await logJackMemoryEvent("jack_memory_search_used", { query: q.slice(0, 80), hits: hits.length });
  return hits.slice(0, 25);
}

// ----------------------------------------------------------------
// Aliases extracted from memory (best-effort)
// ----------------------------------------------------------------

export function extractProjectAliasesFromMemory(markdown: string): Array<{ alias: string; target: string }> {
  const out: Array<{ alias: string; target: string }> = [];
  const sections = extractJackMemorySections(markdown);
  const block = sections.aliases ?? "";
  if (!block) return out;
  const lines = block.split(/\r?\n/);
  for (const raw of lines) {
    // Patterns: "- Brain Hub: brain hub, brian hub, braian hub"
    //           "* Furia → Furia Immobiliare"
    const m = raw.match(/^[\s*\-•]*([^:→\-]+?)\s*(?::|→|->)\s*(.+)$/);
    if (m) {
      const target = m[1].trim().toLowerCase();
      const aliases = m[2].split(/[,;|]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      for (const a of aliases) if (a && a !== target) out.push({ alias: a, target });
    }
  }
  return out;
}

// ----------------------------------------------------------------
// Event logging
// ----------------------------------------------------------------

export async function logJackMemoryEvent(
  event: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("app_logs").insert({
      user_id: u.user.id,
      action: event,
      message: event,
      severity: "info",
      entity_type: "jack_memory",
      metadata: payload as never,
    });
  } catch {
    // logging best-effort
  }
}

export function isJackMemoryStale(doc: JackMemoryDocument | null, maxAgeDays = 60): boolean {
  if (!doc) return false;
  const imported = new Date(doc.imported_at).getTime();
  const ageMs = Date.now() - imported;
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1000;
}

// ============================================================
// v3.11.1 — Natural language helpers + conversational entries
// ============================================================

// ----- Natural response helpers -----

export function cleanMemoryMarkdownForSpeech(input: string): string {
  if (!input) return "";
  let t = input;
  // strip frontmatter
  t = t.replace(/^---[\s\S]*?---\s*/m, "");
  // strip [tag] section markers we add internally
  t = t.replace(/^\s*\[[a-z_]+\]\s*$/gim, "");
  // strip headings (### Foo)
  t = t.replace(/^#{1,6}\s+.*$/gm, "");
  // bold/italic markers
  t = t.replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1");
  t = t.replace(/\*(.*?)\*/g, "$1").replace(/_(.*?)_/g, "$1");
  // inline code
  t = t.replace(/`([^`]+)`/g, "$1");
  // list bullets -> sentence
  t = t.replace(/^\s*[-*•]\s+/gm, "");
  // "Key: value" -> "Key: value" but flatten line breaks
  t = t.replace(/\r/g, "");
  t = t.replace(/\n{2,}/g, ". ");
  t = t.replace(/\n/g, ", ");
  t = t.replace(/\s+/g, " ").trim();
  // tidy punctuation
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/([,.;:])\1+/g, "$1");
  return t;
}

function clampForSpeech(s: string, max = 900): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastDot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (lastDot > max * 0.6 ? cut.slice(0, lastDot + 1) : cut) + "…";
}

export function buildNaturalIdentityResponse(ctx: JackMemoryContext): string {
  if (ctx.status === "missing" || !ctx.sections) {
    return "Non ho ancora una memoria personale configurata. Importala dalla pagina Jack Memory e ti racconto chi sei.";
  }
  const s = ctx.sections;
  const blocks: string[] = [];
  if (s.identity) blocks.push(cleanMemoryMarkdownForSpeech(s.identity));
  if (s.background) blocks.push(cleanMemoryMarkdownForSpeech(s.background));
  if (s.style) blocks.push("Sul tono: " + cleanMemoryMarkdownForSpeech(s.style));
  const joined = blocks.filter(Boolean).join(". ").replace(/\.\s*\./g, ".");
  if (!joined) return "Ho la memoria configurata ma non riesco a estrarre una sintesi naturale. Apri Jack Memory per verificare.";
  return clampForSpeech("Federico, " + joined, 900);
}

export function buildNaturalJackRulesResponse(ctx: JackMemoryContext): string {
  if (ctx.status === "missing" || !ctx.sections) {
    return "Non ho ancora regole personalizzate. Importa il tuo Jack Memory Core per configurarle.";
  }
  const s = ctx.sections;
  const blocks: string[] = [];
  if (s.behavior) blocks.push(cleanMemoryMarkdownForSpeech(s.behavior));
  if (s.security) blocks.push("Sulla sicurezza: " + cleanMemoryMarkdownForSpeech(s.security));
  if (s.privacy) blocks.push("Sulla privacy: " + cleanMemoryMarkdownForSpeech(s.privacy));
  const joined = blocks.filter(Boolean).join(". ");
  if (!joined) return "Le regole non sono ancora definite nella memoria. Aggiungile nella sezione comportamento.";
  return clampForSpeech("Le regole che seguo: " + joined, 900);
}

export function buildNaturalProjectMemoryResponse(
  projectName: string,
  ctx: JackMemoryContext,
  entries: JackMemoryEntry[] = [],
): string {
  const parts: string[] = [];
  const active = entries.filter((e) => e.status === "active");
  if (active.length > 0) {
    parts.push(
      `Su ${projectName} ricordo ${active.length} ${active.length === 1 ? "nota" : "note"}: ` +
        active.slice(0, 4).map((e) => cleanMemoryMarkdownForSpeech(e.content)).join("; "),
    );
  }
  if (ctx.sections?.projects) {
    const slice = cleanMemoryMarkdownForSpeech(ctx.sections.projects);
    const matched = slice
      .split(/[.;]/)
      .map((s) => s.trim())
      .filter((s) => s.toLowerCase().includes(projectName.toLowerCase().split(" ")[0]))
      .slice(0, 2)
      .join(". ");
    if (matched) parts.push(matched);
  }
  if (parts.length === 0) {
    return `Su ${projectName} non ho ancora memorie operative salvate. Dimmi "memorizza che…" per crearne.`;
  }
  return clampForSpeech(parts.join(". "), 900);
}

export function summarizeMemoryForConversation(
  ctx: JackMemoryContext,
  options?: { maxChars?: number },
): string {
  if (ctx.status === "missing" || !ctx.sections) return "";
  const s = ctx.sections;
  const blocks = [s.identity, s.behavior, s.style, s.projects]
    .filter(Boolean)
    .map((b) => cleanMemoryMarkdownForSpeech(b!));
  return clampForSpeech(blocks.join(". "), options?.maxChars ?? 600);
}

// ----- Conversational memory entries -----

export type JackMemoryEntryStatus = "active" | "suggested" | "archived" | "rejected";
export type JackMemoryEntryCategory =
  | "identity"
  | "preference"
  | "project_rule"
  | "project_context"
  | "business_context"
  | "communication_style"
  | "tooling"
  | "safety_rule"
  | "general";

export type JackMemoryEntry = {
  id: string;
  user_id: string;
  brain_id: string | null;
  project_id: string | null;
  project_name: string | null;
  category: JackMemoryEntryCategory;
  content: string;
  normalized_content: string | null;
  source: string;
  status: JackMemoryEntryStatus;
  importance: "low" | "normal" | "high";
  sensitivity: "normal" | "sensitive" | "secret";
  confidence: number | null;
  source_conversation_id: string | null;
  source_message_id: string | null;
  approved_at: string | null;
  archived_at: string | null;
  last_used_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CreateJackMemoryEntryInput = {
  content: string;
  category?: JackMemoryEntryCategory;
  project_name?: string | null;
  brain_id?: string | null;
  source?: string;
  status?: JackMemoryEntryStatus;
  importance?: "low" | "normal" | "high";
  sensitivity?: "normal" | "sensitive" | "secret";
  acknowledgeSecret?: boolean;
  metadata?: Record<string, unknown>;
};

const CATEGORY_HINTS: Array<{ cat: JackMemoryEntryCategory; re: RegExp }> = [
  { cat: "project_rule", re: /(separat[io]|non collegare|tieni distint|regola.*progett|sempre|mai|non fare)/i },
  { cat: "preference", re: /(preferisc|mi piace|voglio sempre|non voglio|stile|tono)/i },
  { cat: "communication_style", re: /(rispondi|parla|tono|spiega|breve|conciso|in italiano)/i },
  { cat: "safety_rule", re: /(non eseguire|non inviare|non cancellare|chiedi conferma|approva)/i },
  { cat: "tooling", re: /(usa.*(strumento|tool)|n8n|telegram|gmail|drive)/i },
  { cat: "business_context", re: /(client[ei]|fattur|investit|partner|fornito)/i },
];

export function classifyMemoryEntry(content: string): JackMemoryEntryCategory {
  for (const h of CATEGORY_HINTS) if (h.re.test(content)) return h.cat;
  return "general";
}

const SENSITIVE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{10,}\b/i,
  /\bBearer\s+\S{10,}/i,
  /\b(api[_-]?key|apikey|password|passwd|token|secret)\s*[:=]\s*\S{4,}/i,
  /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/,
  /\b\d{9,}:[A-Za-z0-9_\-]{30,}\b/, // telegram token
  /\b(iban|codice fiscale|carta di credito|cvv)\b/i,
];

export function detectMemorySensitivity(content: string): "normal" | "sensitive" | "secret" {
  for (const re of SENSITIVE_PATTERNS) if (re.test(content)) return "secret";
  if (/\b(diagnos|medic|terapia|avvocato|legale|familiare|figli|moglie|marito)\b/i.test(content)) {
    return "sensitive";
  }
  return "normal";
}

export function redactMemorySecrets(content: string): string {
  let out = content;
  for (const re of SENSITIVE_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

const MEMORY_INTENT_PATTERNS = {
  save: [
    /^\s*(jack[,\s]+)?(memorizza|ricorda|salva|tieni a mente|annota|nota)\s+(che|questo|quello|quanto)?\b/i,
    /^\s*(jack[,\s]+)?da ora in poi\b/i,
    /^\s*(jack[,\s]+)?aggiorna la memoria\b/i,
  ],
  forget: [
    /^\s*(jack[,\s]+)?(dimentica|cancella|rimuovi|non ricordare(?: pi[uù])?)\b/i,
  ],
  search: [
    /^\s*(jack[,\s]+)?(cosa (ti )?ricordi|cosa sai|che memoria hai|hai memoria)\b/i,
  ],
} as const;

export type MemoryIntentKind = "save" | "forget" | "search" | "none";

export function detectMemoryIntent(transcript: string): {
  kind: MemoryIntentKind;
  payload: string;
} {
  const t = transcript.trim();
  for (const re of MEMORY_INTENT_PATTERNS.save) {
    const m = t.match(re);
    if (m) {
      const after = t.slice(m[0].length).trim().replace(/^,\s*/, "");
      return { kind: "save", payload: after || t };
    }
  }
  for (const re of MEMORY_INTENT_PATTERNS.forget) {
    const m = t.match(re);
    if (m) {
      const after = t.slice(m[0].length).trim().replace(/^,\s*/, "");
      return { kind: "forget", payload: after || t };
    }
  }
  for (const re of MEMORY_INTENT_PATTERNS.search) {
    const m = t.match(re);
    if (m) return { kind: "search", payload: t.slice(m[0].length).trim() || t };
  }
  return { kind: "none", payload: t };
}

export function extractMemoryEntryFromTranscript(transcript: string): {
  content: string;
  category: JackMemoryEntryCategory;
  sensitivity: "normal" | "sensitive" | "secret";
} {
  const { payload } = detectMemoryIntent(transcript);
  const content = payload.replace(/^che\s+/i, "").trim();
  return {
    content,
    category: classifyMemoryEntry(content),
    sensitivity: detectMemorySensitivity(content),
  };
}

export async function createJackMemoryEntry(
  input: CreateJackMemoryEntryInput,
): Promise<{ kind: "created" | "needs_confirmation"; entry?: JackMemoryEntry; sensitivity?: string }> {
  const userId = await getUserIdOrThrow();
  const content = input.content.trim();
  if (!content) throw new Error("Contenuto memoria vuoto");
  const sensitivity = input.sensitivity ?? detectMemorySensitivity(content);
  const category = input.category ?? classifyMemoryEntry(content);

  if (sensitivity === "secret" && !input.acknowledgeSecret) {
    await logJackMemoryEvent("jack_memory_secret_warning", {
      reason: "secret_pattern_detected",
      category,
    });
    // store as suggested with redacted preview
    const { data, error } = await supabase
      .from("jack_memory_entries" as never)
      .insert({
        user_id: userId,
        content: redactMemorySecrets(content),
        normalized_content: redactMemorySecrets(content).toLowerCase(),
        category,
        sensitivity: "secret",
        status: "suggested",
        source: input.source ?? "conversation",
        importance: input.importance ?? "normal",
        project_name: input.project_name ?? null,
        brain_id: input.brain_id ?? null,
        metadata: { ...(input.metadata ?? {}), secret_redacted: true },
      } as never)
      .select("*")
      .single();
    if (error) throw error;
    await logJackMemoryEvent("jack_memory_entry_suggested", {
      id: (data as JackMemoryEntry).id,
      reason: "secret",
    });
    return { kind: "needs_confirmation", entry: data as JackMemoryEntry, sensitivity };
  }

  const status: JackMemoryEntryStatus = input.status ?? (sensitivity === "sensitive" ? "suggested" : "active");
  const { data, error } = await supabase
    .from("jack_memory_entries" as never)
    .insert({
      user_id: userId,
      content,
      normalized_content: content.toLowerCase(),
      category,
      sensitivity,
      status,
      source: input.source ?? "conversation",
      importance: input.importance ?? "normal",
      project_name: input.project_name ?? null,
      brain_id: input.brain_id ?? null,
      approved_at: status === "active" ? new Date().toISOString() : null,
      metadata: input.metadata ?? {},
    } as never)
    .select("*")
    .single();
  if (error) throw error;
  await logJackMemoryEvent(
    status === "active" ? "jack_memory_entry_created" : "jack_memory_entry_suggested",
    { id: (data as JackMemoryEntry).id, category, sensitivity },
  );
  return { kind: "created", entry: data as JackMemoryEntry, sensitivity };
}

export async function suggestJackMemoryEntry(
  input: CreateJackMemoryEntryInput,
): Promise<JackMemoryEntry> {
  const res = await createJackMemoryEntry({ ...input, status: "suggested" });
  if (!res.entry) throw new Error("Suggerimento memoria non creato");
  return res.entry;
}

export async function listJackMemoryEntries(filters?: {
  status?: JackMemoryEntryStatus | JackMemoryEntryStatus[];
  category?: JackMemoryEntryCategory;
  project_name?: string;
  brain_id?: string | null;
  limit?: number;
}): Promise<JackMemoryEntry[]> {
  let q = supabase
    .from("jack_memory_entries" as never)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filters?.limit ?? 200);
  if (filters?.status) {
    if (Array.isArray(filters.status)) q = q.in("status", filters.status as never);
    else q = q.eq("status", filters.status as never);
  }
  if (filters?.category) q = q.eq("category", filters.category as never);
  if (filters?.project_name) q = q.ilike("project_name", `%${filters.project_name}%`);
  if (filters?.brain_id !== undefined && filters.brain_id !== null) {
    q = q.eq("brain_id", filters.brain_id as never);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as JackMemoryEntry[];
}

export async function archiveJackMemoryEntry(id: string): Promise<void> {
  const { error } = await supabase
    .from("jack_memory_entries" as never)
    .update({ status: "archived", archived_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;
  await logJackMemoryEvent("jack_memory_entry_archived", { id });
}

export async function approveJackMemoryEntry(id: string): Promise<void> {
  const { error } = await supabase
    .from("jack_memory_entries" as never)
    .update({ status: "active", approved_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;
  await logJackMemoryEvent("jack_memory_entry_created", { id, via: "approval" });
}

export async function rejectJackMemoryEntry(id: string): Promise<void> {
  const { error } = await supabase
    .from("jack_memory_entries" as never)
    .update({ status: "rejected" } as never)
    .eq("id", id);
  if (error) throw error;
  await logJackMemoryEvent("jack_memory_entry_rejected", { id });
}

export async function searchJackMemoryEntries(query: string): Promise<JackMemoryEntry[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { data, error } = await supabase
    .from("jack_memory_entries" as never)
    .select("*")
    .in("status", ["active", "suggested"] as never)
    .ilike("normalized_content", `%${q}%`)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as JackMemoryEntry[];
}

export async function findSimilarMemoryEntries(content: string): Promise<JackMemoryEntry[]> {
  const tokens = content
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 5);
  if (tokens.length === 0) return [];
  // OR-search on the most distinctive tokens
  const orExpr = tokens.map((t) => `normalized_content.ilike.%${t}%`).join(",");
  const { data, error } = await supabase
    .from("jack_memory_entries" as never)
    .select("*")
    .eq("status", "active" as never)
    .or(orExpr)
    .limit(10);
  if (error) return [];
  return (data ?? []) as JackMemoryEntry[];
}
