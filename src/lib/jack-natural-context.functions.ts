// ============================================================
// Brain Hub v3.13 — Jack Natural Memory & Context Injection
// ============================================================
// Server-side builder for a COMPACT, NATURAL Italian summary that Jack
// (GPT Voice Mode) can use as conversational background context.
//
// Privacy rules (enforced server-side):
//   - Only jack_memory_entries with status='active' and sensitivity != 'secret'
//   - Strip residual secret patterns even on safe entries (defense in depth)
//   - No raw markdown dump, no payload over ~1400 chars
//   - No secrets, no tokens, no raw logs
// ============================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Types ----------

export type NaturalContextInput = {
  brain_id?: string | null;
  max_entries?: number;
  max_priorities?: number;
};

export type NaturalContextProject = {
  id: string;
  name: string;
};

export type NaturalContextPriority = {
  title: string;
  detail?: string | null;
};

export type NaturalContextResult = {
  ok: true;
  summary_text: string;
  brain: { id: string; name: string } | null;
  projects: NaturalContextProject[];
  top_priorities: NaturalContextPriority[];
  entry_count: number;
  used_entry_ids: string[];
  generated_at: string;
  context_chars: number;
};

export type NaturalContextFailure = {
  ok: false;
  error: "build_failed";
  detail?: string;
};

export type NaturalContextResponse = NaturalContextResult | NaturalContextFailure;

// ---------- Helpers ----------

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_\-]{16,}/g,
  /\bBearer\s+[A-Za-z0-9._\-]{20,}\b/gi,
  /eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g,
  /\b\d{9,}:[A-Za-z0-9_\-]{30,}\b/g, // Telegram bot token
  /\b(api[_-]?key|apikey|password|passwd|webhook[_-]?secret)\s*[:=]\s*\S+/gi,
];

function stripSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

function naturalizeEntry(content: string, max = 220): string {
  let t = content.trim();
  t = stripSecrets(t);
  // strip markdown bold/italic/code/headings/bullets
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1");
  t = t.replace(/\*(.*?)\*/g, "$1").replace(/_(.*?)_/g, "$1");
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/^\s*[-*•]\s+/gm, "");
  t = t.replace(/\s*\n+\s*/g, " ");
  t = t.replace(/\s{2,}/g, " ").trim();
  if (t.length > max) t = t.slice(0, max - 1) + "…";
  return t;
}

const IMPORTANCE_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  medium: 2,
  low: 1,
};

// ---------- Server function ----------

type EntryRow = {
  id: string;
  content: string;
  category: string | null;
  importance: string | null;
  project_name: string | null;
  updated_at: string;
};

type BriefRow = {
  next_actions: unknown;
  open_actions_summary: unknown;
  executive_summary: string | null;
  brief_date: string;
};

type BrainRow = { id: string; name: string };
type ProjectLinkRow = { project_id: string; project_name: string | null };

function extractPriorities(brief: BriefRow | null, max: number): NaturalContextPriority[] {
  if (!brief) return [];
  const out: NaturalContextPriority[] = [];
  const na = brief.next_actions;
  if (Array.isArray(na)) {
    for (const item of na) {
      if (out.length >= max) break;
      if (item && typeof item === "object") {
        const obj = item as { title?: unknown; description?: unknown; action?: unknown };
        const title =
          (typeof obj.title === "string" && obj.title) ||
          (typeof obj.action === "string" && obj.action) ||
          null;
        if (title) {
          out.push({
            title: naturalizeEntry(title, 140),
            detail:
              typeof obj.description === "string"
                ? naturalizeEntry(obj.description, 160)
                : null,
          });
        }
      } else if (typeof item === "string") {
        out.push({ title: naturalizeEntry(item, 140) });
      }
    }
  }
  return out.slice(0, max);
}

