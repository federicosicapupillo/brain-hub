# Brain Hub Engineering Standards — Index

**Location:** `/docs/engineering/README.md`

Questo file è solo un indice. Riconosce che sta nascendo una famiglia di standard, senza anticipare contenuto non ancora deciso. Ogni riga punta a un documento reale, o dichiara esplicitamente "non ancora esistente" — mai un link a uno scheletro vuoto.

**Nota di struttura:** la documentazione di Brain Hub è organizzata in tre domini fisicamente separati, a riflettere i tre livelli di governance:

```text
/docs/
    product/      → Product Governance (visione, roadmap, moduli)
    engineering/  → Engineering Governance (questo indice; EQG, Architecture
                    Principles, ADR, Coding Standards)
    runtime/      → Runtime Governance (RBAC, Approval Layer, Audit,
                    Governance Evaluator, Runtime Risk Model)
```

Questo indice copre solo `/docs/engineering/`. Per Runtime Governance vedi `/docs/runtime/` (es. `runtime-risk-model.md`).

## Engineering Governance

| Documento | Stato | Versione |
|---|---|---|
| `engineering-quality-gate.md` | ✅ Esiste (include EQG Parte A/B per il codice + ASR per gli standard) | v1.3 |
| `architecture-principles.md` | ✅ Esiste — core completo: Structural (Data Trust Model, Partial Failure Pattern, Service Layer Pattern), Behavioral (Honest State Pattern, Read→Suggest→Prepare→Confirm→Execute) | v1.4 |
| `adr/` (Architecture Decision Records) | ✅ Esiste (ADR-001, ADR-002, ADR-003, ADR-004, ADR-005) | — |
| `agent-contract-spec.md` | ⏳ Non ancora esistente | — |
| `brain-graph-ontology.md` | ⏳ Non ancora esistente | — |
| `coding-standards.md` | ⏳ Non ancora esistente | — |

## Runtime Governance (riferimento — vive in /docs/runtime/)

| Documento | Stato | Versione |
|---|---|---|
| `runtime-risk-model.md` | ✅ Esiste | v1.0 |
| `approval-policy.md` | ⏳ Non ancora esistente | — |
| `governance-evaluator.md` | ⏳ Non ancora esistente (logica già implementata in codice, non ancora documentata) | — |
| `rbac-reference.md` | ⏳ Non ancora esistente (vive in `reference/`, non in `runtime/`, secondo la distinzione modello/implementazione) | — |
| `audit-model.md` | ⏳ Non ancora esistente | — |

## Relazioni tra documenti

```text
engineering-quality-gate.md
  → definisce COME si valuta e si approva ogni patch (Parte A / Parte B / Decision Log)

architecture-principles.md
  → definisce QUALI pattern strutturali ogni modulo deve rispettare
  → referenziato dall'EQG come materiale di review per la Parte B

adr/
  → registra PERCHÉ una decisione architettonica specifica è stata presa,
    con alternative considerate e conseguenze — risponde a domande tipo
    "perché confidence=null e non 0?" senza dover cercare nelle chat
```

Ogni nuovo standard aggiunto a questa famiglia segue la Standard Evolution Policy definita in `engineering-quality-gate.md`.
