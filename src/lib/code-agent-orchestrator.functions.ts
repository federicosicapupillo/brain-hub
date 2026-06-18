// ============================================================
// Brain Hub v3.15.4 — Code Agent Server Function Boundary
// ============================================================
// Authenticated server functions for sensitive Code Agent Job mutations.
// All write operations route through here: requireSupabaseAuth injects an
// authenticated Supabase client (RLS-scoped to the user) plus userId, and
// we use AsyncLocalStorage (from a `.server.ts` shim) to expose them to
// the existing orchestrator state-machine code without duplicating logic.
//
// NO runner. NO Codex/Claude API. NO shell, commit, push, PR, merge, deploy.
// NO automatic Telegram sends. user_id ALWAYS taken from the server auth
// context — the client cannot forge it.
// ============================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  approveCodeAgentJob,
  rejectCodeAgentJob,
  markCodeAgentJobSentManually,
  saveCodeAgentJobResult,
  createReviewFromCodeAgentJob,
  createNextActionFromCodeAgentJob,
  createMasterSnapshotDraftFromCodeAgentJob,
  syncCodeAgentJobApprovalStatus,
  syncPendingCodeAgentApprovals,
  createCodeAgentJobFromBrowser,
  updateCodeAgentJobRepository,
  CodeAgentTransitionError,
  type CodeAgentEngine,
  type CodeAgentRiskLevel,
  type UnifiedCreateCodeAgentJobResult,
} from "@/lib/code-agent-orchestrator";

// ---------- Error serialization (crosses RPC boundary) ----------

export type SerializedCodeAgentError = {
  type: "code_agent_transition_error";
  code: string;
  message: string;
};

function isCodeAgentTransitionError(e: unknown): e is CodeAgentTransitionError {
  return (
    e instanceof CodeAgentTransitionError ||
    (typeof e === "object" &&
      e !== null &&
      (e as { name?: string }).name === "CodeAgentTransitionError" &&
      typeof (e as { code?: unknown }).code === "string")
  );
}

function serializeError(e: unknown): never {
  if (isCodeAgentTransitionError(e)) {
    const payload: SerializedCodeAgentError = {
      type: "code_agent_transition_error",
      code: e.code,
      message: e.message,
    };
    throw new Error(JSON.stringify(payload));
  }
  throw e instanceof Error ? e : new Error("Errore sconosciuto nel Code Agent");
}

type AuthCtx = { supabase: unknown; userId: string };

async function withGuard<T>(context: AuthCtx, fn: () => Promise<T>): Promise<T> {
  const runtime = await import("@/lib/code-agent-server-runtime.server");
  try {
    return await runtime.serverRuntime.runWithCtx(
      { supabase: context.supabase as { from: (t: string) => unknown }, userId: context.userId },
      fn,
    );
  } catch (e) {
    serializeError(e);
  }
}

// ---------- Validators ----------

const jobIdInput = z.object({ jobId: z.string().uuid() });
const engineEnum = z.enum([
  "codex_cloud",
  "codex_cli",
  "codex_github_action",
  "claude_code_cli",
  "claude_code_github_action",
  "manual_developer",
  "lovable",
  "custom",
]);

// ---------- Server functions ----------

export const approveCodeAgentJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jobId: string }) => jobIdInput.parse(d))
  .handler(async ({ data, context }) => {
    return withGuard(context, async () => {
      await approveCodeAgentJob(data.jobId);
      return { ok: true } as const;
    });
  });

export const rejectCodeAgentJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jobId: string; reason?: string | null }) =>
    z
      .object({
        jobId: z.string().uuid(),
        reason: z.string().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    return withGuard(context, async () => {
      await rejectCodeAgentJob(data.jobId, data.reason ?? null);
      return { ok: true } as const;
    });
  });

export const markCodeAgentJobSentManuallyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jobId: string; engine: CodeAgentEngine }) =>
    z.object({ jobId: z.string().uuid(), engine: engineEnum }).parse(d),
  )
  .handler(async ({ data, context }) => {
    return withGuard(context, async () => {
      await markCodeAgentJobSentManually(data.jobId, data.engine);
      return { ok: true } as const;
    });
  });

export const saveCodeAgentJobResultFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jobId: string; text: string }) =>
    z.object({ jobId: z.string().uuid(), text: z.string().min(1).max(20000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    return withGuard(context, async () => {
      await saveCodeAgentJobResult(data.jobId, { text: data.text });
      return { ok: true } as const;
    });
  });

export const createReviewFromCodeAgentJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jobId: string }) => jobIdInput.parse(d))
  .handler(async ({ data, context }) => {
    return withGuard(context, async () => {
      const r = await createReviewFromCodeAgentJob(data.jobId);
      return { ok: true, review_id: r?.id ?? null } as const;
    });
  });

export const createNextActionFromCodeAgentJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jobId: string }) => jobIdInput.parse(d))
  .handler(async ({ data, context }) => {
    return withGuard(context, async () => {
      const a = await createNextActionFromCodeAgentJob(data.jobId);
      return { ok: true, action_id: a?.id ?? null } as const;
    });
  });

export const createMasterSnapshotDraftFromCodeAgentJobFn = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jobId: string }) => jobIdInput.parse(d))
  .handler(async ({ data, context }) => {
    return withGuard(context, async () => {
      const id = await createMasterSnapshotDraftFromCodeAgentJob(data.jobId);
      return { ok: true, draft_id: id } as const;
    });
  });

export const syncCodeAgentJobApprovalStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jobId: string }) => jobIdInput.parse(d))
  .handler(async ({ data, context }) => {
    return withGuard(context, async () => {
      const r = await syncCodeAgentJobApprovalStatus(data.jobId);
      return r;
    });
  });

export const syncPendingCodeAgentApprovalsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { brainId?: string | null }) =>
    z.object({ brainId: z.string().uuid().nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    return withGuard(context, async () => {
      const r = await syncPendingCodeAgentApprovals(data.brainId ?? null);
      return r;
    });
  });

// ---------- v3.15.5: creation + repository update ----------

const riskEnum = z.enum(["low", "medium", "high"]);

export const createCodeAgentJobFromBrowserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      commandText: string;
      brainId?: string | null;
      projectId?: string | null;
      repositoryId?: string | null;
      preferredEngine?: CodeAgentEngine | null;
      repositoryHint?: string | null;
      riskHint?: CodeAgentRiskLevel | null;
      source?: string | null;
      notes?: string | null;
      deliveryPreference?: "manual" | "telegram" | null;
    }) =>
      z
        .object({
          commandText: z.string().min(1).max(1500),
          brainId: z.string().uuid().nullable().optional(),
          projectId: z.string().uuid().nullable().optional(),
          repositoryId: z.string().uuid().nullable().optional(),
          preferredEngine: engineEnum.nullable().optional(),
          repositoryHint: z.string().max(500).nullable().optional(),
          riskHint: riskEnum.nullable().optional(),
          source: z.string().max(120).nullable().optional(),
          notes: z.string().max(2000).nullable().optional(),
          deliveryPreference: z.enum(["manual", "telegram"]).nullable().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    return withGuard(context, async (): Promise<UnifiedCreateCodeAgentJobResult> => {
      return createCodeAgentJobFromBrowser({
        command_text: data.commandText,
        brain_id: data.brainId ?? null,
        project_id: data.projectId ?? null,
        repository_id: data.repositoryId ?? null,
        preferred_engine: data.preferredEngine ?? null,
        repository_hint: data.repositoryHint ?? null,
        risk_hint: data.riskHint ?? null,
        source: data.source ?? "ui_browser",
        notes: data.notes ?? null,
        delivery_preference: data.deliveryPreference ?? null,
      });
    });
  });

export const updateCodeAgentJobRepositoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jobId: string; repositoryId: string | null }) =>
    z
      .object({
        jobId: z.string().uuid(),
        repositoryId: z.string().uuid().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    return withGuard(context, async () => {
      await updateCodeAgentJobRepository(data.jobId, data.repositoryId);
      return { ok: true } as const;
    });
  });

