# Brain Hub Engineering Quality Gate (EQG)

**Version:** 1.4
**Status:** Active
**Scope:** Engineering Governance layer of Brain Hub OS
**Location:** `/docs/engineering/engineering-quality-gate.md`
**Compatibility:** Minimum Brain Hub Version: v3.30

---

## 0. Principio fondamentale

> Una patch non è "completata" quando il codice compila.
> È completata quando supera l'Engineering Quality Gate.

Questo documento ha lo stesso peso operativo di RBAC, Governance Evaluator o Action Queue. Nessuna patch su Brain Hub OS si considera chiusa senza un report EQG compilato e una decisione di review esplicita.

Il Quality Gate è diviso in due parti, con responsabilità distinte:

- **Parte A — Auto-verificabile**: compilata da Lovable (o da chi implementa). Contiene solo fatti oggettivi, verificabili dal codice e dall'output degli strumenti.
- **Parte B — Architecture Review**: compilata da un umano (Federico / Claude in supporto). Non può essere autocertificata da chi ha scritto la patch.

---

## Posizione nei tre livelli di governance

```text
1. Product Governance
   Visione, roadmap, moduli, Brain OS

2. Engineering Governance  ← questo documento vive qui
   Quality Gate, Architecture Principles, Coding Standards,
   Brain Graph, Agent Contract

3. Runtime Governance
   RBAC, Audit, Controlled Actions, Approval Layer, Permessi
```

L'EQG non sostituisce il Governance Evaluator runtime: lo precede. Una patch passa l'EQG *prima* che il suo codice venga eseguito in produzione sotto controllo RBAC.

---

## Principio di separazione: codice vs. valore

> L'EQG valuta la qualità dell'implementazione, non il valore della funzionalità. Una feature utile può essere respinta se non soddisfa gli standard di engineering; una feature piccola può essere approvata se li soddisfa pienamente.

Questo principio mantiene separati due giudizi che vengono spesso confusi: quanto è utile una feature (decisione di prodotto) e quanto è solida la sua implementazione (decisione di engineering). L'EQG si occupa solo del secondo.

---

## PARTE A — Auto-verificabile (compilata da Lovable)

**Regola di formato (vincolante):** le sezioni A0–A8 devono mantenere
sempre la stessa etichetta e lo stesso ordine definiti in questo
documento, anche quando una sezione risulta "invariato rispetto alla
patch precedente" o non direttamente rilevante per la patch corrente.
Le sezioni non vanno rinominate, riordinate o reinterpretate in base al
contenuto specifico di ogni singola patch. Lo scopo del formato fisso è
la comparabilità dei report nel tempo nel Decision Log — un report che
riorganizza liberamente la struttura rompe questo scopo anche se il
contenuto è completo.

**Questa regola è stata violata tre volte (v3.32, v3.33, v3.33.1)
nonostante fosse scritta esplicitamente.** La causa non è la chiarezza
della regola, ma il fatto che venisse descritta invece di fornita come
template letterale da copiare. Da qui in avanti, ogni prompt che
richiede un report EQG deve includere il blocco seguente, da copiare
esattamente, sostituendo solo il contenuto tra parentesi quadre — non
descritto a parole, non parafrasato:

```text
A0. Severity Classification
[...]

A1. Funzionalità
[...]

A2. Governance & RBAC
[...]

A3. Stato dei dati
[...]

A4. Performance & Resilienza
[...]

A5. Type Safety
[...]

A6. Limiti residui
[...]

A7. Debito tecnico introdotto
[...]

A8. Debiti ereditati
[...]
```

Se una patch è docs-only o non tocca alcune aree (es. nessun tipo TS modificato), la sezione corrispondente resta comunque presente con l'etichetta esatta, e riporta esplicitamente "non applicabile" con una riga di motivazione — non viene rinominata né omessa.

### A0. Severity Classification

Ogni finding emerso durante la compilazione della Parte A va classificato secondo questa scala. La severity determina l'esito automatico della patch.

```text
CRITICAL → Patch respinta automaticamente, nessuna eccezione
  - bypass del Governance Evaluator / RBAC
  - dati mockati o hardcoded in produzione
  - typecheck o build falliti

HIGH → Richiede fix prima del merge
  - partial failure assente o non gestito
  - provenance incompleta su uno o più widget/dati
  - audit/logging mancante su azioni governate

MEDIUM → Accettabile con debito tecnico esplicito (sezione A7)
  - performance migliorabile ma entro soglie di tollerabilità
  - duplicazione temporanea con piano di rimozione

LOW → Annotato, nessun blocco
  - naming non ottimale, refactor cosmetico rimandabile

INFO → Solo osservazione, nessuna azione richiesta
```

