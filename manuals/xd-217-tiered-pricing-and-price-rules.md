# XD-217 — Tiered Pricing & Price Rule Fix — Test Manual

## Prerequisites

Dev server running (`yarn dev`), logged in at `http://localhost:3000/backend`

> **Note:** Seed rule `volume-mrc-10pct` (10% MRC discount) is always active and affects all MRC charges.

---

## Setup check

1. **CPQ → Pricing Tables** → click **GIX Internet Peering Pricing** → confirm 6 tiers (0–50, 51–100, 101–250, 251–500, 501–1000, 1001+)
2. **CPQ → Product Offerings** → click **GIX Internet Peering Standard Offering** → **Charges** tab → confirm `bandwidth_fee` has pricing **tiered**
3. **CPQ → Price Rules** → confirm rule **Internet Peering — Bandwidth Surcharge** exists (Surcharge $, value 25, charge code `bandwidth_fee`)

---

## Test 1 — Tiered pricing calculates correctly (staircase)

Temporarily **disable** the surcharge rule to isolate tiered pricing:

1. **CPQ → Price Rules** → find **Internet Peering — Bandwidth Surcharge** → **Edit** → uncheck **Active** → **Update**
2. **CPQ → CPQ Quotes** → **+ New Quote** → select any customer
3. **Add Offering** → **GIX Internet Peering Standard Offering** → set **Bandwidth = 1000** → **Add to Quote**
4. Click **Recalculate**
5. Expand the line item (click ▶)

| What to check | Expected | Bug (before fix) |
|---|---|---|
| Total | **$403.65** | wrong value |
| Unit Price | **~$0.40** | wrong value |
| Qty | 1000 | 1000 |

Breakdown: 50×$0.52 + 50×$0.49 + 150×$0.47 + 250×$0.45 + 500×$0.43 = $448.50, then 10% seed discount → **$403.65**

---

## Test 2 — Absolute surcharge applies as flat amount, not per-unit

Re-enable the surcharge rule:

1. **CPQ → Price Rules** → find **Internet Peering — Bandwidth Surcharge** → **Edit** → check **Active** → **Update**
2. Go back to the quote from Test 1
3. Click **Recalculate**
4. Expand the line item

| What to check | Expected | Bug (before fix) |
|---|---|---|
| Total | **$428.65** | ~$25,403.73 |
| Unit Price | **~$0.43** | ~$25.40 |
| Qty | 1000 | 1000 |

Breakdown: $448.50 (tiered) → 10% seed discount = $403.65 → + $25 flat surcharge = **$428.65**

The $25 surcharge is added **once** to the total, not per-unit ($25 × 1000 = $25,000).

Done.
