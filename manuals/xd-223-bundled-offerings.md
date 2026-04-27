# XD-223: Bundled Offerings — Step-by-Step Testing Manual

This manual covers end-to-end testing of bundled offerings: verifying the seed bundle, then using it in a quote that becomes an order and finally a subscription.

## Prerequisites

1. Start infrastructure and dev server:

```bash
docker compose up -d
yarn mercato init --reinstall
yarn dev
```

2. Open your browser: `http://localhost:3000/backend`
3. Log in: `superadmin@acme.com` / `secret`

> Seed data automatically creates a complete bundle:
> - 5 products (4 simple + 1 bundle: **GIX Connectivity Bundle**)
> - 5 specifications (4 simple + 1 bundle: **SPEC-GIX-CONNECTIVITY-BUNDLE**)
> - 5 offerings (4 simple + 1 bundle: **OFFER-GIX-CONNECTIVITY-BUNDLE**)
> - 4 bundle slots + 4 offering components
>
> **You can skip Part 1 and go directly to Part 2 if you want to test quoting immediately.**

---

## Part 1 — Verify the Bundle Definition (or Create from Scratch)

> Seed data already creates the full bundle. The steps below explain what was created and how to reproduce it manually for a new bundle.

### Step 1.1 — Verify / Create a Bundle Specification

The bundle concept starts at the **Product Specification** level (CPQ → Specifications), not in the Catalog. The catalog product (`GIX Connectivity Bundle`) already exists from seeds.

**To verify the seeded bundle:**

1. Sidebar → **CPQ** → **Specifications**
2. Find **"GIX Connectivity Bundle Specification"** — click on it
3. Confirm:

| Field | Expected Value |
|---|---|
| Code | `SPEC-GIX-CONNECTIVITY-BUNDLE` |
| Product | GIX Connectivity Bundle |
| Lifecycle Status | `active` |
| **Spec Type** | **`bundle`** |

**To create a new bundle from scratch:**

1. Sidebar → **CPQ** → **Specifications**
2. Click **"+ New Specification"**
3. Fill in the General tab — the key field is **Spec Type = `bundle`**
4. Select a product (must exist in Catalog first)
5. Save — a **"Bundle Slots"** tab appears (only visible when Spec Type = bundle)

### Step 1.2 — Verify / Add Bundle Slots

Each slot defines a "place" in the bundle filled by a child specification.

**To verify seeded slots:**

1. On the specification detail, click the **"Bundle Slots"** tab
2. You should see 4 slots:

| Name | Component Group | Target Specification | Min | Max | Sort Order |
|---|---|---|---|---|---|
| Access Port | `access` | GIX Access Port Specification | 1 | 1 | 0 |
| Internet Peering | `peering` | GIX Internet Peering Specification | 0 | 1 | 1 |
| Mobile Peering | `peering` | GIX Mobile Peering Specification | 0 | 1 | 2 |
| Cloud Connect | `cloud` | GIX Cloud Connect Specification | 0 | 2 | 3 |

**To add a new slot manually:** click **"+ Add Slot"**, fill in the fields, save.

> **Cardinality cheat sheet:**
> - `1:1` = required, exactly one
> - `0:1` = optional, at most one
> - `0:null` = optional, unlimited
> - `1:null` = required, at least one

### Step 1.3 — Verify / Create a Bundle Offering

**To verify the seeded offering:**

1. Sidebar → **CPQ** → **Offerings**
2. Find **"GIX Connectivity Bundle — Standard"** — click on it
3. Confirm:

| Field | Expected Value |
|---|---|
| Code | `OFFER-GIX-CONNECTIVITY-BUNDLE` |
| Specification | GIX Connectivity Bundle Specification |
| Lifecycle Status | `active` |
| **Offering Type** | **`bundle`** |

**To create a new bundle offering from scratch:**

1. Click **"+ New Offering"**
2. Set **Offering Type = `bundle`** and link to a bundle specification
3. Save — a **"Components"** tab appears (only visible when Offering Type = bundle)

### Step 1.4 — Verify / Add Offering Components

Components link child offerings to the bundle's slots.

**To verify seeded components:**

1. On the offering detail, click the **"Components"** tab
2. You should see 4 components:

| Slot | Child Offering | Default? |
|---|---|---|
| Access Port | GIX Access Port Standard Offering | Yes |
| Internet Peering | GIX Internet Peering Standard Offering | Yes |
| Mobile Peering | GIX Mobile Peering Standard Offering | No |
| Cloud Connect | GIX Cloud Connect Standard Offering | No |

**To add components manually:** click **"+ Add"** in the relevant slot section, select the child offering, save.

### Step 1.5 — Verify the Bundle Tree (optional)

Open your browser console or use curl:

```
GET /api/cpq/bundle-tree?offeringId=<BUNDLE_OFFERING_ID>
```

You should see a JSON with `tree` (slots with components) and `validation` (completeness check).

---

## Part 2 — Use the Bundle in a Quote

### Step 2.1 — Create a New Quote

