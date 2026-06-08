import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  GitBranch, ExternalLink, FileText, ScrollText, FileCode, RefreshCw,
  FolderKanban, Inbox, Archive, ListChecks, PlugZap, Lightbulb, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createManualSource } from "@/lib/knowledge-api";
import { logAction } from "@/lib/workspace-api";

export const Route = createFileRoute("/_authenticated/github-sync")({
  head: () => ({ meta: [{ title: "GitHub Sync Manuale — iBrain" }] }),
  component: GitHubSyncPage,
});

// ---------- Types ----------
type ImportRecord = {
  id: string;
  type: "readme" | "changelog" | "markdown";
  category?: string;
  title: string;
  branch?: string;
  file_path?: string;
  imported_at: string;
  source_id?: string;
};

type ToolMeta = {
  branch?: string;
  manual_check_status?: ManualCheckStatus;
  manual_check_notes?: string;
  imports?: ImportRecord[];
  [k: string]: unknown;
};

type ManualCheckStatus =
  | "mai_verificato"
  | "verificato_manualmente"
  | "aggiornato_manualmente"
  | "da_revisionare"
  | "errore";

type GithubLink = {
  id: string;
  brain_id: string;
  tool_name: string;
  connection_status: string;
  connection_mode: string;
  url: string | null;
  repo_url: string | null;
  folder_path: string | null;
  notes: string | null;
  last_checked_at: string | null;
  metadata: ToolMeta;
  brain?: { id: string; name: string; color: string | null } | null;
};

const CHECK_STATUSES: { value: ManualCheckStatus; label: string }[] = [
  { value: "mai_verificato", label: "Mai verificato" },
  { value: "verificato_manualmente", label: "Verificato manualmente" },
  { value: "aggiornato_manualmente", label: "Aggiornato manualmente" },
  { value: "da_revisionare", label: "Da revisionare" },
  { value: "errore", label: "Errore" },
];

const CHECK_VARIANT: Record<ManualCheckStatus, "default" | "secondary" | "outline" | "destructive"> = {
  mai_verificato: "outline",
  verificato_manualmente: "secondary",
  aggiornato_manualmente: "default",
  da_revisionare: "secondary",
  errore: "destructive",
};

const MD_CATEGORIES = [
  "README", "changelog", "documentazione tecnica", "schema database",
  "note sviluppo", "prompt operativo", "regole progetto", "bug/fix",
];

type FilterKey =
  | "all" | "with_github" | "no_url" | "to_verify" | "manually_updated"
  | "with_readme" | "no_readme" | "with_changelog" | "no_changelog";

const FILTERS: { value: FilterKey; label: string }[] = [
  { value: "all", label: "Tutti" },
  { value: "with_github", label: "Solo con GitHub" },
  { value: "no_url", label: "Senza URL repository" },
  { value: "to_verify", label: "Da verificare" },
  { value: "manually_updated", label: "Aggiornati manualmente" },
  { value: "with_readme", label: "Con README importato" },
  { value: "no_readme", label: "Senza README" },
  { value: "with_changelog", label: "Con changelog" },
  { value: "no_changelog", label: "Senza changelog" },
];

// ---------- Helpers ----------
function parseRepo(url: string | null | undefined): { owner: string; name: string } | null {
  if (!url) return null;
  const m = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?]|$)/i);
  if (!m) return null;
  return { owner: m[1], name: m[2] };
}

function hasImport(meta: ToolMeta, type: ImportRecord["type"]): boolean {
  return (meta.imports ?? []).some((i) => i.type === type);
}

