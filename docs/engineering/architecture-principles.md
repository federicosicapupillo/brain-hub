# Brain Hub Architecture Principles

**Version:** 1.4
**Status:** Active (in costruzione — principi aggiunti uno alla volta, mai come scheletro vuoto)
**Scope:** Engineering Governance layer of Brain Hub OS
**Location:** `/docs/engineering/architecture-principles.md`
**Compatibility:** Minimum Brain Hub Version: v3.31

---

## Indice dei principi

I principi sono divisi in due categorie. I **principi strutturali** definiscono come il sistema è costruito (tipi, contratti, payload) e sono verificabili in modo deterministico. I **principi comportamentali** definiscono come il sistema (incluso il linguaggio naturale prodotto da agenti) si comporta, e includono garanzie qualitative oltre a quelle di codice.

Ogni principio dichiara il proprio **Enforcement**: `Structural` (verificabile da typecheck/EQG/test), `Behavioral` (verificabile solo da review qualitativa/QA conversazionale), o `Hybrid` (entrambi, dichiarati separatamente).

### Structural Principles

| # | Principio | Stato | Enforcement |
|---|-----------|-------|-------------|
| 1 | Data Trust Model | ✅ Definito | Structural |
| 2 | Partial Failure Pattern | ✅ Definito | Structural |
| 3 | Service Layer Pattern | ✅ Definito | Structural |

### Behavioral Principles

| # | Principio | Stato | Enforcement |
|---|-----------|-------|-------------|
| 4 | Honest State Pattern | ✅ Definito | Hybrid |
| 5 | Read → Suggest → Prepare → Confirm → Execute | ✅ Definito | Hybrid |

I principi non ancora definiti vengono aggiunti solo dopo discussione dedicata, con lo stesso livello di rigore degli altri. Non vengono creati come placeholder generici per riempire l'indice.

Con il Principio 5, il "core" architetturale di Brain Hub OS è considerato strutturalmente completo: i moduli applicativi (Project Center, Communication Center, Agent Center, ecc.) applicano questi cinque principi per composizione, senza dover reinventare regole fondamentali.

---

## Structural Principles

## Principio 1 — Data Trust Model

### Obiettivo

Ogni dato operativo significativo in Brain Hub OS deve esporre quattro dimensioni indipendenti, che insieme rispondono a quattro domande distinte:

```text
Status        → il dato è disponibile?
Confidence    → quanto è affidabile?
Provenance    → da dove arriva e come è stato calcolato?
Freshness     → quando è stato aggiornato/verificato?
```

Queste dimensioni non si sostituiscono a vicenda. Un dato può essere `live`, con confidence alta, ma vecchio. Oppure appena aggiornato (`freshness` recente) ma derivato con bassa confidence. Confonderle in un solo segnale produce un sistema che mente per semplificazione.

### Tipi

```ts
type DataTrustStatus =
  | "live"
  | "empty"
  | "missing"
  | "unknown"
  | "error"
  | "loading";

type ConfidenceCalculationMethod =
  | "direct_source"
  | "weighted_average"
  | "minimum_source"
  | "manual_review"
  | "graph_inference_v1"
  | "rule_based_score"
  | "not_applicable";

type DataTrust = {
  status: DataTrustStatus;
  confidence: number | null; // integer 0-100
  calculation_method: ConfidenceCalculationMethod;
  provenance: {
    source_tables?: string[];
    source_functions?: string[];
    source_events?: string[];
    source_files?: string[];
    source_external_tools?: string[];
  };
  freshness: string | null; // ISO timestamp
  warnings?: string[];
};
```

### Semantica della scala di confidence

| Confidence | Significato |
|---|---|
| **100** | Dato letto direttamente da una fonte autoritativa, senza trasformazioni sostanziali. |
| **1–99** | Dato derivato, aggregato, inferito o calcolato. |
| **0** | Esiste una valutazione reale, e il risultato è completamente non affidabile. |
| **null** | La confidence non può essere calcolata o non è applicabile. |

