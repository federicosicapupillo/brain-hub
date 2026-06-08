import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  PlugZap, Plus, ExternalLink, Pencil, Trash2, Inbox, FolderKanban, Lightbulb, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/strumenti-progetti")({
  head: () => ({ meta: [{ title: "Strumenti Progetti — AI Brain" }] }),
  component: StrumentiPage,
});

// ============== Catalog ==============
type Mode = "manuale" | "import_export" | "github" | "oauth" | "api" | "storage" | "local_sync" | "non_disponibile";
type Status = "manuale" | "da_collegare" | "collegato" | "sincronizzato" | "errore" | "non_disponibile";

const MODES: { value: Mode; label: string }[] = [
  { value: "manuale", label: "Manuale" },
  { value: "import_export", label: "Import / Export" },
  { value: "github", label: "Tramite GitHub" },
  { value: "oauth", label: "OAuth" },
  { value: "api", label: "API" },
  { value: "storage", label: "Storage" },
  { value: "local_sync", label: "Sync locale" },
  { value: "non_disponibile", label: "Non disponibile" },
];

const STATUSES: { value: Status; label: string }[] = [
  { value: "manuale", label: "Manuale" },
  { value: "da_collegare", label: "Da collegare" },
  { value: "collegato", label: "Collegato" },
  { value: "sincronizzato", label: "Sincronizzato" },
  { value: "errore", label: "Errore" },
  { value: "non_disponibile", label: "Non disponibile" },
];

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "outline" | "destructive"> = {
  manuale: "secondary",
  da_collegare: "outline",
  collegato: "default",
  sincronizzato: "default",
  errore: "destructive",
  non_disponibile: "outline",
};

interface ToolDef { name: string; category: string; defaultMode: Mode; defaultStatus: Status }
const TOOL_CATALOG: ToolDef[] = [
  { name: "Lovable", category: "dev", defaultMode: "manuale", defaultStatus: "da_collegare" },
  { name: "GitHub", category: "dev", defaultMode: "github", defaultStatus: "da_collegare" },
  { name: "Supabase", category: "dev", defaultMode: "api", defaultStatus: "da_collegare" },
  { name: "Antigravity", category: "dev", defaultMode: "manuale", defaultStatus: "manuale" },
  { name: "Obsidian", category: "notes", defaultMode: "local_sync", defaultStatus: "manuale" },
  { name: "ChatGPT", category: "ai", defaultMode: "manuale", defaultStatus: "manuale" },
  { name: "Claude", category: "ai", defaultMode: "manuale", defaultStatus: "manuale" },
  { name: "Perplexity", category: "ai", defaultMode: "manuale", defaultStatus: "manuale" },
  { name: "Google Drive", category: "storage", defaultMode: "manuale", defaultStatus: "da_collegare" },
  { name: "Gmail", category: "comms", defaultMode: "manuale", defaultStatus: "da_collegare" },
  { name: "Google Calendar", category: "comms", defaultMode: "manuale", defaultStatus: "da_collegare" },
  { name: "Google Earth / Maps", category: "maps", defaultMode: "manuale", defaultStatus: "manuale" },
  { name: "Runway", category: "media", defaultMode: "manuale", defaultStatus: "manuale" },
  { name: "Midjourney", category: "media", defaultMode: "manuale", defaultStatus: "manuale" },
  { name: "ElevenLabs", category: "media", defaultMode: "manuale", defaultStatus: "manuale" },
  { name: "D-ID", category: "media", defaultMode: "manuale", defaultStatus: "manuale" },
  { name: "Klippify", category: "media", defaultMode: "manuale", defaultStatus: "manuale" },
  { name: "CapCut", category: "media", defaultMode: "manuale", defaultStatus: "manuale" },
  { name: "Instagram", category: "social", defaultMode: "manuale", defaultStatus: "manuale" },
  { name: "Facebook", category: "social", defaultMode: "manuale", defaultStatus: "manuale" },
  { name: "LinkedIn", category: "social", defaultMode: "manuale", defaultStatus: "manuale" },
];
const TOOL_BY_NAME = new Map(TOOL_CATALOG.map((t) => [t.name, t] as const));

