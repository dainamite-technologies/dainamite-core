# XD-215 — Customer Inventory — Test Manual

## Prerequisites

```bash
docker compose up -d
.\node_modules\.bin\mercato.cmd init   # PowerShell — runs migrations + seeds data
yarn dev
```

Log in to the admin panel at `http://localhost:3000/backend`
- Email: `superadmin@acme.com`
- Password: `secret`

### How to run API tests

1. Open DevTools (F12) → **Console** tab
2. Type `allow pasting` and press Enter (one-time)
3. Paste the `fetch(...)` snippets below — they use your session cookie automatically

---

## Navigation

- **Sidebar → Customers → Customer Inventory** — dedicated inventory list page
- **Customer detail → Inventory tab** — injected tab on company/person views

API base: `/api/cpq/inventory/`

### Recommended execution order

1. **UI Tests 1–3** — UI structure without inventory data (empty states, navigation)
2. **API Tests 1–19** — Create and manipulate inventory data
3. **UI Tests 4–9** — Verify data is displayed correctly in the browser
4. **API Tests 20–21** — Cascading termination (destructive)
5. **API Tests D-1–D-2** — Soft delete (destructive — removes data)

---

# Section 1 — UI Tests

## Part A — UI Structure (before data)

> Run these tests **before** creating any inventory data via API.

### Step 0 — Get a customer ID

Run this once to get a customer ID for all tests (UI and API):

```js
const customers = await fetch('/api/customers/companies?pageSize=10').then(r => r.json())
const items = customers.items ?? customers
const customer = items[0]
console.log('Customer ID:', customer?.id)
console.log('Customer Name:', customer?.name ?? customer?.companyName)
```

If no customers exist, create one:

```js
const newCustomer = await fetch('/api/customers/companies', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ companyName: 'ACME Corp', isActive: true }),
}).then(r => r.json())
console.log('Customer ID:', newCustomer.id)
```

Save the customer ID — replace `<CUSTOMER_ID>` in all tests below.

---

### UI Test 1 — Sidebar navigation

1. Look at the left sidebar in the admin panel
2. Find the **Customers** navigation group

**Expected**:
- There is a **Customer Inventory** menu item with a package icon inside the Customers section
- It appears below Companies / People / Deals (pageOrder 85)

**Screenshot check:** Take a screenshot showing the sidebar with the Customer Inventory entry visible.

---

### UI Test 2 — Dedicated Inventory page (empty state)

1. Click **Customer Inventory** in the sidebar
2. Or go directly to `http://localhost:3000/backend/cpq/inventory`

**Expected**:
- Page title: "Customer Inventory"
- Breadcrumb shows: Customer Inventory
- Two tabs visible: **Subscriptions** | **Assets**
- Both tabs show empty state message: "No inventory records found." or similar
- No errors in the console

---

### UI Test 3 — Customer detail → Inventory tab (empty state)

1. Navigate to **Customers → Companies** in the sidebar
2. Click on any customer
3. Find and click the **Inventory** tab in the detail view

**Expected**:
- The tab labeled **Inventory** is visible among other tabs
- Summary cards all show `0` / `$0.00`
- Three sub-tabs: Subscriptions, Subscription Items, Assets — all empty
- No console errors, no loading spinners stuck
- "View full inventory →" link visible at the bottom

Also verify for a **Person** customer:

4. Navigate to **Customers → People**
5. Click on any person (or create one if needed)
6. Find and click the **Inventory** tab

**Expected**:
- The Inventory tab is visible (injected via `detail:customers.person:tabs`)
- Same empty state behavior as company view

---

## Part B — UI Verification (after API data)

> Run these tests **after** completing API Tests 1–19 so there is data to see. Do NOT run API Tests 20–21 (termination) before these.

### UI Test 4 — Dedicated Inventory page (Subscriptions tab)

Navigate to `http://localhost:3000/backend/cpq/inventory`

1. Click the **Subscriptions** tab (should be active by default)
2. Verify the subscription from API Test 1 is visible

**Expected**:
- Table with columns: Code, Name, Status, MRC, Billing Cycle, Start Date, Term End
- Subscription `SUB-2026-00001` (or similar code) is listed
- Status badge shows **active** in green (after API Test 4)
- MRC shows `$950.00` (after amendment in API Test 9)
- Billing cycle shows "annually" (after update in API Test 8)

---

### UI Test 5 — Dedicated Inventory page (Assets tab)

On the same page, click the **Assets** tab.