`status` ed `confidence` sono indipendenti. Uno stato `error`, `missing` o `unknown` **non implica** automaticamente `confidence: 0`. L'errore o l'indisponibilità della fonte vivono nello `status`; la confidence riguarda solo l'affidabilità del dato quando esiste.

```json
// Corretto
{ "status": "error", "confidence": null }
{ "status": "missing", "confidence": null }

// Scorretto — confonde stato del sistema e qualità del dato
{ "status": "error", "confidence": 0 }
```

### Calculation method

Ogni confidence diversa da `null` deve dichiarare il metodo che l'ha prodotta, tramite l'enum chiuso `ConfidenceCalculationMethod`.

```text
direct_source        → lettura diretta da fonte autoritativa (tipicamente confidence=100)
weighted_average      → media pesata di più fonti
minimum_source        → confidence = valore minimo tra le fonti coinvolte
manual_review          → confidence assegnata da revisione umana
graph_inference_v1     → inferenza dal Brain Graph (versionato, perché il metodo evolverà)
rule_based_score        → confidence prodotta da regole deterministiche dichiarate,
                          non da una fonte diretta e non da una formula
                          matematica ponderata (vedi sotto)
not_applicable          → usato solo quando confidence è null per costruzione
```

**`rule_based_score` — condizione di uso obbligatoria.**

Questo metodo copre i casi più comuni nei moduli che derivano priorità o
punteggi da regole operative (es. Priority Engine: "review pendente = 95,
action bloccata = 90, automation fallita = 80" in base a severity, stato,
tipo, scadenza). Non è una lettura diretta né una media ponderata reale:
è un punteggio assegnato da una logica deterministica dichiarata nel codice.

`rule_based_score` è ammesso **solo se** il payload/debug espone:

```text
rules_used          → quale regola/branch ha prodotto questo punteggio
input_sources         → quali fonti/tabelle sono state lette
source_criticality     → criticality delle fonti coinvolte (vedi Principio 2)
confidence_reason       → spiegazione leggibile del perché di quel numero
```

Senza questi quattro campi, il valore non è ispezionabile e quindi non
soddisfa lo scopo del Data Trust Model — in quel caso usare comunque
`rule_based_score` come etichetta è una violazione dello standard, non
solo un'imprecisione.

**Divieto esplicito:** `weighted_average` non può essere usato per
indicare un punteggio basato su soglie ordinate o regole deterministiche
senza una vera formula di pesi. Se non esiste un calcolo di media
ponderata effettivo, il metodo corretto è `rule_based_score` (o
`minimum_source` / `manual_review` a seconda del caso).

```text

**Regola di estensione:** nessun nuovo `calculation_method` può essere introdotto localmente da una feature o da una singola patch. Va proposto e aggiunto a questo standard, con relativa voce nel Decision Log dell'EQG che approva la patch che lo introduce.

Non viene fissata, in questa versione, una formula matematica unica per derivare confidence (es. come combinare pesi in `weighted_average`). Si fissa solo il contratto — input dichiarati, metodo dichiarato, output 0-100. Una formula comune sarà valutata solo quando Brain Graph, Knowledge Center e Priority Engine genereranno casi reali sufficienti a giustificarla.

### Provenance

`provenance` non è un principio separato: è una sottosezione del Data Trust Model. Ogni confidence non-null deve essere accompagnata da provenance sufficiente a spiegare da dove viene il numero — almeno uno tra `source_tables`, `source_functions`, `source_events`, `source_files`, `source_external_tools`, secondo quale sia rilevante per quel dato.

### Freshness

`freshness` è un timestamp ISO o `null`. Indica solo *quando* il dato è stato aggiornato o verificato — non è un giudizio di validità.

```text
Freshness indica quando il dato è stato aggiornato/verificato.
Non indica da solo se il dato è ancora valido.
La valutazione di staleness appartiene al consumer.
```

Esempio del perché la soglia di "vecchio" non può essere fissata a livello di standard:

```text
Gmail unread today    → 10 minuti può essere vecchio
GitHub repo registry   → 3 giorni può essere accettabile
Master Snapshot          → 7 giorni può essere normale
Prezzi / metriche realtime → 1 giorno può essere inutilizzabile
```

Ogni consumer (widget, agente, Priority Engine) definisce la propria soglia di staleness in base al proprio dominio, analogamente a `COMMAND_CENTER_SLOW_WIDGET_THRESHOLD_MS` per il timing.

### Obbligatorietà

```text
Il Data Trust Model è obbligatorio per:
- nuove API
- nuovi widget OS
- nuovi service layer
- dati usati da agenti
- dati usati da Priority Engine
- dati usati da Brain Graph