Ogni finding elencato nelle sezioni successive (in particolare A6 — Limiti residui) deve riportare la propria severity.

### A1. Funzionalità
- File creati
- File modificati
- Migration (se presenti)
- Obiettivo dichiarato vs. realizzato
- Feature fuori scope introdotte: sì/no (elencare se sì)

### A2. Governance & RBAC (fatti)
- Azione passata dal Governance Evaluator: sì/no
- Permesso RBAC coinvolto
- Evento di audit generato
- Bypass dei controlli: sì/no

### A3. Stato dei dati
- Dati mockati presenti: sì/no
- Valori hardcoded: sì/no
- Stato dichiarato per ogni fonte: `live | empty | missing | unknown | error | loading`
- Confidence dichiarata (dove richiesta)

### A4. Performance & Resilienza
- Partial failure verificato: sì/no
- Timing disponibile (totale e per componente)
- Soglie usate (es. `*_THRESHOLD_MS`) e valore esatto
- Uso di 500 solo per errori sistemici non recuperabili: confermato sì/no
- Degrado controllato in caso di fonte non disponibile: sì/no

### A5. Type Safety
- Typecheck: pulito/non pulito (comando + risultato)
- Build: pulita/non pulita
- Uso di `any`: sì/no (elencare se sì)
- Uso di `ts-ignore`: sì/no (elencare se sì)

### A6. Limiti residui (obbligatorio — non sono accettate risposte vuote o generiche)

Ogni limite deve avere:
- descrizione
- impatto: basso / medio / alto
- workaround (se esiste)
- versione prevista di risoluzione

```text
LIMITI RESIDUI

1.
[descrizione]

Severity:
[CRITICAL/HIGH/MEDIUM/LOW/INFO]

Impatto:
[basso/medio/alto]

Workaround:
[se esiste]

Previsto:
[versione]
```

Se non viene indicato nemmeno un limite, la patch non ha ricevuto un'analisi reale e va respinta o approfondita prima dell'approvazione.

### A7. Debito tecnico introdotto

```text
TECHNICAL DEBT INTRODOTTO

Nessuno

oppure

- [descrizione debito 1]
- [descrizione debito 2]
```

Il debito tecnico non è automaticamente negativo — può essere una scelta consapevole — ma deve sempre essere esplicitato, mai sottinteso.

### A8. Debiti ereditati (tracking storico)

Per ogni debito promesso in una versione precedente:

```text
Inherited Technical Debt

Promesso in: vX.X
Risolto: sì/no

Se risolto:
  Risolto in questa patch

Se non risolto:
  Motivo
  Nuova versione prevista
```

Questa sezione impedisce che TODO/FIXME/"ci penseremo dopo" si perdano nel tempo senza tracciabilità.

---

## PARTE B — Architecture Review (compilata da un umano)

Questa parte **non può essere compilata da Lovable**. Richiede giudizio, non solo verifica fattuale.

Ogni voce richiede un esito esplicito PASS/FAIL e una nota — non basta la spunta, perché tra sei mesi serve poter capire *perché* una patch è stata approvata o respinta.

```text
Architecture Review

1. Coerente con il modello Brain Hub OS
   Esito: PASS / FAIL
   Note: ...

2. Evita duplicazioni
   Esito: PASS / FAIL
   Note: ...

3. Riutilizza servizi esistenti
   Esito: PASS / FAIL
   Note: ...

4. Aumenta il debito tecnico in modo accettabile
   Esito: PASS / FAIL
   Note: ...

5. Rompe pattern consolidati
   Esito: PASS / FAIL
   Note: ...

6. Prepara il terreno alle patch future (vs. lo complica)
   Esito: PASS / FAIL
   Note: ...

Decisione complessiva

APPROVATA
oppure
RESPINTA (motivo + azione richiesta)
```

Una singola voce FAIL non implica automaticamente RESPINTA — dipende dalla severity associata e dal giudizio del reviewer — ma deve sempre essere motivata nelle Note.

---

