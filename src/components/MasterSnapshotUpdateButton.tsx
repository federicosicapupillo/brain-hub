import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  proposeMasterSnapshotUpdate,
  type MasterSnapshotSource,
  type MasterSnapshotChanges,
} from "@/lib/master-snapshot";

type Props = {
  source: MasterSnapshotSource;
  sourceId?: string | null;
  brainId?: string | null;
  defaultReason?: string;
  defaultChanges?: MasterSnapshotChanges;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg";
  label?: string;
};

function parseList(v: string): string[] {
  return v
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function MasterSnapshotUpdateButton({
  source,
  sourceId,
  brainId,
  defaultReason,
  defaultChanges,
  variant = "outline",
  size = "sm",
  label = "Aggiorna Master Snapshot",
}: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(defaultReason ?? "");
  const [summary, setSummary] = useState("");
  const [whatChanged, setWhatChanged] = useState(defaultChanges?.what_changed ?? "");
  const [modules, setModules] = useState((defaultChanges?.modules_completed ?? []).join("\n"));
  const [files, setFiles] = useState((defaultChanges?.files_modified ?? []).join("\n"));
  const [migrations, setMigrations] = useState((defaultChanges?.migrations ?? []).join("\n"));
  const [typecheck, setTypecheck] = useState(defaultChanges?.typecheck_status ?? "");
  const [build, setBuild] = useState(defaultChanges?.build_status ?? "");
  const [risks, setRisks] = useState((defaultChanges?.residual_risks ?? []).join("\n"));
  const [limits, setLimits] = useState((defaultChanges?.residual_limits ?? []).join("\n"));
  const [nextStep, setNextStep] = useState(defaultChanges?.next_step ?? "");
  const [sections, setSections] = useState((defaultChanges?.sections_updated ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [createdDraftId, setCreatedDraftId] = useState<string | null>(null);

  async function handleSubmit() {
    if (!reason.trim()) {
      toast.error("Inserisci un motivo per l'aggiornamento");
      return;
    }
    setBusy(true);
    try {
      const draft = await proposeMasterSnapshotUpdate({
        brainId,
        reason: reason.trim(),
        summary: summary.trim() || undefined,
        source,
        sourceId,
        changes: {
          what_changed: whatChanged.trim() || undefined,
          modules_completed: parseList(modules),
          files_modified: parseList(files),
          migrations: parseList(migrations),
          typecheck_status: typecheck.trim() || undefined,
          build_status: build.trim() || undefined,
          residual_risks: parseList(risks),
          residual_limits: parseList(limits),
          next_step: nextStep.trim() || undefined,
          sections_updated: parseList(sections),
        },
      });
      if (!draft?.id) {
        throw new Error("Bozza creata ma id mancante nella risposta");
      }
      setCreatedDraftId(draft.id);
      await qc.invalidateQueries({ queryKey: ["master-snapshots"] });
      toast.success("Bozza creata correttamente");
      try {
        await navigate({ to: "/master-snapshot", search: { draft: draft.id } });
        setOpen(false);
      } catch (navErr) {
        console.error("[MasterSnapshot] navigate failed", navErr);
        // keep dialog open so the user can use the "Apri bozza" fallback button
      }
    } catch (e) {
      console.error("[MasterSnapshot] proposeMasterSnapshotUpdate failed", e);
      const msg = e instanceof Error ? e.message : "Errore sconosciuto";
      toast.error(`Errore: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          <FileText className="mr-1 h-3 w-3" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Proponi aggiornamento Master Snapshot</DialogTitle>
          <DialogDescription>
            Crea una bozza. Verrà salvata come nuova versione solo dopo la tua approvazione manuale.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          <div>
            <Label htmlFor="ms-reason">Motivo aggiornamento *</Label>
            <Input
              id="ms-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Es. Completata v2.4 Company Simple Frontend"
            />
          </div>
          <div>
            <Label htmlFor="ms-summary">Sintesi</Label>
            <Textarea
              id="ms-summary"
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ms-what">Cosa è cambiato</Label>
            <Textarea
              id="ms-what"
              rows={3}
              value={whatChanged}
              onChange={(e) => setWhatChanged(e.target.value)}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="ms-mod">Moduli completati (uno per riga)</Label>
              <Textarea id="ms-mod" rows={3} value={modules} onChange={(e) => setModules(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ms-files">File modificati</Label>
              <Textarea id="ms-files" rows={3} value={files} onChange={(e) => setFiles(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ms-mig">Migration</Label>
              <Textarea id="ms-mig" rows={2} value={migrations} onChange={(e) => setMigrations(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ms-sect">Sezioni aggiornate</Label>
              <Textarea id="ms-sect" rows={2} value={sections} onChange={(e) => setSections(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ms-tc">Stato typecheck</Label>
              <Input id="ms-tc" value={typecheck} onChange={(e) => setTypecheck(e.target.value)} placeholder="ok / fail" />
            </div>
            <div>
              <Label htmlFor="ms-bd">Stato build</Label>
              <Input id="ms-bd" value={build} onChange={(e) => setBuild(e.target.value)} placeholder="ok / fail" />
            </div>
            <div>
              <Label htmlFor="ms-risk">Rischi residui</Label>
              <Textarea id="ms-risk" rows={2} value={risks} onChange={(e) => setRisks(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ms-lim">Limiti residui</Label>
              <Textarea id="ms-lim" rows={2} value={limits} onChange={(e) => setLimits(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="ms-next">Prossimo step consigliato</Label>
            <Input id="ms-next" value={nextStep} onChange={(e) => setNextStep(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Annulla
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? "Creazione…" : "Crea proposta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
