# Architect checkpoint #1 — CPQ Cost-Plus Pricing

Execution: fresh-context subagent with the App Spec, both capability catalogs and their source files; framework read from `@open-mercato/core` 0.9.0 in another local install. 2026-11-11.

| Tag | Finding | Re-mapping applied |
|---|---|---|
| ESTIMATE | Carried-cost hash guard marked "grounded" but the sibling carry-over is not built (`P/data/entities.ts:1489-1560`, no `carried_from_*`, no `SOURCE_CHANGED`) | New hash helper row (gap 3, 1 commit) + mirror row; built here, reusable by the sibling |
| MISSED | Command audit snapshots / undo payloads would store cost values (`P/commands/price-adjustments.ts:2-5, 44-47`); `ce.ts` / search exposure | +1 commit WF4 "confidential commands"; I-4 already covers audit / search |
| MISSED | Table lookup bound to `CpqProductCharge` (`cpqPricingService.ts:248-322`); cost element lacked a model for tiered / volume | Engine row names the refactor; `quantity_rule` replaced by `cost_model` (flat / per_unit / tiered / volume) |
| OVERENGINEERED | `CpqOrderLineCost` duplicates quote cost lines already reachable through `source_quote_line_id` | Dropped; orders read quote cost lines; Q-D13 re-confirmation = lock-exempt, margin-only write |
| OVERENGINEERED | Stored `CpqQuoteMargin` | Margin computed (`computeQuoteMargin()`); `margin_hash` computed in the write wrapper |
| OVERENGINEERED | Cost request detail page (workflows already ship a task inbox) | Dropped; row expansion + Answer / Decline dialogs on the Cost requests list |
| MISSED | No notification when no workflow is configured | +1 commit Phase 2 notifications |
| OK | `pricing_table.purpose` column; guard both table and entry routes | Stated in §1.4.10 |
| OK | Index entities justified (currencies providers cannot store indices; data_sync is project-level) | — |
| GROUNDING | FX `ExchangeRateService.getRate` (date ≤ today, `maxDaysBack`); `runCpqMutationGuards` on status + conversion routes; `SchedulerService` | Rows upgraded to grounded / grounded-elsewhere |

Net: 39 → 41 atomic commits.
