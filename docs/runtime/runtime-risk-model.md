# Runtime Risk Model

**Version:** 1.1
**Status:** Active
**Domain:** Runtime Governance (non Engineering Governance — vedi nota sotto)
**Location:** `/docs/runtime/runtime-risk-model.md`
**Compatibility:** Minimum Brain Hub Version: v3.34
**Documento correlato:** `architecture-principles.md` — Principio 5 (Read → Suggest → Prepare → Confirm → Execute), ADR-005

## Perché questo documento non è un Architecture Principle

Il Principio 5 (`architecture-principles.md`) stabilisce che la separazione degli stadi Read→Suggest→Prepare→Confirm→Execute deve essere proporzionale al `risk_level` di un'azione, ma deliberatamente non definisce cosa sia un risk_level — è un dettaglio operativo, non un principio strutturale. Questo documento riempie quel vuoto.

Appartiene al dominio **Runtime Governance** (insieme a RBAC, Approval Layer, Audit, Governance Evaluator), non a Engineering Governance: non dice come scrivere codice, dice quando un'azione può essere eseguita e con quale livello di autorizzazione.

## Risk Level — definizione

```ts
type RiskLevel = "low" | "medium" | "high" | "critical";
```

| Risk Level | Definizione | Esempi |
|---|---|---|
| **LOW** | Azione reversibile, nessun effetto su sistemi esterni o dati di terzi, impatto limitato e facilmente annullabile. | Segnare un'email come letta, aggiornare lo stato locale di un widget, marcare una action come vista, riordinare priorità nella propria vista. |
| **MEDIUM** | Azione che modifica dati interni a Brain Hub o effettua una chiamata a un sistema esterno ma reversibile/correggibile senza conseguenze gravi. | Archiviare un'email, categorizzare un messaggio, creare una bozza (non inviata), aggiornare un campo di progetto, schedulare un task. |
| **HIGH** | Azione che produce un effetto visibile o irreversibile verso l'esterno, o che modifica dati che altri potrebbero vedere/usare. | Inviare un'email, pubblicare un post, creare una issue/PR pubblica, modificare permessi di un repository, inviare un messaggio Telegram/social. |
| **CRITICAL** | Azione distruttiva, irreversibile, o con impatto su sicurezza/accesso/dati sensibili. | Cancellare dati in modo permanente, revocare/modificare credenziali, modificare RBAC o regole di governance stesse, eseguire codice non sandboxato, transazioni finanziarie (già vietate a livello di azione assistita, vedi nota sotto). |

`critical` non implica necessariamente "vietato": implica il massimo livello di frizione e verifica richiesto prima di Execute. Alcune azioni (transazioni finanziarie, modifica di credenziali) restano comunque fuori dal perimetro di ciò che Brain Hub può eseguire autonomamente, indipendentemente dalla classificazione di rischio — quel vincolo è esterno a questo modello ed è già parte delle regole di sicurezza generali del sistema.

## Conferma richiesta per livello

```text
LOW
  Confirm: implicita nell'azione stessa (un click vale come
  Prepare+Confirm). Nessuna schermata di conferma separata richiesta.
  Reversibilità: l'azione deve essere annullabile con un'azione
  altrettanto semplice (undo immediato o ri-marcatura).

MEDIUM
  Confirm: preview/prepare visibile prima dell'esecuzione. Non serve
  una conferma a parte se la preview stessa funge da punto di stop
  naturale (es. bozza salvata ma non inviata, che richiede un'azione
  esplicita successiva per diventare effetto reale).

HIGH
  Confirm: esplicita e separata da Prepare. L'utente deve vedere
  esattamente cosa sta per accadere (contenuto, destinatario, effetto)
  e confermare con un'azione dedicata, non riusabile per altre azioni
  nello stesso flusso.

CRITICAL
  Confirm: esplicita, separata, e con frizione aggiuntiva proporzionata
  (es. doppia conferma, conferma con timeout/cooldown, o conferma che
  richiede di ripetere/confermare il dettaglio specifico dell'azione,
  non solo un "sì" generico).
```

## Execute consentito

