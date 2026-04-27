# CPQ: Quote → Order → Subscription — Step by Step

This manual covers the complete UI flow: creating a quote, converting it to an order, activating the order, and verifying the automatically created inventory (subscriptions and assets).

## Prerequisites

1. Start infrastructure and dev server:

```bash
docker compose up -d
.\node_modules\.bin\mercato.cmd init
yarn dev
```

2. Open your browser: `http://localhost:3000/backend`
3. Log in: `superadmin@acme.com` / `secret`

---

## Step 1 — Create a New CPQ Quote

1. In the sidebar, click **CPQ** → **CPQ Quotes**
2. Click the **"+ New Quote"** button (top right corner)
3. A modal dialog will appear: **"Select Customer for New Quote"**
4. Use the search box to find a customer, or scroll through the list
5. **Click on a customer** to select them
6. The system will create a new quote and automatically redirect you to the **quote detail page**
7. You should see:
   - A header with the quote number (e.g. `Quote QUO-000001`)
   - Status badge: **new** (blue)
   - Text: "No items configured yet"

---

## Step 2 — Add a Product to the Quote

1. Click the blue **"Add Offering"** button (top right corner)
2. The **Select Product Offering** panel will appear with a list of available offerings
3. If there are many offerings — use the search box at the top
4. **Click on an offering** (e.g. "GIX Access Port Standard Offering")
5. The **Configure** panel will appear with a form:
   - Set the **Quantity** (e.g. `2`)
   - Fill in the configuration fields (e.g. select Data Centre, Port Size)
6. Click the **"Add to Quote"** button at the bottom of the panel
7. You will return to the summary view and see:
   - The added line item with offering name, quantity, and NRC/MRC pricing
   - The **Pricing Summary** card with totals

---

## Step 3 — (Optional) Add More Products

1. Click **"Add Offering"** again
2. Select a different offering (e.g. "GIX Internet Peering Standard Offering")
3. Configure the parameters (e.g. Bandwidth)
4. Click **"Add to Quote"**
5. You now have two (or more) line items on the quote

---

## Step 4 — Recalculate Pricing

1. Click the **"Recalculate"** button (top right corner, refresh icon)
2. The **Pricing Summary** card will update with final NRC and MRC amounts
3. Click the **arrow ▶** on any line item — the charge breakdown table will expand

---

## Step 5 — Transition the Quote Status to "accepted"

The status badge next to the quote title is clickable. It opens a dropdown with the allowed next statuses.

1. Click the **status badge** (e.g. "new") next to the quote title — a dropdown will appear
2. Click **"Ready"** — the status changes to **ready**
3. Click the status badge again → click **"With Customer"** — the status changes to **with customer**
4. Click the status badge again → click **"Accepted"** — the status changes to **accepted** (green)
5. The green **"Convert to Order"** button will appear in the top right corner

> The dropdown only shows statuses that are valid transitions from the current status. Terminal statuses (accepted, rejected, cancelled) have no further transitions.

---

## Step 6 — Convert the Quote to an Order

1. On the quote page with **accepted** status — click the green **"Convert to Order"** button (top right corner)
2. The button will show a loading spinner
3. You will be automatically **redirected to the new order detail page**
4. Verify what you see:

| Element | What you should see |
|---|---|
| Header | Order number (e.g. `Order ORD-000001`) |
| Status badge | **"draft"** (blue) |
| Currency | Same as the source quote (e.g. USD) |
| "View Source Quote" link | Clicking it navigates back to the quote |
| Pricing Summary card | NRC and MRC amounts matching the quote |
| Line Items section | Same number of line items as in the quote |
| "Activate Order" button | Green, prominent, top right corner |
| "Cancel Order" button | Red border, next to Activate |

---

## Step 7 — Inspect Order Line Items

1. On the order detail page — click on any line item row
2. The row will expand and show:
   - **Configuration** — key-value pairs (e.g. data_centre: equinix-ld5)
   - **Charges** — charges table: Charge, Type, Unit Price, Qty, Total
   - **Dates** — Start date, Term months, End date (if set)
3. Click the row again to collapse it

---

## Step 8 — Check the Orders List

1. Click **"← Back"** in the order header
2. Or from the sidebar: **CPQ** → **CPQ Orders**
3. You will see the orders table with columns:
   - Order ID, Status, Currency, NRC Total, MRC Total, Created, Activated
4. Your new order should appear in the list with status **"draft"**
5. Click on the order row to go back to its detail page

---

## Step 9 — Activate the Order

1. On the order detail page with **draft** status — click the green **"Activate Order"** button
2. The button will show a loading spinner
3. After completion you will see:

| Element | What you should see |
|---|---|
| Status badge | Changed to **"active"** (green) |
| Green banner | "Order activated on [date]. Inventory items have been created." |
| "View Inventory →" link | Appeared in the green banner |
| "Activate Order" button | Disappeared (order is already active) |
| "Cancel Order" button | Still visible |

---

## Step 10 — Verify the Created Inventory

1. On the order page — click the **"View Inventory →"** link in the green banner
2. You will be navigated to the **Customer Inventory** page
3. Alternatively: from the sidebar → **Customers** → **Customer Inventory**

> The system automatically created the following during order activation:
> - **Subscription** (CpqInventorySubscription) — one per order
> - **Subscription items** (CpqInventorySubscriptionItem) — one per line with MRC charges
> - **Assets** (CpqInventoryAsset) — one per line with NRC charges

---

## Step 11 — (Optional) Create a Second Order from the Same Quote

The system allows creating multiple orders from a single quote (the quote is not locked after conversion).

1. From the sidebar: **CPQ** → **CPQ Quotes**
2. Click the same quote with **accepted** status
3. The **"Convert to Order"** button is still visible
4. Click it — a second order is created with a new order number
5. Go to **CPQ Orders** — you will see both orders in the list

---

## Step 12 — (Optional) Cancel an Order

1. From the sidebar: **CPQ** → **CPQ Orders**
2. Click an order with **draft** status (e.g. the second order from Step 11)
3. Click the **"Cancel Order"** button (red border)
4. The status will change to **"cancelled"** (gray badge)
5. Both buttons (Activate and Cancel) will disappear — cancelled is a terminal status

---

## Flow Summary

```
Step 1:       CPQ Quotes → "New Quote" → select customer
Steps 2–4:   Add products → Configure → Recalculate
Step 5:       Click status badge → Ready → With Customer → Accepted
Step 6:       Click "Convert to Order" → new order created
Step 9:       Click "Activate Order" → inventory created
Step 10:      Click "View Inventory" → subscriptions and assets
```

### Status Lifecycle

| Object | Lifecycle |
|---|---|
| **Quote** | new → ready → with_customer → accepted |
| **Order** | draft → active → fulfilled (or cancelled) |
| **Subscription** | pending → active → suspended / terminated / expired |
| **Asset** | pending → delivered → active → returned (or cancelled) |
