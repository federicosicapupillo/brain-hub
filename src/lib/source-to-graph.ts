import { supabase } from "@/integrations/supabase/client";
import { logAction, pushLiveEvent } from "@/lib/workspace-api";

export interface MaterializeResult {
  analyzed: number;
  created: number;
  skipped: number;
  edges: number;
  errors: string[];
}

/**
 * Crea brain_nodes (type "documento", origin "obsidian") a partire dalle
 * knowledge_sources passate, e li collega al nodo padre via brain_edges
 * con kind "source". Evita duplicati confrontando label + origin nel brain.
 */
export async function materializeSourcesAsNodes(opts: {
  brainId: string;
  parentNodeId: string;
  sourceIds: string[];
}): Promise<MaterializeResult> {
  const { brainId, parentNodeId, sourceIds } = opts;
  const result: MaterializeResult = { analyzed: 0, created: 0, skipped: 0, edges: 0, errors: [] };
  if (sourceIds.length === 0) return result;

  const { data: userData, error: ue } = await supabase.auth.getUser();
  if (ue || !userData.user) throw ue ?? new Error("Non autenticato");
  const user_id = userData.user.id;

  const { data: sources, error: se } = await supabase
    .from("knowledge_sources")
    .select("id,title,description,extracted_text,tags")
    .in("id", sourceIds);
  if (se) throw se;

  const { data: existing, error: ee } = await supabase
    .from("brain_nodes")
    .select("id,label")
    .eq("brain_id", brainId)
    .eq("origin", "obsidian");
  if (ee) throw ee;
  const existingLabels = new Map<string, string>(
    (existing ?? []).map((n) => [n.label, n.id]),
  );

  // Edges already starting from parent toward those labels (dedup edges too)
  const { data: parentEdges } = await supabase
    .from("brain_edges")
    .select("target")
    .eq("brain_id", brainId)
    .eq("source", parentNodeId);
  const existingTargets = new Set((parentEdges ?? []).map((e) => e.target));

  for (const src of sources ?? []) {
    result.analyzed++;
    try {
      const label = (src.title ?? "Senza titolo").toString().slice(0, 200);
      let nodeId = existingLabels.get(label);
      if (nodeId) {
        result.skipped++;
      } else {
        const summary = ((src.extracted_text ?? src.description ?? "") + "").slice(0, 250);
        const tags = Array.from(new Set([...((src.tags as string[] | null) ?? []), "documento"]));
        const x = Math.random() * 0.6 + 0.2;
        const y = Math.random() * 0.6 + 0.2;
        const { data: node, error: ne } = await supabase.from("brain_nodes").insert({
          user_id, brain_id: brainId, label, type: "documento", origin: "obsidian",
          tags, summary, x, y,
        }).select("id").single();
        if (ne) throw ne;
        nodeId = node.id;
        existingLabels.set(label, nodeId);
        result.created++;
      }

      if (!existingTargets.has(nodeId)) {
        const { error: eee } = await supabase.from("brain_edges").insert({
          user_id, brain_id: brainId, source: parentNodeId, target: nodeId, kind: "source",
        });
        if (eee) throw eee;
        existingTargets.add(nodeId);
        result.edges++;
      }
    } catch (e) {
      result.errors.push(`${src.title}: ${e instanceof Error ? e.message : "errore"}`);
    }
  }

  await logAction({
    action: "sources_materialized",
    message: `Grafo aggiornato: ${result.created} nodi, ${result.edges} collegamenti da ${result.analyzed} fonti`,
    entity_type: "brain", entity_id: brainId, brain_id: brainId,
    metadata: {
      analyzed: result.analyzed, created: result.created,
      skipped: result.skipped, edges: result.edges, errors: result.errors.length,
    },
  });
  await pushLiveEvent({
    event_type: "graph",
    title: `Documenti aggiunti al grafo`,
    description: `${result.created} nuovi nodi · ${result.edges} collegamenti`,
    brain_id: brainId,
  });

  return result;
}
