import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ExternalLink,
  FolderTree,
  Link2,
  Plug,
  Plus,
  RefreshCw,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  createDriveConnection,
  createKnowledgeSourceFromDriveFile,
  DRIVE_CATEGORY_LABEL,
  DRIVE_CONNECTION_STATUS_LABEL,
  DRIVE_CONNECTION_STATUS_TONE,
  type DriveConnection,
  type DriveFile,
  type DriveFileCategory,
  getDriveConnections,
  getDriveKnowledgeSummary,
  importManualDriveLink,
  listDriveFileMap,
  logDriveKnowledgeEvent,
  suggestDriveOrganization,
  syncDriveMetadata,
} from "@/lib/drive-knowledge";
import {
  disconnectGoogleDrive,
  getGoogleDriveOauthStatus,
  startGoogleDriveOAuth,
} from "@/lib/drive-oauth.functions";

export const Route = createFileRoute("/_authenticated/drive-knowledge")({
  head: () => ({
    meta: [
      { title: "Google Drive Knowledge — Brain Hub" },
      {
        name: "description",
        content:
          "Mappa documenti Google Drive in modalità read-only e collegali alla Knowledge Map di Brain Hub.",
      },
    ],
  }),
  component: DriveKnowledgeRoute,
});

type Brain = { id: string; name: string };