// ---------- v3.15.6: Jack → Code Agent Job (authenticated server function) ----------

const jackSourceEnum = z.enum(["jack_command", "jack_gpt", "jack_classic", "jack_voice", "jack"]);

function normalizeJackSource(src: string | null | undefined): string {
  if (!src) return "jack_command";
  const s = src.toLowerCase();
  if (s === "jack_gpt" || s === "jack_voice") return "jack_gpt";
  if (s === "jack_classic") return "jack_classic";
  if (s === "jack" || s === "jack_command") return "jack_command";
  return "jack_command";
}

export const createCodeAgentJobFromJackCommandFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      commandText: string;
      brainId?: string | null;
      projectId?: string | null;
      repositoryId?: string | null;
      preferredEngine?: CodeAgentEngine | null;
      repositoryHint?: string | null;
      riskHint?: CodeAgentRiskLevel | null;
      source?: string | null;
      notes?: string | null;
      deliveryPreference?: "manual" | "telegram" | null;
      transcriptPreview?: string | null;
      intent?: string | null;
    }) =>
      z
        .object({
          commandText: z.string().min(1).max(1500),
          brainId: z.string().uuid().nullable().optional(),
          projectId: z.string().uuid().nullable().optional(),
          repositoryId: z.string().uuid().nullable().optional(),
          preferredEngine: engineEnum.nullable().optional(),
          repositoryHint: z.string().max(500).nullable().optional(),
          riskHint: riskEnum.nullable().optional(),
          source: jackSourceEnum.nullable().optional(),
          notes: z.string().max(2000).nullable().optional(),
          deliveryPreference: z.enum(["manual", "telegram"]).nullable().optional(),
          // Short preview only — never the full transcript. We trim hard.
          transcriptPreview: z.string().max(240).nullable().optional(),
          intent: z.string().max(120).nullable().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    return withGuard(context, async () => {
      const cmd = String(data.commandText ?? "").trim();
      if (!cmd) {
        throw new CodeAgentTransitionError(
          "code_agent_jack_command_empty",
          "Comando Jack vuoto o non valido.",
        );
      }
      const normalizedSource = normalizeJackSource(data.source ?? null);
      const res = await createCodeAgentJobFromBrowser({
        command_text: cmd,
        brain_id: data.brainId ?? null,
        project_id: data.projectId ?? null,
        repository_id: data.repositoryId ?? null,
        preferred_engine: data.preferredEngine ?? null,
        repository_hint: data.repositoryHint ?? null,
        risk_hint: data.riskHint ?? null,
        source: normalizedSource,
        notes: data.notes ?? null,
        delivery_preference: data.deliveryPreference ?? null,
      });

      if (res.job_id) {
        await emitCodeAgentJackJobCreatedEvent(res.job_id, {
          brain_id: data.brainId ?? null,
          project_id: !!data.projectId,
          repository_id: !!res.repository_id,
          engine: res.recommended_engine,
          risk_level: res.risk_level,
          source: normalizedSource,
          intent: data.intent ?? null,
          has_repository_hint: !!data.repositoryHint,
          has_transcript_preview: !!data.transcriptPreview,
          status: res.status,
          approval_status: res.approval_status,
        });
      }

      // Minimal typed payload — no transcript / prompt / result.
      return {
        ok: res.ok,
        job_id: res.job_id,
        job_type: res.job_type,
        recommended_engine: res.recommended_engine,
        selected_engine: res.selected_engine,
        risk_level: res.risk_level,
        requires_approval: res.requires_approval,
        status: res.status,
        approval_status: res.approval_status,
        repository_id: res.repository_id,
        repository_resolution_status: res.repository_resolution.status,
        telegram_approval_id: res.telegram_approval_id,
        next_step: res.next_step,
        safe_message: res.safe_message,
        unsafe_request: res.unsafe_request,
        source: normalizedSource,
      } as const;
    });
  });
