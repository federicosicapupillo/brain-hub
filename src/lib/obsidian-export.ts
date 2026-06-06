import { zipSync, strToU8 } from "fflate";
import { supabase } from "@/integrations/supabase/client";
import { logAction, pushLiveEvent } from "@/lib/workspace-api";

export interface ExportOptions {
  brainId: string;
  includeNodes: boolean;
  includeSources: boolean;
  includeEdges: boolean;
  includeTags: boolean;
  includeMetadata: boolean;
}

export interface ExportStats {
  brainName: string;
  brains: number;
  nodes: number;
  sources: number;
  links: number;
  files: number;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  stats: ExportStats;
}

function sanitize(name: string): string {
  const s = (name ?? "").toString().replace(/[\\/:*?"<>|#^[\]]+/g, "_").replace(/\s+/g, " ").trim();
  return s.slice(0, 120) || "senza-titolo";
}

function uniquify(base: string, used: Set<string>): string {
  if (!used.has(base)) { used.add(base); return base; }
  let i = 2;
  while (used.has(`${base} (${i})`)) i++;
  const out = `${base} (${i})`;
  used.add(out);
  return out;
}

function yaml(obj: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${String(item).replace(/\n/g, " ")}`);
    } else if (typeof v === "object") {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      const s = String(v).replace(/\n/g, " ");
      lines.push(`${k}: ${s}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

export async function exportBrainToObsidian(opts: ExportOptions): Promise<ExportResult> {
  const { data: userData, error: ue } = await supabase.auth.getUser();
  if (ue || !userData.user) throw ue ?? new Error("Non autenticato");
  const user_id = userData.user.id;

  const { data: brainRow, error: be } = await supabase
    .from("brains").select("*").eq("id", opts.brainId).eq("user_id", user_id).single();
  if (be || !brainRow) throw be ?? new Error("Cervello non trovato");

  const [{ data: nodeRows }, { data: edgeRows }, { data: sourceRows }] = await Promise.all([
    opts.includeNodes
      ? supabase.from("brain_nodes").select("*").eq("brain_id", opts.brainId).eq("user_id", user_id)
      : Promise.resolve({ data: [] as never[] }),
    opts.includeEdges
      ? supabase.from("brain_edges").select("*").eq("brain_id", opts.brainId).eq("user_id", user_id)
      : Promise.resolve({ data: [] as never[] }),
    opts.includeSources
      ? supabase.from("knowledge_sources").select("*").eq("brain_id", opts.brainId).eq("user_id", user_id)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const nodes = (nodeRows ?? []) as Array<{
    id: string; label: string; type: string; origin: string; tags: string[];
    summary: string | null; created_at?: string; updated_at?: string;
  }>;
  const edges = (edgeRows ?? []) as Array<{ source: string; target: string; kind: string }>;
  const sources = (sourceRows ?? []) as Array<{
    id: string; title: string; source_type: string; description: string | null;
    extracted_text: string | null; url: string | null; file_name: string | null;
    tags: string[]; metadata: Record<string, unknown>; node_id: string | null;
    created_at?: string; updated_at?: string;
  }>;

  // Build label maps and unique filenames
  const nodeFile = new Map<string, string>(); // id -> safe label
  const usedNodeNames = new Set<string>();
  for (const n of nodes) nodeFile.set(n.id, uniquify(sanitize(n.label), usedNodeNames));

  const sourceFile = new Map<string, string>();
  const usedSourceNames = new Set<string>();
  for (const s of sources) sourceFile.set(s.id, uniquify(sanitize(s.title), usedSourceNames));

  // adjacency for nodes (undirected for linking)
  const neighbors = new Map<string, Set<string>>();
  if (opts.includeEdges) {
    for (const e of edges) {
      if (!neighbors.has(e.source)) neighbors.set(e.source, new Set());
      if (!neighbors.has(e.target)) neighbors.set(e.target, new Set());
      neighbors.get(e.source)!.add(e.target);
      neighbors.get(e.target)!.add(e.source);
    }
  }

  // sources by parent node
  const sourcesByNode = new Map<string, typeof sources>();
  for (const s of sources) {
    if (!s.node_id) continue;
    if (!sourcesByNode.has(s.node_id)) sourcesByNode.set(s.node_id, []);
    sourcesByNode.get(s.node_id)!.push(s);
  }

  const files: Record<string, Uint8Array> = {};
  const root = "Brain-Hub-Export";
  const brainSafe = sanitize(brainRow.name);
  let linkCount = 0;

  // Brain file
  {
    const fm: Record<string, unknown> = {
      source: "brain-hub",
      brain: brainRow.name,
      type: "Cervello",
    };
    if (opts.includeTags) fm.tags = ["brain-hub", "obsidian", brainSafe.toLowerCase().replace(/\s+/g, "-")];
    if (opts.includeMetadata) {
      fm.origin = brainRow.origin;
      fm.kind = brainRow.kind;
      fm.visibility = brainRow.visibility;
      fm.created_at = brainRow.created_at;
      fm.updated_at = brainRow.updated_at;
    }
    let body = yaml(fm);
    body += `# ${brainRow.name}\n\n`;
    if (brainRow.description) body += `${brainRow.description}\n\n`;
    if (opts.includeNodes && nodes.length > 0) {
      body += `## Nodi\n\n`;
      for (const n of nodes) { body += `- [[${nodeFile.get(n.id)}]]\n`; linkCount++; }
      body += `\n`;
    }
    if (opts.includeSources && sources.length > 0) {
      body += `## Fonti\n\n`;
      for (const s of sources) { body += `- [[${sourceFile.get(s.id)}]]\n`; linkCount++; }
    }
    files[`${root}/cervelli/${brainSafe}.md`] = strToU8(body);
  }

  // Nodes
  if (opts.includeNodes) {
    for (const n of nodes) {
      const fm: Record<string, unknown> = {
        source: "brain-hub",
        brain: brainRow.name,
        type: "Nodo",
      };
      if (opts.includeTags) fm.tags = Array.from(new Set(["brain-hub", "obsidian", ...(n.tags ?? [])]));
      if (opts.includeMetadata) {
        fm.node_type = n.type;
        fm.origin = n.origin;
        fm.created_at = n.created_at;
        fm.updated_at = n.updated_at;
      }
      let body = yaml(fm);
      body += `# ${n.label}\n\n`;
      if (n.summary) body += `${n.summary}\n\n`;
      const linked = neighbors.get(n.id);
      if (opts.includeEdges && linked && linked.size > 0) {
        const otherNodes = Array.from(linked).filter((id) => nodeFile.has(id));
        if (otherNodes.length > 0) {
          body += `## Nodi collegati\n\n`;
          for (const id of otherNodes) { body += `- [[${nodeFile.get(id)}]]\n`; linkCount++; }
          body += `\n`;
        }
      }
      const childSources = sourcesByNode.get(n.id) ?? [];
      if (opts.includeSources && childSources.length > 0) {
        body += `## Fonti collegate\n\n`;
        for (const s of childSources) {
          const sf = sourceFile.get(s.id);
          if (sf) { body += `- [[${sf}]]\n`; linkCount++; }
        }
      }
      files[`${root}/nodi/${nodeFile.get(n.id)}.md`] = strToU8(body);
    }
  }

  // Sources
  if (opts.includeSources) {
    for (const s of sources) {
      const fm: Record<string, unknown> = {
        source: "brain-hub",
        brain: brainRow.name,
        type: "Documento",
      };
      if (opts.includeTags) fm.tags = Array.from(new Set(["brain-hub", "obsidian", ...(s.tags ?? [])]));
      if (opts.includeMetadata) {
        fm.source_type = s.source_type;
        if (s.url) fm.url = s.url;
        if (s.file_name) fm.file_name = s.file_name;
        const meta = s.metadata ?? {};
        const origin = (meta as Record<string, unknown>).origin;
        const path = (meta as Record<string, unknown>).obsidian_path;
        if (origin) fm.origin = origin;
        if (path) fm.obsidian_path = path;
        fm.created_at = s.created_at;
        fm.updated_at = s.updated_at;
      }
      let body = yaml(fm);
      body += `# ${s.title}\n\n`;
      if (s.description) body += `${s.description}\n\n`;
      if (s.node_id && nodeFile.has(s.node_id)) {
        body += `> Nodo padre: [[${nodeFile.get(s.node_id)}]]\n\n`;
        linkCount++;
      }
      if (s.extracted_text) body += `${s.extracted_text}\n`;
      else if (s.url) body += `${s.url}\n`;
      files[`${root}/fonti/${sourceFile.get(s.id)}.md`] = strToU8(body);
    }
  }

  // Index
  {
    let body = yaml({
      source: "brain-hub",
      type: "Indice",
      brain: brainRow.name,
      exported_at: new Date().toISOString(),
    });
    body += `# Brain Hub Export — ${brainRow.name}\n\n`;
    body += `- Cervello: [[${brainSafe}]]\n`;
    body += `- Nodi: ${opts.includeNodes ? nodes.length : 0}\n`;
    body += `- Fonti: ${opts.includeSources ? sources.length : 0}\n`;
    body += `- Collegamenti: ${opts.includeEdges ? edges.length : 0}\n\n`;
    body += `Generato da Brain Hub il ${new Date().toLocaleString()}.\n`;
    files[`${root}/index.md`] = strToU8(body);
  }

  const zipped = zipSync(files, { level: 6 });
  // copy to a fresh ArrayBuffer so the Blob is independent of fflate's buffer
  const ab = new ArrayBuffer(zipped.byteLength);
  new Uint8Array(ab).set(zipped);
  const blob = new Blob([ab], { type: "application/zip" });
  const fileName = `brain-hub-export-${brainSafe}-${new Date().toISOString().slice(0, 10)}.zip`;

  const stats: ExportStats = {
    brainName: brainRow.name,
    brains: 1,
    nodes: opts.includeNodes ? nodes.length : 0,
    sources: opts.includeSources ? sources.length : 0,
    links: linkCount,
    files: Object.keys(files).length,
  };

  await logAction({
    action: "obsidian_exported",
    message: `Export Obsidian: ${stats.files} file (${stats.nodes} nodi, ${stats.sources} fonti)`,
    entity_type: "brain", entity_id: opts.brainId, brain_id: opts.brainId,
    metadata: { ...stats, options: opts },
  });
  await pushLiveEvent({
    event_type: "export",
    title: `Export Obsidian: ${brainRow.name}`,
    description: `${stats.files} file · ${stats.links} link`,
    brain_id: opts.brainId,
  });

  return { blob, fileName, stats };
}

export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
