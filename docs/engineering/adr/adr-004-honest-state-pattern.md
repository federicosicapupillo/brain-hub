# ADR-004 — Honest State Pattern

**Status:** Accettato
**Data:** 2026-06-30
**Versione minima compatibile:** Brain Hub v3.34 (atteso per il primo modulo che ne dipende esplicitamente); principio valido da subito come vincolo su ogni nuovo consumer
**Documento correlato:** `architecture-principles.md` — Principio 4

## Contesto

I primi tre principi architetturali (Data Trust Model, Partial Failure Pattern, Service Layer Pattern) definiscono come Brain Hub OS rappresenta e struttura i dati. Nessuno di essi vincola però cosa un consumer — UI, componente, o agente AI — è autorizzato a *dire* una volta ricevuto quello stato. Un sistema può avere `status: unknown` correttamente popolato nel backend e comunque produrre, a valle, un testo che lo presenta come fatto accertato ("probabilmente...", "sembra che...").

Questo gap è particolarmente rilevante per Jack e i futuri agenti AI (Agent Center, Knowledge Center, Communication Center), dove l'output non è un componente React con rendering deterministico ma testo generato da un modello linguistico — un livello che il typecheck non può vincolare.

## Alternative considerate

1. **Trattare l'onestà dello stato come implicita nel Data Trust Model**, assumendo che `status` ben popolato sia sufficiente. Scartata: il Data Trust Model garantisce solo la rappresentazione del dato, non il comportamento di chi lo legge e lo comunica.

2. **Un principio unico, senza distinguere livelli di enforcement**, che dichiari semplicemente "Brain Hub non mente mai sullo stato dei dati". Scartata: prometterebbe una garanzia assoluta che il sistema non può mantenere nella sua componente di linguaggio naturale — un LLM può sempre produrre un tono più sicuro di quanto i dati giustifichino, indipendentemente da quanto rigoroso sia lo strato dati sottostante. Dichiarare questo come garanzia strutturale sarebbe disonesto rispetto al principio stesso.

3. **Due livelli di enforcement dichiarati esplicitamente** — Livello 1 Structural (deterministico, verificabile da typecheck/EQG) per Service Layer/API/UI, Livello 2 Behavioral (best-effort, verificabile solo da review qualitativa) per Jack e agenti AI. Adottata.

## Decisione

```text
Honest State Pattern: ogni consumer deve propagare onestamente lo stato
ricevuto, senza inventare dati, completare dati mancanti, mascherare
errori, o trasformare unknown/empty/error in uno stato più favorevole.

Livello 1 — Structural Enforcement (Service Layer, API, payload, UI):
  - DataTrustStatus resta enum chiuso (Principio 1).
  - Ogni stato ha mappatura deterministica verso la UI — template fissi
    per stato, mai stringhe libere costruite ad hoc.
  - Nessun componente può reinterpretare semanticamente uno stato
    ricevuto da un livello inferiore.
  Verificabile da: typecheck, code review, test, EQG.

Livello 2 — Behavioral Enforcement (Jack, Agent Center, LLM):
  - Quando le informazioni non sono sufficienti, l'agente deve
    dichiarare il limite invece di completarlo con inferenze presentate
    come fatti.
  Verificabile da: system instructions, review conversazionale, QA
  manuale — non dal compilatore.
```

I due livelli sono dichiarati separatamente nello standard, con enforcement diverso (`Structural` vs `Behavioral`, combinati come `Hybrid` per il principio nel suo insieme), per evitare di promettere allo standard una proprietà che il software non può garantire in modo assoluto.

## Conseguenze

**Positive:**
- Chiude un gap reale tra "i dati sono ben rappresentati" (Data Trust Model) e "il sistema comunica onestamente quei dati" — distinzione che diventerà sempre più rilevante man mano che crescono i moduli con output in linguaggio naturale (Agent Center, Knowledge Center, Communication Center).
- Stabilisce, come convenzione del documento, una sezione "Applicabilità / Enforcement / Verifica" applicata retroattivamente anche ai tre principi strutturali precedenti — rendendo esplicito per ogni principio futuro se la garanzia è verificabile dal compilatore o richiede QA qualitativa.
- Per il Livello 1, l'enforcement è verificabile esattamente come gli altri principi (typecheck, EQG).

**Trade-off accettati:**
- Il Livello 2 non offre garanzie deterministiche. Lo standard lo dichiara esplicitamente invece di nasconderlo dietro un linguaggio che suggerisce un controllo assoluto — questo è considerato un punto di forza dello standard (onestà sui propri limiti), non una debolezza, ma significa che la "caratteristica distintiva" di Brain Hub sul Livello 2 richiede investimento continuo in QA conversazionale, non solo una regola scritta una volta.
- Non esiste ancora, in Brain Hub OS, un meccanismo concreto di test conversazionale automatizzato per verificare il Livello 2 — resta una verifica manuale/a campione finché un tale meccanismo non verrà costruito (debito implicito, da tracciare quando emergerà un caso concreto, non da anticipare ora come principio separato).