const DEFAULTS_BY_PROJECT: Record<string, string[]> = {
  "Pupillo": ["Lovable", "GitHub", "Supabase", "ChatGPT", "Obsidian", "Antigravity"],
  "IdeaPilot IA": ["Lovable", "GitHub", "Supabase", "ChatGPT", "Runway", "ElevenLabs", "Klippify", "CapCut"],
  "Sica Industrial Radar": ["Lovable", "GitHub", "Supabase", "ChatGPT", "Perplexity", "Google Earth / Maps", "Obsidian"],
  "Furia Immobiliare": ["Lovable", "ChatGPT", "Perplexity", "Google Drive", "Obsidian", "Instagram"],
  "Sica Immobiliare Comunicazione": ["ChatGPT", "Perplexity", "Runway", "Midjourney", "CapCut", "Instagram", "Facebook", "LinkedIn"],
  "Brain Hub": ["Lovable", "GitHub", "Supabase", "ChatGPT", "Claude", "Obsidian", "Antigravity"],
};

// ============== Types ==============
interface Brain { id: string; name: string }
interface ToolLink {
  id: string;
  brain_id: string;
  tool_name: string;
  tool_category: string;
  connection_mode: Mode;
  connection_status: Status;
  url: string | null;
  repo_url: string | null;
  folder_path: string | null;
  notes: string | null;
  last_sync_at: string | null;
}

