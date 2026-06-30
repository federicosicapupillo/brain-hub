# ADR-003 — Service Layer Pattern

**Status:** Accettato
**Data:** 2026-06-30
**Versione minima compatibile:** Brain Hub v3.33 (migrazione); principio valido da subito per nuovi service pubblici
**Documento correlato:** `architecture-principles.md` — Principio 3

## Contesto

Il Command Center (v3.30.1) e il Priority Engine (v3.31) sono stati costruiti come endpoint indipendenti, ciascuno con la propria struttura interna per rappresentare disponibilità e provenienza dei dati: `WidgetProvenance` nel primo, `RawSourceResult` nel secondo. Entrambe esprimono lo stesso concetto — il Data Trust Model (ADR-001) applicato a un dato — ma sono state costruite separatamente.

Il debito è stato dichiarato esplicitamente in A7 sia in v3.31 sia in v3.32 (con disciplina corretta dopo la correzione di processo introdotta in quella stessa patch), classificato come scelta consapevole in attesa che il Service Layer Pattern venisse formalizzato. Questo ADR è quel momento.

Il rischio, lasciando la situazione invariata, è che ogni nuovo modulo (Project Center, Communication Center, Brain Graph) costruisca la propria variante locale dello stesso concetto, moltiplicando la duplicazione invece di consolidarla.

## Alternative considerate

1. **Continuare con `RawSourceResult` e `WidgetProvenance` separati, uno per endpoint.** Scartata: ogni nuovo modulo aggiungerebbe una terza, quarta variante dello stesso concetto, aumentando il rischio che le definizioni divergano nel tempo (es. un campo aggiunto a una ma non all'altra).

2. **Introdurre un super-tipo che unifica i due, ma che li lascia entrambi esistenti come specializzazioni.** Scartata: risolverebbe la duplicazione di superficie ma non quella concettuale — risulterebbe in un tipo "ombrello" con campi opzionali per accomodare entrambi i casi d'uso, meno preciso di un contratto unico.

3. **`ServiceOutcome<T>` come unico contratto pubblico del service layer, con `WidgetProvenance` ridotto a proiezione pura per la UI.** Adottata.

## Decisione

```text
- DataTrust è l'unica fonte di verità per status/confidence/provenance/freshness
  (riafferma ADR-001, non la ridefinisce).
- ServiceOutcome<T> è il contratto pubblico del Service Layer: ogni service
  pubblico (chiamato direttamente da una route API) restituisce
  ServiceOutcome<T>, mai un tipo costruito ad hoc.
- Gli helper interni possono lavorare su modelli puri (T), senza overhead
  di trust ad ogni passaggio di composizione interna.
- Le Route/API orchestrano i service pubblici; non costruiscono modelli
  di trust autonomamente.
- Le UI usano proiezioni pure (es. toWidgetProvenance(outcome)), mai tipi
  paralleli costruiti indipendentemente dai dati grezzi.
```

`ServiceOutcome<T>`:

```ts
type ServiceOutcome<T> = {
  data: T | null;
  trust: DataTrust;
  error_safe_message?: string;
  duration_ms: number;
};
```

## Conseguenze

**Positive:**
- Elimina la duplicazione concettuale tra `RawSourceResult` e `WidgetProvenance`, e previene che si ripeta in ogni modulo futuro.
- Riduce il rischio di incoerenza: un solo punto in cui "cosa significa che un dato è disponibile/affidabile" viene definito.
- Rende il Service Layer uniforme: qualunque nuovo modulo (Project Center, Communication Center, Brain Graph) eredita un contratto già pronto invece di doverne inventare uno.
- Chiude formalmente, a livello di standard, un debito tecnico tracciato dal Decision Log dell'EQG da due patch consecutive.

**Trade-off accettati:**
- Richiede una migrazione graduale dei servizi esistenti (Command Center, Priority Engine) — non immediata su tutto il codebase, ma pianificata come patch dedicata (v3.33).
- Alcune UI dovranno essere aggiornate per consumare proiezioni (`toWidgetProvenance`) invece di modelli costruiti localmente nell'endpoint — un refactor mirato, non un riscrittura.
- Come per gli altri principi, non è retroattivo sulle superfici legacy non toccate: si applica obbligatoriamente solo ai nuovi service pubblici e ai due endpoint già identificati come debito.

## Collegamento al ciclo decisionale

Questo ADR chiude il primo ciclo completo del processo di engineering di Brain Hub:

```text
ADR        → perché si prende questa decisione (questo documento)
Principle  → la regola generale che ne deriva (architecture-principles.md, Principio 3)
Patch      → applicazione della regola (v3.33 — Service Layer Migration)
EQG        → verifica che l'applicazione sia corretta e che il debito
             tracciato in A7/A8 dalle patch precedenti risulti chiuso
```
