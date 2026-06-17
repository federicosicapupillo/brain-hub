import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  BookOpen,
  ListChecks,
  Inbox,
  Archive,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Lightbulb,
  Target,
  Link as LinkIcon,
  Plug,
  Map as MapIcon,
  FileText,
  ClipboardList,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/guida")({
  head: () => ({ meta: [{ title: "Guida operativa — AI Brain" }] }),
  component: GuidaPage,
});

function GuidaPage() {
  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl">
      <PageHeader
        title="Guida operativa iBrain"
        subtitle="Le regole per usare iBrain come centro di comando dei tuoi progetti, senza trasformarlo in un archivio confuso."
      />

      {/* Pulsanti rapidi */}
      <div className="flex flex-wrap gap-2">
        <Link to="/prossime-azioni" search={{}}>
          <Button variant="default" className="bg-gradient-primary text-primary-foreground">
            <ListChecks className="mr-2 h-4 w-4" />
            Vai a Prossime Azioni
          </Button>
        </Link>
        <Link to="/importa" search={{}}>
          <Button variant="outline">
            <Inbox className="mr-2 h-4 w-4" />
            Importa nuovo contenuto
          </Button>
        </Link>
        <Link to="/archivio" search={{}}>
          <Button variant="outline">
            <Archive className="mr-2 h-4 w-4" />
            Apri Archivio
          </Button>
        </Link>
      </div>

      {/* 1. Cos'è iBrain */}
      <Card className="bg-card/40 glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            1. Cos’è iBrain
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            iBrain è il centro operativo personale per organizzare progetti, prompt, file, task, roadmap, collegamenti, fonti e decisioni strategiche.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Non è solo un archivio.</li>
            <li>Non è solo un task manager.</li>
            <li>Non è solo una dashboard.</li>
          </ul>
          <p>Serve per capire:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>quali progetti sono attivi</li>
            <li>a che punto sono</li>
            <li>quali materiali sono collegati</li>
            <li>quali prompt sono stati usati</li>
            <li>quali task sono aperti</li>
            <li>qual è la prossima azione utile</li>
          </ul>
        </CardContent>
      </Card>

      {/* 2. Regola madre */}
      <Card className="border-l-4 border-l-primary bg-card/40 glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-primary" />
            2. Regola madre
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-primary/10 p-4 text-sm font-medium text-foreground leading-relaxed">
            Ogni contenuto importato deve avere:
            <ul className="mt-2 list-disc pl-5 font-normal text-muted-foreground space-y-1">
              <li>un progetto</li>
              <li>un tipo</li>
              <li>un titolo chiaro</li>
              <li>uno stato</li>
              <li>tag utili</li>
              <li>una prossima utilità</li>
            </ul>
            <p className="mt-3 text-foreground">
              Se un contenuto non ha una prossima utilità, va archiviato o lasciato in bozza.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 3. Come importare correttamente */}
      <Card className="bg-card/40 glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            3. Come importare correttamente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>Quando importo qualcosa devo chiedermi:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>A quale progetto appartiene?</li>
            <li>Che tipo di contenuto è?</li>
            <li>È un prompt, una nota, un task, una roadmap, un file o un link?</li>
            <li>Mi serve adesso o è solo archivio?</li>
            <li>Deve generare una prossima azione?</li>
          </ul>
        </CardContent>
      </Card>

      {/* 4. Differenza tra le sezioni */}
      <Card className="bg-card/40 glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            4. Differenza tra le sezioni
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 font-medium text-foreground">Sezione</th>
                  <th className="py-2 font-medium text-foreground">A cosa serve</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-medium text-foreground">Progetti</td>
                  <td className="py-2">Per vedere tutti i progetti attivi.</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-medium text-foreground">Importa</td>
                  <td className="py-2">Per aggiungere nuovi contenuti.</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-medium text-foreground">Archivio</td>
                  <td className="py-2">Per cercare tutto ciò che è stato salvato.</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-medium text-foreground">Prompt</td>
                  <td className="py-2">Per conservare prompt usati o da usare.</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-medium text-foreground">Task</td>
                  <td className="py-2">Per le azioni operative da fare.</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-medium text-foreground">Roadmap</td>
                  <td className="py-2">Per le fasi del progetto.</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-medium text-foreground">Fonti</td>
                  <td className="py-2">Per materiali, note, documenti e conoscenza.</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-medium text-foreground">Prossime Azioni</td>
                  <td className="py-2">Per capire da dove ripartire.</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium text-foreground">Connettori</td>
                  <td className="py-2">Per capire cosa è manuale, cosa è da collegare e cosa è sincronizzato.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 5. Regole per i prompt */}
      <Card className="bg-card/40 glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-primary" />
            5. Regole per i prompt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>I prompt importanti vanno salvati come Prompt, non come note generiche.</p>
          <p>Ogni prompt deve avere:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>progetto corretto</li>
            <li>titolo chiaro</li>
            <li>strumento collegato</li>
            <li>stato: bozza, usato, approvato, da revisionare</li>
            <li>tag utili</li>
          </ul>
          <p>
            I prompt storici, come quelli di Pupillo, servono come memoria operativa per riutilizzare logiche nei progetti futuri.
          </p>
        </CardContent>
      </Card>

      {/* 6. Regole per i task */}
      <Card className="bg-card/40 glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            6. Regole per i task
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>Un task deve essere una cosa concreta da fare.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
              <div className="text-xs font-semibold text-green-500 mb-1 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Esempi corretti
              </div>
              <ul className="list-disc pl-4 space-y-1 text-sm">
                <li>Rivedere sezione budget homepage</li>
                <li>Definire schema dati capannoni</li>
                <li>Creare piano contenuti Furia Immobiliare</li>
              </ul>
            </div>
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <div className="text-xs font-semibold text-red-500 mb-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Esempi sbagliati
              </div>
              <ul className="list-disc pl-4 space-y-1 text-sm">
                <li>Sistemare tutto</li>
                <li>Fare marketing</li>
                <li>Migliorare progetto</li>
                <li>Guardare cose</li>
              </ul>
            </div>
          </div>
          <p className="font-medium text-foreground">Ogni task deve essere il più specifico possibile.</p>
        </CardContent>
      </Card>

      {/* 7. Regole per la roadmap */}
      <Card className="bg-card/40 glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapIcon className="h-4 w-4 text-primary" />
            7. Regole per la roadmap
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>La roadmap non è una lista infinita di task.</p>
          <p>Serve per definire le fasi principali di un progetto.</p>
          <p className="font-medium text-foreground">Esempio:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Fase 1: Struttura dati</li>
            <li>Fase 2: UI principale</li>
            <li>Fase 3: Test utenti</li>
            <li>Fase 4: Lancio</li>
            <li>Fase 5: Ottimizzazione</li>
          </ul>
        </CardContent>
      </Card>

      {/* 8. Regole per i collegamenti */}
      <Card className="bg-card/40 glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-primary" />
            8. Regole per i collegamenti
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>I collegamenti devono avere un senso operativo.</p>
          <p className="font-medium text-foreground">Esempi:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Pupillo collegato a IdeaPilot IA perché è un esempio concreto di SaaS/marketplace.</li>
            <li>Sica Industrial Radar collegato a Sica Immobiliare Comunicazione perché uno analizza capannoni e l’altro li promuove.</li>
            <li>Furia Immobiliare collegato a Brain Hub perché Brain Hub archivia materiali e strategie.</li>
          </ul>
          <p className="font-medium text-foreground">Non collegare progetti solo perché sembrano simili.</p>
        </CardContent>
      </Card>

      {/* 9. Regole per i connettori */}
      <Card className="bg-card/40 glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="h-4 w-4 text-primary" />
            9. Regole per i connettori
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Manuale</strong> significa che devo importare io i contenuti.</li>
            <li><strong className="text-foreground">Da collegare</strong> significa che serve una vera integrazione.</li>
            <li><strong className="text-foreground">Collegato</strong> significa che esiste una connessione reale autorizzata.</li>
            <li><strong className="text-foreground">Sincronizzato</strong> significa che i dati si aggiornano automaticamente o semi-automaticamente.</li>
          </ul>
          <p className="font-medium text-foreground">
            Non considerare uno strumento collegato se non esiste una vera connessione API, OAuth, GitHub, Drive o simile.
          </p>
        </CardContent>
      </Card>

      {/* 10. Metodo giornaliero consigliato */}
      <Card className="bg-card/40 glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            10. Metodo giornaliero consigliato
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">Ogni volta che apro iBrain:</p>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0 mt-0.5">1</Badge>
              Apro Prossime Azioni.
            </li>
            <li className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0 mt-0.5">2</Badge>
              Guardo i task reali.
            </li>
            <li className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0 mt-0.5">3</Badge>
              Controllo i suggerimenti prioritari.
            </li>
            <li className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0 mt-0.5">4</Badge>
              Scelgo massimo 1-3 azioni da fare.
            </li>
            <li className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0 mt-0.5">5</Badge>
              Apro il progetto collegato.
            </li>
            <li className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0 mt-0.5">6</Badge>
              Lavoro sull’azione.
            </li>
            <li className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0 mt-0.5">7</Badge>
              Segno il task come fatto o creo il prossimo step.
            </li>
            <li className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0 mt-0.5">8</Badge>
              Importo solo contenuti utili.
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* 11. Cosa evitare */}
      <Card className="bg-card/40 glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            11. Cosa evitare
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Non importare file senza progetto.</li>
            <li>Non creare task generici.</li>
            <li>Non duplicare prompt già presenti.</li>
            <li>Non salvare tutto come nota.</li>
            <li>Non mischiare progetti diversi.</li>
            <li>Non usare i collegamenti come cestino.</li>
            <li>Non creare roadmap troppo dettagliate.</li>
            <li>Non lasciare contenuti importanti senza tag.</li>
            <li>Non fidarsi dei connettori se sono ancora manuali.</li>
          </ul>
        </CardContent>
      </Card>

      {/* 12. Frase finale */}
      <Card className="border-l-4 border-l-primary bg-primary/5">
        <CardContent className="py-6">
          <div className="flex items-start gap-3">
            <Target className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <p className="text-sm font-medium text-foreground leading-relaxed">
              iBrain deve trasformare le idee in progetti ordinati, e i progetti ordinati in prossime azioni concrete.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