## Decision Log

Ogni review chiusa lascia una traccia permanente. Va aggiunta una riga per ogni patch valutata, a prescindere dall'esito.

```text
Decision Log

Reviewer:       [nome]
Data:           [YYYY-MM-DD]
Patch:          [vX.X.X — titolo]
Link patch:     [riferimento/commit/PR]
Decisione:      APPROVATA / RESPINTA
Motivazione:    [sintesi]
```

**Regola di crescita:** quando il Decision Log supera 100 entry, va estratto in un file dedicato `decision-log.md` (stesso percorso, `/docs/engineering/`), lasciando in questo documento solo un riferimento e le ultime 5-10 voci più recenti come contesto immediato. Questo evita che `engineering-quality-gate.md` cresca indefinitamente diventando lui stesso difficile da consultare.

Le voci si accumulano in ordine cronologico in questa sezione (o in un file dedicato `decision-log.md` se il volume cresce troppo per restare in questo documento).

```text
Reviewer:       Federico
Data:           2026-06-30
Patch:          v3.30.1 — Command Center Hardening
Link patch:     src/routes/api/command-center-data.ts, src/components/os/CommandCenterDashboard.tsx
Decisione:      APPROVATA
Motivazione:    Prima patch valutata interamente con l'EQG. Provenance, partial
                failure, timing e logging anomaly-only implementati come da
                spec. Debito tecnico dichiarato esplicitamente (A7: hook dev
                __force_fail) e debiti ereditati da v3.29 tracciati in A8
                (governance_confidence e last_enforcement_at riportati a
                v3.31/v3.32, correttamente fuori scope per questa patch).
                Nessun finding CRITICAL/HIGH. Raccomandazioni non bloccanti:
                passare la scala di confidence da 0/1/null a 0-100 (da
                formalizzare in architecture-principles.md prima che altri
                moduli ne dipendano); rimuovere __force_fail in v3.31 quando
                nascerà un test harness dedicato — aggiunto come azione di
                follow-up esplicita, non solo annotazione.
```

```text
Reviewer:       Federico
Data:           2026-06-30
Patch:          v3.31 — Priority Engine ("Today's Focus")
Link patch:     src/lib/priority-engine/priority-engine.ts, src/routes/api/priority-engine-data.ts,
                src/components/os/TodaysFocusWidget.tsx, src/lib/data-trust/types.ts
Decisione:      APPROVATA CON FOLLOW-UP OBBLIGATORI v3.32 (confidence review: 92/100)
Motivazione:    Prima patch costruita sotto architecture-principles.md v1.0
                (Data Trust Model + Partial Failure Pattern). Source Criticality
                dichiarata come costante tipizzata e realmente usata nel
                calcolo; verificata per tutte e sei le fonti via __force_fail.
                Punto chiave rispettato: con action_queue (required) in errore,
                il widget sopprime la lista invece di presentare priorità
                apparentemente affidabili. Nessun finding CRITICAL/HIGH.
                Criticità identificata in A6.2: calculation_method="weighted_average"
                dichiarato per il widget senza una vera formula ponderata
                (in realtà soglie ordinate) — rischia di indebolire
                l'interpretabilità dello standard Data Trust Model.
Follow-up obbligatori (v3.32):
  1. Rimuovere/spostare __force_fail in test harness dedicato
     (debito ereditato da v3.30.1, secondo rinvio).
  2. Correggere calculation_method del widget: non usare weighted_average
     se non esiste una formula ponderata reale.
  3. Decidere se introdurre rule_based_score come nuovo
     ConfidenceCalculationMethod in architecture-principles.md, da
     approvare esplicitamente prima dell'uso.
Nota aperta (non bloccante): A7 ha riportato "nessun debito nuovo" pur
  descrivendo nel testo la duplicazione RawSourceResult/WidgetProvenance
  come scelta consapevole — inconsistenza formale tra intestazione e
  contenuto, da correggere nel prossimo prompt (debito va sempre
  dichiarato esplicitamente come tale, anche se accettabile).
```