**Expected**:
- Table with columns: Code, Name, Type, Status, Price, Created
- 3 assets listed:
  - "Network Switch — Equinix LD5" — physical — active (after API Test 16)
  - "GIX Access Port Setup Fee" — one_time — active (after API Test 16)
  - "Physical NIC — 10G SFP+" — physical — pending
- Status badges with correct colors (active=green, pending=blue)
- Prices formatted as currency

---

### UI Test 6 — Customer detail → Inventory tab (Company, with data)

1. Navigate to **Customers → Companies** in the sidebar
2. Click on the customer used in API tests (e.g. "ACME Corp")
3. Find and click the **Inventory** tab

**Expected — Summary cards:**
- Four summary cards at the top:
  - **Active Subscriptions**: `1` (the one activated in API Test 4)
  - **Total MRC**: `$950.00` (after amendment in API Test 9)
  - **Active Assets**: `2` (the two activated in API Test 16)
  - **Pending Items**: `1` (the Physical NIC asset still pending)

**Expected — Subscriptions sub-tab:**
- Default sub-tab showing subscriptions for this customer
- Table with: Code, Name, Status, MRC, Billing Cycle, Start Date, Term End
- Our subscription is listed with green "active" badge and MRC $950.00
- "View full inventory →" link at the bottom

**Expected — Subscription Items sub-tab:**
4. Click the **Subscription Items** sub-tab

- Flat list of all items owned by this customer
- 3 items listed:
  - "Access Port 10G" — active — MRC $450.00
  - "GIX Internet Peering 2G" — active — MRC $200.00
  - "GIX Cloud Connect AWS 500M" — active — MRC $300.00
- Items show their subscription relationship

**Expected — Assets sub-tab:**
5. Click the **Assets** sub-tab

- 3 assets listed
- Each shows: Code, Name, Type, Status badge, Price, and what it's linked to:
  - "Network Switch" → standalone
  - "GIX Access Port Setup Fee" → linked to subscription
  - "Physical NIC" → linked to subscription item
- "View full inventory →" link at the bottom

---

### UI Test 7 — Status badge colors

Verify all status badge colors in the UI:

| Status | Expected color | Where to check |
|--------|---------------|----------------|
| `active` | Green badge | Subscription, items, assets |
| `pending` | Blue badge | Physical NIC asset |
| `suspended` | Yellow badge | (see snippet below) |
| `terminated` | Red badge | (run API Test 20 to see this) |
| `delivered` | Teal/green badge | (run asset transition to delivered only) |
| `cancelled` | Gray badge | (create and cancel an asset to see this) |

To test the suspended badge, create a suspended subscription via console:

```js
const sub2 = await fetch('/api/cpq/inventory/subscriptions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customerId: '<CUSTOMER_ID>',
    name: 'Test Subscription for UI Colors',
    items: [{ name: 'Test Item', mrcAmount: 100 }],
  }),
}).then(r => r.json())

await fetch('/api/cpq/inventory/subscriptions/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: sub2.id, targetStatus: 'active' }),
})

await fetch('/api/cpq/inventory/subscriptions/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: sub2.id, targetStatus: 'suspended' }),
})
console.log('Suspended subscription created for UI color test')
```

Refresh the Inventory page or customer detail tab and verify:
- Active subscription → green badge
- Suspended subscription → yellow badge

---

### UI Test 8 — Real-time data refresh

1. Open the dedicated **Customer Inventory** page
2. In the DevTools Console, create a new subscription:

```js
const sub3 = await fetch('/api/cpq/inventory/subscriptions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customerId: '<CUSTOMER_ID>',
    name: 'Real-time Test Subscription',
    items: [{ name: 'Real-time Item', mrcAmount: 999 }],
  }),
}).then(r => r.json())
console.log('Created:', sub3.code)
```

3. Refresh the Inventory page (F5)

**Expected**:
- The new subscription appears in the Subscriptions tab
- Status badge shows "pending" in blue
- MRC shows $999.00

---

### UI Test 9 — "View full inventory" link from customer tab

1. Go to a customer detail → Inventory tab
2. Click the **View full inventory →** link at the bottom

**Expected**:
- Navigates to `/backend/cpq/inventory`
- The dedicated inventory page loads correctly

---

# Section 2 — API Tests

## Part C — Subscriptions API

### API Test 1 — Create a subscription with items