function DriveKnowledgeRoute() {
  const qc = useQueryClient();
  const [brainId, setBrainId] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [mimeFilter, setMimeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  const [openConnect, setOpenConnect] = useState(false);
  const [connectLabel, setConnectLabel] = useState("Google Drive");

  const [openManualLink, setOpenManualLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [linkConnectionId, setLinkConnectionId] = useState<string>("");

  useEffect(() => {
    void logDriveKnowledgeEvent("drive_connection_opened", "Drive Knowledge aperto");
  }, []);

  const { data: brains = [] } = useQuery({
    queryKey: ["drive-knowledge", "brains"],
    queryFn: async (): Promise<Brain[]> => {
      const { data, error } = await supabase
        .from("brains")
        .select("id, name")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Brain[];
    },
  });

  const brainFilter = brainId || null;

  const { data: connections = [], isLoading: loadingConnections } = useQuery({
    queryKey: ["drive-knowledge", "connections", brainFilter],
    queryFn: () => getDriveConnections(brainFilter),
  });

  const { data: files = [], isLoading: loadingFiles } = useQuery({
    queryKey: [
      "drive-knowledge",
      "files",
      brainFilter,
      categoryFilter,
      mimeFilter,
      statusFilter,
      search,
    ],
    queryFn: () =>
      listDriveFileMap({
        brainId: brainFilter,
        category: categoryFilter === "all" ? null : (categoryFilter as DriveFileCategory),
        mimePrefix: mimeFilter === "all" ? null : mimeFilter,
        status:
          statusFilter === "all"
            ? null
            : (statusFilter as DriveFile["status"]),
        search: search.trim() || null,
      }),
  });

  const { data: summary } = useQuery({
    queryKey: ["drive-knowledge", "summary", brainFilter],
    queryFn: () => getDriveKnowledgeSummary(brainFilter),
  });

  const { data: organization = [] } = useQuery({
    queryKey: ["drive-knowledge", "organization", brainFilter],
    queryFn: () => suggestDriveOrganization(brainFilter),
  });

  const categories = useMemo(
    () => Object.entries(DRIVE_CATEGORY_LABEL) as Array<[DriveFileCategory, string]>,
    [],
  );

  async function handleCreateConnection() {
    try {
      await createDriveConnection({
        label: connectLabel || "Google Drive",
        brainId: brainFilter,
        connectionStatus: "not_configured",
        metadata: { note: "OAuth non configurato — usa import manuale" },
      });
      toast.success("Connessione Drive creata (OAuth non configurato).");
      setOpenConnect(false);
      setConnectLabel("Google Drive");
      await qc.invalidateQueries({ queryKey: ["drive-knowledge"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore";
      toast.error(msg);
    }
  }

  async function handleManualLink() {
    try {
      await importManualDriveLink({
        url: linkUrl,
        name: linkName || undefined,
        brainId: brainFilter,
        connectionId: linkConnectionId || null,
      });
      toast.success("Link Drive importato");
      setOpenManualLink(false);
      setLinkUrl("");
      setLinkName("");
      setLinkConnectionId("");
      await qc.invalidateQueries({ queryKey: ["drive-knowledge"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore";
      toast.error(msg);
    }
  }

  async function handleSync(connection: DriveConnection) {
    const res = await syncDriveMetadata(connection.id);
    if (res.ok) {
      toast.success("Sync metadata Drive completato");
    } else {
      toast.error(res.reason ?? "Sync metadata fallito");
    }
    await qc.invalidateQueries({ queryKey: ["drive-knowledge"] });
  }

  async function handleCreateKnowledge(file: DriveFile) {
    const targetBrain = file.brain_id ?? brainFilter ?? brains[0]?.id ?? null;
    if (!targetBrain) {
      toast.error("Seleziona prima un progetto/cervello.");
      return;
    }
    try {
      await createKnowledgeSourceFromDriveFile(file.id, { brainId: targetBrain });
      toast.success("Knowledge source creata da file Drive");
      await qc.invalidateQueries({ queryKey: ["drive-knowledge"] });
      await qc.invalidateQueries({ queryKey: ["knowledge-sources"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore";
      toast.error(msg);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader
        title="Google Drive Knowledge"
        subtitle="Mappa documenti Drive in modalità read-only e collegali alla Knowledge Map"
        actions={
          <>
            <Badge variant="outline" className="text-[10px]">
              v2.8 read-only
            </Badge>
            <Button asChild size="sm" variant="outline">
              <Link to="/knowledge-map">Knowledge Map</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/tool-connections">Tool Connections</Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Select value={brainId} onValueChange={setBrainId}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="Tutti i progetti/cervelli" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tutti</SelectItem>
              {brains.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="default" onClick={() => setOpenConnect(true)}>
            <Plug className="mr-1 h-3 w-3" /> Collega Google Drive
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpenManualLink(true)}>
            <Link2 className="mr-1 h-3 w-3" /> Aggiungi link manuale
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryTile label="Connessioni" value={summary?.connections ?? 0} />
        <SummaryTile
          label="Configurate"
          value={summary?.configuredConnections ?? 0}
          hint={summary?.hasNeverSynced ? "Mai sincronizzata" : undefined}
        />
        <SummaryTile label="File mappati" value={summary?.totalFiles ?? 0} />
        <SummaryTile
          label="Knowledge source"
          value={summary?.knowledgeSourcesCreated ?? 0}
          tone={summary?.lastSyncFailed ? "warning" : "default"}
          hint={summary?.lastSyncFailed ? "Ultimo sync fallito" : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="h-4 w-4" /> Connessioni Drive ({connections.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingConnections ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessuna connessione Drive. Usa "Collega Google Drive" per creare un placeholder
              sicuro: l'OAuth reale non è ancora configurato in questa versione, ma puoi
              importare link manualmente.
            </p>
          ) : (
            <ul className="divide-y">
              {connections.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{c.label}</span>
                      <Badge
                        className={
                          DRIVE_CONNECTION_STATUS_TONE[c.connection_status] ??
                          "bg-muted text-muted-foreground border-border"
                        }
                      >
                        {DRIVE_CONNECTION_STATUS_LABEL[c.connection_status] ?? c.connection_status}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.last_sync_at
                        ? `Ultimo sync: ${new Date(c.last_sync_at).toLocaleString()}`
                        : "Mai sincronizzata"}
                      {c.root_folder_name ? ` · Root: ${c.root_folder_name}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleSync(c)}>
                      <RefreshCw className="mr-1 h-3 w-3" /> Sincronizza metadata
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            Sicurezza: Brain Hub non modifica, non sposta e non cancella file su Google Drive.
            Nessun contenuto file viene scaricato in v2.8.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FolderTree className="h-4 w-4" /> File mappati ({files.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <Input
              placeholder="Cerca per nome…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le categorie</SelectItem>
                {categories.map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={mimeFilter} onValueChange={setMimeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Tipo file" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i tipi</SelectItem>
                <SelectItem value="application/pdf">PDF</SelectItem>
                <SelectItem value="image/">Immagini</SelectItem>
                <SelectItem value="video/">Video</SelectItem>
                <SelectItem value="application/vnd.google-apps.folder">Cartelle</SelectItem>
                <SelectItem value="application/vnd.google-apps.document">Docs</SelectItem>
                <SelectItem value="application/vnd.google-apps.spreadsheet">Sheets</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti gli status</SelectItem>
                <SelectItem value="mapped">Mappato</SelectItem>
                <SelectItem value="linked">Linked a knowledge</SelectItem>
                <SelectItem value="archived">Archiviato</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loadingFiles ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : files.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessun file mappato. Importa un link manuale o sincronizza metadata.
            </p>
          ) : (
            <ul className="divide-y">
              {files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate max-w-md">{f.name}</span>
                      {f.category && (
                        <Badge variant="outline" className="text-[10px]">
                          {DRIVE_CATEGORY_LABEL[f.category]}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        {f.status}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {f.mime_type ?? "—"}
                      {f.modified_time
                        ? ` · ${new Date(f.modified_time).toLocaleString()}`
                        : ""}
                      {f.path ? ` · ${f.path}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {f.web_url && (
                      <Button asChild size="sm" variant="ghost">
                        <a href={f.web_url} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-1 h-3 w-3" /> Apri file
                        </a>
                      </Button>
                    )}
                    {f.status !== "linked" && (
                      <Button size="sm" variant="outline" onClick={() => handleCreateKnowledge(f)}>
                        <Plus className="mr-1 h-3 w-3" /> Crea knowledge source
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Suggerimenti di organizzazione
          </CardTitle>
        </CardHeader>
        <CardContent>
          {organization.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessun suggerimento. Mappa più file per ricevere raggruppamenti per categoria.
            </p>
          ) : (
            <ul className="divide-y">
              {organization.map((s) => (
                <li key={s.category} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <span className="font-medium">
                      {DRIVE_CATEGORY_LABEL[s.category]} ({s.count})
                    </span>
                    <div className="text-[11px] text-muted-foreground">{s.recommendation}</div>
                  </div>
                  {s.filesWithoutKnowledge > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {s.filesWithoutKnowledge} senza KS
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-2 p-4 text-[11px] text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-3 w-3" />
          <p>
            Brain Hub v2.8 è read-only: nessun file viene creato, spostato o cancellato su Google
            Drive. I token OAuth, se mai configurati, restano server-side e non sono mai esposti
            al frontend.
          </p>
        </CardContent>
      </Card>

      {/* Connect dialog */}
      <Dialog open={openConnect} onOpenChange={setOpenConnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Collega Google Drive</DialogTitle>
            <DialogDescription>
              OAuth Google non è ancora configurato in questa versione. Creiamo un connettore
              placeholder sicuro: potrai importare link Drive manualmente e mapparli alle
              knowledge source.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dk-label">Etichetta connessione</Label>
            <Input
              id="dk-label"
              value={connectLabel}
              onChange={(e) => setConnectLabel(e.target.value)}
              placeholder="Es. Google Drive — Azienda"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenConnect(false)}>
              Annulla
            </Button>
            <Button onClick={handleCreateConnection}>Crea connessione</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual link dialog */}
      <Dialog open={openManualLink} onOpenChange={setOpenManualLink}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aggiungi link Drive manuale</DialogTitle>
            <DialogDescription>
              Incolla un link Google Drive (file o cartella). Brain Hub salva solo metadata e
              link, non scarica contenuti.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="dk-link-url">URL Drive *</Label>
              <Input
                id="dk-link-url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://drive.google.com/file/d/…"
              />
            </div>
            <div>
              <Label htmlFor="dk-link-name">Nome (opzionale)</Label>
              <Input
                id="dk-link-name"
                value={linkName}
                onChange={(e) => setLinkName(e.target.value)}
                placeholder="Nome file/cartella"
              />
            </div>
            <div>
              <Label htmlFor="dk-link-conn">Connessione (opzionale)</Label>
              <Select value={linkConnectionId} onValueChange={setLinkConnectionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Nessuna connessione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nessuna</SelectItem>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenManualLink(false)}>
              Annulla
            </Button>
            <Button onClick={handleManualLink}>Importa link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "default" | "warning";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className={
            tone === "warning"
              ? "text-2xl font-semibold text-amber-600"
              : "text-2xl font-semibold"
          }
        >
          {value}
        </div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
