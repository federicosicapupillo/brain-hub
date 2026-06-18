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
  CodeAgentTransitionError,
  type CodeAgentEngine,
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
