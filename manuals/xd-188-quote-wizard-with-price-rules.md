# XD-188 — Testing Price Rules via Quote Wizard

## Prerequisites

```bash
docker compose up -d
.\node_modules\.bin\mercato.cmd init   # PowerShell — runs migrations + seeds data
yarn dev
```

Log in to the admin panel at `http://localhost:3000/backend`
- Email: `superadmin@acme.com`
- Password: `secret`

> **Important — which rules apply in the Quote Wizard?**
>
> The Quote Wizard calls the Price API with `productId` (not `offeringId`).
> This means only **global rules** (`productOfferingId = null`) are applied.
> **Product-scoped** seed rules (like `access-port-nrc-15pct-off`) do **NOT** fire in the wizard.
>
> If you also created user rules from the `xd-188-price-rules.md` manual (Part A), those global rules will also affect pricing here. The expected values below assume **only seed global rules** are active. If `ui-nrc-10pct-off` (10% NRC discount) from Part A also exists, Setup Fee values will be 10% lower than listed.

---

## Step 1 — Open the Quote Wizard

1. In the left sidebar, click **CPQ > Quotes**
2. Click **New Quote** (or go directly to `http://localhost:3000/backend/cpq/quotes/new`)

## Step 2 — Select a Customer

1. Type a customer name in the search field and select one from the list
2. Click continue

## Step 3 — Choose Path

Select **New Primary** (create a new primary product)

## Step 4 — Configure the Primary Product (Price Rules in action)

### Test A — Access Port with 1G port

1. Select **GIX Access Port**
2. Set the attributes:
   - **Data Centre**: `Equinix LD5`
   - **Port Size**: `1G`
3. The **Charge Preview** panel appears on the right with real-time pricing

**Expected results** (only seed global rules active, no user-created rules):

| Charge | Base price | Rules applied | Result |
|--------|-----------|---------------|--------|
| Setup Fee (NRC) | $290 | No global rules target NRC | $290.00 |
| Monthly Port Fee (MRC) | $250 | `volume-mrc-10pct` — 10% discount (global) | $225.00 |

> If you also have `ui-nrc-10pct-off` (from xd-188 Part A), Setup Fee = 290 × 0.9 = **$261.00**

### Test B — Switch to 100G port and observe changes

1. Change **Port Size** to **100G**
2. Watch the Charge Preview update

**Expected results**:

| Charge | Base price | Rules applied | Result |
|--------|-----------|---------------|--------|
| Setup Fee (NRC) | $890 | No global rules target NRC | $890.00 |
| Monthly Port Fee (MRC) | $1200 | `volume-mrc-10pct` — 10% discount → $1080, then `premium-100g-surcharge` — +$50 (condition: `port_size=100G`) | $1130.00 |

> If `ui-nrc-10pct-off` exists: Setup Fee = 890 × 0.9 = **$801.00**

The 100G surcharge rule fires because its `applicabilityCondition` matches `port_size = 100G`.

## Step 5 — Add Child Services

1. Click **Continue** to go to Step 4 (Configure Services)
2. Add **GIX Internet Peering**:
   - **Bandwidth**: `200`
3. The Charge Preview shows tiered pricing for the bandwidth fee

> Note: The seed rule `internet-peering-bandwidth-surcharge` is product-scoped, so it does **not** apply here (wizard uses productId). Only the global `volume-mrc-10pct` rule applies if the bandwidth charge is typed as MRC.

4. Optionally add **GIX Cloud Connect**:
   - **Cloud Provider**: `AWS`
   - **Cloud Region**: `eu-west-2`
   - **Pricing Model**: `flat`
   - **Bandwidth**: `100`
5. The `cloud-connect-5pct-off` rule (5% discount, global) applies here because the configuration has a non-empty `cloud_provider` value

## Step 6 — Review & Confirm

1. Click **Continue** to reach the Review step
2. Verify the summary shows:
   - Each product with its configured attributes
   - All charges per product (with global price rules already applied)
   - **Quote Totals**: One-time Total (NRC), Monthly Total (MRC), Usage Charges
3. Click **Create Quote** to submit — the system creates the quote and redirects you to its detail view

---

## Additional Test — Change a Rule and Compare

This test shows that price rule changes take effect immediately on new calculations.

1. Go to **Sidebar → CPQ → Price Rules**
2. Find **Volume Discount — 10% MRC** and click **Edit**
3. Change **Value** from `10` to `25` (25% MRC discount)
4. Click **Update**
5. Go back to **CPQ → Quotes → New Quote** and configure the same product (GIX Access Port, Equinix LD5, 1G)
6. In the Charge Preview, the Monthly Port Fee should now be lower:
   - Before: $250 × 0.90 = $225.00
   - After: $250 × 0.75 = $187.50
7. **Revert the change**: go back to Price Rules, edit the rule, set value back to `10`, click **Update**

---

## Seed Price Rules Reference

### Which rules apply in the Quote Wizard?

The wizard uses `productId` when calling the Price API. The `loadPriceRules` method loads rules where `productOfferingId IS NULL` (global) or matches the given `offeringId`. Since no `offeringId` is passed, **only global rules apply**.

### Active Global Rules (apply in the wizard)

| Rule | Type | Value | Filter | Effect |
|------|------|-------|--------|--------|
| Volume Discount — 10% MRC | discount_percent | 10% | MRC charges only | 10% off all monthly recurring charges |
| 100G Port Premium Surcharge | surcharge_absolute | $50 | charge: `monthly_port_fee`, condition: `port_size=100G` | $50 extra on monthly port fee for 100G ports |
| Cloud Connect Promo — 5% Off | discount_percent | 5% | condition: `cloud_provider` is not empty | 5% off all Cloud Connect charges |

### Active Product-Scoped Rules (do NOT apply in the wizard)

| Rule | Product Offering | Type | Value | Filter | Why not applied |
|------|-----------------|------|-------|--------|-----------------|
| Access Port — 15% Setup Discount | GIX Access Port | discount_percent | 15% | charge: `setup_fee` | Requires `offeringId` |
| Internet Peering — Bandwidth Surcharge | GIX Internet Peering | surcharge_absolute | $25 | charge: `bandwidth_fee` | Requires `offeringId` |

These rules would apply if the wizard sent `offeringId` instead of `productId`.

### Inactive Rules (can be enabled via UI)

| Rule | Type | Value | Filter |
|------|------|-------|--------|
| Early Adopter — NRC Waiver | discount_percent | 100% | NRC charges only |
| Setup Fee Cap at $200 | price_override | $200 | charge: `setup_fee` |
| Cloud Connect — Committed Rate Override | price_override | $0.40 | charge: `commit_bandwidth_fee`, condition: `pricing_model=burstable` |

To activate an inactive rule: go to **CPQ → Price Rules**, click **Edit** on the rule, check **Active**, and click **Update**.
