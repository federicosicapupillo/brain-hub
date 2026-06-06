import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Loader2 } from "lucide-react";
import { resetCurrentUserWorkspace, type ResetSummary } from "@/lib/reset-workspace";

export const Route = createFileRoute("/_authenticated/impostazioni")({
  head: () => ({ meta: [{ title: "Impostazioni — AI Brain" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="p-4 lg:p-6 space-y-4">
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

      <Card className="space-y-3 border-destructive/40 bg-card/60 p-4 glass">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Zona pericolosa
        </div>
        <p className="text-xs text-muted-foreground">
          Cancella tutti i tuoi cervelli, fonti, chunk, nodi, task, log e file caricati.
          Non cancella il tuo account.
        </p>
        <ResetButton />
      </Card>
    </div>
  );
}

function ResetButton() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleReset = async () => {
    if (confirm !== "RESET") return;
    setLoading(true);
    try {
      const summary: ResetSummary = await resetCurrentUserWorkspace();
      const total = Object.values(summary.tables).reduce((a, b) => a + b, 0);
      toast.success("Brain Hub resettato correttamente", {
        description: `${total} record eliminati · ${summary.storageFiles} file storage`,
      });
      setOpen(false);
      setConfirm("");
      navigate({ to: "/" });
    } catch (e) {
      toast.error("Errore durante il reset", {
        description: e instanceof Error ? e.message : "Errore sconosciuto",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Resetta il mio Brain Hub
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!loading) { setOpen(o); if (!o) setConfirm(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conferma reset</DialogTitle>
            <DialogDescription>
              Questa azione cancella tutti i tuoi cervelli, fonti, chunk, nodi, task,
              log e file caricati. Non cancella il tuo account. Scrivi{" "}
              <span className="font-mono font-semibold text-destructive">RESET</span>{" "}
              per confermare.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="RESET"
            disabled={loading}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Annulla
            </Button>
            <Button
              variant="destructive"
              onClick={handleReset}
              disabled={confirm !== "RESET" || loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Conferma reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
