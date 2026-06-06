import { supabase } from "@/integrations/supabase/client";

async function getUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error("Non autenticato");
  return data.user.id;
}

// =================== TYPES ===================
export interface Connector {
  id: string; name: string; type: string; description: string;
  status: string; is_enabled: boolean; config: Record<string, unknown>;
  last_sync_at: string | null; updated_at: string;
}
export interface Agent {
  id: string; brain_id: string | null; name: string; role: string;
  description: string; instructions: string; status: string;
  model: string; tools: unknown[]; updated_at: string;
}
export interface RoadmapItem {
  id: string; brain_id: string | null; title: string; description: string;
  status: string; phase: string; priority: string; order_index: number;
  due_date: string | null; updated_at: string;
}
export interface Task {
  id: string; brain_id: string | null; node_id: string | null; agent_id: string | null;
  title: string; description: string; status: string; priority: string;
  due_date: string | null; completed_at: string | null; updated_at: string;
}
export interface AppLog {
  id: string; brain_id: string | null; entity_type: string; entity_id: string | null;
  action: string; message: string; severity: string;
  metadata: Record<string, unknown>; created_at: string;
}
export interface LiveEvent {
  id: string; brain_id: string | null; event_type: string;
  title: string; description: string; payload: Record<string, unknown>;
  is_read: boolean; created_at: string;
}

// =================== CONNECTORS ===================
export async function listConnectors(): Promise<Connector[]> {
  const { data, error } = await supabase.from("connectors").select("*").order("created_at");
  if (error) throw error;
  return (data ?? []) as Connector[];
}
export async function upsertConnector(input: {
  id?: string; name: string; type: string; description?: string;
  status?: string; is_enabled?: boolean;
}): Promise<Connector> {
  const user_id = await getUserId();
  const payload = {
    user_id, name: input.name, type: input.type,
    description: input.description ?? "",
    status: input.status ?? "inactive",
    is_enabled: input.is_enabled ?? false,
    config: {},
  };
  if (input.id) {
    const { data, error } = await supabase.from("connectors")
      .update({ is_enabled: payload.is_enabled, status: payload.status, description: payload.description })
      .eq("id", input.id).select().single();
    if (error) throw error;
    return data as Connector;
  }
  const { data, error } = await supabase.from("connectors").insert(payload).select().single();
  if (error) throw error;
  return data as Connector;
}
export async function toggleConnector(id: string, is_enabled: boolean): Promise<void> {
  const { error } = await supabase.from("connectors")
    .update({ is_enabled, status: is_enabled ? "connected" : "inactive" }).eq("id", id);
  if (error) throw error;
}

// =================== AGENTS ===================
export async function listAgents(): Promise<Agent[]> {
  const { data, error } = await supabase.from("agents").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Agent[];
}
export async function createAgent(input: {
  name: string; role?: string; description?: string; instructions?: string;
  status?: string; model?: string; brain_id?: string | null;
}): Promise<Agent> {
  const user_id = await getUserId();
  const { data, error } = await supabase.from("agents").insert({
    user_id, brain_id: input.brain_id ?? null, name: input.name,
    role: input.role ?? "", description: input.description ?? "",
    instructions: input.instructions ?? "", status: input.status ?? "draft",
    model: input.model ?? "", tools: [],
  }).select().single();
  if (error) throw error;
  await logAction({ action: "agent_created", message: `Agente creato: ${input.name}`, entity_type: "agent", entity_id: data.id, brain_id: input.brain_id ?? null });
  await pushLiveEvent({ event_type: "agent", title: `Nuovo agente: ${input.name}`, brain_id: input.brain_id ?? null });
  return data as Agent;
}
export async function updateAgentStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from("agents").update({ status }).eq("id", id);
  if (error) throw error;
}