```text
Reviewer:       Federico
Data:           2026-06-30
Patch:          v3.32 — Priority Engine Standards Cleanup
Link patch:     src/lib/data-trust/types.ts, src/lib/priority-engine/priority-engine.ts,
                src/routes/api/priority-engine-data.ts, src/routes/api/command-center-data.ts,
                scripts/test-partial-failure.ts
Decisione:      APPROVATA (confidence review: 95/100)
Motivazione:    Chiude tutti e tre i follow-up obbligatori da v3.31. (1)
                calculation_method del widget e delle confidence per-priorità
                corretto a rule_based_score (architecture-principles.md v1.1),
                con tutti e 4 i campi obbligatori (rules_used, input_sources,
                source_criticality, confidence_reason) esposti. (2) __force_fail
                rimosso dal codice applicativo di entrambi gli endpoint,
                sostituito da scripts/test-partial-failure.ts — harness
                standalone che testa computePriorities direttamente, senza
                HTTP né auth, nessun rinvio a v3.33. (3) A7 ora dichiara
                correttamente ogni trade-off come debito (duplicazione
                RawSourceResult/WidgetProvenance riconfermata esplicitamente,
                non nascosta). Nessuna regressione nella logica di
                prioritizzazione. Debito residuo limitato e tracciato: la
                duplicazione RawSourceResult/WidgetProvenance resta aperta in
                attesa del Service Layer Pattern (Principio 3, non ancora
                definito); harness con process.exit(1) anziché runner
                ufficiale, migrabile a vitest quando esisterà una suite.
Follow-up residui: nessuno obbligatorio. Evoluzione pianificata: definire
  il Service Layer Pattern, naturale punto di convergenza per
  RawSourceResult e WidgetProvenance.
Nota metodologica: il report EQG di questa patch ha riorganizzato
  liberamente le sezioni A1–A8 in base al contenuto specifico (es. A1 =
  Governance invece di Funzionalità), invece di seguire l'etichettatura
  fissa dello standard. Non ha impattato la decisione — tutto il
  contenuto richiesto era presente — ma rompe la comparabilità tra
  report nel tempo, che è lo scopo dichiarato del Decision Log. Dal
  prossimo report EQG, la Parte A deve seguire rigorosamente la
  numerazione e le intestazioni A0–A8 definite nello standard, anche
  quando una sezione risulta "invariato rispetto alla patch precedente".
  L'ordine e i nomi delle sezioni non vanno reinterpretati per singola
  patch.
```

```text
Reviewer:       Federico
Data:           2026-06-30
Patch:          v3.33 — Service Layer Migration
Link patch:     src/lib/service-outcome.ts, src/lib/data-trust/types.ts,
                src/lib/priority-engine/priority-engine.ts,
                src/routes/api/priority-engine-data.ts, src/routes/api/command-center-data.ts
Decisione:      APPROVATA (confidence review: 94/100)
Motivazione:    Implementa ADR-003 e il Principio 3 (Service Layer Pattern).
                ServiceOutcome<T> introdotto come contratto pubblico,
                RawSourceResult eliminato, WidgetProvenance ridotto a
                proiezione/forma payload, Data Trust Model e Partial
                Failure Pattern invariati nel comportamento. Payload
                esterno stabile, nessuna regressione, scope rispettato
                (nessuna estensione a componenti React oltre il necessario).
                Debito RawSourceResult/WidgetProvenance tracciato da
                v3.31/v3.32: chiuso.
Follow-up: nessuno bloccante per il codice.
Nota metodologica (RICORRENTE — seconda occorrenza dopo v3.32): il
  report EQG Parte A non ha seguito l'etichettatura fissa A0–A8 dello
  standard, nonostante la regola sia già vincolante da v1.1. Questo non
  è più un episodio isolato: indica che la regola scritta nello standard
  non basta da sola a garantire conformità — va ribadita esplicitamente
  in ogni prompt, non assunta come nota già acquisita. Azione: da questo
  punto in poi, ogni prompt verso Lovable deve includere l'istruzione
  esplicita "Compila EQG Parte A seguendo esattamente le sezioni A0–A8
  dello standard, senza rinominare o riordinare le intestazioni" come
  riga a sé stante, non solo come riferimento al documento allegato.
```

