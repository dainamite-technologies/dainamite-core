# XD-187 — Calculate Price API — Test Manual

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

Tests 1–10 are API tests (DevTools Console). Test 11 uses the quoting wizard in the UI.

Related pages in the sidebar:
- **Sidebar → CPQ → Product Configuration** — products with attributes and charges
- **Sidebar → CPQ → Pricing Tables** — pricing tables used by the calculator
- **Sidebar → CPQ → Price Rules** — rules that modify calculated prices
- **Sidebar → Sales → CPQ Quotes** — quote creation wizard (Test 11)

---

### Step 0 — Get product IDs

Run this once to get the IDs you need for all tests below:

```js
const products = await fetch('/api/catalog/products?pageSize=100').then(r => r.json())
const items = products.items ?? products
const accessPort = items.find(p => p.sku === 'GIX-ACCESS-PORT')
const internetPeering = items.find(p => p.sku === 'GIX-INTERNET-PEERING')
const mobilePeering = items.find(p => p.sku === 'GIX-MOBILE-PEERING')
const cloudConnect = items.find(p => p.sku === 'GIX-CLOUD-CONNECT')

console.log('Access Port ID:', accessPort?.id)
console.log('Internet Peering ID:', internetPeering?.id)
console.log('Mobile Peering ID:', mobilePeering?.id)
console.log('Cloud Connect ID:', cloudConnect?.id)
```

Save these IDs — replace `<ACCESS_PORT_ID>`, `<INTERNET_PEERING_ID>`, etc. in the tests below.

---

## Test 1 — Flat pricing: Access Port (NRC + MRC)

```js
const res = await fetch('/api/cpq/cpq-quotes/price', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    primaryItem: {
      productId: '<ACCESS_PORT_ID>',
      configuration: { data_centre: 'equinix-ld5', port_size: '1G' }
    },
    childItems: []
  })
})
const data = await res.json()
console.log('Status:', res.status)
console.log('Primary charges:', JSON.stringify(data.primaryCharges, null, 2))
console.log('Totals:', data.totals)
console.log('Currency:', data.currencyCode)
```

**Expected**:
- 2 charges: `setup_fee` (NRC, flat, unitPrice=290, qty=1, total=290) and `monthly_port_fee` (MRC, flat, unitPrice=250, qty=1, total=250)
- `totals.nrcTotal = 290`, `totals.mrcTotal = 250`, `totals.usageCharges = []`
- `currencyCode = "USD"`

---

## Test 2 — Flat pricing with different dimensions

```js
const res = await fetch('/api/cpq/cpq-quotes/price', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    primaryItem: {
      productId: '<ACCESS_PORT_ID>',
      configuration: { data_centre: 'equinix-fr5', port_size: '10G' }
    },
    childItems: []
  })
})
const data = await res.json()
const nrc = data.primaryCharges.find(c => c.chargeCode === 'setup_fee')
const mrc = data.primaryCharges.find(c => c.chargeCode === 'monthly_port_fee')
console.log('NRC unitPrice:', nrc.unitPrice, 'total:', nrc.totalPrice)
console.log('MRC unitPrice:', mrc.unitPrice, 'total:', mrc.totalPrice)
```

**Expected**: NRC unitPrice=490, total=490. MRC unitPrice=410, total=410. (Frankfurt, 10G prices from seed data)

---

## Test 3 — Tiered pricing: Internet Peering (150 MB)

```js
const res = await fetch('/api/cpq/cpq-quotes/price', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    primaryItem: null,
    childItems: [{
      productId: '<INTERNET_PEERING_ID>',
      configuration: { bandwidth_mb: 150 }
    }]
  })
})
const data = await res.json()
const charge = data.childItems[0].charges[0]
console.log('Charge:', charge.chargeCode, charge.pricingMethod)
console.log('unitPrice (avg):', charge.unitPrice)
console.log('quantity:', charge.quantity)
console.log('totalPrice:', charge.totalPrice)
console.log('Tiers:', JSON.stringify(charge.breakdown?.tiers, null, 2))
```