```js
const sub = await fetch('/api/cpq/inventory/subscriptions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customerId: '<CUSTOMER_ID>',
    name: 'GIX Access — Equinix LD5',
    billingCycle: 'monthly',
    currencyCode: 'USD',
    termMonths: 12,
    autoRenew: true,
    startDate: '2026-05-01',
    items: [
      {
        name: 'Access Port 10G',
        mrcAmount: 450,
        nrcAmount: 490,
        configuration: { datacentre: 'Equinix LD5', portSpeed: '10G' },
        charges: [{ chargeCode: 'setup_fee', chargeType: 'nrc', amount: 490 }, { chargeCode: 'monthly_port_fee', chargeType: 'mrc', amount: 450 }],
        capacityTotal: 10000,
        capacityUnit: 'MB',
        sortOrder: 0,
      },
      {
        name: 'GIX Internet Peering 2G',
        mrcAmount: 200,
        nrcAmount: 0,
        configuration: { bandwidth: '2G' },
        charges: [{ chargeCode: 'bandwidth_fee', chargeType: 'mrc', amount: 200 }],
        sortOrder: 1,
      },
    ],
  }),
}).then(r => r.json())
console.log('Subscription:', sub)
console.log('Code:', sub.code)
console.log('MRC (aggregate):', sub.mrcAmount, '— expected: 650 (450+200)')
console.log('NRC (aggregate):', sub.nrcAmount, '— expected: 490')
console.log('Items count:', sub.items?.length, '— expected: 2')
```

**Expected**:
- Status `201 Created`
- `code` auto-generated as `SUB-2026-00001` (or next sequence)
- `mrcAmount` = `650` (sum of item MRCs)
- `nrcAmount` = `490` (sum of item NRCs)
- `status` = `pending`
- 2 items returned

Save `sub.id` as `<SUB_ID>` and item IDs for later tests.

```js
const SUB_ID = sub.id
const PORT_ITEM_ID = sub.items[0].id
const PEERING_ITEM_ID = sub.items[1].id
console.log('SUB_ID:', SUB_ID)
console.log('PORT_ITEM_ID:', PORT_ITEM_ID)
console.log('PEERING_ITEM_ID:', PEERING_ITEM_ID)
```

---

### API Test 2 — Get subscription with items (tree view)

```js
const detail = await fetch(`/api/cpq/inventory/subscriptions?id=${SUB_ID}`).then(r => r.json())
console.log('Subscription:', detail.name)
console.log('Status:', detail.status)
console.log('Items:', detail.items?.length)
detail.items?.forEach(item => {
  console.log(`  - ${item.name} | MRC: ${item.mrcAmount} | NRC: ${item.nrcAmount}`)
})
```

**Expected**: Full subscription detail with 2 items.

---

### API Test 3 — List subscriptions (paginated)

```js
const list = await fetch(`/api/cpq/inventory/subscriptions?customerId=<CUSTOMER_ID>&page=1&pageSize=10`).then(r => r.json())
console.log('Total:', list.total)
console.log('Items:', list.items?.map(s => `${s.code} — ${s.name} (${s.status})`))
```

**Expected**: At least 1 subscription for the customer.

---

### API Test 4 — Activate the subscription

```js
const activated = await fetch('/api/cpq/inventory/subscriptions/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: SUB_ID, targetStatus: 'active' }),
}).then(r => r.json())
console.log('Status:', activated.status, '— expected: active')
console.log('Activated at:', activated.activatedAt)
```

**Expected**: `status` = `active`, `activatedAt` is set.

---

### API Test 5 — Suspend the subscription

```js
const suspended = await fetch('/api/cpq/inventory/subscriptions/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: SUB_ID, targetStatus: 'suspended' }),
}).then(r => r.json())
console.log('Status:', suspended.status, '— expected: suspended')
console.log('Suspended at:', suspended.suspendedAt)
```

**Expected**: `status` = `suspended`, `suspendedAt` is set.

---

### API Test 6 — Reactivate the subscription

```js
const reactivated = await fetch('/api/cpq/inventory/subscriptions/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: SUB_ID, targetStatus: 'active' }),
}).then(r => r.json())
console.log('Status:', reactivated.status, '— expected: active')
console.log('Suspended at:', reactivated.suspendedAt, '— expected: null (cleared)')
```

**Expected**: `status` = `active`, `suspendedAt` cleared to null.

---

### API Test 7 — Invalid transition (should return 409)

```js
const invalid = await fetch('/api/cpq/inventory/subscriptions/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: SUB_ID, targetStatus: 'pending' }),
})
console.log('HTTP status:', invalid.status, '— expected: 409')
const body = await invalid.json()
console.log('Error:', body.error)
```