export const buildJackNaturalContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown): NaturalContextInput => (d ?? {}) as NaturalContextInput)
  .handler(async ({ data, context }): Promise<NaturalContextResponse> => {
    try {
      const { supabase, userId } = context;
      const brainId = data.brain_id ?? null;
      const maxEntries = Math.min(Math.max(data.max_entries ?? 8, 3), 12);
      const maxPriorities = Math.min(Math.max(data.max_priorities ?? 5, 3), 5);

      // 1) Active + safe memory entries
      const entriesQ = supabase
        .from("jack_memory_entries")
        .select("id,content,category,importance,project_name,updated_at,sensitivity,status")
        .eq("user_id", userId)
        .eq("status", "active")
        .neq("sensitivity", "secret")
        .order("updated_at", { ascending: false })
        .limit(40);
      const { data: rawEntries } = await entriesQ;
      const entries = ((rawEntries ?? []) as EntryRow[])
        .sort((a, b) => {
          const ra = IMPORTANCE_RANK[(a.importance ?? "normal").toLowerCase()] ?? 2;
          const rb = IMPORTANCE_RANK[(b.importance ?? "normal").toLowerCase()] ?? 2;
          if (rb !== ra) return rb - ra;
          return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
        })
        .slice(0, maxEntries);

      // 2) Current brain + linked projects
      let brain: BrainRow | null = null;
      let projects: NaturalContextProject[] = [];
      if (brainId) {
        const { data: b } = await supabase
          .from("brains")
          .select("id,name")
          .eq("id", brainId)
          .maybeSingle();
        brain = (b as BrainRow | null) ?? null;
        const { data: links } = await supabase
          .from("project_links")
          .select("project_id,project_name")
          .eq("brain_id", brainId)
          .limit(8);
        projects = ((links as ProjectLinkRow[] | null) ?? [])
          .filter((l) => l.project_name)
          .map((l) => ({ id: l.project_id, name: String(l.project_name) }));
      }

      // 3) Latest brief for that brain
      const briefQuery = supabase
        .from("daily_operating_briefs")
        .select("next_actions,open_actions_summary,executive_summary,brief_date,brain_id")
        .eq("user_id", userId)
        .order("brief_date", { ascending: false })
        .limit(5);
      const { data: briefs } = await briefQuery;
      const briefRow =
        ((briefs as Array<BriefRow & { brain_id: string | null }> | null) ?? []).find(
          (b) => (brainId ? b.brain_id === brainId : true),
        ) ?? null;
      const priorities = extractPriorities(briefRow, maxPriorities);

      // 4) Compose a single natural Italian paragraph (no markdown, no lists)
      const parts: string[] = [];
      if (brain) {
        const projPhrase =
          projects.length > 0
            ? ` Progetti collegati: ${projects.map((p) => p.name).join(", ")}.`
            : "";
        parts.push(`Stai lavorando nel brain "${brain.name}".${projPhrase}`);
      }
      if (entries.length > 0) {
        const entrySentences = entries
          .map((e) => {
            const tag = e.project_name ? ` (${e.project_name})` : "";
            return `${naturalizeEntry(e.content, 200)}${tag}`;
          })
          .filter(Boolean);
        parts.push(`Cose che ricordo di te${entries.length === 1 ? "" : ""}: ${entrySentences.join("; ")}.`);
      }
      if (priorities.length > 0) {
        const list = priorities.map((p) => p.title).filter(Boolean).join("; ");
        if (list) parts.push(`Priorità operative di oggi: ${list}.`);
      }

      let summary = parts.join(" ").replace(/\s{2,}/g, " ").trim();
      summary = stripSecrets(summary);
      const MAX_CONTEXT = 1400;
      if (summary.length > MAX_CONTEXT) summary = summary.slice(0, MAX_CONTEXT - 1) + "…";

      // Best-effort log
      try {
        await (supabase as never as {
          from: (t: string) => {
            insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
          };
        })
          .from("app_logs")
          .insert({
            user_id: userId,
            action: "jack_natural_context_built",
            message: "jack_natural_context_built",
            severity: "info",
            entity_type: "jack_memory",
            metadata: {
              brain_id: brainId,
              entry_count: entries.length,
              priorities: priorities.length,
              chars: summary.length,
            } as never,
          });
      } catch {
        // logging best-effort
      }

      return {
        ok: true,
        summary_text: summary,
        brain: brain ?? null,
        projects,
        top_priorities: priorities,
        entry_count: entries.length,
        used_entry_ids: entries.map((e) => e.id),
        generated_at: new Date().toISOString(),
        context_chars: summary.length,
      };
    } catch (err) {
      return {
        ok: false,
        error: "build_failed",
        detail: String((err as Error).message ?? err).slice(0, 200),
      };
    }
  });