**Expected**:
- `chargeCode: "bandwidth_fee"`, `pricingMethod: "tiered"`, `chargeType: "mrc"`
- Tier breakdown: tier 0 (0–50, rate 0.52, qty 51, subtotal 26.52), tier 1 (51–100, rate 0.49, qty 50, subtotal 24.50), tier 2 (101–250, rate 0.47, qty 49, subtotal 23.03)
- `totalPrice = 74.05` (approximately), `unitPrice = totalPrice / 150`
- `totals.mrcTotal` matches totalPrice

---

## Test 4 — Per-unit pricing: Cloud Connect flat model

```js
const res = await fetch('/api/cpq/cpq-quotes/price', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    primaryItem: null,
    childItems: [{
      productId: '<CLOUD_CONNECT_ID>',
      configuration: {
        data_centre_location: 'London',
        cloud_provider: 'AWS',
        cloud_region: 'eu-west-2',
        pricing_model: 'flat',
        bandwidth_mb: 100
      }
    }]
  })
})
const data = await res.json()
const charges = data.childItems[0].charges
console.log('Charges count:', charges.length)
charges.forEach(c => console.log(c.chargeCode, c.chargeType, 'unit:', c.unitPrice, 'qty:', c.quantity, 'total:', c.totalPrice))
console.log('Totals:', data.totals)
```

**Expected**:
- 1 charge: `flat_bandwidth_fee` (MRC, per_unit, unitPrice=0.52, qty=100, total=52.00)
- `commit_bandwidth_fee` and `overage_fee` should NOT appear (applicability condition filters them out — they require `pricing_model: "burstable"`)

---

## Test 5 — Usage charges: Cloud Connect burstable model

```js
const res = await fetch('/api/cpq/cpq-quotes/price', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    primaryItem: null,
    childItems: [{
      productId: '<CLOUD_CONNECT_ID>',
      configuration: {
        data_centre_location: 'London',
        cloud_provider: 'AWS',
        cloud_region: 'eu-west-2',
        pricing_model: 'burstable',
        bandwidth_mb: 100
      }
    }]
  })
})
const data = await res.json()
const charges = data.childItems[0].charges
charges.forEach(c => {
  console.log(c.chargeCode, c.chargeType, 'unit:', c.unitPrice, 'qty:', c.quantity, 'total:', c.totalPrice, 'note:', c.note)
})
console.log('Usage charges in totals:', data.totals.usageCharges)
```

**Expected**:
- 2 charges:
  - `commit_bandwidth_fee` — MRC, per_unit, unitPrice=0.46, qty=100, total=46.00
  - `overage_fee` — **usage**, per_unit, unitPrice=0.69, **qty=null**, **total=null**, note present
- `flat_bandwidth_fee` does NOT appear (filtered by applicability)
- `totals.usageCharges` contains 1 entry: `{ chargeCode: "overage_fee", unitPrice: 0.69, note: "..." }`
- `totals.mrcTotal = 46.00` (only commit fee, not overage)
- `totals.nrcTotal = 0`

---

## Test 6 — Primary + child items together

```js
const res = await fetch('/api/cpq/cpq-quotes/price', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    primaryItem: {
      productId: '<ACCESS_PORT_ID>',
      configuration: { data_centre: 'equinix-ld5', port_size: '10G' }
    },
    childItems: [
      {
        productId: '<INTERNET_PEERING_ID>',
        configuration: { bandwidth_mb: 200 }
      },
      {
        productId: '<CLOUD_CONNECT_ID>',
        configuration: {
          data_centre_location: 'London',
          cloud_provider: 'GCP',
          cloud_region: 'europe-west2',
          pricing_model: 'flat',
          bandwidth_mb: 50
        }
      }
    ]
  })
})
const data = await res.json()
console.log('Primary charges:', data.primaryCharges.length)
console.log('Child items:', data.childItems.length)
data.childItems.forEach((ci, i) => {
  console.log(`Child ${i}: productId=${ci.productId}, charges=${ci.charges.length}`)
  ci.charges.forEach(c => console.log('  ', c.chargeCode, c.chargeType, 'total:', c.totalPrice))
})
console.log('Totals:', data.totals)
```

**Expected**:
- `primaryCharges`: 2 (setup_fee NRC + monthly_port_fee MRC)
- `childItems[0]`: Internet Peering with tiered MRC
- `childItems[1]`: Cloud Connect with flat MRC
- Each child item has `productId` echoed back
- `totals.nrcTotal` = Access Port NRC
- `totals.mrcTotal` = Access Port MRC + Peering MRC + Cloud Connect MRC

