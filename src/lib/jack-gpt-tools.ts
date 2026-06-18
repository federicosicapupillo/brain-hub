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
import {
  searchJackMemory,
  getCurrentJackMemoryDocument,
  detectSecretPatterns,
} from "@/lib/jack-memory";
import { supabase as browserSupabase } from "@/integrations/supabase/client";

// ---------- OpenAI tool schema (sent to Realtime session) ----------

export const JACK_GPT_TOOLS_SCHEMA = [
  {
    type: "function",
    name: "get_daily_brief",
    description:
      "Restituisce il Daily Operating Brief di oggi (executive summary, next actions, warnings, email summary). Read-only.",
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
      "Stato di un progetto/brain (recente attività, azioni aperte, warning). Usare quando Federico nomina un progetto.",
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
      "Cerca in Jack Memory (entries + sezioni documento). Restituisce risultati compatti, mai dump markdown grezzo.",
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
      "Crea una memory entry quando Federico dice 'memorizza', 'ricorda che'. Se contiene segreti, l'entry viene creata come 'suggested' e richiede conferma manuale.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        category: { type: "string" },
        project_name: { type: "string" },
      },
      required: ["content"],
    },
  },
  {
    type: "function",
    name: "get_action_queue_summary",
    description: "Riepilogo Action Queue (count aperte, high risk, suggested, top azioni).",
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
    description: "Warning Loop QA (critici, medi, info).",
    parameters: {
      type: "object",
      properties: { brain_id: { type: "string" } },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_gmail_summary",
    description:
      "Riepilogo email oggi (totale, high priority, reply needed, lead/finance/meeting). Mai body completo salvo richiesta.",
    parameters: {
      type: "object",
      properties: { brain_id: { type: "string" } },
      required: [],
    },
  },
] as const;

// ---------- Helpers ----------

async function fetchBrains(): Promise<Array<{ id: string; name: string }>> {
  const { data } = await browserSupabase
    .from("brains")
    .select("id,name")
    .order("name", { ascending: true });
  return (data ?? []) as Array<{ id: string; name: string }>;
}

function buildContext(brains: Array<{ id: string; name: string }>): JackCommandContext {
  return { brains, currentBrief: null };
}

function redactSnippet(text: string, max = 220): string {
  let out = text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]");
  out = out.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]");
  out = out.replace(/\b\d{12,}\b/g, "[REDACTED]");
  if (out.length > max) out = out.slice(0, max - 1) + "…";
  return out;
}

// ---------- Server function: tool dispatcher ----------

type ToolInput = {
  tool_name: string;
  arguments: Record<string, unknown>;
};

export const runJackGptTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as ToolInput)
  .handler(async ({ data, context }) => {
    const { tool_name, arguments: args } = data;
    const userId = context.userId;

    try {
      switch (tool_name) {
        case "get_daily_brief": {
          const brains = await fetchBrains();
          const result = await resolveJackCommandIntent({
            transcript: "a che punto siamo",
            intent: "daily_status",
            context: buildContext(brains),
          });
          return {
            ok: true,
            payload: {
              executive_summary: redactSnippet(result.summary ?? "", 600),
              voice_summary_text: redactSnippet(result.speech ?? "", 800),
              next_actions: (result.bullets ?? []).slice(0, 6).map((b) => redactSnippet(b, 180)),
              warnings_summary: result.warnings ?? null,
              source_counts: result.sourceCounts ?? null,
              generated_at: result.generatedAt ?? null,
              brain_id: (args.brain_id as string) ?? null,
            },
          };
        }
        case "get_project_status": {
          const brains = await fetchBrains();
          const projectName = (args.project_name as string) ?? (args.brain_id as string) ?? "";
          const result = await resolveJackCommandIntent({
            transcript: `a che punto siamo con ${projectName}`,
            intent: "project_status",
            context: buildContext(brains),
            projectMention: projectName || undefined,
          });
          return {
            ok: true,
            payload: {
              project_name: result.resolvedProject?.name ?? projectName,
              resolved_brain_id: result.resolvedProject?.brainId ?? null,
              status_summary: redactSnippet(result.speech ?? result.summary ?? "", 800),
              recent_activity: (result.bullets ?? []).slice(0, 5).map((b) => redactSnippet(b, 180)),
              warnings: result.warnings ?? null,
              next_steps: result.nextSteps ?? null,
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
                kind: h.kind,
                snippet: redactSnippet(h.snippet, 200),
                category: h.category ?? null,
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
          const { supabase } = context;
          const { data: row, error } = await supabase
            .from("jack_memory_entries")
            .insert({
              user_id: userId,
              content,
              category,
              sensitivity: isSecret ? "secret" : "normal",
              status: isSecret ? "suggested" : "active",
              source: "jack_gpt",
            } as never)
            .select("id,status,sensitivity")
            .single();
          if (error) return { ok: false, error: "insert_failed" };
          return {
            ok: true,
            payload: {
              entry_id: (row as { id: string } | null)?.id ?? null,
              status: (row as { status: string } | null)?.status ?? null,
              sensitivity: (row as { sensitivity: string } | null)?.sensitivity ?? null,
              secret_warning: isSecret,
              message: isSecret
                ? "Ho rilevato un possibile segreto. L'ho salvato come suggerito, in attesa di conferma manuale."
                : "Memoria salvata.",
            },
          };
        }
        case "get_action_queue_summary": {
          const brains = await fetchBrains();
          const projectName = (args.project_name as string) ?? "";
          const result = await resolveJackCommandIntent({
            transcript: "cosa devo fare adesso",
            intent: projectName ? "project_next_actions" : "next_actions",
            context: buildContext(brains),
            projectMention: projectName || undefined,
          });
          return {
            ok: true,
            payload: {
              top_actions: (result.bullets ?? []).slice(0, 6).map((b) => redactSnippet(b, 180)),
              summary: redactSnippet(result.speech ?? result.summary ?? "", 600),
            },
          };
        }
        case "get_loop_qa_warnings": {
          const brains = await fetchBrains();
          const result = await resolveJackCommandIntent({
            transcript: "ci sono warning",
            intent: "warnings",
            context: buildContext(brains),
          });
          return {
            ok: true,
            payload: {
              warnings_summary: redactSnippet(result.speech ?? result.summary ?? "", 600),
              items: (result.bullets ?? []).slice(0, 8).map((b) => redactSnippet(b, 200)),
            },
          };
        }
        case "get_gmail_summary": {
          const brains = await fetchBrains();
          const result = await resolveJackCommandIntent({
            transcript: "riepilogo email di oggi",
            intent: "email_summary",
            context: buildContext(brains),
          });
          return {
            ok: true,
            payload: {
              summary: redactSnippet(result.speech ?? result.summary ?? "", 600),
              highlights: (result.bullets ?? []).slice(0, 6).map((b) => redactSnippet(b, 180)),
            },
          };
        }
        default:
          return { ok: false, error: "unknown_tool" };
      }
    } catch (err) {
      return { ok: false, error: "tool_failed", detail: String((err as Error).message ?? err).slice(0, 200) };
    }
  });

// Log helper (client-callable) — write a sanitized event row.
export const logJackGptEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as { event: string; metadata?: Record<string, unknown> })
  .handler(async ({ data, context }) => {
    const { event, metadata } = data;
    const safe = JSON.parse(
      JSON.stringify(metadata ?? {}).replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]"),
    );
    try {
      await context.supabase
        .from("agent_event_log" as never)
        .insert({
          user_id: context.userId,
          event_type: event,
          metadata: safe,
        } as never);
    } catch {
      // best-effort logging only
    }
    return { ok: true };
  });
