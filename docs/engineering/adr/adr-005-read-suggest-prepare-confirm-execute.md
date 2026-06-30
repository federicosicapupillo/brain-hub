# ADR-005 — Read → Suggest → Prepare → Confirm → Execute

**Status:** Accettato
**Data:** 2026-06-30
**Versione minima compatibile:** Brain Hub v3.34 (atteso per il primo modulo che lo applica esplicitamente, es. Action Queue evoluta); principio valido da subito come vincolo su ogni nuova azione mutativa
**Documento correlato:** `architecture-principles.md` — Principio 5

## Contesto

I primi quattro principi del core (Data Trust Model, Partial Failure Pattern, Service Layer Pattern, Honest State Pattern) governano come Brain Hub OS rappresenta i dati e cosa è autorizzato a dire su di essi. Nessuno di questi vincola però le azioni con effetti reali — invio email, cancellazioni, pubblicazioni, modifiche a repository, esecuzione di workflow — che agenti (Jack, futuri agenti) o automazioni potrebbero proporre o eseguire.

Senza un principio esplicito, il rischio è che un agente passi direttamente da "ho letto questo dato" a "ho eseguito questa azione" senza un passaggio di proposta, preparazione visibile e conferma proporzionata al rischio — esponendo l'utente a effetti collaterali non chiaramente autorizzati.

## Alternative considerate

1. **Nessun principio esplicito, delegando il controllo solo al Governance Evaluator runtime (RBAC).** Scartata: RBAC stabilisce *chi può* eseguire un'azione, non *come* l'azione deve essere proposta, preparata e confermata prima dell'esecuzione. Sono livelli complementari, non sostitutivi.

2. **Un flusso fisso a 5 stadi, sempre con interfacce/passaggi separati per ogni azione, indipendentemente dal rischio.** Scartata: troppo rigido per azioni a basso rischio (es. "segna come letta"), che finirebbero appesantite da conferme inutili, con il rischio concreto che gli utenti imparino a clickare via le conferme senza leggerle — vanificando lo scopo del principio.

3. **Flusso a 5 stadi semanticamente sempre presenti, ma con separazione visibile proporzionale al `risk_level` dell'azione.** Adottata. Low risk: stadi compressi in un'unica interazione (il sistema registra comunque internamente che gli stadi sono avvenuti). Medium risk: preview/prepare visibile. High risk: Prepare e Confirm sempre esplicitamente separati.

## Decisione

```text
Read → Suggest → Prepare → Confirm → Execute

Read       → lettura, nessuna modifica.
Suggest    → proposta, nessuna modifica eseguibile costruita.
Prepare    → proposta concreta costruita (bozza, payload, patch,
             anteprima), non eseguita.
Confirm    → autorizzazione esplicita dell'utente, proporzionata al
             rischio dell'azione.
Execute    → esecuzione reale, solo dopo Governance Evaluator PASS
             (project isolation → RBAC → policy → agent permission)
             e con audit record obbligatorio.
```

Regola chiave: nessun agente può passare direttamente da Read a Execute. Nessuna azione esterna o mutativa può essere eseguita senza stato preparato, conferma compatibile col rischio, Governance Evaluator PASS, e audit record.

Il principio si applica a ogni azione operativa di Brain Hub OS (Jack, agenti futuri, automazioni, workflow n8n/browser, e azioni dirette della UI), con la distinzione che un'azione avviata direttamente da un umano può saltare lo stadio Suggest (l'utente sta già decidendo), mentre un'azione proposta dal sistema richiede Suggest esplicito.

`Execute` è dichiarato come il punto di ponte esplicito con Runtime Governance: è lo stadio in cui, e solo in cui, viene invocato il Governance Evaluator.

## Conseguenze

**Positive:**
- Chiude il core architetturale di Brain Hub OS: i tre principi Structural (Data Trust, Partial Failure, Service Layer) più i due Behavioral (Honest State, questo) coprono rispettivamente "come è fatto il dato", "come si comporta in caso di errore", "come è strutturato il service layer", "cosa il sistema può dire", "cosa il sistema può fare".
- I moduli applicativi futuri (Project Center, Communication Center, Agent Center) non dovranno definire da zero come gestire azioni mutative: applicano un principio già versionato.
- La proporzionalità al `risk_level` evita sia il rischio di azioni accidentali non controllate (nessuna separazione) sia l'affaticamento da conferma (troppe conferme su azioni innocue, che porterebbe gli utenti a ignorarle).
- Execute come gate esplicito di Governance Evaluator rende il principio verificabile strutturalmente per la parte di codice (Action Queue, Controlled Actions, API mutative), mantenendo onestà sul fatto che la parte di linguaggio naturale (un agente che descrive un'azione in modo da farla sembrare già avvenuta) resta enforcement Behavioral, come già stabilito per Honest State Pattern (ADR-004).

**Trade-off accettati:**
- Non esiste oggi in Brain Hub OS una definizione formale e centralizzata di cosa costituisce `low/medium/high risk` per ogni tipo di azione — questo principio presuppone che tale classificazione esista o venga costruita modulo per modulo. È un debito implicito: il primo modulo che applica concretamente questo principio (probabilmente un'evoluzione dell'Action Queue) dovrà proporre una tassonomia di risk_level, da formalizzare a sua volta se emerge come pattern ricorrente.
- Come per gli altri principi, non è retroattivo: si applica a nuove azioni mutative, non obbliga un refactor immediato di flussi esistenti non toccati.