---

## Test 7 — Currency code propagation

```js
const res = await fetch('/api/cpq/cpq-quotes/price', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    primaryItem: {
      productId: '<ACCESS_PORT_ID>',
      configuration: { data_centre: 'equinix-ld5', port_size: '1G' }
    },
    childItems: [],
    currencyCode: 'EUR'
  })
})
const data = await res.json()
console.log('Response currencyCode:', data.currencyCode)
console.log('Charge unitPrices:', data.primaryCharges.map(c => c.unitPrice))
```

**Expected**: `currencyCode: "EUR"` echoed. Since seed data only has USD entries, charges will return `unitPrice: 0` (no EUR entries match). This confirms currency filtering works.

---

## Test 8 — Empty request (no primary, no children)

```js
const res = await fetch('/api/cpq/cpq-quotes/price', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    primaryItem: null,
    childItems: []
  })
})
const data = await res.json()
console.log('Status:', res.status)
console.log('Primary charges:', data.primaryCharges)
console.log('Child items:', data.childItems)
console.log('Totals:', data.totals)
```

**Expected**: Status `200`, `primaryCharges: []`, `childItems: []`, `totals: { nrcTotal: 0, mrcTotal: 0, usageCharges: [] }`.

---

## Test 9 — No match returns zero (wrong dimension values)

```js
const res = await fetch('/api/cpq/cpq-quotes/price', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    primaryItem: {
      productId: '<ACCESS_PORT_ID>',
      configuration: { data_centre: 'NONEXISTENT-DC', port_size: '1G' }
    },
    childItems: []
  })
})
const data = await res.json()
data.primaryCharges.forEach(c => {
  console.log(c.chargeCode, 'unitPrice:', c.unitPrice, 'totalPrice:', c.totalPrice)
})
```

**Expected**: Charges exist but have `unitPrice: 0`, `totalPrice: 0`. No error thrown.

---

## Test 10 — Validation error (missing productId and offeringId)

```js
const res = await fetch('/api/cpq/cpq-quotes/price', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    primaryItem: {
      configuration: { data_centre: 'equinix-ld5' }
    },
    childItems: []
  })
})
console.log('Status:', res.status)
const data = await res.json()
console.log('Error:', data.error)
console.log('Details:', JSON.stringify(data.details))
```

**Expected**: Status `400`, validation error — "One of offeringId or productId is required".

---

## Test 11 — Quoting Wizard end-to-end (UI)

Navigate to: **Sidebar → Sales section → CPQ Quotes** → click **New Quote**

1. In the left sidebar, click **CPQ Quotes** (under the Sales section, document icon)
2. On the quotes list page, click **New Quote** (top right)
3. **Step 1**: Search and select a customer
4. **Step 2**: Choose **New Primary with Children**
5. **Step 3**: Select **GIX Access Port** as the primary product, configure:
   - Data Centre: `Equinix LD5`
   - Port Size: `10G`
6. Verify the **Charge Preview Panel** on the right shows:
   - Setup Fee (NRC): `USD 490.00`
   - Monthly Port Fee (MRC): `USD 450.00`
7. **Step 4**: Add a child **GIX Internet Peering**, set Bandwidth to `200`
8. Verify tiered pricing appears with tier breakdown table
9. Add a child **GIX Cloud Connect**, set:
   - Cloud Provider: `AWS`
   - Cloud Region: `eu-west-2`
   - Pricing Model: `Burstable`
   - Bandwidth: `100`
10. Verify charges show:
    - Committed Bandwidth Fee (MRC)
    - Overage Fee (Usage) with per-unit rate
11. **Step 5 (Review)**: Verify the summary card shows NRC total, MRC total, and usage charges listed separately

### Supporting data verification in UI

After running the API tests, you can cross-check data in the UI:
- **Sidebar → CPQ → Product Configuration** — click any product (e.g. GIX Access Port) to see its charges and attribute configuration
- **Sidebar → CPQ → Pricing Tables** — click a pricing table (e.g. GIX Access Port Pricing) to see the dimension values and price rates used in calculation
