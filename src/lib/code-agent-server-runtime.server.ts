// ============================================================
// Brain Hub v3.15.4 — Code Agent server runtime (server-only)
// ============================================================
// Houses AsyncLocalStorage + runtime resolver registration.
// Lives in a `.server.ts` file so `node:async_hooks` never ships
// to the client bundle.
// ============================================================

import { AsyncLocalStorage } from "node:async_hooks";
import { setCodeAgentRuntimeResolver } from "@/lib/code-agent-orchestrator";

type SbAny = { from: (t: string) => unknown };
export type CodeAgentCtx = { supabase: SbAny; userId: string };

const als = new AsyncLocalStorage<CodeAgentCtx>();

// Register the resolver once (module load on the server).
setCodeAgentRuntimeResolver({
  getSb: () => als.getStore()?.supabase ?? null,
  getUserId: () => als.getStore()?.userId ?? null,
});

export const serverRuntime = {
  runWithCtx<T>(ctx: CodeAgentCtx, fn: () => Promise<T>): Promise<T> {
    return als.run(ctx, fn);
  },
};
