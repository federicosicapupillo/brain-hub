import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/impostazioni")({
  head: () => ({ meta: [{ title: "Impostazioni — AI Brain" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Impostazioni" subtitle="Personalizza il comportamento del tuo brain." />
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="space-y-3 border-border/70 bg-card/60 p-4 glass">
          <div className="text-sm font-medium">Preferenze generali</div>
          <Row label="Tema scuro" defaultChecked />
          <Row label="Animazioni grafo" defaultChecked />
          <Row label="Sync automatica connettori" defaultChecked />
          <Row label="Notifiche agenti" />
        </Card>
        <Card className="space-y-3 border-border/70 bg-card/60 p-4 glass">
          <div className="text-sm font-medium">AI & Embeddings</div>
          <Row label="Indicizzazione documenti" defaultChecked />
          <Row label="Ricerca semantica" defaultChecked />
          <Row label="Riassunto AI nodi" defaultChecked />
          <p className="pt-2 text-xs text-muted-foreground">
            Per attivare realmente sync, autenticazione e ricerca semantica, abilita Lovable Cloud.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, defaultChecked }: { label: string; defaultChecked?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2">
      <Label className="text-sm">{label}</Label>
      <Switch defaultChecked={defaultChecked} />
    </div>
  );
}
