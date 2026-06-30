# ADR-002 — Partial Failure Pattern (con Source Criticality)

**Status:** Accettato
**Data:** 2026-06-30
**Versione minima compatibile:** Brain Hub v3.30.1 (regola base), v3.31 (Source Criticality)
**Documento correlato:** `architecture-principles.md` — Principio 2

## Contesto

L'endpoint `/api/command-center-data` orchestra più fonti indipendenti (projects, action_queue, result_review, agent_runs, gmail, github). Il comportamento di base — non far fallire l'intero endpoint per il fallimento di una sola fonte — è stato implementato e validato in v3.30.1.

Con l'arrivo del Priority Engine (v3.31), è emerso un problema più sottile: un consumer che *aggrega* più fonti per produrre un risultato derivato (priorità operative) non può trattare tutte le fonti come equivalenti. Se la fonte più importante per il calcolo (`action_queue`) fallisce, il sistema non deve generare priorità che sembrano complete e affidabili ma sono basate su dati mancanti — il rischio peggiore non è il blocco totale, ma un falso senso di completezza.

## Alternative considerate

1. **Tutte le fonti trattate allo stesso modo (qualsiasi fallimento → solo warning)** — semplice, ma rischia di produrre output "apparentemente intelligenti" su basi fragili, esattamente il rischio identificato prima di iniziare v3.31 ("se v3.31 costruisce priorità sopra dati non tracciati o fragili...").
2. **Qualsiasi fallimento di una fonte blocca l'intero output (fail-fast totale)** — troppo fragile: una fonte secondaria (es. GitHub) non dovrebbe impedire al sistema di mostrare comunque le priorità calcolabili dalle altre fonti.
3. **Criticality dichiarata per fonte, a livello globale e fissa per tutto il sistema** — scartata: la stessa fonte (es. Gmail) può essere `optional` per il Priority Engine e `required` per un futuro Communication Center. Fissarla globalmente avrebbe accoppiato moduli indipendenti.
4. **Criticality dichiarata esplicitamente da ogni consumer, per le fonti che aggrega** — scelta adottata.

## Decisione

Formalizzare il **Partial Failure Pattern** in due livelli:

**Livello base (fonte singola → consumer diretto):** un errore locale non diventa mai un errore globale. La fonte fallita espone `status="error"` con messaggio sicuro; le altre restano disponibili; logging solo su eventi anomali; HTTP 500 riservato a errori sistemici, 403 a governance/RBAC fail.

**Livello Source Criticality (consumer multilivello):** ogni consumer che aggrega più fonti dichiara, per ciascuna, una criticality — `required`, `important`, o `optional` — come costante tipizzata, realmente usata nel calcolo:

```text
required   → se fallisce, il consumer non produce un output apparentemente
             completo (status degradato, nessuna lista presentata come affidabile)
important  → se fallisce, il consumer continua ma abbassa la confidence
             e aggiunge warning esplicito
optional   → se fallisce, il consumer continua normalmente, warning facoltativo
```

La mappatura è una decisione del modulo specifico, non un valore globale per fonte.

## Conseguenze

**Positive:**
- Il Priority Engine (v3.31) ha potuto dichiarare `action_queue: required` e, verificato in pratica, sopprime la lista di priorità invece di mostrarne una incompleta quando quella fonte fallisce — esattamente il comportamento richiesto prima di iniziare il modulo.
- Il pattern è riusabile da ogni futuro consumer multilivello (Project Center, Communication Center, Brain Graph) senza reinventarlo.
- La distinzione tra "errore di sistema" (status) e "quanto contava quella fonte per questo risultato" (criticality + confidence) resta coerente con il Data Trust Model (ADR-001).

**Negative / costi accettati:**
- Ogni nuovo consumer multilivello deve dichiarare esplicitamente la criticality delle sue fonti — un piccolo overhead di design per ogni modulo, ma intenzionale: previene che la criticality venga assunta implicitamente o lasciata a discrezione dell'implementazione.
- Il meccanismo di test per simulare partial failure (`__force_fail`) è stato inizialmente lasciato come dev hook (debito tecnico dichiarato in v3.30.1, riusato in v3.31, infine rimosso e sostituito da un harness standalone in v3.32) — un esempio di debito tecnico gestito correttamente nel tempo grazie al tracking A8 dell'EQG, non di un problema del pattern stesso.
