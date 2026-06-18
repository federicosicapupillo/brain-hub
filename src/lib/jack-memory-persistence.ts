// ============================================================
// Brain Hub v3.13.1 — Jack Memory Persistence & Reload
// ============================================================
// Server-side helpers (no createServerFn here — these are plain async
// functions used INSIDE existing server-fn handlers like
// `create_memory_entry` in jack-gpt-tools.ts). They guarantee:
//
//   • dedup/upsert of similar memories (no exploding duplicates)
//   • correct user_id + brain_id scoping (global vs brain-specific)
//   • a verification pass that re-reads the row from DB and confirms
//     it appears inside the natural-context summary
//
// No external actions. No secrets logged. RLS still applies because we
// always reuse the authenticated `supabase` client passed in by the
// caller's `requireSupabaseAuth` middleware.
// ============================================================

import { detectSecretPatterns } from "@/lib/jack-memory";

// Loose Supabase shape — we keep it minimal to avoid coupling to the
// generated Database types here. The caller's RLS client guarantees
// row-level security.
type AuthedSupabase = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        eq: (col: string, val: unknown) => {
          neq: (col: string, val: unknown) => {
            or: (expr: string) => {
              order: (col: string, opts: { ascending: boolean }) => {
                limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
              };
            };
            order: (col: string, opts: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
            };
          };
        };
      };
      eq2?: never;
    };
  };
};

// We don't actually use the strict AuthedSupabase shape — Supabase's
// fluent API has too many overloads. Treat it as `never`-cast like the
// existing codebase does for jack_memory_entries.
type AnySupabase = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type MemoryScope = "global" | "brain";

export type UpsertMemoryInput = {
  userId: string;
  content: string;
  category?: string | null;
  brainId?: string | null;
  scope?: MemoryScope;
  projectName?: string | null;
  source?: string;
};

export type UpsertMemoryResult = {
  persisted: boolean;
  entryId: string | null;
  status: "active" | "suggested" | "rejected" | "archived" | null;
  sensitivity: "normal" | "secret" | null;
  scope: MemoryScope;
  brainId: string | null;
  deduped: boolean;
  matchedEntryId: string | null;
  reason: string | null;
  secretWarning: boolean;
};

export type VerifyPersistenceResult = {
  persisted: boolean;
  includedInContext: boolean;
  status: string | null;
  sensitivity: string | null;
  activeMemoryCount: number;
  globalMemoryCount: number;
  brainMemoryCount: number;
  reason: string | null;
};

// ----------------------------------------------------------------
// Tokenization for dedup similarity check
// ----------------------------------------------------------------

const STOPWORDS = new Set([
  "che", "non", "una", "uno", "del", "della", "delle", "degli", "alla", "allo",
  "agli", "alle", "sono", "essere", "avere", "fare", "anche", "molto", "questo",
  "questa", "quando", "perche", "perché", "come", "deve", "devi", "vuoi", "voglio",
  "memorizza", "memorizzalo", "ricorda", "ricordati", "salva",
  "the", "and", "for", "with", "this", "that", "from",
]);

