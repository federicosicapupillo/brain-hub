import { supabase } from "@/integrations/supabase/client";
import { logAction, pushLiveEvent } from "@/lib/workspace-api";

export type LinkType = "project" | "file" | "prompt" | "roadmap" | "task" | "tool" | "external";

export type ProjectLink = {
  id: string;
  user_id: string;
  brain_id: string;
  link_type: LinkType;
  relation_type: string | null;
  title: string;
  url: string | null;
  description: string | null;
  category: string | null;
  tool: string | null;
  status: string | null;
  notes: string | null;
  target_brain_id: string | null;
  target_table: string | null;
  target_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateProjectLinkInput = {
  brain_id: string;
  link_type: LinkType;
  title: string;
  relation_type?: string;
  url?: string;
  description?: string;
  category?: string;
  tool?: string;
  status?: string;
  notes?: string;
  target_brain_id?: string;
  target_table?: string;
  target_id?: string;
};

export async function listProjectLinks(brainId: string): Promise<ProjectLink[]> {
  const { data, error } = await supabase
    .from("project_links")
    .select("*")
    .eq("brain_id", brainId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProjectLink[];
}

export type DirectedProjectLink = ProjectLink & { direction: "out" | "in" };

/**
 * Return all project_links touching brainId — both outbound (brain_id=brainId)
 * and inbound (target_brain_id=brainId, link_type='project'). Inbound rows are
 * re-mapped so the "other end" appears in target_brain_id/title for display,
 * while relation_type/notes keep the original semantic.
 */
export async function listProjectLinksBidirectional(
  brainId: string,
  brainNameById: Map<string, string>,
): Promise<DirectedProjectLink[]> {
  const [outRes, inRes] = await Promise.all([
    supabase.from("project_links").select("*").eq("brain_id", brainId)
      .order("created_at", { ascending: false }),
    supabase.from("project_links").select("*").eq("link_type", "project")
      .eq("target_brain_id", brainId).neq("brain_id", brainId)
      .order("created_at", { ascending: false }),
  ]);
  if (outRes.error) throw outRes.error;
  if (inRes.error) throw inRes.error;
  const outbound: DirectedProjectLink[] = (outRes.data ?? []).map((r) => ({
    ...(r as ProjectLink),
    direction: "out" as const,
  }));
  const inbound: DirectedProjectLink[] = (inRes.data ?? []).map((r) => {
    const src = r.brain_id as string;
    return {
      ...(r as ProjectLink),
      direction: "in" as const,
      target_brain_id: src,
      target_id: src,
      target_table: "brains",
      title: brainNameById.get(src) ?? (r as ProjectLink).title,
    };
  });
  const seen = new Set<string>();
  const merged: DirectedProjectLink[] = [];
  for (const l of [...outbound, ...inbound]) {
    const key = `${l.link_type}:${l.target_brain_id ?? l.url ?? l.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(l);
  }
  return merged;
}

/**
 * Count distinct project↔project pairs each brain participates in, plus
 * non-project outbound links. Used by the dashboard cards.
 */
export async function countLinksPerBrain(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("project_links")
    .select("brain_id,target_brain_id,link_type");
  if (error) throw error;
  const counts: Record<string, number> = {};
  const seenPair = new Set<string>();
  for (const r of data ?? []) {
    if (r.link_type === "project" && r.target_brain_id) {
      const a = r.brain_id as string;
      const b = r.target_brain_id as string;
      const key = [a, b].sort().join("::");
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      counts[a] = (counts[a] ?? 0) + 1;
      counts[b] = (counts[b] ?? 0) + 1;
    } else if (r.link_type === "external") {
      const a = r.brain_id as string;
      counts[a] = (counts[a] ?? 0) + 1;
    }
    // prompt / file / roadmap / task / tool are NOT counted as "Collegamenti".
  }
  return counts;
}

export async function createProjectLink(input: CreateProjectLinkInput): Promise<ProjectLink> {
  const { data: userData, error: ue } = await supabase.auth.getUser();
  if (ue || !userData.user) throw ue ?? new Error("Non autenticato");

  // Dedupe: same brain + link_type + (target_id or url or title)
  const dedupeKey = input.target_id ?? input.url ?? input.title;
  if (dedupeKey) {
    const { data: existing } = await supabase
      .from("project_links")
      .select("*")
      .eq("brain_id", input.brain_id)
      .eq("link_type", input.link_type)
      .eq("user_id", userData.user.id);
    const dup = (existing ?? []).find(
      (e) => (e.target_id ?? e.url ?? e.title) === dedupeKey,
    );
    if (dup) return dup as ProjectLink;
  }

  const { data, error } = await supabase
    .from("project_links")
    .insert({
      user_id: userData.user.id,
      brain_id: input.brain_id,
      link_type: input.link_type,
      title: input.title,
      relation_type: input.relation_type ?? null,
      url: input.url ?? null,
      description: input.description ?? null,
      category: input.category ?? null,
      tool: input.tool ?? null,
      status: input.status ?? null,
      notes: input.notes ?? null,
      target_brain_id: input.target_brain_id ?? null,
      target_table: input.target_table ?? null,
      target_id: input.target_id ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  await logAction({
    action: "project_link_created",
    message: `Collegamento ${input.link_type}: ${input.title}`,
    entity_type: "project_link",
    entity_id: data.id,
    brain_id: input.brain_id,
  });
  await pushLiveEvent({
    event_type: "link",
    title: `Collegamento (${input.link_type}): ${input.title}`,
    brain_id: input.brain_id,
  });
  return data as ProjectLink;
}

export async function deleteProjectLink(id: string, brainId: string): Promise<void> {
  const { error } = await supabase.from("project_links").delete().eq("id", id);
  if (error) throw error;
  await logAction({
    action: "project_link_deleted",
    message: `Collegamento rimosso`,
    entity_type: "project_link",
    entity_id: id,
    brain_id: brainId,
  });
}

export async function updateProjectLink(
  id: string,
  patch: { relation_type?: string | null; notes?: string | null; title?: string },
): Promise<ProjectLink> {
  const { data, error } = await supabase
    .from("project_links")
    .update({
      ...(patch.relation_type !== undefined ? { relation_type: patch.relation_type } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await logAction({
    action: "project_link_updated",
    message: `Collegamento aggiornato`,
    entity_type: "project_link",
    entity_id: id,
    brain_id: data.brain_id,
  });
  return data as ProjectLink;
}

/**
 * Ensure a project→project link exists in project_links and matches the given
 * relation_type/notes. Used to materialize "virtual" meta-derived links on edit.
 */
export async function upsertProjectProjectLink(input: {
  brain_id: string;
  target_brain_id: string;
  target_title: string;
  relation_type?: string | null;
  notes?: string | null;
}): Promise<ProjectLink> {
  const { data: userData, error: ue } = await supabase.auth.getUser();
  if (ue || !userData.user) throw ue ?? new Error("Non autenticato");

  const { data: existing } = await supabase
    .from("project_links")
    .select("*")
    .eq("brain_id", input.brain_id)
    .eq("link_type", "project")
    .eq("user_id", userData.user.id);
  const dup = (existing ?? []).find((e) => e.target_brain_id === input.target_brain_id);
  if (dup) {
    return updateProjectLink(dup.id, {
      relation_type: input.relation_type ?? null,
      notes: input.notes ?? null,
      title: input.target_title,
    });
  }
  return createProjectLink({
    brain_id: input.brain_id,
    link_type: "project",
    title: input.target_title,
    relation_type: input.relation_type ?? "collegato a",
    notes: input.notes ?? undefined,
    target_brain_id: input.target_brain_id,
    target_table: "brains",
    target_id: input.target_brain_id,
  });
}

