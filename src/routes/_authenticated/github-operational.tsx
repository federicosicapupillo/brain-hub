import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  listGithubRepositories,
  createGithubRepository,
  archiveGithubRepository,
  normalizeSuspectRepository,
  listCodeFileMap,
  addCodeFileToMap,
  suggestCodeActionsForRepository,
  createCodeActionFromSuggestion,
  buildCodexPromptForAction,
  buildClaudeCodePromptForAction,
  buildGithubIssueDraftForAction,
  createGithubOperationalReview,
  logGithubOperationalEvent,
  ENGINE_LABEL,
  type GithubRepository,
  type CodeActionSuggestion,
  type SupportedEngine,
} from "@/lib/github-operational";
import {
  parseGithubRepositoryInput,
  isSuspectRepositoryRecord,
} from "@/lib/github-repository-parse";
import {
  ExternalLink,
  GitBranch,
  Plus,
  FileCode,
  Sparkles,
  Copy,
  Archive,
  CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/github-operational")({
  head: () => ({
    meta: [
      { title: "GitHub / Codex Operational — Brain Hub" },
      {
        name: "description",
        content:
          "Connettore manuale GitHub / Codex per Brain Hub: registry repository, mappa file, prompt operativi.",
      },
    ],
  }),
  component: GithubOperationalPage,
});

type Brain = { id: string; name: string };