```text
Reviewer:       Federico
Data:           2026-06-30
Patch:          v3.33.1 — Governance Docs Reorganization
Link patch:     docs/engineering/engineering-quality-gate.md, docs/engineering/architecture-principles.md,
                docs/engineering/README.md, docs/engineering/adr/adr-001..005, docs/runtime/runtime-risk-model.md
Decisione:      APPROVATA
Motivazione:    Patch docs-only. Scoperta utile: /docs/standards/ non
                esisteva mai nel repo (i 9 file sono stati creati
                direttamente nei nuovi percorsi, non spostati in senso
                stretto). Verifica full-repo (grep) conferma zero
                riferimenti residui al vecchio path. Nessun cambio
                semantico al contenuto degli standard. A7 dichiara
                onestamente i limiti reali: impossibilità di verificare
                equivalenza semantica vecchio→nuovo (i file originali
                non esistevano da verificare), e che l'aggiornamento del
                Decision Log stesso richiede intervento umano (questa
                voce è esattamente quell'intervento).
Criticità identificata — FORMATO (TERZA OCCORRENZA, vedi v3.32 e v3.31):
  il report ha rietichettato le sezioni A0–A8 con nomi propri (es. A0 =
  "Identificazione patch" invece di "Severity Classification", A5 =
  "Test e verifiche" invece di "Type Safety"), pur dichiarando nella
  riga di conferma finale "EQG Parte A conforme al formato A0–A8 senza
  rinominare le sezioni → sì". Questa dichiarazione è imprecisa: le
  sezioni sono state rinominate. A differenza delle due occorrenze
  precedenti, qui c'è una dichiarazione esplicita di conformità che non
  corrisponde ai fatti, non solo una deviazione silenziosa.
Azione: la sola istruzione testuale nel prompt non è sufficiente a
  garantire conformità dopo tre tentativi. Da v3.34 in poi, il prompt
  deve includere le 9 etichette esatte (A0. Severity Classification, A1.
  Funzionalità, ... A8. Debiti ereditati) elencate esplicitamente come
  intestazioni da copiare verbatim, non solo descritte a parole. Se la
  violazione si ripete una quarta volta nonostante questo, il formato
  non conforme deve essere trattato come finding bloccante (FAIL in
  Parte B), non più come nota.
```

```text
Reviewer:       Federico
Data:           2026-06-30
Patch:          v3.34 — Command Center v2 (Operational Core)
Link patch:     src/routes/api/command-center-v2-data.ts, src/components/os/CommandCenterV2Dashboard.tsx,
                src/routes/_authenticated/os.command-center-v2.tsx, src/lib/command-center-v2/risk-model.ts,
                src/lib/command-center-v2/suggested-actions.ts
Decisione:      APPROVATA
Motivazione:    Primo modulo applicativo della Fase Applicativa, e primo a
                esercitare tutti e 5 gli Architecture Principles insieme
                più il Runtime Risk Model. Single decision engine
                confermato (Suggested Actions = proiezione pura di
                computePriorities, nessun secondo motore). Source
                Criticality riusata. Pannello Blocked implementato come
                applicazione diretta di Honest State, visibile quanto le
                altre colonne. Scope rigorosamente rispettato: nessuna
                fonte dati nuova, nessun Execute reale (dichiarato fuori
                scope, candidato v3.35), nessun risk_level critical
                introdotto senza caso reale. 13/13 ActionType mappate a
                risk_level con tipo Readonly+frozen (impossibile
                estendere senza modifica di tipo).
Chiarimento pre-approvazione: A3 del report originale dichiarava
  genericamente calculation_method="direct_source" per ogni item, in
  apparente contraddizione con la correzione v3.32 (rule_based_score
  per item derivati dal Priority Engine). Verificato nel codice
  (suggested-actions.ts, pass-through diretto di trust senza
  ricostruzione): il codice era corretto fin dall'inizio: SuggestedAction
  e BlockedItem ereditano rule_based_score invariato. Solo il report
  era impreciso (generalizzava un comportamento valido solo per gli
  envelope letti 1:1 da tabella). Nessuna modifica al codice richiesta,
  solo riformulazione di A3/A6/A7. Nessun typecheck necessario.
Nota positiva sul processo: questo è il primo report EQG (su quattro
  occasioni) a rispettare perfettamente il formato A0–A8 fin dalla prima
  consegna, dopo l'introduzione del template letterale in v1.4
  dell'EQG — conferma che fornire il template da copiare verbatim,
  invece di descriverlo, risolve la violazione ricorrente.
Debito aperto (vedi A6/A7 del report): Execute reale MEDIUM/HIGH,
  risk_level CRITICAL, classificazione automation_actions.action_type
  string-matching, run_status hardcoded in Recent Executions, link
  sidebar v2 manuale invece che da OS_MODULES — tutti candidati v3.35,
  nessuno bloccante per questa approvazione.
```