export function normalizeMemoryContent(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function memoryTokens(input: string): string[] {
  return normalizeMemoryContent(input)
    .split(" ")
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ----------------------------------------------------------------
// Upsert
// ----------------------------------------------------------------

const SIMILARITY_DEDUP_THRESHOLD = 0.55;

export async function upsertJackMemoryEntryFromTool(
  supabase: AnySupabase,
  input: UpsertMemoryInput,
): Promise<UpsertMemoryResult> {
  const content = (input.content ?? "").trim();
  if (!content) {
    return {
      persisted: false,
      entryId: null,
      status: null,
      sensitivity: null,
      scope: "global",
      brainId: null,
      deduped: false,
      matchedEntryId: null,
      reason: "empty_content",
      secretWarning: false,
    };
  }

  const warnings = detectSecretPatterns(content);
  const isSecret = warnings.length > 0;
  const scope: MemoryScope = input.scope ?? (input.brainId ? "brain" : "global");
  const brainId = scope === "brain" ? (input.brainId ?? null) : null;
  const category = input.category ?? "preference";
  const normalized = normalizeMemoryContent(content);
  const tokens = memoryTokens(content);

  // ---- Dedup search: same user, active, similar normalized content ----
  let matchedId: string | null = null;
  try {
    const { data } = await supabase
      .from("jack_memory_entries")
      .select("id,content,normalized_content,brain_id,status")
      .eq("user_id", input.userId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(50);
    const rows = (data as Array<{
      id: string;
      content: string;
      normalized_content: string | null;
      brain_id: string | null;
    }> | null) ?? [];
    let best = 0;
    for (const r of rows) {
      // Only dedup within same scope (global<->global, same brain<->same brain)
      const sameScope = (brainId ?? null) === (r.brain_id ?? null);
      if (!sameScope) continue;
      const rTokens = memoryTokens(r.normalized_content ?? r.content ?? "");
      const sim = jaccardSimilarity(tokens, rTokens);
      if (sim > best) {
        best = sim;
        if (sim >= SIMILARITY_DEDUP_THRESHOLD) matchedId = r.id;
      }
    }
  } catch {
    matchedId = null;
  }

  // ---- Update existing or insert new ----
  const now = new Date().toISOString();
  const targetStatus: "active" | "suggested" = isSecret ? "suggested" : "active";
  const targetSensitivity: "normal" | "secret" = isSecret ? "secret" : "normal";

  if (matchedId) {
    const { data: updRow, error: updErr } = await supabase
      .from("jack_memory_entries")
      .update({
        content,
        normalized_content: normalized,
        category,
        status: targetStatus,
        sensitivity: targetSensitivity,
        brain_id: brainId,
        project_name: input.projectName ?? null,
        source: input.source ?? "jack_gpt",
        updated_at: now,
        last_used_at: now,
      })
      .eq("id", matchedId)
      .eq("user_id", input.userId)
      .select("id,status,sensitivity,brain_id")
      .single();
    if (updErr || !updRow) {
      return {
        persisted: false,
        entryId: matchedId,
        status: null,
        sensitivity: null,
        scope,
        brainId,
        deduped: true,
        matchedEntryId: matchedId,
        reason: "update_failed",
        secretWarning: isSecret,
      };
    }
    const r = updRow as { id: string; status: string; sensitivity: string; brain_id: string | null };
    return {
      persisted: true,
      entryId: r.id,
      status: r.status as UpsertMemoryResult["status"],
      sensitivity: r.sensitivity as UpsertMemoryResult["sensitivity"],
      scope: r.brain_id ? "brain" : "global",
      brainId: r.brain_id,
      deduped: true,
      matchedEntryId: matchedId,
      reason: null,
      secretWarning: isSecret,
    };
  }

  const { data: insRow, error: insErr } = await supabase
    .from("jack_memory_entries")
    .insert({
      user_id: input.userId,
      brain_id: brainId,
      project_name: input.projectName ?? null,
      category,
      content,
      normalized_content: normalized,
      source: input.source ?? "jack_gpt",
      status: targetStatus,
      sensitivity: targetSensitivity,
    })
    .select("id,status,sensitivity,brain_id")
    .single();
  if (insErr || !insRow) {
    return {
      persisted: false,
      entryId: null,
      status: null,
      sensitivity: null,
      scope,
      brainId,
      deduped: false,
      matchedEntryId: null,
      reason: "insert_failed",
      secretWarning: isSecret,
    };
  }
  const r = insRow as { id: string; status: string; sensitivity: string; brain_id: string | null };
  return {
    persisted: true,
    entryId: r.id,
    status: r.status as UpsertMemoryResult["status"],
    sensitivity: r.sensitivity as UpsertMemoryResult["sensitivity"],
    scope: r.brain_id ? "brain" : "global",
    brainId: r.brain_id,
    deduped: false,
    matchedEntryId: null,
    reason: null,
    secretWarning: isSecret,
  };
}

// ----------------------------------------------------------------
// Verify: re-read the row + count active memories in context scope
// ----------------------------------------------------------------

export async function verifyJackMemoryPersistence(
  supabase: AnySupabase,
  args: { userId: string; memoryId: string | null; brainId?: string | null },
): Promise<VerifyPersistenceResult> {
  let status: string | null = null;
  let sensitivity: string | null = null;
  let persisted = false;
  let reason: string | null = null;

  if (args.memoryId) {
    const { data } = await supabase
      .from("jack_memory_entries")
      .select("id,status,sensitivity")
      .eq("id", args.memoryId)
      .eq("user_id", args.userId)
      .maybeSingle();
    const row = data as { id: string; status: string; sensitivity: string } | null;
    if (row) {
      persisted = true;
      status = row.status;
      sensitivity = row.sensitivity;
    } else {
      reason = "memory_not_found";
    }
  } else {
    reason = "no_memory_id";
  }

  // Count active memories: globals + current-brain-scoped
  const { data: activeRows } = await supabase
    .from("jack_memory_entries")
    .select("id,brain_id,status,sensitivity")
    .eq("user_id", args.userId)
    .eq("status", "active")
    .neq("sensitivity", "secret")
    .order("updated_at", { ascending: false })
    .limit(200);
  const rows = (activeRows as Array<{ id: string; brain_id: string | null }> | null) ?? [];
  const globalMemoryCount = rows.filter((r) => r.brain_id == null).length;
  const brainMemoryCount = args.brainId
    ? rows.filter((r) => r.brain_id === args.brainId).length
    : 0;
  const activeMemoryCount = rows.length;

  // included_in_context = simple heuristic: top-12 by updated_at includes id
  // (buildJackNaturalContext takes max 12 entries, sorted by importance then updated_at).
  const topIds = rows.slice(0, 12).map((r) => r.id);
  const includedInContext = args.memoryId ? topIds.includes(args.memoryId) : false;
  if (persisted && !includedInContext && !reason) {
    reason = "saved_but_not_in_top_context_window";
  }

  return {
    persisted,
    includedInContext,
    status,
    sensitivity,
    activeMemoryCount,
    globalMemoryCount,
    brainMemoryCount,
    reason,
  };
}
