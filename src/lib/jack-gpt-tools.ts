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
import {
  prepareJackMasterSnapshotUpdate,
} from "@/lib/jack-controlled-actions.functions";
import {
  createCodeAgentJobFromBrowser,
  emitCodeAgentJackJobCreatedEvent,
  type CodeAgentEngine,
  type CodeAgentRiskLevel,
} from "@/lib/code-agent-orchestrator";
import {
  buildJackBestAvailableNextAction,
  getJackReadinessDetails,
  buildJackDailyStatusFallback,
} from "@/lib/jack-best-next-action";
import {
  normalizePreviewInput,
  buildPendingJackActionPreview,
  validatePreviewForDisplay,
  type PendingJackActionPreview,
} from "@/lib/jack-action-confirmation";
import { resolveProjectKeyAlias } from "@/lib/connector-hub";

// ---------- OpenAI tool schema (sent to Realtime session) ----------

export const JACK_GPT_TOOLS_SCHEMA = [
  {
    type: "function",
    name: "get_daily_brief",
    description:
      "Restituisce il Daily Operating Brief di oggi se presente, sempre arricchito con best_next_action e operational_status. Se il Daily Brief manca, restituisce comunque il fallback operativo (NON dire solo 'genera il Daily Brief'). Read-only.",
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
    name: "get_operational_status",
    description:
      "Stato operativo compatto: presenza Daily Brief, health status/score, best next action, top step di readiness mancanti, contatori remediation. Read-only. Da usare quando l'utente chiede 'a che punto siamo', 'fammi il punto', 'com'è messo Brain Hub'.",
    parameters: {
      type: "object",
      properties: {
        brain_id: { type: "string" },
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
    description:
      "Riepilogo Action Queue + best next action (readiness, daily brief, remediation). Restituisce anche top_missing_readiness_steps quando il loop è bloccato. Read-only.",
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
    name: "get_readiness_details",
    description:
      "Dettagli readiness del loop: status, step mancanti, primi 3 step prioritari con label/area/perché conta/come correggere e CTA. Read-only.",
    parameters: {
      type: "object",
      properties: { brain_id: { type: "string" } },
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
  {
    type: "function",
    name: "preview_controlled_action",
    description:
      "Prepara una PREVIEW di una action suggerita SENZA crearla. Sempre safe: se mancano title/description/reason il tool li ricostruisce da readiness/best-next-action; non lancia mai tool_failed per campi mancanti. Usalo PRIMA di create_controlled_action per mostrare a Federico cosa proponi. Restituisce title, description, reason, risk_level, source e idempotency_key. NON scrive nulla nel database.",
    parameters: {
      type: "object",
      properties: {
        command_text: { type: "string", description: "Testo del comando vocale di Federico (opzionale)." },
        brain_id: { type: "string" },
        project_id: { type: "string" },
        source: { type: "string", description: "Origine logica della proposta (es. jack_readiness_unblock, jack_voice_controlled)." },
        title: { type: "string" },
        description: { type: "string" },
        reason: { type: "string" },
        risk_level: { type: "string", enum: ["low", "medium", "high"] },
        source_warning_id: { type: "string" },
        readiness_step_id: { type: "string" },
        notes: { type: "string" },
      },
      required: [],
    },
  },
  // v3.19.6 — create_controlled_action REMOVED from model-facing tool list.
  // Writes happen ONLY via UI button or deterministic voice router after
  // explicit user confirmation. The model can only call preview tools.

  {
    type: "function",
    name: "prepare_master_snapshot_update",
    description:
      "Prepara una BOZZA di aggiornamento del Master Snapshot leggendo l'ultimo Daily Brief e l'attività recente. Non promuove mai a 'current', non approva nulla. Restituisce id bozza e CTA verso /master-snapshot.",
    parameters: {
      type: "object",
      properties: {
        brain_id: { type: "string" },
        reason: { type: "string" },
        summary: { type: "string", description: "Riepilogo libero di cosa è cambiato oggi." },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "create_code_agent_job",
    description:
      "Trasforma un comando di Federico riguardante codice ('correggi questo bug con Codex', 'fai una review con Claude Code', 'fai una PR', 'esegui typecheck', 'fai tutto da solo') in un Code Agent Job controllato. NON esegue codice, NON chiama Codex/Claude API, NON fa commit/push/PR. Classifica job_type, sceglie engine, stima rischio, prepara prompt e richiede approvazione se serve.",
    parameters: {
      type: "object",
      properties: {
        command_text: { type: "string" },
        preferred_engine: {
          type: "string",
          enum: [
            "codex_cloud",
            "codex_cli",
            "codex_github_action",
            "claude_code_cli",
            "claude_code_github_action",
            "manual_developer",
            "lovable",
            "custom",
          ],
        },
        repository_hint: { type: "string" },
        risk_hint: { type: "string", enum: ["low", "medium", "high"] },
        project_id: { type: "string" },
        brain_id: { type: "string" },
      },
      required: ["command_text"],
    },
  },
  {
    type: "function",
    name: "get_project_state",
    description:
      "Stato sintetico di un singolo progetto (Project State Snapshot): stato attuale, ultima cosa completata, prossima azione, blockers, priorità, freshness. Read-only.",
    parameters: {
      type: "object",
      properties: { project_key: { type: "string" } },
      required: ["project_key"],
    },
  },
  {
    type: "function",
    name: "get_all_project_states",
    description:
      "Elenco compatto di tutti i Project State Snapshot dell'utente con stato, priorità, freshness e prossima azione. Read-only.",
    parameters: {
      type: "object",
      properties: { brain_id: { type: "string" } },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_project_next_action",
    description:
      "Prossima azione definita per un progetto (Project State). Read-only.",
    parameters: {
      type: "object",
      properties: { project_key: { type: "string" } },
      required: ["project_key"],
    },
  },
  {
    type: "function",
    name: "get_multi_project_overview",
    description:
      "Overview multi-progetto: totali, attivi, alta priorità, da aggiornare, parcheggiati, e progetto consigliato come prossimo focus. Read-only.",
    parameters: {
      type: "object",
      properties: { brain_id: { type: "string" } },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_connector_hub_summary",
    description:
      "Riepilogo connettori (Drive, Gmail, Calendar, GitHub, Supabase, Obsidian, Telegram, n8n, Lovable manual): totali, connessi, read-only, warning, errori, manuali, fonti mappate, progetti collegati. Read-only.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "get_project_connectors",
    description:
      "Connettori e fonti mappate per un progetto. Accetta project_key canonico (es. 'brain_hub'), project_name ('Brain Hub') o query libera ('Brian Hub', 'progetto Furia'). Risolve via alias e snapshot. Read-only.",
    parameters: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        project_name: { type: "string" },
        query: { type: "string" },
        brain_id: { type: "string" },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_connector_warnings",
    description:
      "Connettori con warning, errori o non configurati. Risponde a 'Quali connettori hanno problemi?'. Read-only.",
    parameters: { type: "object", properties: {}, required: [] },
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

// v3.19.4 — read-only tools (used to log read-tool dedup separately).
const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "get_daily_brief",
  "get_operational_status",
  "get_action_queue_summary",
  "get_readiness_details",
  "get_loop_qa_warnings",
  "get_gmail_summary",
  "get_project_status",
  "get_memory_context",
  "search_jack_memory",
  "get_project_state",
  "get_all_project_states",
  "get_project_next_action",
  "get_multi_project_overview",
  "get_connector_hub_summary",
  "get_project_connectors",
  "get_connector_warnings",
]);

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

// ---------- Duplicate tool-call guard ----------
// Some GPT runs emit the same tool_call twice in the same turn.
// Memoize identical (user + tool + args) results for a short TTL
// to prevent duplicate Supabase reads and duplicate event logs.
type CachedResult = { at: number; result: unknown };
const TOOL_CALL_DEDUP_TTL_MS = 3000;
const toolCallCache = new Map<string, CachedResult>();

function dedupKey(userId: string, toolName: string, args: Record<string, unknown>): string {
  return `${userId}::${toolName}::${JSON.stringify(args)}`;
}

function readDedupedCall(key: string): unknown | null {
  const hit = toolCallCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TOOL_CALL_DEDUP_TTL_MS) {
    toolCallCache.delete(key);
    return null;
  }
  return hit.result;
}

function writeDedupedCall(key: string, result: unknown) {
  toolCallCache.set(key, { at: Date.now(), result });
  // Light eviction
  if (toolCallCache.size > 200) {
    const cutoff = Date.now() - TOOL_CALL_DEDUP_TTL_MS;
    for (const [k, v] of toolCallCache) {
      if (v.at < cutoff) toolCallCache.delete(k);
    }
  }
}

// v3.19.5 — in-flight dedup. If an identical (user + tool + args) call is
// already executing, the second caller joins the same Promise instead of
// running compute() again. Applied to read tools and preview_controlled_action.
const JOINABLE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "get_daily_brief",
  "get_operational_status",
  "get_action_queue_summary",
  "get_readiness_details",
  "get_loop_qa_warnings",
  "get_gmail_summary",
  "get_memory_context",
  "preview_controlled_action",
  "get_project_state",
  "get_all_project_states",
  "get_project_next_action",
  "get_multi_project_overview",
  "get_connector_hub_summary",
  "get_project_connectors",
  "get_connector_warnings",
]);
type InFlightResult = { ok: boolean; [k: string]: unknown };
const inFlightToolCalls = new Map<string, Promise<InFlightResult>>();

async function logSanitizedEvent(
  supabaseClient: unknown,
  userId: string,
  event: string,
  metadata: Record<string, unknown>,
) {
  try {
    await (supabaseClient as {
      from: (t: string) => {
        insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
      };
    })
      .from("agent_event_log")
      .insert({ user_id: userId, event_type: event, metadata });
  } catch {
    // best-effort
  }
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
      // v3.19.6 — hard lock: the model must never invoke write tools.
      if (tool_name === "create_controlled_action") {
        void logSanitizedEvent(supabase, userId, "jack_model_write_tool_call_blocked", {
          tool_name,
          brain_id: (args.brain_id as string | undefined) ?? null,
          reason: "write_tool_not_available_to_model",
        });
        return {
          ok: false,
          blocked: true,
          reason: "write_tool_not_available_to_model",
          message:
            "Posso preparare la proposta, ma la creazione richiede conferma UI o router deterministico.",
        };
      }
      return { ok: false, error: "tool_rejected", detail: "unknown_or_disallowed_tool" };
    }

    const cacheKey = dedupKey(userId, tool_name, args);
    const cached = readDedupedCall(cacheKey);
    if (cached !== null) {
      const isReadTool = READ_ONLY_TOOL_NAMES.has(tool_name);
      void logSanitizedEvent(
        supabase,
        userId,
        isReadTool
          ? "jack_read_tool_duplicate_prevented"
          : "jack_duplicate_tool_call_prevented",
        {
          tool_name,
          brain_id: (args.brain_id as string | undefined) ?? null,
        },
      );
      return cached;
    }


    type ToolReturn = { ok: boolean; [k: string]: unknown };
    const compute = async (): Promise<ToolReturn> => {
      switch (tool_name) {

        case "get_daily_brief": {
          const brainId = (args.brain_id as string | undefined) ?? null;
          const fb = await buildJackDailyStatusFallback(brainId);
          void logSanitizedEvent(supabase, userId, "jack_daily_status_fallback_used", {
            brain_id: brainId,
            has_daily_brief: fb.has_daily_brief,
            fallback_used: fb.fallback_used,
            source: fb.best_next_action?.source ?? null,
            tool_name: "get_daily_brief",
          });
          if (!fb.has_daily_brief) {
            void logSanitizedEvent(supabase, userId, "jack_daily_brief_missing", {
              brain_id: brainId,
              tool_name: "get_daily_brief",
            });
            void logSanitizedEvent(
              supabase,
              userId,
              "jack_operational_status_used_without_daily_brief",
              {
                brain_id: brainId,
                source: fb.best_next_action?.source ?? null,
                status: fb.operational_status ?? null,
              },
            );
          }
          return {
            ok: true,
            payload: {
              has_daily_brief: fb.has_daily_brief,
              fallback_available: true,
              fallback_used: fb.fallback_used,
              summary: redactSnippet(fb.speech, 900),
              daily_brief_summary: fb.daily_brief_summary
                ? redactSnippet(fb.daily_brief_summary, 700)
                : null,
              operational_status: fb.operational_status ?? null,
              operational_score: fb.operational_score ?? null,
              best_next_action: fb.best_next_action
                ? {
                    source: fb.best_next_action.source,
                    title: fb.best_next_action.title,
                    reason: fb.best_next_action.reason,
                    cta_label: fb.best_next_action.cta_label,
                    cta_href: fb.best_next_action.cta_href,
                  }
                : null,
              readiness_details: fb.readiness_details
                ? {
                    status: fb.readiness_details.status,
                    missing_count: fb.readiness_details.missing_count,
                    top_missing_steps: fb.readiness_details.top_missing_steps.map((s) => ({
                      id: s.id,
                      label: s.label,
                      why_it_matters: s.why_it_matters,
                      suggested_fix: s.suggested_fix,
                    })),
                  }
                : null,
              remediation_summary: fb.remediation_summary ?? null,
              brain_id: brainId,
            },
          };
        }
        case "get_operational_status": {
          const brainId = (args.brain_id as string | undefined) ?? null;
          const fb = await buildJackDailyStatusFallback(brainId);
          void logSanitizedEvent(supabase, userId, "jack_daily_status_fallback_used", {
            brain_id: brainId,
            has_daily_brief: fb.has_daily_brief,
            fallback_used: fb.fallback_used,
            source: fb.best_next_action?.source ?? null,
            tool_name: "get_operational_status",
          });
          return {
            ok: true,
            payload: {
              has_daily_brief: fb.has_daily_brief,
              summary: redactSnippet(fb.speech, 900),
              operational_status: fb.operational_status ?? null,
              operational_score: fb.operational_score ?? null,
              best_next_action: fb.best_next_action
                ? {
                    source: fb.best_next_action.source,
                    title: fb.best_next_action.title,
                    reason: fb.best_next_action.reason,
                    cta_label: fb.best_next_action.cta_label,
                    cta_href: fb.best_next_action.cta_href,
                  }
                : null,
              top_missing_readiness_steps:
                fb.readiness_details?.top_missing_steps.map((s) => ({
                  id: s.id,
                  label: s.label,
                  severity: s.severity,
                  why_it_matters: s.why_it_matters,
                  suggested_fix: s.suggested_fix,
                })) ?? [],
              remediation_summary: fb.remediation_summary ?? null,
              brain_id: brainId,
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
          const brainArg = (args.brain_id as string | undefined) ?? null;
          const scopeArg = (args.scope as "global" | "brain" | undefined) ?? (brainArg ? "brain" : "global");
          const upsert = await upsertJackMemoryEntryFromTool(supabase as never, {
            userId,
            content,
            category: (args.category as string | undefined) ?? "preference",
            brainId: scopeArg === "brain" ? brainArg : null,
            scope: scopeArg,
            projectName: (args.project_name as string | undefined) ?? null,
            source: "jack_gpt",
          });
          const verify = await verifyJackMemoryPersistence(supabase as never, {
            userId,
            memoryId: upsert.entryId,
            brainId: scopeArg === "brain" ? brainArg : null,
          });
          return {
            ok: upsert.persisted,
            payload: {
              entry_id: upsert.entryId,
              status: upsert.status,
              sensitivity: upsert.sensitivity,
              scope: upsert.scope,
              brain_id: upsert.brainId,
              persisted: upsert.persisted,
              deduped: upsert.deduped,
              included_in_context: verify.includedInContext,
              active_memory_count: verify.activeMemoryCount,
              global_memory_count: verify.globalMemoryCount,
              brain_memory_count: verify.brainMemoryCount,
              secret_warning: upsert.secretWarning,
              reason: upsert.reason ?? verify.reason ?? null,
              message: upsert.secretWarning
                ? "Possibile segreto rilevato: salvato come 'suggerito', in attesa di conferma manuale."
                : upsert.persisted
                  ? (upsert.deduped ? "Memoria aggiornata (deduplicata)." : "Memoria salvata.")
                  : "Non sono riuscito a salvare la memoria.",
            },
          };
        }
        case "get_action_queue_summary": {
          const brainId = (args.brain_id as string | undefined) ?? null;
          const ctx = await fetchBrainsCtx(supabase as never);
          ctx.brainId = brainId;
          const [result, best, readiness] = await Promise.all([
            resolveJackCommandIntent({
              transcript: "cosa devo fare adesso",
              context: ctx,
            }),
            buildJackBestAvailableNextAction(brainId).catch(() => null),
            getJackReadinessDetails(brainId).catch(() => null),
          ]);
          return {
            ok: true,
            payload: {
              summary: redactSnippet(result.response_text, 700),
              source: result.source,
              best_next_action: best
                ? {
                    source: best.source,
                    title: best.title,
                    reason: best.reason,
                    cta_label: best.cta_label,
                    cta_href: best.cta_href,
                    can_create_action: best.can_create_action,
                    requires_confirmation: best.requires_confirmation,
                    action_queue_open_count:
                      best.meta.action_queue_open_count,
                  }
                : null,
              readiness_details: readiness
                ? {
                    status: readiness.status,
                    missing_count: readiness.missing_count,
                  }
                : null,
              top_missing_readiness_steps:
                readiness?.top_missing_steps.map((s) => ({
                  id: s.id,
                  label: s.label,
                  area: s.area,
                  severity: s.severity,
                  why_it_matters: s.why_it_matters,
                  suggested_fix: s.suggested_fix,
                  cta_label: s.cta_label,
                  cta_href: s.cta_href,
                })) ?? [],
            },
          };
        }
        case "get_readiness_details": {
          const brainId = (args.brain_id as string | undefined) ?? null;
          void logSanitizedEvent(supabase, userId, "jack_readiness_details_requested", {
            brain_id: brainId,
            source: "tool",
          });
          const details = await getJackReadinessDetails(brainId);
          void logSanitizedEvent(supabase, userId, "jack_readiness_details_returned", {
            brain_id: brainId,
            status: details.status,
            missing_count: details.missing_count,
            top_steps_count: details.top_missing_steps.length,
          });
          if (details.missing_count > 0 && details.top_missing_steps.length === 0) {
            void logSanitizedEvent(supabase, userId, "jack_readiness_details_missing", {
              brain_id: brainId,
              missing_count: details.missing_count,
            });
          }
          return {
            ok: true,
            payload: {
              status: details.status,
              missing_count: details.missing_count,
              top_missing_steps: details.top_missing_steps.map((s) => ({
                id: s.id,
                label: s.label,
                area: s.area,
                severity: s.severity,
                why_it_matters: s.why_it_matters,
                suggested_fix: s.suggested_fix,
                cta_label: s.cta_label,
                cta_href: s.cta_href,
              })),
              cta: { label: "Apri Loop QA", to: "/loop-qa" },
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
        case "preview_controlled_action": {
          // v3.19.5 — robust preview. Safe-parse args, never throw on
          // missing fields: reconstruct title/description/reason from
          // best-next-action / readiness / static fallback.
          const normalized = normalizePreviewInput(args);
          void logSanitizedEvent(supabase, userId, "jack_preview_tool_args_normalized", {
            brain_id: normalized.brain_id,
            source: normalized.source,
            tool_name: "preview_controlled_action",
            had_title: normalized.title !== null,
            had_description: normalized.description !== null,
            had_reason: normalized.reason !== null,
            has_command_text: normalized.command_text !== null,
          });

          // Fetch supporting context only if we need to fill gaps.
          const needsFallback =
            !normalized.title || !normalized.description || !normalized.reason;
          const [best, readiness] = needsFallback
            ? await Promise.all([
                buildJackBestAvailableNextAction(normalized.brain_id).catch(() => null),
                getJackReadinessDetails(normalized.brain_id).catch(() => null),
              ])
            : [null, null];

          const built = buildPendingJackActionPreview(normalized, {
            userId,
            bestNextAction: best
              ? {
                  source: best.source,
                  title: best.title,
                  reason: best.reason,
                  description: best.description,
                  cta_label: best.cta_label,
                  cta_href: best.cta_href,
                }
              : null,
            readinessTopStep: readiness?.top_missing_steps[0] ?? null,
          });

          if (!built.ok) {
            void logSanitizedEvent(supabase, userId, "jack_action_preview_failed", {
              brain_id: normalized.brain_id,
              source: normalized.source,
              tool_name: "preview_controlled_action",
              reason: built.reason,
              missing_fields_count: built.required_fields.length,
            });
            return {
              ok: false,
              blocked: true,
              reason: built.reason,
              message: built.message,
              required_fields: built.required_fields,
              fallback_cta: built.fallback_cta,
            };
          }

          const preview: PendingJackActionPreview = built.preview;
          const valid = validatePreviewForDisplay(preview);
          if (!valid) {
            void logSanitizedEvent(supabase, userId, "jack_action_preview_failed", {
              brain_id: normalized.brain_id,
              source: normalized.source,
              tool_name: "preview_controlled_action",
              reason: "invalid_preview_for_display",
              missing_fields_count: 0,
            });
            return {
              ok: false,
              blocked: true,
              reason: "preview_data_missing",
              message: "Preview generata ma incompleta per la lettura vocale.",
              required_fields: ["title", "reason"],
              fallback_cta: "/action-queue",
            };
          }

          void logSanitizedEvent(supabase, userId, "jack_action_preview_built", {
            brain_id: normalized.brain_id,
            source: normalized.source,
            risk_level: preview.risk_level,
            reason: built.missing_fields.length > 0 ? "filled_from_fallback" : "from_input",
            idempotency_key_preview: preview.idempotency_key.slice(0, 32),
            missing_fields_count: built.missing_fields.length,
            tool_name: "preview_controlled_action",
          });
          return {
            ok: true,
            payload: {
              preview,
              requires_confirmation: true,
              idempotency_key: preview.idempotency_key,
              missing_fields_filled: built.missing_fields,
              // v3.19.6 — write tool is NOT exposed to the model.
              confirmation_methods: ["ui_button", "explicit_voice_confirmation"],
              safe_message:
                "Preview generata. La creazione richiede conferma esplicita: clic sul pulsante UI 'Conferma creazione action' oppure conferma vocale chiara ('sì confermo', 'creala'). Il modello non può creare la action.",
            },
          };
        }

        case "prepare_master_snapshot_update": {
          const res = await prepareJackMasterSnapshotUpdate({
            data: {
              brain_id: (args.brain_id as string | undefined) ?? null,
              reason: (args.reason as string | undefined) ?? null,
              summary: (args.summary as string | undefined) ?? null,
            },
          });
          return { ok: res.ok, payload: res };
        }
        case "create_code_agent_job": {
          const commandText = String(args.command_text ?? "").trim();
          if (!commandText) return { ok: false, error: "code_agent_jack_command_empty" };
          // v3.15.6: route through the unified browser helper inside the
          // server-runtime context so audit + typed errors stay consistent
          // with createCodeAgentJobFromJackCommandFn. Dynamic import keeps
          // the `.server.ts` runtime out of the client bundle.
          const { serverRuntime } = await import("@/lib/code-agent-server-runtime.server");
          const sbCtx = context.supabase as unknown as { from: (t: string) => unknown };
          const res = await serverRuntime.runWithCtx(
            { supabase: sbCtx, userId },
            async () =>
              createCodeAgentJobFromBrowser({
                command_text: commandText,
                preferred_engine: (args.preferred_engine as CodeAgentEngine | undefined) ?? null,
                repository_hint: (args.repository_hint as string | undefined) ?? null,
                risk_hint: (args.risk_hint as CodeAgentRiskLevel | undefined) ?? null,
                project_id: (args.project_id as string | undefined) ?? null,
                brain_id: (args.brain_id as string | undefined) ?? null,
                repository_id: (args.repository_id as string | undefined) ?? null,
                source: "jack_gpt",
              }),
          );
          if (res.job_id) {
            await serverRuntime.runWithCtx({ supabase: sbCtx, userId }, async () =>
              emitCodeAgentJackJobCreatedEvent(res.job_id as string, {
                brain_id: (args.brain_id as string | undefined) ?? null,
                project_id: !!args.project_id,
                repository_id: !!res.repository_id,
                engine: res.recommended_engine,
                risk_level: res.risk_level,
                source: "jack_gpt",
                intent: (args.intent as string | undefined) ?? null,
                has_repository_hint: !!args.repository_hint,
                has_transcript_preview: false,
                status: res.status,
                approval_status: res.approval_status,
              }),
            );
          }
          return {
            ok: res.ok,
            payload: {
              job_id: res.job_id,
              job_type: res.job_type,
              recommended_engine: res.recommended_engine,
              selected_engine: res.selected_engine,
              risk_level: res.risk_level,
              requires_approval: res.requires_approval,
              status: res.status,
              approval_status: res.approval_status,
              repository_id: res.repository_id,
              repository_resolution: {
                status: res.repository_resolution.status,
                candidates: res.repository_resolution.candidates.length,
                reason: res.repository_resolution.reason,
              },
              telegram_approval_id: res.telegram_approval_id,
              next_step: res.next_step,
              safe_message: res.safe_message,
              unsafe_request: res.unsafe_request,
            },
          };
        }

        case "get_project_state": {
          const projectKey = String(args.project_key ?? "").trim();
          if (!projectKey) return { ok: false, error: "missing_project_key" };
          const { data: row } = await (supabase as never as {
            from: (t: string) => {
              select: (c: string) => {
                eq: (c: string, v: string) => {
                  maybeSingle: () => Promise<{ data: unknown }>;
                };
              };
            };
          })
            .from("project_state_snapshots")
            .select("project_key,project_name,status,priority,current_state,last_completed,next_action,blockers,freshness_status,last_state_update_at")
            .eq("project_key", projectKey)
            .maybeSingle();
          void logSanitizedEvent(supabase, userId, "jack_project_state_requested", {
            project_key: projectKey,
            found: !!row,
          });
          if (!row) return { ok: true, payload: { found: false, project_key: projectKey } };
          const r = row as Record<string, unknown>;
          return {
            ok: true,
            payload: {
              found: true,
              project_key: r.project_key,
              project_name: r.project_name,
              status: r.status,
              priority: r.priority,
              freshness: r.freshness_status,
              current_state: redactSnippet(String(r.current_state ?? ""), 600),
              last_completed: r.last_completed ?? null,
              next_action: r.next_action ?? null,
              blockers: Array.isArray(r.blockers) ? (r.blockers as string[]).slice(0, 8) : [],
              last_state_update_at: r.last_state_update_at ?? null,
            },
          };
        }

        case "get_project_next_action": {
          const projectKey = String(args.project_key ?? "").trim();
          if (!projectKey) return { ok: false, error: "missing_project_key" };
          const { data: row } = await (supabase as never as {
            from: (t: string) => {
              select: (c: string) => {
                eq: (c: string, v: string) => {
                  maybeSingle: () => Promise<{ data: unknown }>;
                };
              };
            };
          })
            .from("project_state_snapshots")
            .select("project_key,project_name,next_action,freshness_status")
            .eq("project_key", projectKey)
            .maybeSingle();
          if (!row) return { ok: true, payload: { found: false, project_key: projectKey } };
          const r = row as Record<string, unknown>;
          return {
            ok: true,
            payload: {
              found: true,
              project_key: r.project_key,
              project_name: r.project_name,
              next_action: r.next_action ?? null,
              freshness: r.freshness_status,
            },
          };
        }

        case "get_all_project_states":
        case "get_multi_project_overview": {
          const { data: rowsData } = await (supabase as never as {
            from: (t: string) => {
              select: (c: string) => {
                order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown }>;
              };
            };
          })
            .from("project_state_snapshots")
            .select("project_key,project_name,status,priority,current_state,last_completed,next_action,blockers,freshness_status,last_state_update_at")
            .order("updated_at", { ascending: false });
          const rows = (rowsData ?? []) as Array<Record<string, unknown>>;
          const priorityOrder: Record<string, number> = { very_high: 0, high: 1, medium: 2, low: 3 };
          const sorted = [...rows].sort(
            (a, b) =>
              (priorityOrder[String(a.priority)] ?? 9) -
              (priorityOrder[String(b.priority)] ?? 9),
          );
          const projects = sorted.map((r) => ({
            project_key: r.project_key,
            project_name: r.project_name,
            status: r.status,
            priority: r.priority,
            freshness: r.freshness_status,
            next_action: r.next_action ?? null,
            last_completed: r.last_completed ?? null,
            blockers_count: Array.isArray(r.blockers) ? (r.blockers as unknown[]).length : 0,
          }));
          const active = projects.filter((p) => p.status === "active").length;
          const highPriority = projects.filter((p) => p.priority === "very_high" || p.priority === "high").length;
          const needsUpdate = projects.filter(
            (p) => p.freshness === "stale" || p.freshness === "old" || p.freshness === "unknown",
          ).length;
          const parked = projects.filter((p) => p.status === "parked").length;
          const blocked = projects.filter((p) => p.status === "blocked" || p.blockers_count > 0).length;
          const candidate =
            projects.find((p) => p.status === "active" && (p.priority === "very_high" || p.priority === "high") && p.next_action) ??
            projects.find((p) => p.status === "active" && p.next_action) ??
            null;
          void logSanitizedEvent(supabase, userId, "jack_multi_project_overview_requested", {
            tool_name,
            total: projects.length,
            active,
            high_priority: highPriority,
            needs_update: needsUpdate,
          });
          return {
            ok: true,
            payload: {
              total: projects.length,
              active,
              high_priority: highPriority,
              needs_update: needsUpdate,
              parked,
              blocked,
              recommended_next: candidate
                ? {
                    project_key: candidate.project_key,
                    project_name: candidate.project_name,
                    next_action: candidate.next_action,
                  }
                : null,
              projects,
            },
          };
        }


        case "get_connector_hub_summary": {
          const sb = supabase as never as {
            from: (t: string) => {
              select: (c: string) => Promise<{ data: unknown }>;
            };
          };
          const regRes = await sb.from("connector_registry").select("*");
          const mapRes = await sb.from("project_source_mappings").select("project_key");
          const registry = (regRes.data ?? []) as Array<Record<string, unknown>>;
          const mappings = (mapRes.data ?? []) as Array<Record<string, unknown>>;
          const projects = new Set(mappings.map((m) => String(m.project_key)));
          let lastSync: string | null = null;
          for (const r of registry) {
            const ls = (r.last_sync_at as string | null) ?? null;
            if (ls && (!lastSync || ls > lastSync)) lastSync = ls;
          }
          const payload = {
            total: registry.length,
            connected: registry.filter((r) => r.status === "connected").length,
            read_only: registry.filter((r) => r.status === "read_only").length,
            warnings: registry.filter((r) => r.status === "warning").length,
            errors: registry.filter((r) => r.status === "error").length,
            not_configured: registry.filter((r) => r.status === "not_configured").length,
            manual: registry.filter((r) => r.status === "manual").length,
            mappings_total: mappings.length,
            projects_with_mappings: projects.size,
            last_sync_at: lastSync,
            connectors: registry.map((r) => ({
              connector_key: r.connector_key,
              connector_name: r.connector_name,
              status: r.status,
              permission_level: r.permission_level,
              last_sync_at: r.last_sync_at ?? null,
            })),
          };
          void logSanitizedEvent(supabase, userId, "jack_connector_summary_requested", {
            total: payload.total,
            warnings: payload.warnings + payload.errors,
          });
          return { ok: true, payload };
        }

        case "get_project_connectors": {
          const projectKey = String(args.project_key ?? "").trim();
          if (!projectKey) return { ok: false, error: "missing_project_key" };
          const sb = supabase as never as {
            from: (t: string) => {
              select: (c: string) => {
                eq: (c: string, v: string) => Promise<{ data: unknown }>;
              };
            };
          };
          const sb2 = supabase as never as {
            from: (t: string) => {
              select: (c: string) => Promise<{ data: unknown }>;
            };
          };
          const mapRes = await sb
            .from("project_source_mappings")
            .select("connector_key,source_type,source_label,source_ref,sync_status,last_seen_at")
            .eq("project_key", projectKey);
          const regRes = await sb2
            .from("connector_registry")
            .select("connector_key,connector_name,status,permission_level");
          const mappings = (mapRes.data ?? []) as Array<Record<string, unknown>>;
          const registry = (regRes.data ?? []) as Array<Record<string, unknown>>;
          const regByKey = new Map(registry.map((r) => [String(r.connector_key), r]));
          const grouped = new Map<string, number>();
          for (const m of mappings) {
            const k = String(m.connector_key);
            grouped.set(k, (grouped.get(k) ?? 0) + 1);
          }
          const connectors = Array.from(grouped.entries()).map(([k, count]) => {
            const r = regByKey.get(k);
            return {
              connector_key: k,
              connector_name: r?.connector_name ?? k,
              status: r?.status ?? "unknown",
              sources: count,
            };
          });
          void logSanitizedEvent(supabase, userId, "jack_project_connectors_requested", {
            project_key: projectKey,
            sources: mappings.length,
            connectors: connectors.length,
          });
          return {
            ok: true,
            payload: {
              project_key: projectKey,
              connectors,
              sources: mappings.map((m) => ({
                connector_key: m.connector_key,
                source_type: m.source_type,
                source_label: m.source_label,
                source_ref: m.source_ref ?? null,
                sync_status: m.sync_status ?? "not_synced",
              })),
            },
          };
        }

        case "get_connector_warnings": {
          const sb = supabase as never as {
            from: (t: string) => {
              select: (c: string) => Promise<{ data: unknown }>;
            };
          };
          const regRes = await sb
            .from("connector_registry")
            .select("connector_key,connector_name,status,last_error");
          const registry = (regRes.data ?? []) as Array<Record<string, unknown>>;
          const warnings = registry
            .filter((r) => r.status === "warning" || r.status === "error" || r.status === "not_configured")
            .map((r) => ({
              connector_key: r.connector_key,
              connector_name: r.connector_name,
              level:
                r.status === "error"
                  ? "error"
                  : r.status === "warning"
                  ? "warning"
                  : "info",
              message:
                (r.last_error as string | null) ??
                (r.status === "not_configured" ? "Non ancora configurato" : "Verifica connettore"),
            }));
          void logSanitizedEvent(supabase, userId, "jack_connector_warnings_requested", {
            warning_count: warnings.length,
          });
          return { ok: true, payload: { warnings, total: warnings.length } };
        }

        default:
          return { ok: false, error: "unknown_tool" };
      }
    };

    const runCompute = async (): Promise<ToolReturn> => {
      try {
        const result = await compute();
        writeDedupedCall(cacheKey, result);
        return result;
      } catch (err) {
        // v3.19.5 — never bubble unhandled errors as tool_failed when we
        // can return a structured, recoverable error.
        return {
          ok: false,
          blocked: true,
          error: "tool_failed",
          reason: "tool_internal_error",
          detail: String((err as Error).message ?? err).slice(0, 200),
        };
      }
    };

    // v3.19.5 — in-flight join. If an identical call is already running,
    // both callers await the same Promise (no double DB hit, no double log).
    if (JOINABLE_TOOL_NAMES.has(tool_name)) {
      const existing = inFlightToolCalls.get(cacheKey) as
        | Promise<ToolReturn>
        | undefined;
      if (existing) {
        void logSanitizedEvent(supabase, userId, "jack_inflight_tool_call_joined", {
          tool_name,
          brain_id: (args.brain_id as string | undefined) ?? null,
        });
        return await existing;
      }
      const p: Promise<ToolReturn> = runCompute().finally(() => {
        inFlightToolCalls.delete(cacheKey);
      });
      inFlightToolCalls.set(cacheKey, p);
      return await p;
    }

    return await runCompute();
  });

// Log helper — sanitized event row.
export const logJackGptEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const obj = (d && typeof d === "object" ? (d as Record<string, unknown>) : {}) as {
      event?: unknown;
      metadata?: unknown;
    };
    const event =
      typeof obj.event === "string" && obj.event.length > 0 ? obj.event : "jack_gpt_event_unknown";
    const metadata =
      obj.metadata && typeof obj.metadata === "object" && !Array.isArray(obj.metadata)
        ? (obj.metadata as Record<string, unknown>)
        : {};
    return { event, metadata };
  })
  .handler(async ({ data, context }) => {
    try {
      let safe: Record<string, unknown> = {};
      try {
        safe = JSON.parse(
          JSON.stringify(data.metadata).replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]"),
        );
      } catch {
        safe = { _serialize_error: true };
      }
      await (context.supabase as never as {
        from: (t: string) => {
          insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      })
        .from("app_logs")
        .insert({
          user_id: context.userId,
          entity_type: "jack_gpt",
          action: data.event,
          message: data.event,
          severity: "info",
          metadata: safe,
        });
    } catch {
      // best-effort
    }
    return { ok: true };
  });