Non è retroattivamente obbligatorio su tutte le superfici legacy.

Quando una superficie legacy viene toccata o migrata dentro Brain Hub OS,
deve adottare il Data Trust Model in quel momento.
```

Questo evita che l'introduzione dello standard diventi un refactor nascosto e non pianificato.

### Regole — sintesi

```text
1. status ≠ confidence.
2. error/missing/unknown non implicano confidence=0.
3. confidence=null quando non calcolabile/non applicabile.
4. confidence=0 solo quando una valutazione reale conclude affidabilità nulla.
5. ogni confidence deve avere provenance e calculation_method.
6. freshness è timestamp, non giudizio.
7. staleness è responsabilità del consumer.
8. enum calculation_method chiuso; estensioni solo via standard.
9. obbligatorio per nuovi moduli OS e superfici migrate.
10. non obbliga refactor retroattivo su legacy non toccato.
```

### Applicabilità, Enforcement, Verifica

```text
Applicabilità
- Service Layer
- API / Route
- UI / Widget

Enforcement
- Structural

Verifica
- Typecheck
- EQG (Parte A — A3, A4)
- Code review
```

---

## Principio 2 — Partial Failure Pattern

### Obiettivo

Un errore locale non deve diventare un errore globale. Validato per la prima volta in pratica in v3.30.1 (Command Center Hardening) e qui formalizzato come standard riusabile da ogni consumer che aggrega più fonti — in particolare il Priority Engine, che orchestra fonti eterogenee con livelli di importanza diversi.

### Regola base (singola fonte)

Se una fonte/widget/service fallisce:

```text
- il sistema continua a rispondere;
- la parte fallita espone status="error" (vedi Data Trust Model);
- viene mostrato un messaggio sicuro (error_safe_message), mai lo stack/errore grezzo;
- viene loggato solo l'evento anomalo, non ogni load normale;
- gli altri dati restano disponibili;
- HTTP 500 si usa solo per errori sistemici non recuperabili
  (es. l'evaluator di governance stesso lancia);
- HTTP 403 resta riservato a governance/RBAC fail.
```

Questa parte del principio è già implementata e verificata in `/api/command-center-data`.

### Source Criticality (consumer multilivello)

Quando un consumer aggrega più fonti per produrre un output derivato (es. Priority Engine che combina action_queue, projects, agent_runs, gmail, github per generare "Today's Focus"), il fallimento isolato di una fonte non basta più: serve sapere *quanto* quella fonte conta per la validità del risultato finale.

Ogni consumer multilivello deve dichiarare esplicitamente, per ciascuna fonte che aggrega, una criticality:

```ts
type SourceCriticality = "required" | "important" | "optional";
```

| Criticality | Comportamento se la fonte fallisce |
|---|---|
| **required** | Il consumer non deve produrre un risultato apparentemente completo. Deve restituire output degradato, o `status: "error"` / `"partial"` con safe message. Non genera output "sicuro" su una base mancante. |
| **important** | Il consumer può continuare, ma deve abbassare la `confidence` del risultato (vedi Data Trust Model) e aggiungere un `warning`. |
| **optional** | Il consumer continua normalmente. Aggiunge un warning solo se utile al debug o all'utente, senza impatto su confidence. |

### Esempio applicato — Priority Engine (riferimento per v3.31)

```text
action_queue:   required
result_review:  important
projects:       important
agent_runs:     optional
gmail:          optional
github:         optional
```

Conseguenze concrete:

```text
Se action_queue fallisce:
  Today's Focus non deve inventare priorità operative.
  Output: status="partial" o "error", nessuna lista di priorità presentata come affidabile.

Se github fallisce:
  Today's Focus può comunque proporre review/action/project focus,
  segnalando che GitHub non era disponibile (warning, confidence invariata
  o marginalmente ridotta secondo il peso che il modulo deciderà).
```

La mappatura esatta delle criticality per ogni nuovo consumer è una decisione del modulo stesso (dichiarata nel suo service layer), non un valore fisso per fonte a livello globale — la stessa fonte (es. `gmail`) può essere `optional` per il Priority Engine e `required` per un futuro Communication Center.

### Perché questa regola evita due errori opposti

```text
1. Bloccare tutto il sistema per il fallimento di una fonte secondaria
   (over-fragile: una fonte optional non deve mai causare un errore globale).

2. Generare output che sembra completo e affidabile mentre una fonte
   required è mancante (over-confident: il rischio peggiore, perché
   produce decisioni — umane o di agenti — basate su un falso senso
   di completezza).
```

### Regole — sintesi

```text
1. Un errore isolato non propaga mai come errore globale.
2. status="error" sostituisce sempre dati inventati o silenziosamente assenti.
3. 500 solo per errori sistemici; 403 solo per governance/RBAC.
4. Logging solo su eventi anomali, mai sul normale funzionamento.
5. Ogni consumer multilivello dichiara la criticality di ogni fonte aggregata.
6. required: nessun output apparentemente completo se la fonte è assente.
7. important: output possibile, ma confidence abbassata e warning esplicito.
8. optional: output normale, warning facoltativo.
9. La criticality è una decisione del consumer/modulo, non un valore globale per fonte.
```

### Applicabilità, Enforcement, Verifica

```text
Applicabilità
- Service Layer
- API / Route

Enforcement
- Structural

Verifica
- Typecheck
- EQG (Parte A — A4)
- Test harness (simulazione partial failure)
```

---

## Principio 3 — Service Layer Pattern

### Obiettivo

Stabilire una gerarchia chiara di responsabilità tra UI, route API e service layer, in modo che la verità su disponibilità/affidabilità di un dato (Data Trust Model) abbia un'unica fonte, mai duplicata in tipi paralleli costruiti indipendentemente in punti diversi del codice.

```text
UI / Route API
↓
Governance
↓
Service Layer
↓
DB / Tool / External API
```

Origina dal debito tecnico dichiarato in v3.31/v3.32: `RawSourceResult` (endpoint Priority Engine) e `WidgetProvenance` (endpoint Command Center) duplicavano lo stesso concetto — disponibilità e provenienza di un dato — costruiti separatamente nei due endpoint invece di condividere un'unica struttura.

### Tipo base — ServiceOutcome

```ts
type ServiceOutcome<T> = {
  data: T | null;
  trust: DataTrust;            // vedi Principio 1 — unica fonte di status/
                                // confidence/calculation_method/provenance/freshness
  error_safe_message?: string; // presente solo se trust.status === "error"
  duration_ms: number;
};
```

**Regola forte:** la disponibilità del dato vive solo in `trust.status`. `ServiceOutcome` non introduce un campo `status` proprio, né duplica `warnings` (già presente in `DataTrust`). Qualsiasi struttura che reintroduce un concetto di disponibilità separato da `trust.status` viola questo principio, anche se in buona fede.

### Confine di obbligatorietà

`ServiceOutcome<T>` è obbligatorio solo al **confine pubblico del service layer** — non per ogni funzione interna.

```text
Route/API       → chiama funzioni che restituiscono ServiceOutcome<T>
Service pubblico → restituisce ServiceOutcome<T>
Helper interno    → può lavorare su T puro
```

Esempio:

```ts
// pubblico — confine del service layer, restituisce ServiceOutcome
getPriorityEngineData(): Promise<ServiceOutcome<PriorityEnginePayload>>

// interno — helper, lavora su dati puri, nessun overhead di trust
rankPriorityItems(rows: RawRow[]): PriorityItem[]
```

Questo evita di appesantire ogni funzione di composizione interna con la gestione di `trust` ad ogni passaggio: il trust si costruisce una volta, al momento in cui il service pubblico restituisce il proprio outcome.

### UI Projection — proiezione, non fonte di verità parallela

I tipi di presentazione usati dalla UI (es. `WidgetProvenance`) sono ammessi, ma devono essere **proiezioni pure** di `ServiceOutcome`/`DataTrust`, mai costruiti indipendentemente con una propria logica di stato.

```ts
function toWidgetProvenance<T>(
  outcome: ServiceOutcome<T>
): WidgetProvenance
```

Gerarchia risultante:

```text
DataTrust
↓
ServiceOutcome<T>
↓
UI Projection (es. WidgetProvenance)
```

Una route API non deve mai costruire una propria struttura di provenance/stato a partire dai dati grezzi: deve sempre passare attraverso un `ServiceOutcome` prodotto dal service layer, poi eventualmente proiettarlo per la UI.

### Regole — sintesi

```text
1. DataTrust è la fonte unica per status/confidence/provenance/freshness.
2. ServiceOutcome<T> è obbligatorio sui service pubblici (confine route ↔ service).
3. Helper interni possono restituire dati puri (T), senza overhead di trust.
4. Route API orchestrano i service pubblici; non inventano trust autonomamente.
5. Le UI projections (es. WidgetProvenance) derivano da ServiceOutcome tramite
   funzioni pure di proiezione; non sono fonti di verità indipendenti.
6. Nessuna struttura duplica un concetto di "disponibilità" già coperto da
   trust.status — se sembra necessario, è un segnale che trust.status va
   esteso, non che serve un campo parallelo.
```

### Nota di migrazione (non retroattiva su tutto)

Come per gli altri principi, questo non impone un refactor immediato di ogni endpoint esistente. Si applica obbligatoriamente a nuovi service pubblici. La consolidazione di `RawSourceResult`/`WidgetProvenance` negli endpoint Command Center e Priority Engine già esistenti è debito tecnico tracciato (vedi Decision Log dell'EQG, v3.31/v3.32) e va pianificata come patch dedicata, non eseguita implicitamente dentro un'altra patch. **Aggiornamento v3.33: debito chiuso** — vedi Decision Log dell'EQG.

### Applicabilità, Enforcement, Verifica

```text
Applicabilità
- Service Layer
- API / Route
- UI (proiezioni)

Enforcement
- Structural

Verifica
- Typecheck
- EQG (Parte A — A1, A6, A7, A8)
- Code review
```

---

## Behavioral Principles

## Principio 4 — Honest State Pattern

### Obiettivo

Il Data Trust Model (Principio 1) risponde alla domanda "come descrivo un dato?" — definendo `status`, `confidence`, `provenance`, `freshness`. L'Honest State Pattern risponde a una domanda diversa: "cosa è autorizzato a dire Brain Hub, dato quello stato?"

Non è una proprietà dei dati. È un vincolo sul comportamento di ogni consumer — codice, UI, o linguaggio naturale prodotto da un agente — che riceve uno stato e deve trasmetterlo senza alterarlo, abbellirlo, o nasconderlo.

```text
Brain Hub non deve mai:
- inventare dati
- completare dati mancanti
- mascherare errori
- trasformare unknown in live
- trasformare empty in missing
- trasformare error in empty
```

Ogni consumer deve propagare onestamente lo stato ricevuto, dal Command Center al Priority Engine, fino agli agenti AI (Jack, e i futuri agenti di Agent Center, Knowledge Center, Communication Center, Brain Graph).

Questo principio ha due livelli di enforcement molto diversi tra loro, e lo standard li dichiara separatamente per non promettere una garanzia che il sistema non può mantenere in modo assoluto.

### Livello 1 — Structural Enforcement (obbligatorio, deterministico)

**Ambito:** Service Layer, API, payload JSON, UI, widget, componenti React.

**Garanzia:** deterministica, verificabile da typecheck/code review/test/EQG.

```text
- DataTrustStatus è un enum chiuso (vedi Principio 1).
- Ogni stato ha una mappatura deterministica verso la UI: un set chiuso
  di rendering/template per stato, mai una stringa libera costruita ad
  hoc nel componente.
- Nessun componente può reinterpretare unknown come live, error come
  empty, o qualsiasi altra trasformazione semantica dello stato.
- Nessun payload può cambiare lo stato ricevuto da un livello inferiore
  (un service che riceve status="error" da una fonte non può
  restituire status="live" al livello superiore, anche se ha dati
  parziali disponibili — il Partial Failure Pattern, Principio 2,
  governa già questo caso tramite Source Criticality).
```

Questo è un requisito architetturale, verificato con:
- typecheck (l'enum chiuso impedisce stati arbitrari)
- code review (nessuna funzione di mapping status→testo deve permettere bypass)
- test (verificare che ogni stato produca l'output atteso, non una sua versione attenuata)
- EQG (Parte A)

### Livello 2 — Behavioral Enforcement (best effort, qualitativo)

**Ambito:** Jack, Agent Center, qualsiasi LLM che produce risposte in linguaggio naturale.

**Garanzia:** non deterministica. Un modello linguistico può, per costruzione, produrre un tono più sicuro di quanto i dati sottostanti giustifichino — questo non è eliminabile dal compilatore, solo mitigabile.

Il vincolo comportamentale richiesto:

```text
Quando le informazioni non sono sufficienti, l'agente deve dichiarare il
limite invece di completarlo con inferenze presentate come fatti.

Esempio:
  Stato sottostante: unknown
  NON accettabile: "Probabilmente è..." / "Sembra che..." / "Quasi
    sicuramente..."
  Accettabile: "Non ho dati sufficienti su questo."
```

Questo livello viene verificato tramite:
- system instructions / prompt design (il vincolo va scritto esplicitamente nelle istruzioni dell'agente, non assunto come comportamento di default del modello)
- review conversazionale (controllo a campione delle risposte prodotte)
- test manuali / casi QA dedicati
- non tramite il compilatore — qualsiasi dichiarazione di conformità "strutturale" per questo livello sarebbe falsa

### Perché la distinzione è necessaria

Dichiarare Honest State Pattern come un principio unico, senza separare i due livelli, rischierebbe di promettere una proprietà assoluta ("Brain Hub non mente mai") che il software può garantire solo nella sua parte deterministica. La parte che coinvolge linguaggio naturale resta soggetta ai limiti noti dei modelli linguistici, e lo standard deve essere onesto su questo — coerentemente con il principio stesso che descrive.

### Applicabilità, Enforcement, Verifica

```text
Applicabilità
- Service Layer (Livello 1)
- API / UI / Widget (Livello 1)
- Agent Layer — Jack, agenti futuri (Livello 2)

Enforcement
- Hybrid (Structural per Livello 1, Behavioral per Livello 2)

Verifica
- Livello 1: Typecheck, EQG, code review, test
- Livello 2: System instructions, review conversazionale, QA manuale,
  casi di test conversazionali dedicati
```

---

## Principio 5 — Read → Suggest → Prepare → Confirm → Execute

### Obiettivo

Se Honest State Pattern governa cosa Brain Hub è autorizzato a *dire*, questo principio governa cosa Brain Hub è autorizzato a *fare*. Definisce il confine tra "il sistema può ragionare e proporre liberamente" e "il sistema sta producendo un effetto reale su dati, sistemi esterni o workflow" — e impone che il secondo non avvenga mai senza passare attraverso il primo in modo esplicito.

```text
Brain Hub può leggere, ragionare e preparare liberamente entro i
permessi concessi. Ma ogni effetto reale verso sistemi esterni, dati
utente o workflow mutativi richiede conferma proporzionata al rischio
e passaggio esplicito dal Runtime Governance Layer.
```

### Ambito

Il principio vale per qualsiasi azione operativa in Brain Hub OS: azioni proposte da Jack, da agenti futuri, da automazioni, avviate dalla UI, generate da workflow n8n/browser, o dirette su Gmail, GitHub, Drive, Calendar, Telegram, social, progetti.

```text
Azione umana diretta:
  l'utente può saltare Suggest, perché sta già decidendo lui.

Azione proposta dal sistema/agente:
  Suggest è obbligatorio.
```

### I cinque stadi

```text
Read       → il sistema legge dati e stato. Non modifica nulla.
Suggest    → il sistema propone cosa fare. Non prepara ancora una
             modifica eseguibile.
Prepare    → il sistema costruisce una proposta concreta (bozza email,
             payload n8n, action queue item, prompt Codex, anteprima
             post, patch proposta, piano operativo). Non esegue.
Confirm    → l'utente autorizza (click, conferma vocale, approvazione
             Telegram, approvazione UI, consenso esplicito).