**Expected**: HTTP 409, error message "Cannot transition from 'active' to 'pending'".

---

### API Test 8 — Update subscription (mutable fields only)

```js
const updated = await fetch('/api/cpq/inventory/subscriptions', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: SUB_ID,
    name: 'GIX Access — Equinix LD5 (Renewed)',
    billingCycle: 'annually',
    termMonths: 24,
    autoRenew: false,
    metadata: { contractRef: 'CNT-2026-001' },
  }),
}).then(r => r.json())
console.log('Name:', updated.name, '— expected: GIX Access — Equinix LD5 (Renewed)')
console.log('Billing cycle:', updated.billingCycle, '— expected: annually')
console.log('Term months:', updated.termMonths, '— expected: 24')
console.log('Auto renew:', updated.autoRenew, '— expected: false')
console.log('Metadata:', updated.metadata)
```

**Expected**: Mutable fields updated. `mrcAmount` and `nrcAmount` unchanged (aggregates).

---

## Part D — Subscription Items (Amendments)

### API Test 9 — Add an item to existing subscription (amendment)

```js
const newItem = await fetch('/api/cpq/inventory/subscription-items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    subscriptionId: SUB_ID,
    parentItemId: PORT_ITEM_ID,
    name: 'GIX Cloud Connect AWS 500M',
    mrcAmount: 300,
    nrcAmount: 0,
    configuration: { cloudProvider: 'AWS', region: 'eu-west-1', bandwidth: '500M' },
    charges: [{ chargeCode: 'flat_bandwidth_fee', chargeType: 'mrc', amount: 300 }],
    sortOrder: 2,
  }),
}).then(r => r.json())
console.log('New item:', newItem.name)
console.log('Parent item ID:', newItem.parentItemId, '— expected:', PORT_ITEM_ID)
const CLOUD_ITEM_ID = newItem.id
console.log('CLOUD_ITEM_ID:', CLOUD_ITEM_ID)
```

Now verify the subscription aggregates were recomputed:

```js
const subAfter = await fetch(`/api/cpq/inventory/subscriptions?id=${SUB_ID}`).then(r => r.json())
console.log('MRC after amendment:', subAfter.mrcAmount, '— expected: 950 (450+200+300)')
console.log('NRC after amendment:', subAfter.nrcAmount, '— expected: 490')
console.log('Items count:', subAfter.items?.length, '— expected: 3')
```

**Expected**: MRC = 950, 3 items, new item has `parentItemId` pointing to the port.

---

### API Test 10 — List items by subscription

```js
const items = await fetch(`/api/cpq/inventory/subscription-items?subscriptionId=${SUB_ID}`).then(r => r.json())
console.log('Items:', items.length ?? items.items?.length)
items.forEach?.(i => console.log(`  ${i.name} | parent: ${i.parentItemId ?? 'none'} | MRC: ${i.mrcAmount}`))
```

**Expected**: 3 items. The Cloud Connect item has `parentItemId` = port item ID.

---

### API Test 11 — List items by parent (children of the port)

```js
const children = await fetch(`/api/cpq/inventory/subscription-items?parentItemId=${PORT_ITEM_ID}`).then(r => r.json())
console.log('Children of port:', children.length ?? children.items?.length)
children.forEach?.(c => console.log(`  ${c.name}`))
```

**Expected**: 2 child items (Internet Peering + Cloud Connect). The port itself is NOT returned.

---

## Part E — Assets

### API Test 12 — Create a standalone asset

```js
const asset1 = await fetch('/api/cpq/inventory/assets', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customerId: '<CUSTOMER_ID>',
    name: 'Network Switch — Equinix LD5',
    assetType: 'physical',
    purchasePrice: 2500,
    currencyCode: 'USD',
    purchaseDate: '2026-04-01',
    configuration: { model: 'Arista 7050X3', rackUnit: '42U-A3' },
    metadata: { serialNumber: 'AR-2026-XYZ-001', warrantyEnd: '2029-04-01' },
  }),
}).then(r => r.json())
console.log('Asset:', asset1.name)
console.log('Code:', asset1.code, '— expected: AST-2026-00001 (or next seq)')
console.log('Type:', asset1.assetType, '— expected: physical')
console.log('Status:', asset1.status, '— expected: pending')
const ASSET1_ID = asset1.id
console.log('ASSET1_ID:', ASSET1_ID)
```

**Expected**: Standalone asset (no subscription link), code auto-generated.

---