```text
LOW       → Execute autonomo consentito (anche da agente, senza
            intervento umano per-azione), se l'azione rientra nei
            permessi RBAC del modulo/agente.
MEDIUM    → Execute consentito dopo Confirm dell'utente. Un agente può
            proporre e preparare autonomamente, ma non eseguire senza
            Confirm.
HIGH      → Execute consentito solo dopo Confirm esplicita E passaggio
            dal Governance Evaluator con audit record dettagliato
            (non solo "azione X eseguita", ma contenuto/destinatario/
            effetto specifico).
CRITICAL  → Execute richiede Confirm con frizione aggiuntiva (vedi
            sopra) E Governance Evaluator PASS E audit record completo.
            Per alcune categorie (vedi tabella sopra), Execute non è
            mai autonomo, indipendentemente da Confirm.
```

## Approval layer

```text
LOW, MEDIUM   → Approval layer = l'utente stesso, in tempo reale
                (click, conferma vocale).
HIGH          → Approval layer = l'utente stesso, con possibilità
                futura di delega esplicita (es. "approva sempre
                automaticamente le email a questo destinatario") —
                la delega stessa è un'azione HIGH/CRITICAL da
                configurare con lo stesso rigore.
CRITICAL      → Approval layer = solo l'utente, nessuna delega
                automatica prevista in questa versione del modello.
```

## Audit

Ogni Execute, a qualsiasi risk_level, produce un audit record (coerente con il Governance Evaluator esistente). Il livello di dettaglio richiesto scala con il rischio:

```text
LOW       → audit minimale (azione, timestamp, esito)
MEDIUM    → audit con riferimento ai dati coinvolti
HIGH      → audit con contenuto/destinatario/effetto specifico,
            ispezionabile per intero (non solo riferimento)
CRITICAL  → audit completo + retention estesa (la durata esatta di
            retention non è fissata in questa versione; va decisa
            quando emergerà un caso reale che la richiede)
```

## Come un modulo applica questo modello

Ogni nuovo modulo che introduce azioni mutative (Command Center v2, Project Center, Communication Center, Agent Center) deve:

1. Classificare ogni tipo di azione che espone con un `risk_level` esplicito, dichiarato nel codice (non lasciato implicito).
2. Applicare la separazione di stadi e il livello di conferma corrispondente, secondo le tabelle sopra.
3. Riportare nel proprio report EQG (Parte A) la mappatura risk_level → azione, analogamente a come Source Criticality viene dichiarata e citata per le fonti dati.

Questo modello non prescrive la UI esatta di conferma per ogni caso — quella è una decisione di design del singolo modulo — ma prescrive il comportamento minimo richiesto per ogni livello.

## Execute Receipt

Ogni Execute reale, indipendentemente dal risk_level, produce un **Execute Receipt** — l'artefatto runtime che documenta in modo permanente e ispezionabile cosa è stato eseguito, da chi, quando, e con quale esito. È l'equivalente, a livello di esecuzione, di ciò che l'ADR è per le decisioni architetturali e il Decision Log è per le patch: una risposta verificabile alla domanda "perché/come è successo questo", senza dover ricostruire la storia da log sparsi.

```ts
type ExecuteReceipt = {
  receipt_id: string;
  action_id: string;
  action_type: string;          // riferimento al tipo di azione (es. ActionType
                                  // di Command Center v2)
  risk_level: RiskLevel;
  requested_by: string;          // chi ha generato la proposta (utente, agente)
  approved_by: string | null;     // chi ha confermato — null se LOW (confirm
                                  // implicita) e tracciato comunque come tale
  executed_by: string;             // sistema/processo che ha eseguito
  started_at: string;               // ISO timestamp
  completed_at: string | null;        // null se in corso o fallito prima del
                                      // completamento
  result: "success" | "failure" | "partial";
  rollback_available: boolean;
  external_reference: string | null;  // es. message-id email, commit SHA,
                                      // null se l'azione è interna (MEDIUM)
  audit_record: string;                // riferimento al record di audit
                                        // già prodotto dal Governance Evaluator
};
```

Regole:

