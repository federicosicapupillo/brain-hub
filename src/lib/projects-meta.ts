import { supabase } from "@/integrations/supabase/client";
import { createBrain } from "@/lib/brains-api";

export type ProjectPriority = "molto-alta" | "alta" | "media" | "bassa";

export interface ProjectMeta {
  name: string;
  category: string;
  description: string;
  status: string;
  priority: ProjectPriority;
  tools: string[];
  connections: string[];
  nextAction: string;
  color: string;
}

// Hardcoded metadata for the 6 main projects.
// Matched by brain name (case-insensitive).
export const PROJECT_META: ProjectMeta[] = [
  {
    name: "Brain Hub",
    category: "Sistema Centrale / Knowledge Management",
    description:
      "Dashboard personale per organizzare progetti, prompt, file, agenti AI, roadmap, task, log e connessioni tra idee.",
    status: "MVP operativo",
    priority: "molto-alta",
    tools: ["Lovable", "GitHub", "Obsidian", "ChatGPT", "Claude", "Antigravity"],
    connections: ["IdeaPilot IA", "Pupillo", "Sica Industrial Radar"],
    nextAction: "Collega i prompt operativi e le fonti Obsidian.",
    color: "#8B5CF6",
  },
  {
    name: "IdeaPilot IA",
    category: "SaaS / AI App Builder / Marketing",
    description:
      "Piattaforma che aiuta una persona a trasformare un'idea in una prima web app pronta da testare, presentare o vendere.",
    status: "In sviluppo / test marketing",
    priority: "alta",
    tools: ["Lovable", "ChatGPT", "Claude", "Perplexity", "Runway", "ElevenLabs", "Klippify", "Stripe", "Supabase"],
    connections: ["Brain Hub", "Pupillo"],
    nextAction: "Definire onboarding e prima landing per test marketing.",
    color: "#6366F1",
  },
  {
    name: "Pupillo",
    category: "Marketplace / Ristorazione / Extra Horeca",
    description:
      "Piattaforma per collegare ristoratori e lavoratori extra nel settore ristorazione, con turni, candidature, reputazione, badge e conferme.",
    status: "Sviluppo avanzato / revisione funzionale",
    priority: "alta",
    tools: ["Lovable", "Supabase", "Stripe", "Twilio", "ChatGPT", "GitHub"],
    connections: ["Brain Hub", "IdeaPilot IA"],
    nextAction: "Completare flusso candidature e badge reputazione.",
    color: "#F97316",
  },
  {
    name: "Sica Industrial Radar",
    category: "Real Estate Industriale / Capannoni / Lead Intelligence",
    description:
      "Sistema per ricercare, filtrare e analizzare capannoni industriali, logistici, artigianali, commerciali e navali (mq, altezza, piazzale, carroponte, portoni, posizione).",
    status: "Ideazione / sviluppo iniziale",
    priority: "alta",
    tools: ["Lovable", "Google Earth", "ChatGPT", "Perplexity", "Supabase", "Mappe"],
    connections: ["Brain Hub", "Sica Immobiliare Comunicazione"],
    nextAction: "Definire schema dati capannoni e fonti iniziali.",
    color: "#0EA5E9",
  },
  {
    name: "Furia Immobiliare",
    category: "Real Estate Residenziale",
    description:
      "Progetto immobiliare legato a case, ville, casali e immobili residenziali in Lunigiana e zone limitrofe.",
    status: "Attivo / comunicazione e gestione annunci",
    priority: "media",
    tools: ["Lovable", "Sito web", "Social", "ChatGPT", "Strumenti grafici"],
    connections: ["Sica Immobiliare Comunicazione"],
    nextAction: "Pianificare calendario contenuti mensile.",
    color: "#10B981",
  },
  {
    name: "Sica Immobiliare Comunicazione",
    category: "Marketing Immobiliare / Capannoni",
    description:
      "Modernizzazione della comunicazione di Sica Immobiliare: annunci più efficaci, pubblicità online, video, lead acquisition e posizionamento 'specialisti dei capannoni'.",
    status: "Da strutturare",
    priority: "alta",
    tools: ["Instagram", "Facebook", "LinkedIn", "Runway", "Midjourney", "CapCut", "ChatGPT"],
    connections: ["Sica Industrial Radar", "Furia Immobiliare"],
    nextAction: "Brief identità visuale e piano editoriale 90 giorni.",
    color: "#EC4899",
  },
];

export function findMeta(brainName: string): ProjectMeta | undefined {
  const k = brainName.trim().toLowerCase();
  return PROJECT_META.find((p) => p.name.toLowerCase() === k);
}

export function priorityLabel(p: ProjectPriority): string {
  return { "molto-alta": "Molto Alta", alta: "Alta", media: "Media", bassa: "Bassa" }[p];
}

export function priorityColor(p: ProjectPriority): string {
  return {
    "molto-alta": "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
    alta: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    media: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    bassa: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  }[p];
}

/**
 * Create any of the 6 known projects that do not exist yet as brains.
 * Matching is by name (case-insensitive). Returns the names created.
 */
export async function seedMissingProjects(): Promise<string[]> {
  const { data, error } = await supabase.from("brains").select("name");
  if (error) throw error;
  const existing = new Set((data ?? []).map((b) => (b.name ?? "").toLowerCase()));
  const created: string[] = [];
  for (const p of PROJECT_META) {
    if (existing.has(p.name.toLowerCase())) continue;
    await createBrain({
      name: p.name,
      description: p.description,
      origin: "manuale",
      kind: "workspace",
      visibility: "privato",
      color: p.color,
    });
    created.push(p.name);
  }
  return created;
}