---

## Standard Evolution Policy

Questa policy si applica a qualsiasi modifica agli Engineering Standards di Brain Hub (EQG, Architecture Principles, e i documenti che seguiranno — Agent Contract, Brain Graph Ontology, Service Layer Pattern, Coding Standards).

Ogni modifica a uno standard esistente deve:

```text
1. Indicare la motivazione (perché lo standard cambia, non solo cosa cambia)
2. Dichiarare la retrocompatibilità (lo standard precedente resta valido
   per le patch già approvate? richiede migrazione?)
3. Riportare la prima versione minima compatibile (Compatibility:
   Minimum Brain Hub Version, già presente nell'header di ogni standard)
4. Aggiornare il changelog del documento (mai una modifica silenziosa)
5. Essere approvata tramite Architecture Review — Parte B (EQG) se la
   modifica accompagna una patch di codice, oppure tramite un
   Architecture Standard Review (ASR, vedi sotto) se la modifica
   riguarda solo il documento stesso, senza una patch di codice associata
```

Gli standard non cambiano "perché serve in quel momento". Cambiano seguendo la stessa disciplina che impongono al codice: motivazione esplicita, tracciabilità, approvazione umana.

Una modifica che introduce un nuovo enum value, una nuova regola vincolante, o un nuovo principio, segue questa policy a prescindere da quanto sembri piccola — la modifica a `ConfidenceCalculationMethod` per `rule_based_score` (v1.1 di architecture-principles.md) è un esempio di applicazione corretta: motivata da un finding reale, retrocompatibile (non invalida `weighted_average` per i casi in cui è genuinamente corretto), versionata, approvata in Parte B (era legata alla patch v3.32).

### Normative Hierarchy

Quando due documenti di governance sembrano in conflitto, prevale quello più in alto in questa gerarchia:

```text
1. Architecture Principles    (cosa il sistema DEVE essere/fare strutturalmente)
2. Runtime Governance         (cosa il sistema PUÒ eseguire in pratica —
                                RBAC, Approval Layer, Runtime Risk Model)
3. Engineering Quality Gate    (come si verifica che 1 e 2 siano rispettati)
4. ADR                          (perché una decisione specifica è stata presa
                                — vincolante per il contesto che descrive,
                                ma non introduce regole nuove oltre quelle
                                già riflesse nei livelli 1-2)
5. ASR                            (registra che una modifica ai livelli 1-3
                                  è stata approvata — non genera regole
                                  proprie, attesta solo il processo seguito)
```

In pratica: se l'EQG (livello 3) richiede qualcosa che contraddice un Architecture Principle (livello 1), l'EQG va corretto, non il principio — a meno che la modifica non passi esplicitamente per la Standard Evolution Policy con un ADR a supporto. Un ADR non può introdurre silenziosamente un comportamento che contraddice un Architecture Principle esistente: se la decisione lo richiede, l'ADR deve essere accompagnato da una modifica esplicita al principio stesso (via ASR), non aggirarlo.

### ADR — Regola di immutabilità

Gli ADR, una volta accettati, non vengono modificati nel contenuto della decisione originale. Possono essere:

```text
Superseded  → un nuovo ADR sostituisce la decisione precedente,
              riferendola esplicitamente (es. "Supersedes ADR-002")
Deprecated  → la decisione non è più applicabile, ma il documento resta
              come registro storico del perché era valida allora
Extended    → un nuovo ADR aggiunge un caso non coperto dal precedente,
              senza contraddirlo
```

Mai riscritti. Se un ADR si rivela sbagliato o incompleto, la correzione è un nuovo ADR, non un editing silenzioso di quello esistente — coerentemente con lo scopo stesso degli ADR: rispondere fra mesi alla domanda "perché abbiamo deciso così", senza che la risposta sia stata alterata nel frattempo.

### Architecture Standard Review (ASR)

L'EQG (Parte A / Parte B) è progettato per valutare patch di codice: typecheck, build, payload, comportamento runtime. Quando una modifica riguarda solo un documento di standard — senza patch di codice associata, come una riorganizzazione, l'aggiunta di un principio, o un nuovo campo di metadati applicato retroattivamente — forzarla nel formato EQG produrrebbe sezioni vuote o forzate (non c'è un payload da verificare, non c'è un typecheck da eseguire).