// ============== Page ==============
function StrumentiPage() {
  const qc = useQueryClient();
  const [filterBrain, setFilterBrain] = useState<string>("__all");
  const [filterTool, setFilterTool] = useState<string>("__all");
  const [filterStatus, setFilterStatus] = useState<string>("__all");
  const [filterMode, setFilterMode] = useState<string>("__all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<ToolLink> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ToolLink | null>(null);
  const [seeding, setSeeding] = useState(false);

  const brainsQ = useQuery({
    queryKey: ["brains-min"],
    queryFn: async (): Promise<Brain[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase.from("brains").select("id,name").eq("user_id", u.user.id).order("name");
      if (error) throw error;
      return (data ?? []) as Brain[];
    },
  });

  const linksQ = useQuery({
    queryKey: ["tool-links"],
    queryFn: async (): Promise<ToolLink[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("project_tool_links")
        .select("id,brain_id,tool_name,tool_category,connection_mode,connection_status,url,repo_url,folder_path,notes,last_sync_at")
        .eq("user_id", u.user.id)
        .order("tool_name");
      if (error) throw error;
      return (data ?? []) as ToolLink[];
    },
  });

  const brains = brainsQ.data ?? [];
  const links = linksQ.data ?? [];

  // Seed initial defaults for known projects (only missing ones)
  async function seedDefaults() {
    setSeeding(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) return;
      const existing = new Set(links.map((l) => `${l.brain_id}:${l.tool_name}`));
      const rows: Record<string, unknown>[] = [];
      for (const b of brains) {
        const tools = DEFAULTS_BY_PROJECT[b.name];
        if (!tools) continue;
        for (const t of tools) {
          if (existing.has(`${b.id}:${t}`)) continue;
          const def = TOOL_BY_NAME.get(t);
          if (!def) continue;
          rows.push({
            user_id: userId,
            brain_id: b.id,
            tool_name: t,
            tool_category: def.category,
            connection_mode: def.defaultMode,
            connection_status: def.defaultStatus,
          });
        }
      }
      if (rows.length === 0) {
        toast.message("Nessuno strumento iniziale mancante.");
        return;
      }
      const { error } = await supabase.from("project_tool_links").insert(rows);
      if (error) { toast.error(error.message); return; }
      toast.success(`${rows.length} collegamenti iniziali creati.`);
      qc.invalidateQueries({ queryKey: ["tool-links"] });
    } finally {
      setSeeding(false);
    }
  }

  const filtered = useMemo(() => {
    return links.filter((l) =>
      (filterBrain === "__all" || l.brain_id === filterBrain) &&
      (filterTool === "__all" || l.tool_name === filterTool) &&
      (filterStatus === "__all" || l.connection_status === filterStatus) &&
      (filterMode === "__all" || l.connection_mode === filterMode),
    );
  }, [links, filterBrain, filterTool, filterStatus, filterMode]);

  const byBrain = useMemo(() => {
    const map = new Map<string, ToolLink[]>();
    for (const l of filtered) {
      const arr = map.get(l.brain_id) ?? [];
      arr.push(l);
      map.set(l.brain_id, arr);
    }
    return map;
  }, [filtered]);

  const suggestions = useMemo(() => buildSuggestions(brains, links), [brains, links]);

  function openCreate(brainId?: string) {
    setEditing({ brain_id: brainId ?? brains[0]?.id, connection_mode: "manuale", connection_status: "manuale", tool_category: "altro" });
    setEditorOpen(true);
  }
  function openEdit(l: ToolLink) { setEditing(l); setEditorOpen(true); }

  async function saveEditor(values: Partial<ToolLink>) {
    if (!values.brain_id || !values.tool_name) { toast.error("Progetto e strumento sono richiesti."); return; }
    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id;
    if (!userId) return;
    const payload = {
      brain_id: values.brain_id,
      tool_name: values.tool_name,
      tool_category: values.tool_category ?? TOOL_BY_NAME.get(values.tool_name)?.category ?? "altro",
      connection_mode: (values.connection_mode ?? "manuale") as Mode,
      connection_status: (values.connection_status ?? "manuale") as Status,
      url: values.url || null,
      repo_url: values.repo_url || null,
      folder_path: values.folder_path || null,
      notes: values.notes || null,
    };
    if (values.id) {
      const { error } = await supabase.from("project_tool_links").update(payload).eq("id", values.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Collegamento aggiornato.");
    } else {
      const { error } = await supabase.from("project_tool_links").insert({ ...payload, user_id: userId });
      if (error) {
        if (error.code === "23505") toast.error("Questo strumento è già collegato al progetto.");
        else toast.error(error.message);
        return;
      }
      toast.success("Strumento collegato.");
    }
    setEditorOpen(false); setEditing(null);
    qc.invalidateQueries({ queryKey: ["tool-links"] });
  }

  async function removeLink(l: ToolLink) {
    const { error } = await supabase.from("project_tool_links").delete().eq("id", l.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Collegamento rimosso.");
    setConfirmDelete(null);
    qc.invalidateQueries({ queryKey: ["tool-links"] });
  }

  const seedable = brains.some((b) => DEFAULTS_BY_PROJECT[b.name]);
  const loading = brainsQ.isLoading || linksQ.isLoading;

  return (
    <div className="p-6">
      <PageHeader
        title="Strumenti Progetti"
        subtitle="Collega ogni progetto agli strumenti esterni che usa, con modalità e stato reali."
        actions={
          <>
            {seedable && (
              <Button variant="outline" size="sm" onClick={seedDefaults} disabled={seeding}>
                {seeding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Importa collegamenti iniziali
              </Button>
            )}
            <Button size="sm" onClick={() => openCreate()} disabled={brains.length === 0}>
              <Plus className="mr-2 h-4 w-4" />Aggiungi strumento
            </Button>
          </>
        }
      />

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
          <FilterSelect label="Progetto" value={filterBrain} onChange={setFilterBrain}
            options={[{ value: "__all", label: "Tutti" }, ...brains.map((b) => ({ value: b.id, label: b.name }))]} />
          <FilterSelect label="Strumento" value={filterTool} onChange={setFilterTool}
            options={[{ value: "__all", label: "Tutti" }, ...TOOL_CATALOG.map((t) => ({ value: t.name, label: t.name }))]} />
          <FilterSelect label="Stato" value={filterStatus} onChange={setFilterStatus}
            options={[{ value: "__all", label: "Tutti" }, ...STATUSES.map((s) => ({ value: s.value, label: s.label }))]} />
          <FilterSelect label="Modalità" value={filterMode} onChange={setFilterMode}
            options={[{ value: "__all", label: "Tutte" }, ...MODES.map((m) => ({ value: m.value, label: m.label }))]} />
        </CardContent>
      </Card>

      {loading && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Caricamento…</CardContent></Card>
      )}

      {!loading && brains.length === 0 && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          Nessun progetto. Crea prima un progetto da <Link to="/progetti" className="underline">Progetti</Link>.
        </CardContent></Card>
      )}

      {!loading && brains.length > 0 && (
        <div className="space-y-6">
          {/* Project cards */}
          <div className="grid gap-4 lg:grid-cols-2">
            {brains
              .filter((b) => filterBrain === "__all" || b.id === filterBrain)
              .map((b) => {
                const items = byBrain.get(b.id) ?? [];
                return (
                  <Card key={b.id}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <FolderKanban className="h-4 w-4" />{b.name}
                        <Badge variant="outline">{items.length} strum.</Badge>
                      </CardTitle>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" asChild>
                          <Link to="/progetti/$brainId" params={{ brainId: b.id }}>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openCreate(b.id)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {items.length === 0 && (
                        <p className="text-xs text-muted-foreground">Nessuno strumento collegato.</p>
                      )}
                      {items.map((l) => (
                        <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card/60 p-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{l.tool_name}</span>
                              <Badge variant={STATUS_VARIANT[l.connection_status]}>{labelOf(STATUSES, l.connection_status)}</Badge>
                              <Badge variant="outline">{labelOf(MODES, l.connection_mode)}</Badge>
                            </div>
                            {(l.url || l.repo_url || l.folder_path) && (
                              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                {l.repo_url ?? l.url ?? l.folder_path}
                              </div>
                            )}
                            {l.last_sync_at && (
                              <div className="text-[11px] text-muted-foreground">Ultima sync: {new Date(l.last_sync_at).toLocaleString()}</div>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {(l.url || l.repo_url) && (
                              <Button size="sm" variant="ghost" asChild>
                                <a href={(l.repo_url ?? l.url)!} target="_blank" rel="noreferrer">
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" asChild title="Importa manualmente">
                              <Link to="/importa" search={{ brain: l.brain_id, tool: l.tool_name }}>
                                <Inbox className="h-3 w-3" />
                              </Link>
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(l)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(l)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              })}
          </div>

          {/* Mappa collegamenti */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Mappa collegamenti</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {brains.map((b) => {
                const items = (linksQ.data ?? []).filter((l) => l.brain_id === b.id);
                if (items.length === 0) return null;
                return (
                  <div key={b.id} className="text-sm">
                    <span className="font-medium">{b.name}</span>
                    <span className="text-muted-foreground"> → {items.map((i) => i.tool_name).join(", ")}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Suggerimenti */}
          {suggestions.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="h-4 w-4" />Suggerimenti collegamento
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {suggestions.map((s, i) => (
                  <div key={i} className="rounded-md border border-border bg-card/60 p-2 text-sm">
                    <span className="font-medium">{s.brain}:</span>{" "}
                    <span className="text-muted-foreground">{s.text}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Editor dialog */}
      <Dialog open={editorOpen} onOpenChange={(o) => { setEditorOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Modifica collegamento" : "Aggiungi strumento"}</DialogTitle>
            <DialogDescription>Compila i campi per collegare uno strumento a un progetto.</DialogDescription>
          </DialogHeader>
          {editing && (
            <Editor
              brains={brains}
              value={editing}
              onChange={setEditing}
              onSave={() => saveEditor(editing)}
              onCancel={() => { setEditorOpen(false); setEditing(null); }}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rimuovere il collegamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && `Stai per rimuovere "${confirmDelete.tool_name}" dal progetto.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDelete && removeLink(confirmDelete)}>Rimuovi</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============== Helpers ==============
function labelOf<T extends string>(opts: { value: T; label: string }[], v: T) {
  return opts.find((o) => o.value === v)?.label ?? v;
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function buildSuggestions(brains: Brain[], links: ToolLink[]): { brain: string; text: string }[] {
  const out: { brain: string; text: string }[] = [];
  const byBrain = new Map<string, ToolLink[]>();
  for (const l of links) {
    const arr = byBrain.get(l.brain_id) ?? [];
    arr.push(l);
    byBrain.set(l.brain_id, arr);
  }
  for (const b of brains) {
    const items = byBrain.get(b.id) ?? [];
    const has = (name: string) => items.some((i) => i.tool_name === name);
    const get = (name: string) => items.find((i) => i.tool_name === name);
    if (has("Lovable") && !has("GitHub")) out.push({ brain: b.name, text: "Hai Lovable ma non GitHub — collega un repository GitHub al progetto." });
    if (has("Supabase") && !get("Supabase")?.notes) out.push({ brain: b.name, text: "Supabase collegato senza note tecniche — importa lo schema database o aggiungi note." });
    const obsidian = get("Obsidian"); if (obsidian && obsidian.connection_mode === "manuale") out.push({ brain: b.name, text: "Obsidian è solo manuale — valuta import markdown o vault via GitHub/Drive." });
    if (has("Runway")) out.push({ brain: b.name, text: "Usi Runway — salva prompt video e asset generati in Importa." });
    if (has("ChatGPT")) out.push({ brain: b.name, text: "Usi ChatGPT — importa prompt e decisioni importanti nello storico." });
  }
  return out;
}

function Editor({ brains, value, onChange, onSave, onCancel }: {
  brains: Brain[];
  value: Partial<ToolLink>;
  onChange: (v: Partial<ToolLink>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const update = (patch: Partial<ToolLink>) => onChange({ ...value, ...patch });
  useEffect(() => {
    if (!value.id && value.tool_name) {
      const def = TOOL_BY_NAME.get(value.tool_name);
      if (def && value.tool_category === "altro") {
        onChange({ ...value, tool_category: def.category, connection_mode: def.defaultMode, connection_status: def.defaultStatus });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.tool_name]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Progetto</Label>
          <Select value={value.brain_id ?? ""} onValueChange={(v) => update({ brain_id: v })}>
            <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
            <SelectContent>
              {brains.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Strumento</Label>
          <Select value={value.tool_name ?? ""} onValueChange={(v) => update({ tool_name: v })}>
            <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
            <SelectContent>
              {TOOL_CATALOG.map((t) => <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Categoria</Label>
          <Input value={value.tool_category ?? ""} onChange={(e) => update({ tool_category: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Modalità</Label>
          <Select value={value.connection_mode ?? "manuale"} onValueChange={(v) => update({ connection_mode: v as Mode })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Stato</Label>
          <Select value={value.connection_status ?? "manuale"} onValueChange={(v) => update({ connection_status: v as Status })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>URL</Label>
          <Input value={value.url ?? ""} onChange={(e) => update({ url: e.target.value })} placeholder="https://..." />
        </div>
        <div className="space-y-1">
          <Label>Repository GitHub</Label>
          <Input value={value.repo_url ?? ""} onChange={(e) => update({ repo_url: e.target.value })} placeholder="https://github.com/..." />
        </div>
        <div className="space-y-1 col-span-2">
          <Label>Cartella / Path</Label>
          <Input value={value.folder_path ?? ""} onChange={(e) => update({ folder_path: e.target.value })} placeholder="/Vault/Progetto" />
        </div>
        <div className="space-y-1 col-span-2">
          <Label>Note</Label>
          <Textarea rows={3} value={value.notes ?? ""} onChange={(e) => update({ notes: e.target.value })} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Annulla</Button>
        <Button onClick={onSave}><PlugZap className="mr-2 h-4 w-4" />Salva</Button>
      </DialogFooter>
    </div>
  );
}