### API Test 13 — Create an asset linked to a subscription

```js
const asset2 = await fetch('/api/cpq/inventory/assets', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customerId: '<CUSTOMER_ID>',
    subscriptionId: SUB_ID,
    name: 'GIX Access Port Setup Fee',
    assetType: 'one_time',
    purchasePrice: 490,
    currencyCode: 'USD',
    purchaseDate: '2026-05-01',
    configuration: { datacentre: 'Equinix LD5', portSpeed: '10G' },
  }),
}).then(r => r.json())
console.log('Asset:', asset2.name)
console.log('Linked to subscription:', asset2.subscriptionId, '— expected:', SUB_ID)
const ASSET2_ID = asset2.id
```

**Expected**: Asset linked to subscription via `subscriptionId`.

---

### API Test 14 — Create an asset linked to a subscription item

```js
const asset3 = await fetch('/api/cpq/inventory/assets', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customerId: '<CUSTOMER_ID>',
    subscriptionId: SUB_ID,
    subscriptionItemId: PORT_ITEM_ID,
    name: 'Physical NIC — 10G SFP+',
    assetType: 'physical',
    purchasePrice: 350,
    currencyCode: 'USD',
    metadata: { serialNumber: 'NIC-2026-ABC-002', manufacturer: 'Mellanox' },
  }),
}).then(r => r.json())
console.log('Asset:', asset3.name)
console.log('Linked to item:', asset3.subscriptionItemId, '— expected:', PORT_ITEM_ID)
```

**Expected**: Asset linked to both subscription and item.

---

### API Test 15 — List assets for customer

```js
const assets = await fetch(`/api/cpq/inventory/assets?customerId=<CUSTOMER_ID>`).then(r => r.json())
console.log('Total assets:', assets.total)
assets.items?.forEach(a => {
  const linkedTo = a.subscriptionItemId ? 'item' : a.subscriptionId ? 'subscription' : 'standalone'
  console.log(`  ${a.code} — ${a.name} (${a.status}) [${linkedTo}]`)
})
```

**Expected**: 3 assets — 1 standalone, 1 linked to subscription, 1 linked to item.

---

### API Test 16 — Asset status transitions

```js
// pending → delivered
const delivered = await fetch('/api/cpq/inventory/assets/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: ASSET1_ID, targetStatus: 'delivered' }),
}).then(r => r.json())
console.log('Status:', delivered.status, '— expected: delivered')

// delivered → active
const active = await fetch('/api/cpq/inventory/assets/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: ASSET1_ID, targetStatus: 'active' }),
}).then(r => r.json())
console.log('Status:', active.status, '— expected: active')

// pending → active (direct, for digital assets)
const directActive = await fetch('/api/cpq/inventory/assets/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: ASSET2_ID, targetStatus: 'active' }),
}).then(r => r.json())
console.log('Direct activation:', directActive.status, '— expected: active')
```

**Expected**: All transitions succeed. Physical asset goes pending→delivered→active. Digital asset goes pending→active directly.

---

### API Test 17 — Invalid asset transition (should return 409)

```js
const badTransition = await fetch('/api/cpq/inventory/assets/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: ASSET1_ID, targetStatus: 'pending' }),
})
console.log('HTTP status:', badTransition.status, '— expected: 409')
const errBody = await badTransition.json()
console.log('Error:', errBody.error)
```

**Expected**: HTTP 409, cannot go from `active` back to `pending`.

---

## Part F — Customer Inventory View

### API Test 18 — Get combined customer inventory

```js
const inventory = await fetch(`/api/cpq/inventory/customer/<CUSTOMER_ID>`).then(r => r.json())
console.log('Summary:', inventory.summary)
console.log('Active subscriptions:', inventory.summary.activeSubscriptions)
console.log('Total MRC:', inventory.summary.totalMrc)
console.log('Active assets:', inventory.summary.activeAssets)
console.log('Subscriptions:', inventory.subscriptions?.length)
console.log('Subscription items:', inventory.subscriptionItems?.length)
console.log('Assets:', inventory.assets?.length)
```

**Expected**:
- `activeSubscriptions` = 1 (the one we activated)
- `totalMrc` = 950
- Subscriptions, items, and assets arrays populated
- Summary includes `activeAssets` count

---

### API Test 19 — Get parent items (for quoting wizard)