// ---------- Page ----------
function GitHubSyncPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [importDlg, setImportDlg] = useState<{ link: GithubLink; type: ImportRecord["type"] } | null>(null);
  const [checkDlg, setCheckDlg] = useState<GithubLink | null>(null);

  const { data: links = [], isLoading } = useQuery({
    queryKey: ["github-sync-links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_tool_links")
        .select("*, brain:brains(id,name,color)")
        .ilike("tool_name", "github");
      if (error) throw error;
      return (data ?? []) as unknown as GithubLink[];
    },
  });

  const { data: allBrains = [] } = useQuery({
    queryKey: ["github-sync-brains"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brains").select("id,name,color").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const linkedBrainIds = useMemo(() => new Set(links.map((l) => l.brain_id)), [links]);
  const brainsWithoutGithub = allBrains.filter((b) => !linkedBrainIds.has(b.id));

  const filtered = useMemo(() => {
    return links.filter((l) => {
      const m = l.metadata ?? {};
      switch (filter) {
        case "with_github": return !!l.repo_url;
        case "no_url": return !l.repo_url;
        case "to_verify": return !m.manual_check_status || m.manual_check_status === "mai_verificato" || m.manual_check_status === "da_revisionare";
        case "manually_updated": return m.manual_check_status === "aggiornato_manualmente" || m.manual_check_status === "verificato_manualmente";
        case "with_readme": return hasImport(m, "readme");
        case "no_readme": return !hasImport(m, "readme");
        case "with_changelog": return hasImport(m, "changelog");
        case "no_changelog": return !hasImport(m, "changelog");
        default: return true;
      }
    });
  }, [links, filter]);

  const suggestions = useMemo(() => {
    const out: { tone: "info" | "warn"; text: string }[] = [];
    for (const l of links) {
      const name = l.brain?.name ?? "progetto";
      const m = l.metadata ?? {};
      if (!l.repo_url) out.push({ tone: "warn", text: `${name}: aggiungi URL repository.` });
      if (l.connection_status === "da_collegare") {
        out.push({
          tone: "info",
          text: `${name}: collegamento GitHub salvato come riferimento. Per sincronizzazione automatica servirà integrazione API/OAuth.`,
        });
      }
      if (!hasImport(m, "readme")) out.push({ tone: "warn", text: `${name}: importa il README del repository.` });
      if (!hasImport(m, "changelog")) out.push({ tone: "warn", text: `${name}: importa un changelog o una nota sviluppo.` });
    }
    for (const b of brainsWithoutGithub) {
      out.push({ tone: "info", text: `${b.name}: collega un repository GitHub da Strumenti Progetti.` });
    }
    return out.slice(0, 20);
  }, [links, brainsWithoutGithub]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="GitHub Sync Manuale"
        subtitle="Gestisci i repository collegati ai progetti e importa manualmente README, changelog, file markdown e note tecniche."
      />

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/strumenti-progetti"><PlugZap className="mr-2 h-4 w-4" />Strumenti Progetti</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/archivio"><Archive className="mr-2 h-4 w-4" />Apri Archivio</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/importa"><Inbox className="mr-2 h-4 w-4" />Importa contenuto</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/prossime-azioni"><ListChecks className="mr-2 h-4 w-4" />Prossime Azioni</Link>
        </Button>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4" /> Suggerimenti
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {suggestions.map((s, i) => (
                <li key={i} className={s.tone === "warn" ? "text-foreground" : "text-muted-foreground"}>
                  • {s.text}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-sm text-muted-foreground">Filtro:</Label>
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
          <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto text-sm text-muted-foreground">
          {filtered.length} repository · {links.length} totali
        </div>
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Caricamento…
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nessun repository GitHub corrisponde al filtro selezionato.
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((l) => (
            <RepoCard
              key={l.id}
              link={l}
              onImport={(type) => setImportDlg({ link: l, type })}
              onCheck={() => setCheckDlg(l)}
            />
          ))}
        </div>
      )}

      {importDlg && (
        <ImportDialog
          link={importDlg.link}
          type={importDlg.type}
          onClose={() => setImportDlg(null)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ["github-sync-links"] });
            setImportDlg(null);
          }}
        />
      )}
      {checkDlg && (
        <ManualCheckDialog
          link={checkDlg}
          onClose={() => setCheckDlg(null)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ["github-sync-links"] });
            setCheckDlg(null);
          }}
        />
      )}
    </div>
  );
}

