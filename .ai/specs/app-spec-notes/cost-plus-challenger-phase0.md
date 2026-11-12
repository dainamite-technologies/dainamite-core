# Challenger — Phase 0 (§0–§2), CPQ Cost-Plus Pricing

Execution: fresh-context subagent (general-purpose), 2026-11-11. Inputs: the App Spec §0–§2 + glossary, the user brief.

## CRITICAL → disposition

| # | Finding | Disposition |
|---|---|---|
| C1 | `status` conflates value certainty with sourcing state: an estimated cost cannot be requested, re-requesting drops the value, there is no declined / cancelled state | FIXED — split into `value_status` (`none` / `estimated` / `confirmed`) + `value_origin` + `sourcing_status` (`not_requested` / `requested` / `answered` / `declined` / `cancelled`) + `request_seq`; Renew turns carried values into `estimated` (value kept) |
| C2 | No correlation id for async supplier answers; R1b reset can let a stale answer land | FIXED — `cost_request_id` in `cost_requested`, required on answer; `409 COST_REQUEST_SUPERSEDED`; `supplier_quote_ref` idempotency; `cost_request_cancelled` event |
| C3 | "Supplier term" used in R13 but not modelled; early-termination charges ignored | FIXED — `supplier_term_end`, `supplier_min_term_months` on cost lines / item costs; Cancel quote shows supplier-term warning; supplier early-termination cost logged as Q-D10 |
| C4 | `margin_summary` / order `costs` on widely-read entities leak through CRUD, undo snapshots, audit log, search, export | FIXED — margin and order costs in cost-owned tables (`cpq_quote_margins`, `cpq_order_line_costs`); I-4 widened to audit / search / export / undo payloads |
| C5 | Index cost on live subscriptions: "changes margin" vs "updated by ARC only" | FIXED — frozen at activation until the next ARC (R12); scheduled revaluation logged as Q-D9 |
| C6 | Cost-plus charge with no *applicable* price-basis cost → `markup(0)` | FIXED — `NO_PRICE_BASIS_COST`, I-2 rephrased |
| C7 | Cost lineage lost across quote → order → subscription; catalog instantiation on mirror lines undefined | FIXED — stable `cost_key` at every stage; mirror lines skip catalog instantiation unless reconfigured; dedupe by `cost_key` |

## WARNING → disposition

| Finding | Disposition |
|---|---|
| R2 quantity / rounding (absolute markup per instance; sub-precision unit; per_unit cost on flat charge; sum order) | FIXED in R2 |
| FX direction, FX vs index freeze, table currency precedence, index currency duplicated | FIXED in R3 / R4 / §1.4.4 |
| Lock friction: margin-only costs, validity extension, accepted-quote re-confirm sequence, revision bump vs approval | FIXED in R11 / R7 |
| Expiry vs "today"; no expiry trigger | FIXED — I-6 "at conversion"; `cpq.quote.cost_expiring` scheduled event (later phase) |
| Markup on `CpqProductCharge` readable by catalog readers → cost inferable | FIXED — markup fields guarded by `cpq.costs.view` in API responses |
| Language: line vs quote `ready`; `cost_confirmed` fires on estimates; "confirmed" = supplier vs catalog | FIXED — event renamed `cost_valued`; `value_origin`; "line ready" vs "quote `ready`" made explicit |
| Coverage inflation | FIXED — coverage defined as "every cost line on the charge known and ≥ 1 cost line" |
| R14 self-contradiction; renewals blocked when toggle off | FIXED — explicit rule; per-tenant override noted |
| Competing supplier bids; mid-term supplier change without ARC; order snapshot re-confirm; clone rules | Clone FIXED (R16); bids, mid-term change, order re-confirm → §10 Q-D11..Q-D13 |
| Index import revision collisions; future-dated values; CRM company as supplier | FIXED — server-assigned revision; future values allowed, never used before their date; supplier reference documented as optional reuse |
