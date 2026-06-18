// Jack GPT Mode — controlled, read-only tools exposed to OpenAI Realtime.
// Implemented as TanStack server functions. The browser routes tool_call events
// from OpenAI to these functions, then returns results back via the data channel.
// All tools are scoped to the authenticated user (RLS).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  resolveJackCommandIntent,
  type JackCommandContext,
} from "@/lib/jack-command-router";
import { searchJackMemory } from "@/lib/jack-memory";
import { buildJackNaturalContext } from "@/lib/jack-natural-context.functions";
import {
  upsertJackMemoryEntryFromTool,
  verifyJackMemoryPersistence,
} from "@/lib/jack-memory-persistence";

// ---------- OpenAI tool schema (sent to Realtime session) ----------

export const JACK_GPT_TOOLS_SCHEMA = [
  {
    type: "function",
    name: "get_daily_brief",
    description:
      "Restituisce il Daily Operating Brief di oggi. Read-only.",
    parameters: {
      type: "object",
      properties: {
        brain_id: { type: "string", description: "Brain id opzionale per filtrare." },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_project_status",
    description:
      "Stato di un progetto/brain. Usare quando Federico nomina un progetto.",
    parameters: {
      type: "object",
      properties: {
        project_name: { type: "string" },
        brain_id: { type: "string" },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "search_jack_memory",
    description:
      "Cerca in Jack Memory. Restituisce risultati compatti, mai dump markdown grezzo.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        project_name: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "create_memory_entry",
    description:
      "Crea/aggiorna una memory entry persistente quando Federico dice 'memorizza', 'ricorda che'. Dedup automatico su preferenze simili. Sensibili → 'suggested', altrimenti 'active'. Restituisce persisted, status e included_in_context.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        category: { type: "string", description: "preference|fact|rule|context" },
        project_name: { type: "string" },
        brain_id: { type: "string", description: "Brain id se la memoria è specifica di un progetto. Omettere per preferenze personali globali." },
        scope: { type: "string", enum: ["global", "brain"], description: "Default: global per preferenze personali, brain se brain_id presente." },
      },
      required: ["content"],
    },
  },
  {
    type: "function",
    name: "get_action_queue_summary",
    description: "Riepilogo Action Queue (open, high risk, top azioni).",
    parameters: {
      type: "object",
      properties: {
        brain_id: { type: "string" },
        project_name: { type: "string" },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_loop_qa_warnings",
    description: "Warning Loop QA recenti.",
    parameters: {
      type: "object",
      properties: { brain_id: { type: "string" } },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_gmail_summary",
    description: "Riepilogo email oggi. Mai body completo salvo richiesta.",
    parameters: {
      type: "object",
      properties: { brain_id: { type: "string" } },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_memory_context",
    description:
      "Restituisce il contesto naturale aggiornato (chi è Federico, brain attivo, progetti, priorità di oggi). Compatto, senza segreti. Usare se serve rinfrescare la memoria conversazionale.",
    parameters: {
      type: "object",
      properties: {
        brain_id: { type: "string" },
      },
      required: [],
    },
  },
] as const;

// ---------- Helpers ----------

function redactSnippet(text: string | null | undefined, max = 600): string {
  if (!text) return "";
  let out = text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]");
  out = out.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]");
  out = out.replace(/\b\d{12,}\b/g, "[REDACTED]");
  if (out.length > max) out = out.slice(0, max - 1) + "…";
  return out;
}

async function fetchBrainsCtx(
  supabase: {
    from: (t: string) => {
      select: (cols: string) => {
        order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown }>;
      };
    };
  },
): Promise<JackCommandContext> {
  const { data } = await supabase
    .from("brains")
    .select("id,name")
    .order("name", { ascending: true });
  const brains = (data as Array<{ id: string; name: string }> | null) ?? [];
  return { brainId: null, brains, currentBrief: null };
}

// ---------- Server function: tool dispatcher ----------

type ToolInput = {
  tool_name: string;
  arguments: Record<string, unknown> | string | null | undefined;
};

const ALLOWED_TOOL_NAMES: ReadonlySet<string> = new Set(
  JACK_GPT_TOOLS_SCHEMA.map((t) => t.name),
);

function parseToolArgs(raw: ToolInput["arguments"]): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw;
}

export const runJackGptTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as ToolInput)
  .handler(async ({ data, context }) => {
    const { tool_name } = data;
    const args = parseToolArgs(data.arguments);
    const userId = context.userId;
    const { supabase } = context;

    if (!tool_name || !ALLOWED_TOOL_NAMES.has(tool_name)) {
      return { ok: false, error: "tool_rejected", detail: "unknown_or_disallowed_tool" };
    }

    try {
      switch (tool_name) {

        case "get_daily_brief": {
          const ctx = await fetchBrainsCtx(supabase as never);
          ctx.brainId = (args.brain_id as string | undefined) ?? null;
          const result = await resolveJackCommandIntent({
            transcript: "a che punto siamo",
            context: ctx,
          });
          return {
            ok: true,
            payload: {
              summary: redactSnippet(result.response_text, 900),
              source: result.source,
              brain_id: ctx.brainId,
            },
          };
        }
        case "get_project_status": {
          const ctx = await fetchBrainsCtx(supabase as never);
          ctx.brainId = (args.brain_id as string | undefined) ?? null;
          const projectName = (args.project_name as string) ?? "";
          const result = await resolveJackCommandIntent({
            transcript: `a che punto siamo con ${projectName}`,
            context: ctx,
          });
          return {
            ok: true,
            payload: {
              project_name: result.project?.brain?.name ?? projectName,
              resolved_brain_id: result.project?.brain?.id ?? null,
              resolution: result.project?.resolution.kind ?? "none",
              status_summary: redactSnippet(result.response_text, 900),
              source: result.source,
            },
          };
        }
        case "search_jack_memory": {
          const query = String(args.query ?? "");
          const hits = await searchJackMemory(query);
          return {
            ok: true,
            payload: {
              query,
              entries: hits.slice(0, 6).map((h) => ({
                heading: h.heading,
                snippet: redactSnippet(h.text, 200),
              })),
            },
          };
        }
        case "create_memory_entry": {
          const content = String(args.content ?? "").trim();
          if (!content) return { ok: false, error: "empty_content" };
          const warnings = detectSecretPatterns(content);
          const isSecret = warnings.length > 0;
          const category = (args.category as string) ?? "preference";
          const { data: row, error } = await (supabase as never as {
            from: (t: string) => {
              insert: (v: Record<string, unknown>) => {
                select: (c: string) => {
                  single: () => Promise<{ data: unknown; error: unknown }>;
                };
              };
            };
          })
            .from("jack_memory_entries")
            .insert({
              user_id: userId,
              content,
              category,
              sensitivity: isSecret ? "secret" : "normal",
              status: isSecret ? "suggested" : "active",
              source: "jack_gpt",
            })
            .select("id,status,sensitivity")
            .single();
          if (error) return { ok: false, error: "insert_failed" };
          const r = row as { id?: string; status?: string; sensitivity?: string } | null;
          return {
            ok: true,
            payload: {
              entry_id: r?.id ?? null,
              status: r?.status ?? null,
              sensitivity: r?.sensitivity ?? null,
              secret_warning: isSecret,
              message: isSecret
                ? "Possibile segreto rilevato: salvato come 'suggerito', in attesa di conferma manuale."
                : "Memoria salvata.",
            },
          };
        }
        case "get_action_queue_summary": {
          const ctx = await fetchBrainsCtx(supabase as never);
          ctx.brainId = (args.brain_id as string | undefined) ?? null;
          const result = await resolveJackCommandIntent({
            transcript: "cosa devo fare adesso",
            context: ctx,
          });
          return {
            ok: true,
            payload: {
              summary: redactSnippet(result.response_text, 700),
              source: result.source,
            },
          };
        }
        case "get_loop_qa_warnings": {
          const ctx = await fetchBrainsCtx(supabase as never);
          ctx.brainId = (args.brain_id as string | undefined) ?? null;
          const result = await resolveJackCommandIntent({
            transcript: "ci sono warning",
            context: ctx,
          });
          return {
            ok: true,
            payload: {
              warnings_summary: redactSnippet(result.response_text, 700),
              source: result.source,
            },
          };
        }
        case "get_gmail_summary": {
          const ctx = await fetchBrainsCtx(supabase as never);
          ctx.brainId = (args.brain_id as string | undefined) ?? null;
          const result = await resolveJackCommandIntent({
            transcript: "riepilogo email di oggi",
            context: ctx,
          });
          return {
            ok: true,
            payload: {
              summary: redactSnippet(result.response_text, 700),
              source: result.source,
            },
          };
        }
        case "get_memory_context": {
          const brainId = (args.brain_id as string | undefined) ?? null;
          const ctx = await buildJackNaturalContext({ data: { brain_id: brainId } });
          if (!ctx.ok) {
            return { ok: false, error: "context_failed", detail: ctx.detail ?? null };
          }
          return {
            ok: true,
            payload: {
              summary: ctx.summary_text,
              brain_name: ctx.brain?.name ?? null,
              projects: ctx.projects.map((p) => p.name),
              top_priorities: ctx.top_priorities.map((p) => p.title),
              entry_count: ctx.entry_count,
              generated_at: ctx.generated_at,
              chars: ctx.context_chars,
            },
          };
        }
        default:
          return { ok: false, error: "unknown_tool" };
      }
    } catch (err) {
      return {
        ok: false,
        error: "tool_failed",
        detail: String((err as Error).message ?? err).slice(0, 200),
      };
    }
  });

// Log helper — sanitized event row.
export const logJackGptEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as { event: string; metadata?: Record<string, unknown> })
  .handler(async ({ data, context }) => {
    const { event, metadata } = data;
    const safe = JSON.parse(
      JSON.stringify(metadata ?? {}).replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]"),
    );
    try {
      await (context.supabase as never as {
        from: (t: string) => {
          insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      })
        .from("agent_event_log")
        .insert({
          user_id: context.userId,
          event_type: event,
          metadata: safe,
        });
    } catch {
      // best-effort
    }
    return { ok: true };
  });
