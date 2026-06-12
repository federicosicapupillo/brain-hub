import { supabase } from "@/integrations/supabase/client";
import {
  ACTION_TYPE_LABEL,
  ActionSource,
  ActionType,
  AutomationAction,
  CreateActionInput,
  RiskLevel,
  createAction,
  listActions,
} from "@/lib/action-queue";
import type { LogEventType } from "@/lib/automation-run";

const NON_TERMINAL = new Set([
  "suggested",
  "pending_approval",
  "approved",
  "ready_to_execute",
]);

async function logEvent(
  action: LogEventType,
  notes: string,
  metadata: Record<string, unknown>,
) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("clipboard_execution_logs").insert({
    user_id: u.user.id,
    clipboard_item_id: null,
    action,
    notes,
    metadata,
  } as never);
}

export type EnqueueResult = {
  action: AutomationAction;
  duplicated: boolean;
};

/**
 * Enqueue an action in the Action Queue with anti-duplicate detection.
 * Two actions are similar if they share: action_type, brain_id (or project_id),
 * roadmap_item_id, prompt_execution_log_id, and the existing one is still
 * in a non-terminal status.
 */
export async function enqueueAction(input: CreateActionInput): Promise<EnqueueResult> {
  // Fetch candidates with same action_type & brain
  let q = supabase
    .from("automation_actions" as never)
    .select("*")
    .eq("action_type", input.action_type)
    .in("status", Array.from(NON_TERMINAL));
  if (input.brain_id) q = q.eq("brain_id", input.brain_id);
  if (input.roadmap_item_id) q = q.eq("roadmap_item_id", input.roadmap_item_id);
  if (input.prompt_execution_log_id)
    q = q.eq("prompt_execution_log_id", input.prompt_execution_log_id);

  const { data: existing } = await q;
  const found = ((existing ?? []) as unknown as AutomationAction[])[0];

  if (found) {
    const meta = (found.metadata ?? {}) as Record<string, unknown>;
    const count =
      typeof meta.duplicate_click_count === "number"
        ? (meta.duplicate_click_count as number)
        : 0;
    const newMeta = {
      ...meta,
      duplicate_click_count: count + 1,
      last_duplicate_click_at: new Date().toISOString(),
      last_duplicate_source: input.source,
    };
    await supabase
      .from("automation_actions" as never)
      .update({ metadata: newMeta } as never)
      .eq("id", found.id);
    await logEvent(
      "automation_action_duplicate_prevented",
      `Duplicato evitato: ${found.title}`,
      {
        action_id: found.id,
        action_type: found.action_type,
        source: input.source,
        brain_id: input.brain_id,
      },
    );
    return { action: { ...found, metadata: newMeta }, duplicated: true };
  }

  const created = await createAction(input);
  return { action: created, duplicated: false };
}

export type CtaContext = {
  source: ActionSource;
  source_block: string;
  source_cta: string;
  action_type: ActionType;
  title: string;
  description?: string;
  risk_level?: RiskLevel;
  brain_id?: string | null;
  project_id?: string | null;
  roadmap_item_id?: string | null;
  prompt_execution_log_id?: string | null;
  parent_execution_log_id?: string | null;
  task_id?: string | null;
  extra?: Record<string, unknown>;
};

/**
 * Convenience: build a CreateActionInput from a CTA context and enqueue it.
 */
export async function enqueueFromCta(ctx: CtaContext): Promise<EnqueueResult> {
  return enqueueAction({
    source: ctx.source,
    action_type: ctx.action_type,
    title: ctx.title,
    description: ctx.description,
    risk_level: ctx.risk_level,
    brain_id: ctx.brain_id ?? null,
    project_id: ctx.project_id ?? null,
    roadmap_item_id: ctx.roadmap_item_id ?? null,
    task_id: ctx.task_id ?? null,
    prompt_execution_log_id: ctx.prompt_execution_log_id ?? null,
    parent_execution_log_id: ctx.parent_execution_log_id ?? null,
    metadata: {
      source_block: ctx.source_block,
      source_cta: ctx.source_cta,
      ...ctx.extra,
    },
  });
}

export function actionTypeLabel(t: ActionType): string {
  return ACTION_TYPE_LABEL[t];
}

/**
 * List actions filtered by brain plus optional terminal exclusion.
 */
export async function listActiveActionsForBrain(brainId: string) {
  const all = await listActions({ brainId });
  return all.filter((a) => NON_TERMINAL.has(a.status));
}
