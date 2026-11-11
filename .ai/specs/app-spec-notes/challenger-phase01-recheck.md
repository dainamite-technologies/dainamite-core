# Challenger re-run — Phase 0/1 after fixes (§0–§4.5)

Execution: fresh-context subagent (general-purpose), 2026-11-10. Verifies the 11 earlier CRITICALs + fresh DDD pass.

Resolved in text: #1 (quotes), #2, #4, #5, #7, #10. Remaining items and new findings, with resolutions applied in the App Spec rewrite ("re-check fixes"):

## UNRESOLVED → fixed

- **#3 terminal deadlock** — saved recalculation on an `accepted` quote could invalidate an adjustment that can then be neither deleted nor converted. → Saved recalculation (`save:true`) refused in terminal statuses (409); adjustments locked once an order exists; conversion uses the stored snapshot.
- **#6 per-cycle rate** — billing charges `unit_price` once per cycle (`invoiceWriter.ts:220`); connector passes the monthly amount (`chargeMapper.ts:91`) → quarterly / annual accounts under-billed. → R14: per-cycle rate = monthly × months per cycle (weekly × 12/52), proration on that rate. Pre-existing defect on today's activation path logged U12 (⚠ needs human confirmation — fix changes billed amounts of existing non-monthly accounts).
- **#8 per-charge vs per-item schedules** — events send one recurring charge per item. → R14: item schedule = union of all its MRC charges' segment boundaries; segment rate = Σ charge rates × line quantity; segments numbered per item.
- **#11 carry-over vs charge model** — pinned `price_override` impossible on tiered / volume. → Carry-over re-creates the **original** adjustment type / value at charge level (no pinning).
- **#9 quote-time anchor** — absolute windows can't map to price months before activation. → Provisional anchor on the quote = today (display / deal value / overlap); actual effective date at activation.

## CRITICAL (new) → fixed

1. **Amend re-prices and re-bills untouched items** — every engine-priced mirror line re-priced at today's standard (C12) and, with `modifiedItems`, re-billed. → **Frozen mirror lines**: on Amend, an engine-priced mirror line keeps the source item's stored waterfall (no engine call) until the rep changes its configuration / quantity or adds an adjustment; then it is re-priced and the source's manual adjustments are carried over. `modifiedItems` = items whose rate or schedule differs from the source item. Renew lines are always re-priced (new term, Q8).
2. **Carry-over beats the rep's line discount** — charge-level carry-over outranks line level. → R1: rep-created adjustments beat carried-over adjustments at any level; specificity applies within each class.

## WARNING → fixed

- Auto transitions (`new` / `incomplete` / `ready`) bypass `transitionStatus` → `status_changed` also emitted for auto transitions (`cause: 'auto'`).
- Aggregate lock + `pricing_revision` bump on every price-affecting write (line add / edit / remove, saved recalculation, clone, carry-over), not only adjustments and status.
- I-7 "verbatim" → exception for activation-time date materialisation and window clipping.
- Term drift → column `price_start_date`; tooltip "Adjustments are locked"; glossary adds Contracted price, Re-rate, Eligible line, Changed line, Frozen mirror line.
- R8 → an invalid adjustment is skipped for its months only; resolution falls back to the next valid adjustment, else standard.
- R9 quote level on Renew → quote-level applies to every engine-priced line that is not frozen (so Renew lines are included).
- ARC deal value → "changed line" = offer differs from the source item, or a non-mirrored line.
- I-8 / I-13 cross into billing → stated as eventually consistent, backed by US-2.5 reconciliation.
- R14 open items include future segment and proration items.
