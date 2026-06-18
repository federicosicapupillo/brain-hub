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
  createControlledJackAction,
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
      "Prepara una PREVIEW di una action suggerita SENZA crearla. Sempre safe. Usalo PRIMA di create_controlled_action per mostrare a Federico cosa proponi. Restituisce title, description, reason, risk_level e idempotency_key. NON scrive nulla nel database.",
    parameters: {
      type: "object",
      properties: {
        command_text: { type: "string", description: "Testo del comando vocale di Federico." },
        brain_id: { type: "string" },
        project_id: { type: "string" },
        source_warning_id: { type: "string" },
        notes: { type: "string" },
      },
      required: ["command_text"],
    },
  },
  {
    type: "function",
    name: "create_controlled_action",
    description:
      "Crea una action suggerita controllata SOLO DOPO conferma esplicita di Federico (es. 'sì, confermo', 'creala', 'procedi'). Richiede confirmed:true e idempotency_key ricevuta da preview_controlled_action. Se chiamata senza conferma esplicita viene bloccata server-side. NON esegue mai operazioni esterne.",
    parameters: {
      type: "object",
      properties: {
        command_text: { type: "string", description: "Testo del comando vocale di Federico." },
        brain_id: { type: "string" },
        project_id: { type: "string" },
        delivery_preference: { type: "string", enum: ["telegram", "ui_only"] },
        notes: { type: "string" },
        confirmed: {
          type: "boolean",
          description: "DEVE essere true. Settarlo a true SOLO dopo conferma verbale esplicita di Federico (es. 'sì confermo', 'creala', 'procedi'). Frasi ambigue come 'ok', 'va bene', 'preparamela', 'dimmi' NON sono conferme valide.",
        },
        idempotency_key: {
          type: "string",
          description: "Idempotency key ricevuta da preview_controlled_action. Garantisce che la stessa proposta non venga creata due volte.",
        },
        source_warning_id: { type: "string" },
      },
      required: ["command_text", "confirmed"],
    },
  },
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
      return { ok: false, error: "tool_rejected", detail: "unknown_or_disallowed_tool" };
    }

    const cacheKey = dedupKey(userId, tool_name, args);
    const cached = readDedupedCall(cacheKey);
    if (cached !== null) {
      void logSanitizedEvent(supabase, userId, "jack_duplicate_tool_call_prevented", {
        tool_name,
        brain_id: (args.brain_id as string | undefined) ?? null,
      });
      return cached;
    }


    type ToolReturn = { ok: boolean; [k: string]: unknown };
    const compute = async (): Promise<ToolReturn> => {
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
          const commandText = String(args.command_text ?? "").trim();
          if (!commandText) return { ok: false, error: "empty_command_text" };
          const res = await createControlledJackAction({
            data: {
              command_text: commandText,
              brain_id: (args.brain_id as string | undefined) ?? null,
              project_id: (args.project_id as string | undefined) ?? null,
              notes: (args.notes as string | undefined) ?? null,
              source_warning_id: (args.source_warning_id as string | undefined) ?? null,
              confirmed: false,
            },
          });
          return {
            ok: true,
            payload: {
              preview: res.preview,
              requires_confirmation: true,
              idempotency_key: res.idempotency_key,
              safe_message:
                "Preview generata. Chiedi conferma esplicita a Federico prima di chiamare create_controlled_action.",
            },
          };
        }
        case "create_controlled_action": {
          const commandText = String(args.command_text ?? "").trim();
          if (!commandText) return { ok: false, error: "empty_command_text" };

          // v3.19.3 — server-side confirmation gate (never trust the model).
          const confirmed = args.confirmed === true;
          if (!confirmed) {
            void logSanitizedEvent(
              supabase,
              userId,
              "jack_action_creation_blocked_missing_confirmation",
              {
                tool_name: "create_controlled_action",
                brain_id: (args.brain_id as string | undefined) ?? null,
                reason: "confirmation_required",
                source: "tool_dispatcher",
              },
            );
            return {
              ok: false,
              blocked: true,
              reason: "confirmation_required",
              error: "confirmation_required",
              detail:
                "create_controlled_action richiede confirmed:true. Usa preview_controlled_action e attendi una conferma esplicita di Federico.",
            };
          }

          // Write-tool idempotency dedup (returns the first result, never repeats).
          const writeKey = `${userId}::write::create_controlled_action::${
            (args.idempotency_key as string | undefined) ?? JSON.stringify({
              c: commandText,
              b: args.brain_id ?? null,
              p: args.project_id ?? null,
            })
          }`;
          const dup = readDedupedCall(writeKey);
          if (dup !== null) {
            void logSanitizedEvent(supabase, userId, "jack_write_tool_duplicate_prevented", {
              tool_name: "create_controlled_action",
              brain_id: (args.brain_id as string | undefined) ?? null,
            });
            return dup as ToolReturn;
          }

          const res = await createControlledJackAction({
            data: {
              command_text: commandText,
              brain_id: (args.brain_id as string | undefined) ?? null,
              project_id: (args.project_id as string | undefined) ?? null,
              delivery_preference:
                (args.delivery_preference as "telegram" | "ui_only" | undefined) ?? null,
              notes: (args.notes as string | undefined) ?? null,
              source_warning_id: (args.source_warning_id as string | undefined) ?? null,
              idempotency_key: (args.idempotency_key as string | undefined) ?? null,
              confirmed: true,
            },
          });
          const out = { ok: res.ok, payload: res };
          writeDedupedCall(writeKey, out);
          return out;
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
        default:
          return { ok: false, error: "unknown_tool" };
      }
    };

    try {
      const result = await compute();
      writeDedupedCall(cacheKey, result);
      return result;
    } catch (err) {
      const result = {
        ok: false,
        error: "tool_failed",
        detail: String((err as Error).message ?? err).slice(0, 200),
      };
      return result;
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
