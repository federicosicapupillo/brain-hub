import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, Plug, RefreshCw, Trash2, Plus } from "lucide-react";
import {
  CONNECTOR_CATALOG,
  listConnectorRegistry,
  listProjectSourceMappings,
  seedConnectorRegistry,
  createProjectSourceMapping,
  deleteProjectSourceMapping,
  seedPupilloQuickMappings,
  logConnectorHubEvent,
  type ConnectorKey,
  type ConnectorRegistryRow,
  type ProjectSourceMappingRow,
} from "@/lib/connector-hub";
import { listProjectStateSnapshots } from "@/lib/project-state-sync";

export const Route = createFileRoute("/_authenticated/connector-hub")({
  head: () => ({
    meta: [
      { title: "Connector Hub — Brain Hub" },
      {
        name: "description",
        content:
          "Stato dei connettori (Drive, Gmail, Calendar, GitHub, Supabase, Obsidian, Telegram, n8n, Lovable) e mapping fonti↔progetti.",
      },
    ],
  }),
  component: ConnectorHubPage,
});

const STATUS_TONE: Record<string, string> = {
  connected: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  read_only: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  error: "bg-red-500/15 text-red-700 dark:text-red-300",
  not_configured: "bg-muted text-muted-foreground",
  manual: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};

const STATUS_LABEL: Record<string, string> = {
  connected: "Connesso",
  read_only: "Read-only",
  warning: "Warning",
  error: "Errore",
  not_configured: "Non configurato",
  manual: "Manuale",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={STATUS_TONE[status] ?? "bg-muted"}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

function ConnectorHubPage() {
  const qc = useQueryClient();
  const [seeding, setSeeding] = useState(false);

  const { data: registry = [], isLoading: regLoading } = useQuery<ConnectorRegistryRow[]>({
    queryKey: ["connector-hub", "registry"],
    queryFn: listConnectorRegistry,
  });
  const { data: mappings = [], isLoading: mapLoading } = useQuery<ProjectSourceMappingRow[]>({
    queryKey: ["connector-hub", "mappings"],
    queryFn: () => listProjectSourceMappings(),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["project-state-snapshots", "for-hub"],
    queryFn: () => listProjectStateSnapshots(),
  });

  // Merge catalog with registry rows (so unseeded connectors still appear).
  const merged = useMemo(() => {
    const byKey = new Map(registry.map((r) => [r.connector_key, r]));
    return CONNECTOR_CATALOG.map((c) => {
      const r = byKey.get(c.key);
      return {
        catalog: c,
        row: r ?? null,
        status: r?.status ?? "not_configured",
        last_sync_at: r?.last_sync_at ?? null,
        permission_level: r?.permission_level ?? c.defaultPermission,
      };
    });
  }, [registry]);

  const mappingsByConnector = useMemo(() => {
    const m = new Map<string, ProjectSourceMappingRow[]>();
    for (const row of mappings) {
      if (!m.has(row.connector_key)) m.set(row.connector_key, []);
      m.get(row.connector_key)!.push(row);
    }
    return m;
  }, [mappings]);

  const onSeed = async () => {
    setSeeding(true);
    try {
      const res = await seedConnectorRegistry();
      toast.success(
        `Connettori inizializzati: ${res.created} nuovi, ${res.updated} aggiornati (${res.total} totali).`,
      );
      await qc.invalidateQueries({ queryKey: ["connector-hub"] });
    } catch (e) {
      toast.error(`Seed fallito: ${(e as Error).message}`);
    } finally {
      setSeeding(false);
    }
  };

  const [seedingPupillo, setSeedingPupillo] = useState(false);
  const onSeedPupillo = async () => {
    setSeedingPupillo(true);
    try {
      const res = await seedPupilloQuickMappings();
      toast.success(
        `Pupillo — mapping creati: ${res.created}, già esistenti: ${res.skipped} (su ${res.total}).`,
      );
      await qc.invalidateQueries({ queryKey: ["connector-hub", "mappings"] });
    } catch (e) {
      toast.error(`Errore quick mapping Pupillo: ${(e as Error).message}`);
    } finally {
      setSeedingPupillo(false);
    }
  };

  // Mapping form state
  const [mProject, setMProject] = useState<string>("");
  const [mConnector, setMConnector] = useState<ConnectorKey | "">("");
  const [mType, setMType] = useState("");
  const [mLabel, setMLabel] = useState("");
  const [mRef, setMRef] = useState("");
  const [mUrl, setMUrl] = useState("");
  const [creating, setCreating] = useState(false);

  const projectOptions = useMemo(
    () =>
      projects.map((p) => ({
        key: p.project_key,
        label: p.project_name ?? p.project_key,
      })),
    [projects],
  );

  const onCreateMapping = async () => {
    if (!mProject || !mConnector || !mType || !mLabel) {
      toast.error("Compila progetto, connettore, tipo fonte e label.");
      return;
    }
    setCreating(true);
    try {
      await createProjectSourceMapping({
        project_key: mProject,
        connector_key: mConnector,
        source_type: mType,
        source_label: mLabel,
        source_ref: mRef.trim() || null,
        source_url: mUrl.trim() || null,
      });
      toast.success("Mapping creato.");
      setMType("");
      setMLabel("");
      setMRef("");
      setMUrl("");
      await qc.invalidateQueries({ queryKey: ["connector-hub", "mappings"] });
    } catch (e) {
      toast.error(`Errore: ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const onDeleteMapping = async (id: string) => {
    try {
      await deleteProjectSourceMapping(id);
      toast.success("Mapping eliminato.");
      await qc.invalidateQueries({ queryKey: ["connector-hub", "mappings"] });
    } catch (e) {
      toast.error(`Errore: ${(e as Error).message}`);
    }
  };

  // Log open once.
  useMemo(() => {
    void logConnectorHubEvent("connector_hub_opened", {});
    return null;
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connector Hub"
        subtitle="Stato connettori (read-only o manual-first) e mapping fonti ai progetti."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSeed} disabled={seeding} size="sm">
          <RefreshCw className={`mr-2 h-4 w-4 ${seeding ? "animate-spin" : ""}`} />
          {registry.length === 0 ? "Inizializza connettori" : "Aggiorna stato connettori"}
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/project-state">Apri Project State</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4" /> Connettori
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {regLoading ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {merged.map((m) => {
                const sources = mappingsByConnector.get(m.catalog.key) ?? [];
                return (
                  <div
                    key={m.catalog.key}
                    className="rounded-lg border bg-card p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{m.catalog.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {m.catalog.description}
                        </div>
                      </div>
                      <StatusBadge status={m.status} />
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>Permesso: {m.permission_level}</span>
                      <span>•</span>
                      <span>
                        Ultimo sync:{" "}
                        {m.last_sync_at
                          ? new Date(m.last_sync_at).toLocaleString()
                          : "—"}
                      </span>
                      <span>•</span>
                      <span>Fonti mappate: {sources.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {m.catalog.ctaRoute ? (
                        <Button asChild size="sm" variant="outline">
                          <Link to={m.catalog.ctaRoute}>{m.catalog.ctaLabel}</Link>
                        </Button>
                      ) : (
                        <Badge variant="outline">{m.catalog.ctaLabel}</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Mappa fonti ai progetti
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="text-xs text-muted-foreground">Progetto</label>
              <Select value={mProject} onValueChange={setMProject}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona progetto" />
                </SelectTrigger>
                <SelectContent>
                  {projectOptions.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Connettore</label>
              <Select
                value={mConnector}
                onValueChange={(v) => setMConnector(v as ConnectorKey)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona connettore" />
                </SelectTrigger>
                <SelectContent>
                  {CONNECTOR_CATALOG.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tipo fonte</label>
              <Input
                value={mType}
                onChange={(e) => setMType(e.target.value)}
                placeholder="es. folder, email_label, repo, calendar, vault, summary"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-muted-foreground">Label</label>
              <Input
                value={mLabel}
                onChange={(e) => setMLabel(e.target.value)}
                placeholder="es. Idealista API"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Ref (opzionale)</label>
              <Input
                value={mRef}
                onChange={(e) => setMRef(e.target.value)}
                placeholder="folderId / repo / label / vault"
              />
            </div>
            <div className="md:col-span-3">
              <label className="text-xs text-muted-foreground">URL (opzionale)</label>
              <Input
                value={mUrl}
                onChange={(e) => setMUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>
          <Button onClick={onCreateMapping} disabled={creating} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Crea mapping
          </Button>

          <div className="pt-2 space-y-2">
            <div className="text-sm font-medium">Mappings esistenti</div>
            {mapLoading ? (
              <p className="text-sm text-muted-foreground">Caricamento…</p>
            ) : mappings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nessun mapping. Aggiungi la prima fonte qui sopra.
              </p>
            ) : (
              <div className="space-y-2">
                {mappings.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-start justify-between rounded-md border bg-card p-3 gap-2"
                  >
                    <div className="text-sm">
                      <div className="font-medium">{m.source_label}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.project_key} · {m.connector_key} · {m.source_type}
                        {m.source_ref ? ` · ${m.source_ref}` : ""}
                      </div>
                      {m.source_url ? (
                        <a
                          href={m.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary underline-offset-2 hover:underline"
                        >
                          {m.source_url}
                        </a>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onDeleteMapping(m.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Note di sicurezza
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>Tutti i connettori sono read-only o manual-first.</p>
          <p>
            Nessuna scrittura automatica su Drive/Gmail/Calendar/GitHub/Supabase/Obsidian, nessun
            invio Telegram, nessuna esecuzione n8n senza approval.
          </p>
          <p>Nessun token, body email/file/calendar o query SQL viene loggato.</p>
        </CardContent>
      </Card>
    </div>
  );
}