Per questi casi si usa un record più leggero, l'**Architecture Standard Review (ASR)**:

```text
Architecture Standard Review (ASR)

Documento:        [nome file]
Versione:          [vecchia → nuova]
Motivazione:        [perché cambia]
Retrocompatibilità:   [totale / parziale / richiede migrazione — dettagliare]
Decisione:            APPROVATA / RESPINTA
Reviewer:              [nome]
ADR collegato:          [se esiste]
Data:                    [YYYY-MM-DD]
```

Regole:

```text
- EQG Parte B valuta implementazioni e patch di codice.
- ASR valuta modifiche agli standard di engineering stessi (documenti).
- ADR registra le decisioni architetturali che giustificano sia patch
  di codice sia evoluzioni di standard.
```

Le voci ASR si accumulano in un proprio registro cronologico, separato dal Decision Log delle patch di codice (vedi sezione "ASR Log" più sotto), per non mescolare le due categorie di evento.

---

## ASR Log

```text
Architecture Standard Review (ASR)

Documento:        architecture-principles.md
Versione:          1.2 → 1.3
Motivazione:        Introduzione della distinzione Structural / Behavioral
                      tra principi. Aggiunta del footer standard
                      (Applicabilità / Enforcement / Verifica), applicato
                      anche retroattivamente ai Principi 1-3. Introduzione
                      del Principio 4 — Honest State Pattern, diviso in
                      Livello 1 (Structural) e Livello 2 (Behavioral) per
                      non promettere allo standard una garanzia
                      deterministica sul comportamento di agenti/LLM che
                      il software non può mantenere in modo assoluto.
Retrocompatibilità:   Totale. Nessun principio precedente (1, 2, 3) cambia
                      semanticamente — solo classificazione e metadati
                      aggiunti (sezione Applicabilità/Enforcement/Verifica).
Decisione:            APPROVATA
Reviewer:              Federico
ADR collegato:          ADR-004 — Honest State Pattern
Data:                    2026-06-30
```

```text
Architecture Standard Review (ASR)

Documento:        architecture-principles.md
Versione:          1.3 → 1.4
Motivazione:        Introduzione del Principio 5 — Read → Suggest →
                      Prepare → Confirm → Execute, ultimo principio del
                      core architetturale. Definisce il confine tra
                      proposta/ragionamento e azione reale, con
                      separazione degli stadi proporzionale al
                      risk_level, ed Execute come gate esplicito del
                      Governance Evaluator (ponte con Runtime Governance).
Retrocompatibilità:   Totale. Nessun principio precedente cambia
                      semanticamente. Aggiunta pura di un nuovo principio
                      e relativa sezione nell'indice.
Decisione:            APPROVATA
Reviewer:              Federico
ADR collegato:          ADR-005 — Read/Suggest/Prepare/Confirm/Execute
Data:                    2026-06-30
```

```text
Architecture Standard Review (ASR)

Documento:        engineering-quality-gate.md
Versione:          1.3 → 1.4
Motivazione:        Aggiunta Normative Hierarchy (risoluzione conflitti
                      tra documenti di governance), regola di
                      immutabilità ADR (superseded/deprecated/extended),
                      regola di crescita del Decision Log (soglia 100
                      entry), e sostituzione della descrizione testuale
                      del formato A0–A8 con template letterale da
                      copiare verbatim — dopo tre violazioni consecutive
                      della regola descritta solo a parole.
Retrocompatibilità:   Totale. Nessuna regola precedente invalidata;
                      la Normative Hierarchy formalizza una precedenza
                      già implicita, non ne introduce una nuova.
Decisione:            APPROVATA
Reviewer:              Federico
ADR collegato:          nessuno (rafforzamento procedurale, non una
                          nuova decisione architetturale — non
                          giustifica un ADR a sé secondo i criteri già
                          stabiliti, es. rule_based_score in v1.1)
Data:                    2026-06-30
```

