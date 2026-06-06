import { supabase } from "@/integrations/supabase/client";
import { createBrain, createNode, createEdge } from "@/lib/brains-api";
import { createManualSource } from "@/lib/knowledge-api";
import { logAction, pushLiveEvent } from "@/lib/workspace-api";

export async function hasAnyBrain(): Promise<boolean> {
  const { count, error } = await supabase
    .from("brains")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function createStarterWorkspace(): Promise<{ brainId: string }> {
  if (await hasAnyBrain()) {
    throw new Error("ALREADY_EXISTS");
  }

  const brain = await createBrain({
    name: "Brain Hub Operativo",
    description:
      "Spazio centrale dove raccolgo progetti, idee, fonti, prompt, task, roadmap, agenti e memoria operativa personale.",
    origin: "manuale",
    kind: "workspace",
    visibility: "privato",
    color: "#8B5CF6",
  });

  const nodesSpec = [
    {
      label: "Brain Hub Operativo",
      type: "progetto",
      tags: ["workspace", "core", "memoria"],
      summary:
        "Nodo centrale del workspace operativo: collega progetti, fonti, prompt e memoria.",
      x: 0.5,
      y: 0.5,
    },
    {
      label: "IdeaPilot IA",
      type: "progetto",
      tags: ["app", "ai", "business", "lovable"],
      summary:
        "Progetto per aiutare le persone a trasformare un'idea in una web app pronta da validare e monetizzare.",
      x: 0.25,
      y: 0.3,
    },
    {
      label: "Pupillo",
      type: "progetto",
      tags: ["horeca", "marketplace", "lavoratori", "ristoratori"],
      summary:
        "Marketplace per mettere in contatto ristoratori e lavoratori extra nel settore horeca.",
      x: 0.75,
      y: 0.3,
    },
    {
      label: "Sica Industrial Radar",
      type: "progetto",
      tags: ["immobiliare", "capannoni", "lead", "industriale"],
      summary:
        "Sistema per cercare, analizzare e acquisire opportunità immobiliari industriali e logistiche.",
      x: 0.8,
      y: 0.7,
    },
    {
      label: "Prompt Lovable",
      type: "prompt",
      tags: ["prompt", "sviluppo", "lovable", "workflow"],
      summary:
        "Raccolta di prompt operativi per modificare, migliorare e sviluppare applicazioni con Lovable.",
      x: 0.2,
      y: 0.7,
    },
    {
      label: "Fonti e Memoria",
      type: "fonte",
      tags: ["documenti", "note", "memoria", "ricerca"],
      summary:
        "Area dedicata alla raccolta di fonti, appunti, file, link e conoscenza collegata ai progetti.",
      x: 0.5,
      y: 0.85,
    },
  ];

  const created: Record<string, string> = {};
  for (const n of nodesSpec) {
    const row = await createNode({
      brain_id: brain.id,
      label: n.label,
      type: n.type,
      origin: "manuale",
      tags: n.tags,
      summary: n.summary,
      x: n.x,
      y: n.y,
    });
    created[n.label] = (row as { id: string }).id;
  }

  const edges: Array<[string, string]> = [
    ["Brain Hub Operativo", "IdeaPilot IA"],
    ["Brain Hub Operativo", "Pupillo"],
    ["Brain Hub Operativo", "Sica Industrial Radar"],
    ["Prompt Lovable", "IdeaPilot IA"],
    ["Fonti e Memoria", "Brain Hub Operativo"],
  ];
  for (const [src, tgt] of edges) {
    await createEdge({
      brain_id: brain.id,
      source: created[src],
      target: created[tgt],
      kind: "link",
    });
  }

  await createManualSource({
    brain_id: brain.id,
    node_id: created["Fonti e Memoria"] ?? null,
    title: "Visione iniziale Brain Hub",
    content:
      "Brain Hub è il mio sistema operativo personale per organizzare progetti, idee, fonti, prompt, roadmap, task, agenti e memoria. Deve diventare il centro dove collego Lovable, Supabase, GitHub, Obsidian, documenti, appunti e strumenti AI. Ogni progetto deve avere cervelli, nodi, fonti, task, log e in futuro ricerca semantica.",
    tags: ["brain", "memoria", "ai", "progetti"],
    description: "Visione e scopo iniziale del workspace Brain Hub.",
  });

  await logAction({
    action: "starter_workspace_created",
    message: "Workspace iniziale creato",
    entity_type: "brain",
    entity_id: brain.id,
    brain_id: brain.id,
  });
  await pushLiveEvent({
    event_type: "workspace",
    title: "Workspace iniziale creato",
    brain_id: brain.id,
  });

  return { brainId: brain.id };
}
