# XD-186 — Pricing Tables — Test Manual

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

The Pricing Tables page is in the left sidebar:

**Sidebar → CPQ section → Pricing Tables** (calculator icon)

Or directly: `http://localhost:3000/backend/cpq/pricing`

---

## Test 1 — Pricing Tables List (UI)

1. In the left sidebar, find the **CPQ** section and click **Pricing Tables**
2. Verify you see a table with columns: **Name**, **Code**, **Price Columns**, **Currencies**, **Status**
3. Verify seed data tables are listed:
   - `GIX Access Port Pricing` — code `gix_access_port_pricing`, Currencies: `USD`, Status: Active
   - `GIX Internet Peering Pricing` — code `gix_internet_peering_pricing`
   - `GIX Mobile Peering Pricing` — code `gix_mobile_peering_pricing`
   - `GIX Cloud Connect Pricing` — code `gix_cloud_connect_pricing`
4. Verify there is **no** "Pricing Model" column (removed per spec)

**Expected**: 4 pricing tables listed with correct metadata.

---

## Test 2 — Pricing Table Detail (UI)

1. From the Pricing Tables list (Sidebar → CPQ → Pricing Tables), click on **GIX Access Port Pricing**
2. Verify the detail view shows:
   - Name: `GIX Access Port Pricing`
   - Code: `gix_access_port_pricing`
   - Currencies: `USD`
   - Dimensions: `Data Centre, Port Size`
   - Price Columns: `Setup Price (NRC), Monthly Recurring (MRC)`
3. Verify the entries table shows columns: **Data Centre**, **Port Size**, **Setup Price (NRC)**, **Monthly Recurring (MRC)**, **Currency**
4. Find the row for `equinix-ld5` / `1G` — verify NRC = `290.00`, MRC = `250.00`, Currency = `USD`
5. Click **← Back** (or navigate back via the sidebar) and click on **GIX Internet Peering Pricing**
6. Verify it shows tier columns: **Tier #**, **Range From**, **Range To**, plus **Price per MB**, **Currency**
7. Verify tier 0 (range 0–50) shows price `0.52`, tier 5 (range 1001–∞) shows `0.40`

**Expected**: Pricing table detail with entries correctly displayed, including currency per entry.

---

## Test 3 — Pricing Tables API: GET list

```js
const res = await fetch('/api/cpq/pricing-tables')
const data = await res.json()
console.log('Status:', res.status)
console.log('Total:', data.total)
console.log('First item keys:', Object.keys(data.items[0]))
console.log('First item currencyCodeList:', data.items[0].currencyCodeList)
```

**Expected**: Status `200`, `total >= 4`, each item has `id`, `code`, `name`, `dimensions`, `priceColumns`, `currencyCodeList`, `isActive`, `createdAt`, `updatedAt`. No `pricingModel`, no `productId`, no `description`.

---

## Test 4 — Pricing Tables API: GET single with entries

```js
// First get a table ID
const list = await fetch('/api/cpq/pricing-tables').then(r => r.json())
const tableId = list.items.find(t => t.code === 'gix_access_port_pricing').id

const res = await fetch(`/api/cpq/pricing-tables?id=${tableId}`)
const data = await res.json()
console.log('Table name:', data.name)
console.log('Entries count:', data.entries.length)
console.log('First entry currencyCode:', data.entries[0].currencyCode)
console.log('First entry dimensionValues:', data.entries[0].dimensionValues)
console.log('First entry prices:', data.entries[0].prices)
```

**Expected**: Table record + embedded `entries` array. Each entry has `dimensionValues`, `prices`, `currencyCode`. No separate API call needed for entries.

---

## Test 5 — Create a new table (API) + verify in UI

