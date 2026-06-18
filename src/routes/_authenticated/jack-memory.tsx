import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertTriangle,
  Archive,
  BrainCog,
  CheckCircle2,
  FileText,
  ShieldAlert,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  approveJackMemoryDocument,
  archiveJackMemoryDocument,
  extractJackMemorySections,
  importJackMemoryMarkdown,
  listJackMemoryDocuments,
  logJackMemoryEvent,
  type ImportJackMemoryResult,
  type JackMemoryDocument,
  type SecretWarning,
} from "@/lib/jack-memory";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/jack-memory")({
  head: () => ({
    meta: [
      { title: "Jack Memory — Brain Hub" },
      {
        name: "description",
        content:
          "Importa, versiona e gestisci la memoria operativa di Jack (identità, stile, regole, alias progetti).",
      },
    ],
  }),
  component: JackMemoryPage,
});

function JackMemoryPage() {
  const [docs, setDocs] = useState<JackMemoryDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("Jack Memory Core — Federico Sica");
  const [filename, setFilename] = useState("Jack_Memory_Core_Federico_Sica.md");
  const [markdown, setMarkdown] = useState("");
  const [pendingWarnings, setPendingWarnings] = useState<SecretWarning[] | null>(null);
  const [importing, setImporting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const d = await listJackMemoryDocuments();
      setDocs(d);
    } catch (e) {
      toast.error("Errore", { description: String(e) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void logJackMemoryEvent("jack_memory_opened");
    void refresh();
  }, []);

  const current = docs.find((d) => d.status === "current") ?? null;
  const drafts = docs.filter((d) => d.status === "draft");
  const archived = docs.filter((d) => d.status === "archived");

  const previewSections = useMemo(() => {
    if (!markdown.trim()) return null;
    return extractJackMemorySections(markdown);
  }, [markdown]);

  const handleFile = async (file: File) => {
    const text = await file.text();
    setMarkdown(text);
    setFilename(file.name);
    if (!title) setTitle(file.name.replace(/\.md$/i, ""));
  };

  const handleImport = async (acknowledgeSecretWarnings = false) => {
    if (!markdown.trim()) {
      toast.error("Markdown vuoto");
      return;
    }
    setImporting(true);
    try {
      const res: ImportJackMemoryResult = await importJackMemoryMarkdown({
        title,
        filename,
        markdown,
        acknowledgeSecretWarnings,
      });
      if (res.kind === "duplicate") {
        toast("Contenuto già importato", {
          description: `Esiste già il documento "${res.existing.title}" (${res.existing.status}).`,
        });
        setPendingWarnings(null);
      } else if (res.kind === "blocked_secret_warning") {
        setPendingWarnings(res.warnings);
        toast.error("Possibili segreti rilevati", {
          description: `Trovati ${res.warnings.length} pattern sospetti. Revisiona prima di importare.`,
        });
      } else {
        toast("Importato come draft", {
          description:
            res.warnings.length > 0
              ? `Importato con ${res.warnings.length} warning segreti.`
              : "Documento salvato come bozza.",
        });
        setMarkdown("");
        setPendingWarnings(null);
        await refresh();
      }
    } catch (e) {
      toast.error("Errore import", { description: String(e) });
    } finally {
      setImporting(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await approveJackMemoryDocument(id);
      toast("Memoria corrente aggiornata");
      await refresh();
    } catch (e) {
      toast.error("Errore", { description: String(e) });
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await archiveJackMemoryDocument(id);
      toast("Documento archiviato");
      await refresh();
    } catch (e) {
      toast.error("Errore", { description: String(e) });
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-4">
      <PageHeader
        title="Jack Memory"
        subtitle="Memoria operativa di identità e contesto di Jack. Non sostituisce il Master Snapshot dei progetti."
      />

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Privacy</AlertTitle>
        <AlertDescription>
          Questa memoria può contenere informazioni personali e operative. Importa solo dati
          che vuoi rendere disponibili a Jack. Nessun contenuto viene inviato a servizi esterni:
          tutto resta nel tuo Brain Hub.
        </AlertDescription>
      </Alert>

      {/* Current */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            Memoria corrente
            <Badge variant={current ? "default" : "outline"} className="ml-auto">
              {current ? "configurata" : "mancante"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {current ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{current.title}</span>
                {current.version ? (
                  <Badge variant="secondary">v{current.version}</Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  importata {new Date(current.imported_at).toLocaleString()}
                </span>
              </div>
              <CurrentSectionsPreview document={current} />
              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to="/daily-brief">Apri Daily Brief</Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/daily-brief">Prova Jack</Link>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleArchive(current.id)}
                >
                  Archivia
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">
              Nessuna memoria attiva. Importa un Markdown qui sotto e approvalo come corrente.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Import */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" /> Importa memoria
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="jm-title">Titolo</Label>
              <Input
                id="jm-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="jm-filename">Filename</Label>
              <Input
                id="jm-filename"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="jm-file">File .md (opzionale)</Label>
            <Input
              id="jm-file"
              type="file"
              accept=".md,text/markdown,text/plain"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </div>
          <div>
            <Label htmlFor="jm-md">Markdown</Label>
            <Textarea
              id="jm-md"
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              rows={14}
              placeholder="# Identità&#10;Federico Sica…&#10;&#10;## Progetti&#10;- Brain Hub&#10;- Furia Immobiliare&#10;…"
              className="font-mono text-xs"
            />
          </div>

          {pendingWarnings && pendingWarnings.length > 0 ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Possibili segreti rilevati</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5 text-xs space-y-1 mt-1">
                  {pendingWarnings.map((w, i) => (
                    <li key={i}>
                      riga {w.line}: <code>{w.pattern}</code> ({w.example})
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleImport(true)}
                    disabled={importing}
                  >
                    Importa comunque
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPendingWarnings(null)}
                  >
                    Annulla
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <Button
              onClick={() => handleImport(false)}
              disabled={importing || !markdown.trim()}
            >
              {importing ? "Importazione…" : "Importa memoria"}
            </Button>
          )}

          {previewSections ? (
            <div className="rounded border p-2 text-xs space-y-1">
              <div className="font-medium flex items-center gap-2">
                <FileText className="h-3 w-3" /> Sezioni riconosciute
              </div>
              <div className="flex flex-wrap gap-1">
                {(["identity","style","background","projects","aliases","security","privacy","behavior","news"] as const).map((k) => (
                  <Badge key={k} variant={previewSections[k] ? "default" : "outline"}>
                    {k}
                  </Badge>
                ))}
                {Object.keys(previewSections.other).length > 0 ? (
                  <Badge variant="secondary">
                    +{Object.keys(previewSections.other).length} altre
                  </Badge>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Drafts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" /> Draft importati ({drafts.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {loading ? (
            <p className="text-muted-foreground">Caricamento…</p>
          ) : drafts.length === 0 ? (
            <p className="text-muted-foreground">Nessuna bozza in attesa.</p>
          ) : (
            drafts.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded border p-2"
              >
                <div className="flex-1">
                  <div className="font-medium">{d.title}</div>
                  <div className="text-xs text-muted-foreground">
                    importata {new Date(d.imported_at).toLocaleString()} •{" "}
                    {d.content_markdown.length} caratteri
                  </div>
                </div>
                <Button size="sm" onClick={() => handleApprove(d.id)}>
                  Approva come corrente
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleArchive(d.id)}
                >
                  Archivia
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Archived */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Archive className="h-4 w-4" /> Storico ({archived.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {archived.length === 0 ? (
            <p className="text-muted-foreground">Nessun documento archiviato.</p>
          ) : (
            archived.slice(0, 20).map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2 rounded border p-2 text-xs"
              >
                <span className="font-medium flex-1">{d.title}</span>
                <span className="text-muted-foreground">
                  archiviata{" "}
                  {d.archived_at
                    ? new Date(d.archived_at).toLocaleString()
                    : "—"}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CurrentSectionsPreview({ document }: { document: JackMemoryDocument }) {
  const sections = useMemo(
    () => extractJackMemorySections(document.content_markdown),
    [document.content_markdown],
  );
  const keys = (["identity", "behavior", "projects", "aliases"] as const).filter(
    (k) => sections[k],
  );
  if (keys.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nessuna sezione canonica riconosciuta nel Markdown.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((k) => (
        <Badge key={k} variant="secondary">
          {k}
        </Badge>
      ))}
    </div>
  );
}