```text
Architecture Standard Review (ASR)

Documento:        runtime-risk-model.md
Versione:          1.0 → 1.1
Motivazione:        Aggiunta Execute Receipt (artefatto runtime per ogni
                      Execute reale) e Internal/External Execute Staging
                      con Internal Execute Readiness Review come gate
                      esplicito. Origine: necessità reale emersa
                      preparando v3.35 (primo Execute reale del
                      sistema) — non anticipata in astratto, richiesta
                      da un modulo concreto, coerente con la regola
                      "nessun nuovo documento finché un modulo reale non
                      lo richiede". Estende un documento esistente
                      (runtime-risk-model.md), non ne crea uno nuovo.
Retrocompatibilità:   Totale. La classificazione risk_level esistente
                      (low/medium/high/critical) non cambia. Aggiunta
                      pura di due sezioni operative.
Decisione:            APPROVATA
Reviewer:              Federico
ADR collegato:          nessuno (artefatto runtime, non decisione
                          architetturale — coerente con la nota già
                          presente nel documento: "non è un nuovo
                          principio architetturale, è un artefatto
                          runtime")
Data:                    2026-06-30
```

---

## Regola di chiusura patch

Una patch è considerata **completata** solo quando:

1. Parte A è compilata per intero, inclusi limiti residui e debito tecnico (anche se "nessuno").
2. Parte B è stata revisionata da un umano con decisione esplicita APPROVATA/RESPINTA.
3. Eventuali debiti ereditati da versioni precedenti sono stati verificati (risolti o riportati avanti con motivo).

In assenza di questi tre punti, la patch resta in stato "in revisione", indipendentemente dal fatto che il codice compili o sia stato deployato.

---

## Nota per evoluzioni future (non ancora attiva)

Quando Brain Hub inizierà a costruire un patrimonio di conoscenza strutturato (Brain Graph, fonti dati, confidence composita, ingestion, RAG), potrebbe emergere la necessità di un quarto livello:

```text
4. Knowledge Governance
```

Questo livello non esiste ancora e non va creato come scheletro vuoto. Va introdotto solo quando ci sarà contenuto reale da governare — Brain Graph Ontology popolato, regole di provenance/confidence in uso attivo, ingestion pipeline funzionanti. Annotato qui solo come promemoria di direzione.

---

## Changelog dello standard

- **v1.4** — Aggiunta la Normative Hierarchy (Architecture Principles > Runtime Governance > EQG > ADR > ASR, per risolvere conflitti tra documenti). Aggiunta la regola di immutabilità degli ADR (superseded/deprecated/extended, mai riscritti). Aggiunta regola di crescita per il Decision Log (estrazione in file dedicato oltre 100 entry). Sostituita la descrizione testuale del formato A0–A8 con un template letterale da copiare verbatim nei prompt, dopo tre violazioni consecutive (v3.32, v3.33, v3.33.1) della regola descritta solo a parole. Origine: review esterna sullo stato complessivo del sistema di governance.
- **v1.3** — Introdotto l'Architecture Standard Review (ASR), un record leggero per valutare modifiche agli standard di engineering che non accompagnano una patch di codice (a differenza dell'EQG Parte B, pensata per il codice). Aggiunto l'ASR Log come registro separato dal Decision Log. Corretto il punto 5 della Standard Evolution Policy, che imponeva impropriamente "Parte B" anche per modifiche solo documentali. Origine: prima ASR reale, per la modifica v1.2→v1.3 di architecture-principles.md.
- **v1.2** — Aggiunta la Standard Evolution Policy: ogni modifica agli Engineering Standards deve dichiarare motivazione, retrocompatibilità, versione minima compatibile, aggiornare il changelog ed essere approvata in Architecture Review. Origine: review di governance dello standard stesso, dopo che EQG e Architecture Principles hanno iniziato a dipendere l'uno dall'altro.
- **v1.1** — Aggiunta regola di formato vincolante: le sezioni A0–A8 mantengono sempre etichetta e ordine fissi, anche quando una sezione è "invariato" rispetto alla patch precedente. Origine: review EQG Parte B di v3.32, dove un report aveva riorganizzato liberamente le sezioni A1–A8 in base al contenuto, rompendo la comparabilità nel Decision Log pur con contenuto completo.
- **v1.0** — Versione iniziale. Introduce la separazione Parte A / Parte B, i limiti residui obbligatori con severity, il debito tecnico esplicito, il tracking dei debiti ereditati, la classificazione di severity (A0), la struttura PASS/FAIL per l'Architecture Review, il Decision Log e il principio di separazione codice/valore. Origine: patch v3.30.1 (Command Center Hardening), evoluto con il feedback della seconda review.
