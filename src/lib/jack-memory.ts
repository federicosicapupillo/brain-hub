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
