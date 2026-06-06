import { supabase } from "@/integrations/supabase/client";
import { logAction, pushLiveEvent } from "@/lib/workspace-api";
import type { Brain, BrainNode, BrainEdge } from "@/lib/demo-data";

type BrainRow = {
  id: string; name: string; description: string | null;
  origin: string; kind: string; visibility: string;
  color: string; updated_at: string;
};
type NodeRow = {
  id: string; brain_id: string; label: string; type: string;
  origin: string; tags: string[]; summary: string | null;
  x: number; y: number; updated_at: string;
};
type EdgeRow = { id: string; source: string; target: string; kind: string };

export function mapBrain(r: BrainRow, nodeCount: number): Brain {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    origin: r.origin as Brain["origin"],
    kind: r.kind as Brain["kind"],
    visibility: r.visibility as Brain["visibility"],
    color: r.color,
    nodeCount,
    updatedAt: r.updated_at,
  };
}

export function mapNode(r: NodeRow): BrainNode {
  return {
    id: r.id,
    brainId: r.brain_id,
    label: r.label,
    type: r.type as BrainNode["type"],
    origin: r.origin as BrainNode["origin"],
    tags: r.tags ?? [],
    summary: r.summary ?? "",
    x: r.x,
    y: r.y,
    updatedAt: r.updated_at,
  };
}

export function mapEdge(r: EdgeRow): BrainEdge {
  return { id: r.id, source: r.source, target: r.target, kind: r.kind as BrainEdge["kind"] };
}

export async function fetchAll() {
  const [{ data: brainRows, error: be }, { data: nodeRows, error: ne }, { data: edgeRows, error: ee }] =
    await Promise.all([
      supabase.from("brains").select("*").order("created_at", { ascending: true }),
      supabase.from("brain_nodes").select("*"),
      supabase.from("brain_edges").select("*"),
    ]);
  if (be) throw be;
  if (ne) throw ne;
  if (ee) throw ee;

  const nodes = (nodeRows ?? []).map(mapNode);
  const counts = nodes.reduce<Record<string, number>>((a, n) => {
    a[n.brainId] = (a[n.brainId] ?? 0) + 1;
    return a;
  }, {});
  const brains = (brainRows ?? []).map((b) => mapBrain(b as BrainRow, counts[b.id] ?? 0));
  const edges = (edgeRows ?? []).map(mapEdge);
  return { brains, nodes, edges };
}

export async function createBrain(input: {
  name: string; description: string;
  origin: string; kind: string; visibility: string; color: string;
}) {
  const { data: userData, error: ue } = await supabase.auth.getUser();
  if (ue || !userData.user) throw ue ?? new Error("Non autenticato");
  const { data, error } = await supabase.from("brains").insert({
    ...input,
    user_id: userData.user.id,
  }).select().single();
  if (error) throw error;
  await logAction({ action: "brain_created", message: `Cervello creato: ${input.name}`, entity_type: "brain", entity_id: data.id, brain_id: data.id });
  await pushLiveEvent({ event_type: "brain", title: `Nuovo cervello: ${input.name}`, brain_id: data.id });
  return data;
}

export async function createNode(input: {
  brain_id: string; label: string; type: string; origin?: string;
  tags?: string[]; summary?: string; x?: number; y?: number;
}) {
  const { data: userData, error: ue } = await supabase.auth.getUser();
  if (ue || !userData.user) throw ue ?? new Error("Non autenticato");
  const { data, error } = await supabase.from("brain_nodes").insert({
    user_id: userData.user.id,
    brain_id: input.brain_id,
    label: input.label,
    type: input.type,
    origin: input.origin ?? "manuale",
    tags: input.tags ?? [],
    summary: input.summary ?? "",
    x: input.x ?? Math.random() * 0.6 + 0.2,
    y: input.y ?? Math.random() * 0.6 + 0.2,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function createEdge(input: {
  brain_id: string; source: string; target: string; kind?: string;
}) {
  const { data: userData, error: ue } = await supabase.auth.getUser();
  if (ue || !userData.user) throw ue ?? new Error("Non autenticato");
  const { data, error } = await supabase.from("brain_edges").insert({
    user_id: userData.user.id,
    brain_id: input.brain_id,
    source: input.source,
    target: input.target,
    kind: input.kind ?? "link",
  }).select().single();
  if (error) throw error;
  return data;
}
