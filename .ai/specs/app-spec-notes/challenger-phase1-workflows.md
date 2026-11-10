# Challenger — Phase 1 (§3 Workflows, §3.5 UI)

Execution: fresh-context subagent (general-purpose), 2026-11-10. Inputs: glossary §1.3, §3, §3.5 + cited source files.

## CRITICAL (all fixed)

1. **Price changes on existing items never reach billing** — `emitAmendedEvent` / `emitRenewedEvent` only carry `add` / `cancel` changes; `modify` updates CPQ only (`cpqOrderService.ts:1220-1302`, `cpqInventoryService.ts:1732-1773`). Renew-at-standard, amend re-pricing and carried-over windows drift from billing. → Fixed: amended / renewed payloads gain `modifiedItems` (item id, new rate or segments, effective date); connector end-dates the old billing items at `effectiveDate − 1` and creates new ones. Flat-rate propagation ships in Phase 1 (WF3), segment propagation in Phase 2. WF3 now ends at "billing items match".
2. **`sourceRef` collision** — `cpq-<sub>-<item>-<type>` unique per account (`chargeMapper.ts:47-53`) drops segment 2 and amend re-rates. → Fixed: `sourceRef` grammar with segment index and a change-log id for re-rates (§1.4.7).
3. **No service-start anchor** — subscription items have no start date; ARC mirror lines null `startDate` / `termMonths`; amend effective date is set at activation, not at quote time. → Fixed: new `service_start_date` on subscription items (set at activation / ARC add); relative windows are materialised into absolute dates at activation; carried-over windows are stored as **absolute dates** (no rebasing arithmetic at quote time; R10 replaced).
4. **"Price lock" does not lock prices** — line edits and `recalculate` run in any non-terminal status; any → any transitions. → Fixed: renamed **Adjustment lock**; deleting invalid / orphaned adjustments allowed while locked; `pricingSnapshotHash` in events + stored on the quote so a project workflow detects post-approval changes. Freezing line edits / rule re-pricing during approval stays out of scope (U5).
5. **Unsigned discount depth hides markups** — → Fixed (signed, fraction).
6. **Glossary Charge chargeCode/chargeType** — → Fixed.
7. **Quantity semantics** — charge quantity vs line quantity (`computeLineTotals`); tiered / volume override stale breakdown. → Fixed: `discount_absolute` = off the per-instance charge total (before the line-quantity multiplier, same as rules), UI shows "× line qty"; `price_override` only for `flat` and `per_unit` charge models; tiered / volume accept `discount_percent` / `discount_absolute` only; edge case "quantity changed after adjustment" added.

## WARNING (fixed or logged)

- Workflow boundaries → restructured to 4 workflows: WF1 Negotiate the price on a quote (all levels, permanent + time-bound), WF2 Bill the contracted price (activation → billing), WF3 Keep / change the contracted price through ARC (amend pins, renew resets, modify reaches billing), WF4 Route a discounted quote for approval (signals). Fixed.
- Mid-cycle boundaries are the main path; quarterly / annual cycles → connector posts proration for every cycle a segment covers partially. Fixed (WF2 main path).
- "Regular price" changes meaning of `unitPrice` / `mrcTotal` / `mrcAmount` → kept (unchanged for charges without bounded windows, I-9) + new glossary term **Current price (at date)** computed from the schedule for UIs; `buildArcAddedItems` gets segments (Phase 2). Fixed.
- Carry-over from derived data → manual entries in `charges[].adjustments` keep `adjustmentId`, `level`, `type`, `value`, window, `reasonCode`; carry-over pins prices from the materialised schedule. Fixed.
- Usage invisible to approvals, not billed → usage charges excluded from manual adjustments in this scope (D2 changed). Fixed.
- No-term lines → deal-value horizon = max(12, last bounded window end). Fixed.
- Bundles → line-level adjustment on a bundle parent cascades to descendant lines; precedence charge > own line > ancestor line > quote. Fixed.
- Cross-level window precedence → per-month resolution example added to R1 / R5. Fixed.
- Concurrency → `pricing_revision` optimistic token on the quote configuration; stale write → 409; aggregate row lock on write. Fixed.
- No outbox → events are signals; the authoritative snapshot (summary + hash) is stored on the quote; approval checks must read it. Fixed (WF4 edge case).
- Currency → `currency_code` on adjustment; mismatch = invalid. Fixed.
- UI states → badges for invalid / orphaned / carried-over; order / subscription show absolute promo dates. Fixed.
- Customer-facing quote document, sales `discountTotalAmount` → out of scope / D6 (stay 0). Logged.