1. Sidebar → **CPQ** → **CPQ Quotes**
2. Click **"+ New Quote"**
3. Select a customer from the modal
4. Redirected to quote detail page (status: **new**)

### Step 2.2 — Add the Bundle Offering to the Quote

1. Click **"Add Offering"**
2. In the list, find **"GIX Connectivity Bundle — Standard"**
3. Click on it
4. The configure panel appears — since the bundle spec has no attributes, just set **Quantity = 1**
5. Click **"Add to Quote"**
6. The bundle line item appears in the summary

> Note: This adds the bundle as a single parent line. The child components need to be added separately as child lines (see next step).

### Step 2.3 — Add Child Lines (Bundle Components)

The bundle line has an **"Add Component"** button (+ icon) that lets you attach child offerings directly from the UI.

1. On the quote summary, find the **GIX Connectivity Bundle** line — it has a purple **bundle** badge and shows "0 components"
2. Click the **+** (Add Component) button on the bundle line
3. A blue banner confirms you are adding a component to the bundle
4. In the offering browser, select **"Access Port — Equinix LD5"**
5. Configure the offering (e.g. `data_centre: equinix-ld5`, `port_size: 10G`) and click **"Add to Quote"**
6. The child line now appears **nested under the bundle** when you expand it (click the chevron)

Repeat for more components:
- **Internet Peering** — click **+** on the bundle line again, select the offering, configure `bandwidth_mb`, add
- **Cloud Connect** — same flow

> The UI automatically sends `parentLineId` to the API, so child lines are properly linked to the bundle parent. Bundle lines show the component count and child lines render indented under the parent.

> When you remove a bundle line, all its child components are also removed automatically.

### Step 2.4 — Recalculate Pricing

1. Click the **"Recalculate"** button (refresh icon, top right)
2. The Pricing Summary updates with NRC and MRC totals from all lines
3. Expand any line item to see charge breakdown details

### Step 2.5 — Progress the Quote to "Accepted"

1. Click the **status badge** → **"Ready"**
2. Click the status badge again → **"With Customer"**
3. Click the status badge again → **"Accepted"**
4. The green **"Convert to Order"** button appears

### Step 2.6 — Convert to Order

1. Click **"Convert to Order"**
2. You are redirected to the new order detail page
3. Verify all line items from the quote appear in the order

### Step 2.7 — Activate the Order

1. Click the green **"Activate Order"** button
2. Status changes to **active**
3. Green banner: "Order activated on [date]. Inventory items have been created."

### Step 2.8 — Verify the Subscription

1. Click **"View Inventory →"** in the green banner
2. Or: sidebar → **Customers** → **Customer Inventory**
3. Find the new subscription — it contains:

| What | Description |
|---|---|
| **Subscription** | Named after the offerings on the order |
| **Subscription Items** | One per line with MRC charges (Access Port monthly fee, Internet Peering bandwidth fee, etc.) |
| **Assets** | One per line with NRC charges (setup fees) |

4. Click on the subscription to see all items with their configurations and charges

---

## Part 3 — API Quick Reference

### Bundle Definition

```
GET    /api/cpq/bundle-slots?specId=<ID>
POST   /api/cpq/bundle-slots
PUT    /api/cpq/bundle-slots
DELETE /api/cpq/bundle-slots

GET    /api/cpq/offering-components?offeringId=<ID>
POST   /api/cpq/offering-components
PUT    /api/cpq/offering-components
DELETE /api/cpq/offering-components

GET    /api/cpq/bundle-tree?offeringId=<ID>
```

### Quoting with Bundles

```
POST   /api/cpq/quotes                        { customerId }
POST   /api/cpq/quotes/<id>/items              { offeringId, configuration, quantity }
POST   /api/cpq/quotes/<id>/items              { offeringId, configuration, parentLineId }
POST   /api/cpq/quotes/<id>/recalculate        { save: true }
PUT    /api/cpq/quotes/<id>/status             { status: "ready" }
PUT    /api/cpq/quotes/<id>/status             { status: "with_customer" }
PUT    /api/cpq/quotes/<id>/status             { status: "accepted" }
POST   /api/cpq/orders                         { quoteId: "<cpq-config-id>" }
PUT    /api/cpq/orders/<id>/status             { status: "active" }
```

---

## Flow Summary

```
Part 1 (Verify / Define the bundle — seed data creates all of this):
  1.1  Specifications → Verify/Create → specType = bundle
  1.2  Bundle Slots tab → Verify/Add slots pointing to child specs
  1.3  Offerings → Verify/Create → offeringType = bundle
  1.4  Components tab → Verify/Link child offerings to slots

Part 2 (Use in a quote):
  2.1  CPQ Quotes → New Quote → select customer
  2.2  Add Offering → select bundle offering → Add to Quote
  2.3  Add child offerings (via API with parentLineId, or via UI as independent items)
  2.4  Recalculate pricing
  2.5  Status: new → ready → with_customer → accepted
  2.6  Convert to Order
  2.7  Activate Order → inventory created
  2.8  Customer Inventory → verify subscription with items
```
