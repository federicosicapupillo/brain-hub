import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import {
  createTelegramConnection,
  deleteTelegramConnection,
  listTelegramConnections,
  updateTelegramConnection,
  type TelegramConnection,
} from "@/lib/telegram-connections";
import { checkTelegramTokenConfig } from "@/lib/telegram-send.functions";

export function TelegramSettingsSection({ brainId }: { brainId: string | null }) {
  const qc = useQueryClient();
  const { data: connections = [] } = useQuery({
    queryKey: ["telegram-connections", brainId],
    queryFn: () => listTelegramConnections(brainId),
  });
  const { data: tokenStatus } = useQuery({
    queryKey: ["telegram-token-config"],
    queryFn: () => checkTelegramTokenConfig(),
  });
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [chatId, setChatId] = useState("");
  const [defaultFor, setDefaultFor] = useState(false);

  const tokenConfigured = !!tokenStatus?.configured;

  const refresh = () => qc.invalidateQueries({ queryKey: ["telegram-connections", brainId] });

  async function handleAdd() {
    if (!label.trim() || !chatId.trim()) {
      toast.error("Label e chat_id sono obbligatori");
      return;
    }
    try {
      await createTelegramConnection({
        label,
        chat_id: chatId,
        brain_id: brainId,
        default_for_approvals: defaultFor,
      });
      toast.success("Destinazione Telegram creata");
      setLabel("");
      setChatId("");
      setDefaultFor(false);
      setAdding(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  async function toggleEnabled(c: TelegramConnection) {
    try {
      await updateTelegramConnection(c.id, { is_enabled: !c.is_enabled });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  async function setDefault(c: TelegramConnection) {
    try {
      await updateTelegramConnection(c.id, { default_for_approvals: true });
      toast.success("Default aggiornato");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  async function remove(c: TelegramConnection) {
    if (!window.confirm(`Eliminare destinazione "${c.label}"?`)) return;
    try {
      await deleteTelegramConnection(c.id);
      toast.success("Eliminata");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>Connessione Telegram</span>
          {tokenConfigured ? (
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
            >
              <CheckCircle2 className="mr-1 h-3 w-3" /> Token server configurato
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-amber-500/30 bg-amber-500/10 text-amber-700"
            >
              <ShieldAlert className="mr-1 h-3 w-3" /> Token server non configurato
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!tokenConfigured && (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700">
            Configura <code>TELEGRAM_BOT_TOKEN</code> come server secret per abilitare l'invio
            reale. Il token <strong>non</strong> deve essere salvato nel database né esposto al
            frontend.
          </div>
        )}

        {connections.length === 0 ? (
          <div className="rounded border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            Nessuna destinazione configurata. Aggiungi un <code>chat_id</code> Telegram.
          </div>
        ) : (
          <ul className="space-y-1">
            {connections.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 bg-background/40 p-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-medium">{c.label}</span>
                    <Badge variant="outline" className="text-[10px]">
                      chat: {c.chat_id}
                    </Badge>
                    {c.default_for_approvals && (
                      <Badge
                        variant="outline"
                        className="border-sky-500/30 bg-sky-500/10 text-[10px] text-sky-700"
                      >
                        default
                      </Badge>
                    )}
                    {!c.is_enabled && (
                      <Badge variant="outline" className="text-[10px]">
                        disabilitata
                      </Badge>
                    )}
                    {c.brain_id ? (
                      <span className="text-[10px] text-muted-foreground">progetto-scoped</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">globale</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {!c.default_for_approvals && c.is_enabled && (
                    <Button size="sm" variant="ghost" onClick={() => setDefault(c)}>
                      Imposta default
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => toggleEnabled(c)}>
                    {c.is_enabled ? "Disabilita" : "Abilita"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(c)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {adding ? (
          <div className="space-y-2 rounded border border-border/60 bg-background/40 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Label</Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="es. Approvazioni team"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Chat ID Telegram</Label>
                <Input
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="es. -1001234567890 o 123456"
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={defaultFor}
                onChange={(e) => setDefaultFor(e.target.checked)}
              />
              Imposta come default per approvazioni
            </label>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd}>
                Salva
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Annulla
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Non inserire qui token o segreti. Solo identificativo chat.
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-3 w-3" /> Aggiungi destinazione
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