```js
const parents = await fetch(`/api/cpq/inventory/customer/<CUSTOMER_ID>/parent-items`).then(r => r.json())
console.log('Parent items:', parents.length)
parents.forEach(p => {
  console.log(`  ${p.name} | capacity: ${p.capacityTotal} ${p.capacityUnit} | used: ${p.capacityUsed ?? 'N/A'}`)
})
```

**Expected**: 1 parent item (Access Port 10G) with capacity info. Child items (peering, cloud connect) NOT included.

---

## Part G — Termination (Cascade)

### API Test 20 — Terminate subscription (cascades to all items)

```js
const terminated = await fetch('/api/cpq/inventory/subscriptions/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: SUB_ID, targetStatus: 'terminated' }),
}).then(r => r.json())
console.log('Subscription status:', terminated.status, '— expected: terminated')
console.log('Terminated at:', terminated.terminatedAt)
```

Verify all items are also terminated:

```js
const itemsAfter = await fetch(`/api/cpq/inventory/subscription-items?subscriptionId=${SUB_ID}`).then(r => r.json())
const allTerminated = (itemsAfter.items ?? itemsAfter).every(i => i.status === 'terminated')
console.log('All items terminated:', allTerminated, '— expected: true')
```

**Expected**: Subscription and all 3 items have `status` = `terminated`. This is a terminal state — no further transitions allowed.

---

### API Test 21 — Verify terminated subscription cannot be reactivated

```js
const cantReactivate = await fetch('/api/cpq/inventory/subscriptions/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: SUB_ID, targetStatus: 'active' }),
})
console.log('HTTP status:', cantReactivate.status, '— expected: 409')
```

**Expected**: HTTP 409. `terminated` is a terminal state.

---

## Part H — Soft Delete

> **Note:** Run these tests last — they remove data from the system.

### API Test D-1 — Delete an asset

```js
const deleteResult = await fetch('/api/cpq/inventory/assets', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: ASSET1_ID }),
}).then(r => r.json())
console.log('Deleted:', deleteResult.success, '— expected: true')

// Verify it's gone from listings
const assetsAfterDelete = await fetch(`/api/cpq/inventory/assets?customerId=<CUSTOMER_ID>`).then(r => r.json())
const stillVisible = assetsAfterDelete.items?.some(a => a.id === ASSET1_ID)
console.log('Still visible:', stillVisible, '— expected: false')
```

**Expected**: Asset soft-deleted (set `deletedAt`), no longer appears in listings.

---

### API Test D-2 — Delete a subscription

```js
const subDelete = await fetch('/api/cpq/inventory/subscriptions', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: SUB_ID }),
}).then(r => r.json())
console.log('Deleted:', subDelete.success, '— expected: true')

const subList = await fetch(`/api/cpq/inventory/subscriptions?customerId=<CUSTOMER_ID>`).then(r => r.json())
console.log('Remaining subscriptions:', subList.total, '— expected: 0')
```

**Expected**: Subscription soft-deleted.

---

## Summary

| Test | Area | What it verifies |
|------|------|------------------|
| **UI 1** | UI | Sidebar navigation — Customer Inventory entry |
| **UI 2** | UI | Dedicated Inventory page — empty state |
| **UI 3** | UI | Customer detail → Inventory tab — empty state (Company + Person) |
| **UI 4** | UI | Dedicated Inventory page — Subscriptions tab with data |
| **UI 5** | UI | Dedicated Inventory page — Assets tab with data |
| **UI 6** | UI | Customer detail → Inventory tab (Company) — summary, subs, items, assets |
| **UI 7** | UI | Status badge colors for all statuses |
| **UI 8** | UI | Real-time data refresh on inventory page |
| **UI 9** | UI | "View full inventory" link navigation |
| **API 1** | API | Create subscription with items, aggregate MRC/NRC |
| **API 2** | API | Get subscription with item tree |
| **API 3** | API | List subscriptions with pagination |
| **API 4-7** | API | Subscription status lifecycle (activate, suspend, reactivate, invalid) |
| **API 8** | API | Update mutable subscription fields |
| **API 9** | API | Amendment — add item, recompute aggregates |
| **API 10-11** | API | List items by subscription and by parent |
| **API 12-14** | API | Create assets (standalone, linked to sub, linked to item) |
| **API 15** | API | List assets for customer with linkage info |
| **API 16-17** | API | Asset status transitions (including direct activation) |
| **API 18** | API | Combined customer inventory view with summary |
| **API 19** | API | Parent items for quoting wizard |
| **API 20-21** | API | Cascading termination + terminal state enforcement |
| **API D-1–D-2** | API | Soft delete (assets and subscriptions) |
