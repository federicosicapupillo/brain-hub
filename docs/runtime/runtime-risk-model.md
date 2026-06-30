# Runtime Risk Model

**Version:** 1.0
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

- **v1.0** — Versione iniziale. Definisce i quattro livelli di rischio (low/medium/high/critical), conferma richiesta, condizioni di Execute, approval layer e granularità di audit per ciascuno. Origine: completamento operativo del Principio 5 (Read→Suggest→Prepare→Confirm→Execute) di `architecture-principles.md`, ADR-005.