```js
const res = await fetch('/api/cpq/pricing-tables', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: 'test-table-186',
    name: 'Test Table XD-186',
    dimensions: [{ key: 'region', label: 'Region' }],
    priceColumns: [
      { key: 'nrc', label: 'Setup Fee' },
      { key: 'mrc', label: 'Monthly Fee' }
    ],
    currencyCodeList: ['USD', 'EUR'],
    isActive: true
  })
})
const data = await res.json()
console.log('Status:', res.status, 'ID:', data.id)
console.log('currencyCodeList:', data.currencyCodeList)
```

**Expected**: Status `201`, returned object has `currencyCodeList: ["USD", "EUR"]`.

**UI verification**: Refresh the Pricing Tables page in the sidebar — the new table should appear in the list.

---

## Test 6 — Pricing Tables API: PUT (update table)

```js
// Use the ID from Test 5
const list = await fetch('/api/cpq/pricing-tables').then(r => r.json())
const table = list.items.find(t => t.code === 'test-table-186')

const res = await fetch('/api/cpq/pricing-tables', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: table.id,
    name: 'Test Table XD-186 (Updated)',
    currencyCodeList: ['USD', 'EUR', 'GBP']
  })
})
const data = await res.json()
console.log('Status:', res.status)
console.log('Updated name:', data.name)
console.log('Updated currencyCodeList:', data.currencyCodeList)
```

**Expected**: Status `200`, name and currencyCodeList updated.

---

## Test 7 — Pricing Table Entries API: POST (create single entry)

```js
const list = await fetch('/api/cpq/pricing-tables').then(r => r.json())
const tableId = list.items.find(t => t.code === 'test-table-186').id

const res = await fetch('/api/cpq/pricing-table-entries', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pricingTableId: tableId,
    dimensionValues: { region: 'eu-west' },
    currencyCode: 'USD',
    prices: { nrc: 500, mrc: 120 }
  })
})
const data = await res.json()
console.log('Status:', res.status)
console.log('Entry currencyCode:', data.currencyCode)
console.log('Entry prices:', data.prices)
```

**Expected**: Status `201`, entry created with `currencyCode: "USD"`.

---

## Test 8 — Pricing Table Entries API: POST (bulk create)

```js
const list = await fetch('/api/cpq/pricing-tables').then(r => r.json())
const tableId = list.items.find(t => t.code === 'test-table-186').id

const res = await fetch('/api/cpq/pricing-table-entries', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify([
    { pricingTableId: tableId, dimensionValues: { region: 'eu-west' }, currencyCode: 'EUR', prices: { nrc: 450, mrc: 110 } },
    { pricingTableId: tableId, dimensionValues: { region: 'us-east' }, currencyCode: 'USD', prices: { nrc: 480, mrc: 100 } },
    { pricingTableId: tableId, dimensionValues: { region: 'us-east' }, currencyCode: 'EUR', prices: { nrc: 430, mrc: 95 } }
  ])
})
const data = await res.json()
console.log('Status:', res.status)
console.log('Created entries:', data.items.length)
data.items.forEach(e => console.log(e.dimensionValues.region, e.currencyCode, e.prices))
```

**Expected**: Status `201`, 3 entries created, each with its own `currencyCode`.

---

## Test 9 — Pricing Tables API: DELETE (soft-delete)

```js
const list = await fetch('/api/cpq/pricing-tables').then(r => r.json())
const table = list.items.find(t => t.code === 'test-table-186')

const res = await fetch('/api/cpq/pricing-tables', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: table.id })
})
const data = await res.json()
console.log('Status:', res.status, data)

// Verify it no longer appears in the list
const list2 = await fetch('/api/cpq/pricing-tables').then(r => r.json())
console.log('Still in list:', list2.items.some(t => t.code === 'test-table-186'))
```

**Expected**: Status `200`, `{ success: true }`. Table no longer appears in the list.

---

## Test 10 — Validation errors

```js
// Missing required fields
const res = await fetch('/api/cpq/pricing-tables', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: '' })
})
console.log('Status:', res.status)
const data = await res.json()
console.log('Error:', data.error, 'Details:', data.details)
```

**Expected**: Status `400`, `error: "Validation error"` with Zod issue details.
