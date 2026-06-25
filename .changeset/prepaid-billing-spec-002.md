---
"@dainamite/billing": minor
---

Prepaid billing mode (SPEC-002 / XD-304). Adds an additive `prepaid` billing
mode alongside the existing postpaid recurring engine: top-up balance,
real-time atomic usage debit (never rejects usage), append-only transaction
ledger, prepaid period-close statements, manual balance adjustments, and the
prepaid admin UI (balance panel, Transactions / Top-ups / Statements lists +
detail pages). Postpaid behaviour is unchanged.
