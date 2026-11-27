---
"@dainamite/cpq": minor
---

Price phases — trials, promotions and ramp deals (spec `2026-11-26-billing-price-phases-ramp-deals`, Phase 2):

- Manual price adjustments on recurring prices accept a month range (`fromMonth` / `toMonth`) and an optional `phaseName`. Phases price MRC only (`PHASE_RECURRING_ONLY`), never overlap on one target (`ADJUSTMENT_OVERLAP`), and never pass the line term (`PHASE_PAST_TERM`).
- Price rules get an optional month range (`from_month` / `to_month`) and campaign dates (`valid_from` / `valid_until`); migration `Migration20261127100000_cpq_price_phases`. Rules outside their campaign are skipped at pricing time; a line already priced with a rule keeps it.
- The waterfall runs per month segment. A phased charge carries `schedule` (months → standard / offer price, source rule | manual | list); its own price and the MRC totals are the regular price, the deal value sums the schedule over the term, and `hasTimeBasedAdjustments` is set.
- Quote UI: **Phases** editor on a line and on a recurring charge (months / years, Free / Set price / % off / Amount off), the schedule in the charge breakdown and on the subscription item, month range fields in the adjustment dialog; rule form month range and campaign dates.
- Order lines and subscription items keep the schedule. The activation event and ARC `addedItems` / `changedItems` recurring charges carry `phases` (contract C2): MRC charges of one billing period merged (union of boundaries, prices summed), each `{ name, months, priceType: 'fixed', value }`, `unitPrice` = regular price. ARC mirror lines stay `LINE_NOT_ELIGIBLE` and re-price at the regular price (D8).