function GithubOperationalPage() {
  const qc = useQueryClient();
  const [brainId, setBrainId] = useState<string | null>(null);
  const [openAddRepo, setOpenAddRepo] = useState(false);
  const [openAddFile, setOpenAddFile] = useState<GithubRepository | null>(null);
  const [openSuggestions, setOpenSuggestions] = useState<GithubRepository | null>(null);
  const [openPromptPreview, setOpenPromptPreview] = useState<{
    title: string;
    body: string;
  } | null>(null);

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-min"],
    queryFn: async (): Promise<Brain[]> => {
      const { data } = await supabase.from("brains").select("id,name").order("name");
      return (data ?? []) as Brain[];
    },
  });

  const reposQ = useQuery({
    queryKey: ["gho-repos", brainId],
    queryFn: () => listGithubRepositories(brainId ?? null),
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title="GitHub / Codex Operational"
        subtitle="Connettore manual-first. Nessun commit, push o PR automatici."
      />


      <Card>
        <CardHeader>
          <CardTitle className="text-base">Selettore brain</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3 items-end flex-wrap">
          <div className="space-y-1">
            <Label>Brain</Label>
            <Select
              value={brainId ?? "__all"}
              onValueChange={(v) => setBrainId(v === "__all" ? null : v)}
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Tutti i brain</SelectItem>
                {brains.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => setOpenAddRepo(true)}>
            <Plus className="w-4 h-4 mr-1" /> Aggiungi repository
          </Button>
          <Link to="/action-queue">
            <Button variant="outline">Apri Action Queue</Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="w-4 h-4" /> Repository collegati ({reposQ.data?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {reposQ.isLoading && <div className="text-sm text-muted-foreground">Caricamento…</div>}
          {reposQ.data && reposQ.data.length === 0 && (
            <div className="text-sm text-muted-foreground">
              Nessun repository collegato. Usa "Aggiungi repository".
            </div>
          )}
          {reposQ.data?.map((r) => (
            <RepoRow
              key={r.id}
              repo={r}
              onAddFile={() => setOpenAddFile(r)}
              onSuggestions={() => setOpenSuggestions(r)}
              onArchive={async () => {
                if (!confirm("Archiviare il repository?")) return;
                await archiveGithubRepository(r.id);
                toast.success("Repository archiviato");
                await qc.invalidateQueries({ queryKey: ["gho-repos"] });
              }}
            />
          ))}
        </CardContent>
      </Card>

      <AddRepoDialog
        open={openAddRepo}
        onOpenChange={setOpenAddRepo}
        brainId={brainId}
        onCreated={async () => {
          await qc.invalidateQueries({ queryKey: ["gho-repos"] });
        }}
      />

      <AddFileDialog
        repo={openAddFile}
        onOpenChange={(open) => !open && setOpenAddFile(null)}
        onCreated={async () => {
          await qc.invalidateQueries({ queryKey: ["gho-files"] });
        }}
      />

      <SuggestionsDialog
        repo={openSuggestions}
        brainId={brainId}
        onOpenChange={(open) => !open && setOpenSuggestions(null)}
        onPreviewPrompt={(title, body) => setOpenPromptPreview({ title, body })}
      />

      <PromptPreviewDialog
        data={openPromptPreview}
        onOpenChange={(open) => !open && setOpenPromptPreview(null)}
      />
    </div>
  );
}

function RepoRow({
  repo,
  onAddFile,
  onSuggestions,
  onArchive,
}: {
  repo: GithubRepository;
  onAddFile: () => void;
  onSuggestions: () => void;
  onArchive: () => void;
}) {
  const filesQ = useQuery({
    queryKey: ["gho-files", repo.id],
    queryFn: () => listCodeFileMap({ repository_id: repo.id }),
  });
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{repo.repository_url}</div>
          <div className="text-xs text-muted-foreground flex gap-2 flex-wrap mt-0.5">
            {repo.repository_owner && repo.repository_name && (
              <span>
                {repo.repository_owner}/{repo.repository_name}
              </span>
            )}
            {repo.default_branch && <Badge variant="outline">{repo.default_branch}</Badge>}
            <Badge variant="secondary">{repo.connected_status}</Badge>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a href={repo.repository_url} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <ExternalLink className="w-3.5 h-3.5 mr-1" /> Apri repository
            </Button>
          </a>
          <Button variant="outline" size="sm" onClick={onAddFile}>
            <FileCode className="w-3.5 h-3.5 mr-1" /> Aggiungi file
          </Button>
          <Button variant="outline" size="sm" onClick={onSuggestions}>
            <Sparkles className="w-3.5 h-3.5 mr-1" /> Suggerimenti
          </Button>
          <Button variant="ghost" size="sm" onClick={onArchive}>
            <Archive className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {filesQ.data && filesQ.data.length > 0 && (
        <div className="text-xs space-y-1 pt-2 border-t">
          <div className="text-muted-foreground">File mappati ({filesQ.data.length})</div>
          <ul className="space-y-0.5">
            {filesQ.data.slice(0, 8).map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <FileCode className="w-3 h-3 text-muted-foreground" />
                <span className="font-mono truncate">{f.file_path}</span>
                {f.importance && (
                  <Badge variant="outline" className="text-[10px]">
                    {f.importance}
                  </Badge>
                )}
                {f.area && (
                  <Badge variant="outline" className="text-[10px]">
                    {f.area}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function humanizePgError(e: unknown): string {
  const err = e as { code?: string; message?: string; name?: string } | null;
  if (!err) return "Errore salvataggio repository";
  if (err.name === "GithubRepositoryRegistryError") {
    if (err.code === "github_repository_already_exists") return "Repository già presente";
    if (err.code === "github_repository_url_invalid")
      return "URL GitHub non valido. Usa il formato https://github.com/owner/repo";
    if (err.code === "not_authenticated") return "Non autenticato";
  }
  if (err.code === "23505") return "Repository già presente";
  if (err.code === "42501") return "Permesso negato dalla RLS";
  return err.message || "Errore salvataggio repository";
}

function AddRepoDialog({
  open,
  onOpenChange,
  brainId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brainId: string | null;
  onCreated: () => void | Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("main");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [urlTouched, setUrlTouched] = useState(false);

  useEffect(() => {
    if (!open) {
      setUrl("");
      setOwner("");
      setName("");
      setBranch("main");
      setNote("");
      setUrlTouched(false);
    }
  }, [open]);

  const parsed = useMemo(() => parseGithubUrl(url), [url]);

  // Auto-fill owner/name from URL whenever URL changes and yields a valid parse
  useEffect(() => {
    if (parsed) {
      setOwner(parsed.owner);
      setName(parsed.name);
    }
  }, [parsed]);

  const urlError =
    urlTouched && url.trim() && !parsed
      ? "URL GitHub non valido. Usa il formato https://github.com/owner/repo"
      : null;

  const canSubmit =
    !busy && !!parsed && owner.trim().length > 0 && name.trim().length > 0;

  const handleSubmit = async () => {
    if (!parsed) {
      toast.error("URL GitHub non valido. Usa il formato https://github.com/owner/repo");
      return;
    }
    const ownerTrim = owner.trim();
    const nameTrim = name.trim();
    if (!ownerTrim || !nameTrim) {
      toast.error("Owner e repository name sono obbligatori");
      return;
    }
    setBusy(true);
    try {
      // Pre-check duplicates for same user (RLS scopes select to current user)
      const { data: existing } = await supabase
        .from("github_repository_registry")
        .select("id")
        .eq("repository_url", parsed.url)
        .maybeSingle();
      if (existing) {
        toast.error("Repository già presente");
        setBusy(false);
        return;
      }
      await createGithubRepository({
        brain_id: brainId,
        repository_url: parsed.url,
        repository_owner: ownerTrim,
        repository_name: nameTrim,
        default_branch: branch.trim() || "main",
        metadata: note.trim() ? { note: note.trim() } : {},
      });
      toast.success("Repository aggiunto");
      await onCreated();
      onOpenChange(false);
    } catch (e) {
      toast.error(humanizePgError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aggiungi repository</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Repository URL</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => setUrlTouched(true)}
              placeholder="https://github.com/owner/repo"
            />
            {urlError && (
              <div className="mt-1 text-xs text-destructive">{urlError}</div>
            )}
            {parsed && (
              <div className="mt-1 text-xs text-muted-foreground">
                Rilevato: <span className="font-mono">{parsed.owner}/{parsed.name}</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Owner</Label>
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} />
            </div>
            <div>
              <Label>Repository name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Default branch</Label>
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
          <div>
            <Label>Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Annulla
          </Button>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            {busy ? "Salvataggio…" : "Aggiungi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddFileDialog({
  repo,
  onOpenChange,
  onCreated,
}: {
  repo: GithubRepository | null;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void | Promise<void>;
}) {
  const [path, setPath] = useState("");
  const [type, setType] = useState("");
  const [importance, setImportance] = useState<string>("medium");
  const [area, setArea] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!repo) {
      setPath("");
      setType("");
      setImportance("medium");
      setArea("");
      setSummary("");
    }
  }, [repo]);

  return (
    <Dialog open={!!repo} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aggiungi file importante</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>File path</Label>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="src/lib/foo.ts"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Tipo</Label>
              <Input
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="ts / tsx / sql"
              />
            </div>
            <div>
              <Label>Importanza</Label>
              <Select value={importance} onValueChange={setImportance}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Area</Label>
            <Input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="auth / api / ui …"
            />
          </div>
          <div>
            <Label>Sommario</Label>
            <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button
            disabled={busy || !path.trim() || !repo}
            onClick={async () => {
              if (!repo) return;
              setBusy(true);
              try {
                await addCodeFileToMap({
                  brain_id: repo.brain_id,
                  project_id: repo.project_id,
                  repository_id: repo.id,
                  file_path: path.trim(),
                  file_type: type.trim() || null,
                  importance,
                  area: area.trim() || null,
                  summary: summary.trim() || null,
                });
                toast.success("File mappato");
                onOpenChange(false);
                await onCreated();
              } catch (e) {
                toast.error("Errore", { description: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            Aggiungi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuggestionsDialog({
  repo,
  brainId,
  onOpenChange,
  onPreviewPrompt,
}: {
  repo: GithubRepository | null;
  brainId: string | null;
  onOpenChange: (v: boolean) => void;
  onPreviewPrompt: (title: string, body: string) => void;
}) {
  const [items, setItems] = useState<CodeActionSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!repo) {
      setItems([]);
      return;
    }
    setLoading(true);
    suggestCodeActionsForRepository(repo.id)
      .then(setItems)
      .catch((e: unknown) =>
        toast.error("Errore suggerimenti", { description: (e as Error).message }),
      )
      .finally(() => setLoading(false));
  }, [repo]);

  return (
    <Dialog open={!!repo} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Suggerimenti azioni codice</DialogTitle>
        </DialogHeader>
        {loading && <div className="text-sm text-muted-foreground">Caricamento…</div>}
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {items.map((s) => (
            <SuggestionRow
              key={s.id}
              suggestion={s}
              brainId={brainId}
              projectId={repo?.project_id ?? null}
              onPreviewPrompt={onPreviewPrompt}
            />
          ))}
          {!loading && items.length === 0 && (
            <div className="text-sm text-muted-foreground">Nessun suggerimento.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SuggestionRow({
  suggestion,
  brainId,
  projectId,
  onPreviewPrompt,
}: {
  suggestion: CodeActionSuggestion;
  brainId: string | null;
  projectId: string | null;
  onPreviewPrompt: (title: string, body: string) => void;
}) {
  const [createdActionId, setCreatedActionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createAction() {
    setBusy(true);
    try {
      const a = await createCodeActionFromSuggestion(suggestion, {
        brain_id: brainId,
        project_id: projectId,
      });
      setCreatedActionId(a.id);
      toast.success("Action creata");
    } catch (e) {
      toast.error("Errore", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function previewPrompt(engine: SupportedEngine) {
    if (!createdActionId) {
      toast.error("Crea prima l'action");
      return;
    }
    try {
      let body = "";
      let title = "";
      if (engine === "codex") {
        body = await buildCodexPromptForAction(createdActionId);
        title = `Prompt Codex — ${suggestion.title}`;
      } else if (engine === "claude_code") {
        body = await buildClaudeCodePromptForAction(createdActionId);
        title = `Prompt Claude Code — ${suggestion.title}`;
      } else if (engine === "github") {
        const d = await buildGithubIssueDraftForAction(createdActionId);
        body = `# ${d.title}\n\n${d.body}`;
        title = `Bozza GitHub Issue — ${suggestion.title}`;
      } else {
        body = await buildCodexPromptForAction(createdActionId);
        title = `Prompt manuale — ${suggestion.title}`;
      }
      onPreviewPrompt(title, body);
      try {
        await navigator.clipboard.writeText(body);
        toast.success("Prompt copiato negli appunti");
      } catch {
        // clipboard may be blocked; preview still shown
      }
    } catch (e) {
      toast.error("Errore", { description: (e as Error).message });
    }
  }

  async function createReview(engine: SupportedEngine) {
    if (!createdActionId) {
      toast.error("Crea prima l'action");
      return;
    }
    try {
      const prompt = await buildCodexPromptForAction(createdActionId);
      await createGithubOperationalReview({
        action_id: createdActionId,
        repository_id: suggestion.repository_id,
        engine,
        prompt,
        file_path: suggestion.file_path ?? null,
        brain_id: brainId,
        project_id: projectId,
        title: `Review handoff: ${suggestion.title}`,
      });
      toast.success("Result Review creata");
    } catch (e) {
      toast.error("Errore", { description: (e as Error).message });
    }
  }

  return (
    <div className="border rounded p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-sm">{suggestion.title}</div>
          <div className="text-xs text-muted-foreground">{suggestion.description}</div>
          <div className="text-[11px] text-muted-foreground mt-1 italic">
            {suggestion.reason}
          </div>
        </div>
        <Badge variant="outline" className="shrink-0">
          {suggestion.action_type}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {createdActionId ? (
          <Badge variant="secondary" className="text-[10px]">
            <CheckCircle2 className="w-3 h-3 mr-1" /> Action creata
          </Badge>
        ) : (
          <Button size="sm" disabled={busy} onClick={createAction}>
            Crea action
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!createdActionId}
          onClick={() => previewPrompt("codex")}
        >
          <Copy className="w-3 h-3 mr-1" /> Codex
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!createdActionId}
          onClick={() => previewPrompt("claude_code")}
        >
          <Copy className="w-3 h-3 mr-1" /> Claude Code
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!createdActionId}
          onClick={() => previewPrompt("github")}
        >
          <Copy className="w-3 h-3 mr-1" /> GitHub Issue
        </Button>
        <Select
          onValueChange={(v) => void createReview(v as SupportedEngine)}
          disabled={!createdActionId}
        >
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue placeholder="Crea Result Review" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ENGINE_LABEL) as SupportedEngine[]).map((e) => (
              <SelectItem key={e} value={e}>
                Review · {ENGINE_LABEL[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {createdActionId && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t mt-2">
          <span className="text-[11px] text-muted-foreground self-center mr-1">
            Codex / Claude Code handoff:
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const { createCodeEngineHandoffFromAction } = await import(
                  "@/lib/code-engine-handoff"
                );
                await createCodeEngineHandoffFromAction(createdActionId, "codex");
                toast.success("Handoff Codex creato");
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Prepara con Codex
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const { createCodeEngineHandoffFromAction } = await import(
                  "@/lib/code-engine-handoff"
                );
                await createCodeEngineHandoffFromAction(createdActionId, "claude_code");
                toast.success("Handoff Claude Code creato");
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Prepara con Claude Code
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/code-handoffs">Apri Code Handoffs</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function PromptPreviewDialog({
  data,
  onOpenChange,
}: {
  data: { title: string; body: string } | null;
  onOpenChange: (v: boolean) => void;
}) {
  const preview = useMemo(() => data?.body ?? "", [data]);
  return (
    <Dialog open={!!data} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{data?.title ?? "Prompt"}</DialogTitle>
        </DialogHeader>
        <Textarea value={preview} readOnly rows={20} className="font-mono text-xs" />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(preview);
                toast.success("Copiato");
              } catch {
                toast.error("Clipboard non disponibile");
              }
            }}
          >
            <Copy className="w-3.5 h-3.5 mr-1" /> Copia
          </Button>
          <Button onClick={() => onOpenChange(false)}>Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