// ---------- Card ----------
function RepoCard({
  link, onImport, onCheck,
}: {
  link: GithubLink;
  onImport: (t: ImportRecord["type"]) => void;
  onCheck: () => void;
}) {
  const repo = parseRepo(link.repo_url ?? link.url);
  const m = link.metadata ?? {};
  const status = (m.manual_check_status ?? "mai_verificato") as ManualCheckStatus;
  const statusLabel = CHECK_STATUSES.find((s) => s.value === status)?.label ?? status;
  const imports = m.imports ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <Link to="/progetti/$brainId" params={{ brainId: link.brain_id }} className="hover:underline">
            {link.brain?.name ?? "Progetto"}
          </Link>
          <Badge variant="outline">da_collegare</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-xs">{repo ? `${repo.owner}/${repo.name}` : "—"}</span>
          </div>
          {link.repo_url && (
            <a href={link.repo_url} target="_blank" rel="noreferrer"
               className="block truncate text-xs text-muted-foreground hover:underline">
              {link.repo_url}
            </a>
          )}
          <div className="text-xs text-muted-foreground">
            Branch: <span className="font-mono">{m.branch ?? "main"}</span>
            {link.folder_path ? <> · Path: <span className="font-mono">{link.folder_path}</span></> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={CHECK_VARIANT[status]}>{statusLabel}</Badge>
          <span className="text-xs text-muted-foreground">
            Ultima verifica: {link.last_checked_at ? new Date(link.last_checked_at).toLocaleString() : "mai"}
          </span>
        </div>

        {imports.length > 0 && (
          <div className="rounded-md border border-border bg-muted/30 p-2">
            <div className="mb-1 text-xs font-medium">Contenuti importati ({imports.length})</div>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {imports.slice(-4).reverse().map((i) => (
                <li key={i.id} className="truncate">
                  • [{i.type}] {i.title}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button size="sm" variant="outline" disabled={!link.repo_url} asChild={!!link.repo_url}>
            {link.repo_url ? (
              <a href={link.repo_url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />Apri repository
              </a>
            ) : <span><ExternalLink className="mr-2 h-4 w-4" />Apri repository</span>}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/progetti/$brainId" params={{ brainId: link.brain_id }}>
              <FolderKanban className="mr-2 h-4 w-4" />Apri progetto
            </Link>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onImport("readme")}>
            <FileText className="mr-2 h-4 w-4" />Importa README
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onImport("changelog")}>
            <ScrollText className="mr-2 h-4 w-4" />Importa changelog
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onImport("markdown")}>
            <FileCode className="mr-2 h-4 w-4" />Importa markdown
          </Button>
          <Button size="sm" variant="outline" onClick={onCheck}>
            <RefreshCw className="mr-2 h-4 w-4" />Aggiorna stato
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Import Dialog ----------
function ImportDialog({
  link, type, onClose, onDone,
}: {
  link: GithubLink;
  type: ImportRecord["type"];
  onClose: () => void;
  onDone: () => void;
}) {
  const repo = parseRepo(link.repo_url ?? link.url);
  const defaultTitle =
    type === "readme" ? `README — ${repo?.name ?? link.brain?.name ?? "repo"}` :
    type === "changelog" ? `CHANGELOG — ${repo?.name ?? link.brain?.name ?? "repo"}` : "";
  const defaultPath =
    type === "readme" ? "README.md" : type === "changelog" ? "CHANGELOG.md" : "";

  const [title, setTitle] = useState(defaultTitle);
  const [branch, setBranch] = useState((link.metadata?.branch as string | undefined) ?? "main");
  const [path, setPath] = useState(defaultPath);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<string>(type === "readme" ? "README" : type === "changelog" ? "changelog" : "documentazione tecnica");
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    try {
      const text = await file.text();
      setContent(text);
      if (!path) setPath(file.name);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    } catch {
      toast.error("Impossibile leggere il file");
    }
  };

  const submit = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error("Titolo e contenuto sono obbligatori");
      return;
    }
    setBusy(true);
    try {
      const baseTags = ["github", type === "readme" ? "readme" : type === "changelog" ? "changelog" : "markdown"];
      const extraTags =
        type === "readme" ? ["documentazione tecnica", "repository"] :
        type === "changelog" ? ["modifiche", "sviluppo"] :
        [category.toLowerCase()];
      const tags = Array.from(new Set([...baseTags, ...extraTags]));

      const src = await createManualSource({
        brain_id: link.brain_id,
        title: title.trim(),
        content,
        description: `Import manuale da GitHub (${type})${repo ? ` — ${repo.owner}/${repo.name}` : ""}`,
        tags,
      });

      // Attach github metadata to the knowledge_source
      await supabase.from("knowledge_sources").update({
        metadata: {
          source: "github_manual_import",
          repo_url: link.repo_url ?? link.url ?? null,
          repository: repo ? `${repo.owner}/${repo.name}` : null,
          branch,
          file_path: path || null,
          import_type: type,
          category: type === "markdown" ? category : type,
          imported_from_tool: "GitHub",
          manual_import: true,
        } as never,
      }).eq("id", src.id);

      // Append import record to the tool link metadata
      const prev = (link.metadata?.imports ?? []) as ImportRecord[];
      const record: ImportRecord = {
        id: src.id,
        type,
        category: type === "markdown" ? category : undefined,
        title: title.trim(),
        branch,
        file_path: path || undefined,
        imported_at: new Date().toISOString(),
        source_id: src.id,
      };
      const nextMeta: ToolMeta = {
        ...(link.metadata ?? {}),
        branch,
        imports: [...prev, record],
      };
      await supabase.from("project_tool_links").update({ metadata: nextMeta as never }).eq("id", link.id);

      await logAction({
        action: "github_manual_import",
        message: `Import manuale GitHub (${type}): ${title.trim()}`,
        entity_type: "knowledge_source",
        entity_id: src.id,
        brain_id: link.brain_id,
      });

      toast.success("Contenuto importato dal repository GitHub");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore durante l'import");
    } finally {
      setBusy(false);
    }
  };

  const titleLabel =
    type === "readme" ? "Importa README" :
    type === "changelog" ? "Importa changelog" : "Importa file markdown";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{titleLabel}</DialogTitle>
          <DialogDescription>
            Import manuale: incolla il contenuto del file. Nessuna chiamata API a GitHub.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Titolo</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label>Branch</Label>
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
            </div>
            <div className="col-span-2">
              <Label>Path file (es. README.md)</Label>
              <Input value={path} onChange={(e) => setPath(e.target.value)} />
            </div>
            {type === "markdown" && (
              <div className="col-span-2">
                <Label>Categoria</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MD_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {type === "markdown" && (
              <div className="col-span-2">
                <Label>Carica file .md / .txt</Label>
                <Input type="file" accept=".md,.markdown,.txt"
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
              </div>
            )}
            <div className="col-span-2">
              <Label>Contenuto</Label>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={10}
                        placeholder="Incolla qui il contenuto del file…" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Annulla</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Importa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Manual Check Dialog ----------
function ManualCheckDialog({
  link, onClose, onDone,
}: { link: GithubLink; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<ManualCheckStatus>(
    (link.metadata?.manual_check_status as ManualCheckStatus) ?? "mai_verificato",
  );
  const [notes, setNotes] = useState((link.metadata?.manual_check_notes as string | undefined) ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const nextMeta: ToolMeta = {
        ...(link.metadata ?? {}),
        manual_check_status: status,
        manual_check_notes: notes || undefined,
      };
      const { error } = await supabase.from("project_tool_links").update({
        metadata: nextMeta as never,
        last_checked_at: new Date().toISOString(),
      }).eq("id", link.id);
      if (error) throw error;
      await logAction({
        action: "github_manual_check",
        message: `Stato manuale GitHub aggiornato: ${status}`,
        entity_type: "project_tool_link",
        entity_id: link.id,
        brain_id: link.brain_id,
      });
      toast.success("Stato manuale aggiornato");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aggiorna stato manuale</DialogTitle>
          <DialogDescription>
            Aggiorna i metadata del collegamento GitHub. Non viene fatta nessuna chiamata API.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Stato repository</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ManualCheckStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHECK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Note verifica</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Annulla</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