// =================== ROADMAP ===================
export async function listRoadmap(): Promise<RoadmapItem[]> {
  const { data, error } = await supabase.from("roadmap_items").select("*").order("order_index");
  if (error) throw error;
  return (data ?? []) as RoadmapItem[];
}
export async function createRoadmapItem(input: {
  title: string; description?: string; status?: string; phase?: string;
  priority?: string; brain_id?: string | null;
}): Promise<RoadmapItem> {
  const user_id = await getUserId();
  const { data, error } = await supabase.from("roadmap_items").insert({
    user_id, brain_id: input.brain_id ?? null, title: input.title,
    description: input.description ?? "", status: input.status ?? "todo",
    phase: input.phase ?? "", priority: input.priority ?? "medium",
  }).select().single();
  if (error) throw error;
  await logAction({ action: "roadmap_created", message: `Roadmap item: ${input.title}`, entity_type: "roadmap_item", entity_id: data.id, brain_id: input.brain_id ?? null });
  return data as RoadmapItem;
}
export async function moveRoadmapItem(id: string, status: string): Promise<void> {
  const { error } = await supabase.from("roadmap_items").update({ status }).eq("id", id);
  if (error) throw error;
}

// =================== TASKS ===================
export async function listTasks(): Promise<Task[]> {
  const { data, error } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Task[];
}
export async function createTask(input: {
  title: string; description?: string; priority?: string; status?: string;
  brain_id?: string | null; node_id?: string | null; agent_id?: string | null;
}): Promise<Task> {
  const user_id = await getUserId();
  const { data, error } = await supabase.from("tasks").insert({
    user_id, brain_id: input.brain_id ?? null, node_id: input.node_id ?? null,
    agent_id: input.agent_id ?? null, title: input.title,
    description: input.description ?? "", status: input.status ?? "todo",
    priority: input.priority ?? "medium",
  }).select().single();
  if (error) throw error;
  await logAction({ action: "task_created", message: `Task creato: ${input.title}`, entity_type: "task", entity_id: data.id, brain_id: input.brain_id ?? null });
  return data as Task;
}
export async function setTaskStatus(id: string, status: string): Promise<void> {
  const completed_at = status === "done" || status === "completato" ? new Date().toISOString() : null;
  const { error } = await supabase.from("tasks").update({ status, completed_at }).eq("id", id);
  if (error) throw error;
  if (completed_at) {
    await logAction({ action: "task_completed", message: `Task completato`, entity_type: "task", entity_id: id, brain_id: null });
  }
}

// =================== LOGS ===================
export async function listLogs(limit = 100): Promise<AppLog[]> {
  const { data, error } = await supabase.from("app_logs").select("*")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as AppLog[];
}
export async function logAction(input: {
  action: string; message: string; severity?: string;
  entity_type?: string; entity_id?: string | null; brain_id?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const user_id = await getUserId();
    await supabase.from("app_logs").insert({
      user_id, brain_id: input.brain_id ?? null,
      entity_type: input.entity_type ?? "",
      entity_id: input.entity_id ?? null,
      action: input.action, message: input.message,
      severity: input.severity ?? "info",
      metadata: (input.metadata ?? {}) as never,
    });
  } catch (e) {
    console.warn("[logAction] failed", e instanceof Error ? e.message : "");
  }
}

// =================== LIVE EVENTS ===================
export async function listLiveEvents(limit = 50): Promise<LiveEvent[]> {
  const { data, error } = await supabase.from("live_events").select("*")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as LiveEvent[];
}
export async function pushLiveEvent(input: {
  event_type: string; title: string; description?: string;
  brain_id?: string | null; payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const user_id = await getUserId();
    await supabase.from("live_events").insert({
      user_id, brain_id: input.brain_id ?? null,
      event_type: input.event_type, title: input.title,
      description: input.description ?? "", payload: (input.payload ?? {}) as never,
    });
  } catch (e) {
    console.warn("[pushLiveEvent] failed", e instanceof Error ? e.message : "");
  }
}
export async function markLiveEventRead(id: string): Promise<void> {
  const { error } = await supabase.from("live_events").update({ is_read: true }).eq("id", id);
  if (error) throw error;
}