```text
1. Ogni Execute (LOW incluso, se mutativo) produce un Execute Receipt.
   Azioni puramente di lettura (Read) non producono Receipt.
2. Il Receipt è immutabile una volta scritto — un fallimento successivo
   (es. un rollback) produce un nuovo Receipt collegato, non modifica
   quello originale.
3. external_reference è obbligatorio quando l'azione ha avuto un effetto
   verso un sistema esterno (HIGH), per permettere di correlare il
   Receipt interno con l'evidenza esterna (es. l'email effettivamente
   inviata).
4. Il Receipt referenzia l'audit_record del Governance Evaluator, non lo
   sostituisce — sono due artefatti complementari: l'audit_record
   conferma che il Governance Evaluator ha autorizzato l'azione, il
   Receipt conferma cosa è realmente accaduto durante l'esecuzione.
```

## Internal / External Execute Staging

L'introduzione di Execute reale in un modulo non avviene tutta insieme. Per ridurre la superficie di rischio quando più assunti (Governance Evaluator, Approval Layer, Execute Dispatcher, connettore esterno, idempotenza, audit, rollback, UX di conferma) vengono validati per la prima volta in produzione, l'Execute reale si introduce in due fasi:

```text
Fase 1 — Internal Execute
  Azioni che scrivono esclusivamente nello stato interno di Brain Hub
  (nessun sistema esterno modificato). Valida Execute Dispatcher,
  Governance Evaluator, Runtime Risk Model, Audit, Confirm, Idempotency,
  Logging, Recovery — senza rischio verso terzi.

Fase 2 — External Execute
  Azioni con effetto verso sistemi esterni (invio email, pubblicazioni,
  push, messaggi). Si apre SOLO dopo che la Fase 1 ha superato
  l'Internal Execute Readiness Review (vedi sotto).
```

### Internal Execute Readiness Review

Checklist obbligatoria prima di abilitare qualsiasi Execute esterno (HIGH con effetto verso terzi). Ogni voce deve essere verificata esplicitamente, non assunta:

```text
Internal Execute Readiness

□ Governance sempre invocata (nessun path che esegue senza passare
  dal Governance Evaluator)
□ Nessun bypass trovato (verifica attiva, non solo assenza di bug noti)
□ Audit completo (ogni Execute produce audit_record + Execute Receipt)
□ Idempotency verificata (eseguire due volte la stessa richiesta non
  produce doppio effetto)
□ Confirm obbligatorio rispettato (nessun Execute MEDIUM/HIGH senza
  Confirm esplicita registrata)
□ Retry sicuro (un retry dopo fallimento non duplica l'azione)
□ Rollback interno funzionante (per le azioni che lo prevedono)
□ Nessuna race condition osservata (esecuzioni concorrenti non
  producono stati inconsistenti)
□ Nessuna esecuzione duplicata osservata in pratica (non solo in teoria)

READY_FOR_EXTERNAL_EXECUTE = true   (solo quando tutte le voci sono verificate)
```

Questa review va registrata nel Decision Log dell'EQG come una patch a sé (non come parte della stessa patch che introduce Internal Execute), in modo che la decisione di "siamo pronti per l'esterno" sia esplicita, datata, e attribuibile — non implicita nel fatto che la patch successiva semplicemente non ha trovato problemi.

## Limiti dichiarati di questa versione

```text
1. La classificazione di risk_level per azioni specifiche non ancora
   esistenti (es. azioni di Knowledge Center o Brain Graph) non è
   anticipata qui — verrà definita quando quei moduli verranno
   costruiti, applicando questo stesso modello.
2. Il meccanismo di delega (menzionato per HIGH) non è specificato in
   dettaglio in questa versione — resta un caso futuro.
3. La retention esatta per audit CRITICAL non è fissata numericamente.
```

## Changelog

- **v1.1** — Aggiunto l'Execute Receipt (artefatto runtime che documenta ogni Execute reale, complementare all'audit_record del Governance Evaluator) e l'Internal/External Execute Staging (separazione obbligatoria tra Execute interno e Execute con effetto esterno, con Internal Execute Readiness Review come gate esplicito tra le due fasi). Origine: primo caso reale di Execute reale (v3.35), che ha reso necessario un modello esplicito per ridurre la superficie di rischio quando più assunti vengono validati per la prima volta in produzione contemporaneamente.
- **v1.0** — Versione iniziale. Definisce i quattro livelli di rischio (low/medium/high/critical), conferma richiesta, condizioni di Execute, approval layer e granularità di audit per ciascuno. Origine: completamento operativo del Principio 5 (Read→Suggest→Prepare→Confirm→Execute) di `architecture-principles.md`, ADR-005.
