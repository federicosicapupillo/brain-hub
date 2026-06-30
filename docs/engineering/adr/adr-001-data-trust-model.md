# ADR-001 — Data Trust Model

**Status:** Accettato
**Data:** 2026-06-30
**Versione minima compatibile:** Brain Hub v3.31
**Documento correlato:** `architecture-principles.md` — Principio 1

## Contesto

Il Command Center (v3.30.1) doveva esporre, per ogni widget, quanto un dato fosse affidabile. La prima implementazione usava una confidence a tre valori (`1` per dati live/empty, `0` per errore, `null` per non calcolabile). Durante la review EQG di v3.30.1 è emerso che questa scala non avrebbe retto l'uso da parte di moduli futuri (Priority Engine, Brain Graph, Knowledge Center), che avrebbero avuto necessità di esprimere confidence intermedie (es. una relazione del Brain Graph inferita con affidabilità del 72%).

## Alternative considerate

1. **Scala booleana/ternaria (status quo)** — semplice, ma incapace di esprimere gradazioni; avrebbe richiesto una migrazione non pianificata appena un modulo con confidence intermedie fosse arrivato.
2. **Scala 0.0–1.0 (float)** — semanticamente equivalente a 0–100, ma meno leggibile nei log e nei payload di debug; maggiore rischio di errori di arrotondamento/confronto.
3. **Confidence come singolo numero senza provenance/metodo dichiarati** — risolve solo parzialmente il problema: un numero senza sapere *come* è stato calcolato resta poco interpretabile e non auditabile.
4. **Modello a quattro dimensioni indipendenti (status, confidence, provenance, freshness)** — scelta adottata. Riconosce che "il dato è disponibile", "quanto è affidabile", "da dove arriva" e "quanto è aggiornato" sono domande indipendenti che un singolo numero non può rispondere tutte insieme.

## Decisione

Adottare il **Data Trust Model**: ogni dato operativo significativo espone `status` (enum chiuso), `confidence` (intero 0–100 o `null`), `calculation_method` (enum chiuso, estendibile solo via standard) con relativa `provenance`, e `freshness` (timestamp ISO o `null`, senza giudizio di staleness — quello è responsabilità del consumer).

Regole chiave:
- `status` e `confidence` sono indipendenti: un errore non implica automaticamente `confidence=0`.
- `confidence=0` è riservato al caso in cui una valutazione reale conclude affidabilità nulla, non all'assenza di dato.
- Ogni confidence non-null deve dichiarare `calculation_method` e provenance.
- Non viene fissata una formula matematica unica per derivare confidence — solo il contratto (input, metodo, output).

## Conseguenze

**Positive:**
- I moduli futuri (Priority Engine, Brain Graph) nascono già compatibili, senza migrazione retroattiva dei contratti dati.
- Ogni confidence è auditabile: si può sempre rispondere "perché questo numero?" risalendo a `calculation_method` e `provenance`.
- Separazione netta tra "il sistema ha fallito nel leggere il dato" (status) e "il dato letto è poco affidabile" (confidence) evita un'ambiguità che avrebbe propagato bug di interpretazione a valle (es. un Priority Engine che tratta un errore di rete come "bassa confidence" invece che come "dato assente").

**Negative / costi accettati:**
- Più campi da popolare per ogni dato rispetto alla scala precedente; richiede disciplina da parte di ogni nuovo modulo.
- L'enum chiuso `calculation_method` richiede un piccolo processo di governance (Standard Evolution Policy) ogni volta che serve un nuovo metodo — friction intenzionale, per evitare etichette di comodo (vedi ADR successivo su `rule_based_score`, introdotto in v3.32 dopo che `weighted_average` era stato usato impropriamente in v3.31).

**Non retroattivo:** il Data Trust Model è obbligatorio per nuove API, nuovi widget, nuovi service layer, e per ogni dato usato da agenti o dal Priority Engine. Non obbliga un refactor delle superfici legacy non toccate.