Execute    → il sistema esegue realmente (invio, cancellazione,
             pubblicazione, archiviazione, chiamata API mutativa,
             modifica DB, workflow live). Solo dopo Governance PASS.
```

### Gli stadi possono collassare, ma non sparire

Non tutti i 5 stadi richiedono interfacce o passaggi separati per ogni azione — sarebbe troppo rigido. Ma devono esistere **semanticamente**: il sistema deve sempre sapere in quale stadio si trova un'azione, anche quando più stadi sono compressi in un'unica interazione.

Il livello di separazione richiesto dipende dal `risk_level` dell'azione:

```text
low risk    → alcuni stadi possono comprimersi (es. un click "segna
              come letta" vale implicitamente come Prepare + Confirm,
              ma il sistema registra comunque che non è stata eseguita
              autonomamente)

medium risk → serve una preview/prepare chiaramente visibile prima
              dell'esecuzione

high risk   → servono Prepare e Confirm esplicitamente separati,
              mai compressi in un solo click implicito
```

Esempi di azioni high risk: inviare email, cancellare dati, pubblicare post, eseguire workflow, modificare repository, creare commit/push/PR, cambiare permessi, inviare messaggi esterni.

### Regola chiave

```text
Nessun agente può passare direttamente da Read a Execute.

Nessuna azione esterna o mutativa può essere eseguita senza:
- stato preparato
- conferma compatibile col rischio
- Governance Evaluator PASS
- audit record
```

### Execute come confine con Runtime Governance

`Execute` è il punto di ponte esplicito tra Architecture Principles (Engineering Governance) e Runtime Governance. Prima di ogni esecuzione reale, il sistema deve passare dal Governance Evaluator (project isolation → RBAC → policy → agent permission), con relativo audit record.

```text
Prepare non esegue.
Confirm non esegue.
Execute esegue solo dopo Governance PASS.
```

Fino a `Prepare`, Brain Hub può essere intelligente — leggere, ragionare, proporre. Da `Confirm` in poi deve essere controllato.

### Applicabilità, Enforcement, Verifica

```text
Applicabilità
- Action Queue
- Controlled Actions / approval layer
- API mutative
- Workflow execution (n8n, automazioni)
- Agent Layer — Jack, agenti futuri
- UI (azioni dirette dell'utente)

Enforcement
- Hybrid

  Structural per: Action Queue, Controlled Actions, API mutative,
  approval layer, workflow execution, payload preview, audit log —
  verificabile da typecheck, EQG, code review, test (es. impossibile
  per il codice saltare da Read a Execute senza passare per i tipi
  intermedi).

  Behavioral per: Jack, agenti, linguaggio naturale di suggerimento e
  spiegazione — verificabile solo da system instructions, review
  conversazionale, QA manuale (un agente può comunque formulare un
  suggerimento in modo che suoni come se l'azione fosse già avvenuta;
  questo resta un rischio mitigabile, non eliminabile dal compilatore,
  esattamente come per Honest State Pattern).

Verifica
- Structural: Typecheck, EQG, code review, test, Governance Evaluator
  (audit record obbligatorio su ogni Execute)
- Behavioral: System instructions, review conversazionale, QA manuale
```

---

## Changelog

- **v1.4** — Introduce il Principio 5 (Read → Suggest → Prepare → Confirm → Execute), ultimo principio del core architetturale. Definisce il confine tra ragionamento/proposta e azione reale, con separazione degli stadi proporzionata al risk_level dell'azione, ed Execute come punto di ponte esplicito con il Governance Evaluator (Runtime Governance). Con questo principio, il core di Brain Hub OS (3 principi Structural + 2 Behavioral) è considerato completo; i moduli applicativi futuri applicano questi principi per composizione. Origine: completamento della roadmap Structural/Behavioral avviata con Honest State Pattern.
- **v1.3** — Introduce il Principio 4 (Honest State Pattern), diviso esplicitamente in Livello 1 (Structural, deterministico) e Livello 2 (Behavioral, best-effort per agenti/LLM). Riorganizza il documento in Structural Principles (1-3) e Behavioral Principles (4-5), e aggiunge a ogni principio esistente una sezione "Applicabilità, Enforcement, Verifica" come convenzione standard del documento. Origine: discussione su come distinguere garanzie deterministiche da garanzie qualitative, per evitare che lo standard prometta proprietà non verificabili dal compilatore.
- **v1.2** — Introduce il Principio 3 (Service Layer Pattern): `ServiceOutcome<T>` come tipo obbligatorio al confine dei service pubblici, `DataTrust` come unica fonte di verità su status/confidence/provenance/freshness, UI projections (es. `WidgetProvenance`) come proiezioni pure derivate, mai costruite indipendentemente. Origine: debito tecnico dichiarato in v3.31/v3.32 (duplicazione `RawSourceResult`/`WidgetProvenance`), risolto a livello di standard; la migrazione del codice esistente resta patch dedicata futura.
- **v1.1** — Aggiunto `rule_based_score` a `ConfidenceCalculationMethod`, con condizione di uso obbligatoria (`rules_used`, `input_sources`, `source_criticality`, `confidence_reason` esposti nel payload) e divieto esplicito di usare `weighted_average` senza una vera formula ponderata. Origine: review EQG Parte B di v3.31, dove il widget Today's Focus dichiarava `weighted_average` per un punteggio in realtà basato su soglie ordinate/regole deterministiche.
- **v1.0** — Introduce il Principio 1 (Data Trust Model) e il Principio 2 (Partial Failure Pattern, incluso Source Criticality), definiti prima dell'avvio di v3.31 — Priority Engine, in modo che il primo modulo costruito sotto questo standard nasca coerente invece di richiedere migrazione successiva. Data Trust Model origina dalla review EQG di v3.30.1 (scala di confidence identificata come dipendenza implicita). Partial Failure Pattern formalizza un comportamento già implementato e approvato in v3.30.1, esteso con Source Criticality per supportare consumer multilivello come il Priority Engine.
