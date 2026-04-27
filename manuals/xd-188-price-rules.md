# XD-188 — Simple Price Rules — Test Manual

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

The Price Rules page is in the left sidebar:

**Sidebar → CPQ section → Price Rules** (scale icon, right below Pricing Tables)

Or directly: `http://localhost:3000/backend/cpq/price-rules`

This page lets you create, edit, and delete price rules through the UI. You can also use the API endpoints below.

---

## Part A — Managing Price Rules via UI

### Test 1 — View the Price Rules list

1. In the left sidebar, find the **CPQ** section and click **Price Rules**
2. Verify you see the seed rules (8 pre-loaded rules including both Global and Product-scoped)
3. The **Create Rule** button should be visible in the top right
4. Check the **Scope** column — some rules show "Global", others show the product offering name (e.g. "GIX Access Port Standard Offering")

**Expected**: 8 seed rules visible, sorted by Sort Order. Rules have mixed scopes (Global and Product-scoped).

### Test 2 — Create a global rule via UI

1. Click **Create Rule**
2. Fill in the form:
   - **Code**: `ui-nrc-10pct-off`
   - **Name**: `10% NRC Discount`
   - **Rule Type**: select `Discount %`
   - **Value**: `10`
   - **Charge Type Filter**: select `NRC only`
   - **Sort Order**: `10`
   - **Product Offering**: leave as `Global (all products)`
   - **Applicability Condition**: leave all three fields empty (no condition — applies always)
   - Leave **Charge Code Filter** empty (applies to all NRC charges)
   - Leave **Active** checked
3. Click **Create**

**Expected**: The rule appears in the table with Scope="Global", Filter="nrc", Status=Active.

### Test 2b — Create a product-scoped rule via UI

1. Click **Create Rule**
2. Fill in the form:
   - **Code**: `ui-access-port-mrc-off`
   - **Name**: `Access Port MRC 5% Off`
   - **Rule Type**: select `Discount %`
   - **Value**: `5`
   - **Charge Type Filter**: select `MRC only`
   - **Product Offering**: select `GIX Access Port Standard Offering (OFFER-GIX-ACCESS-PORT)`
   - **Sort Order**: `50`
   - Leave **Active** checked
3. Click **Create**

**Expected**: The rule appears in the table with Scope="GIX Access Port Standard Offering", Filter="mrc", Status=Active. This rule will only apply when pricing the Access Port offering.

### Test 2c — Create a rule with an applicability condition via UI

1. Click **Create Rule**
2. Fill in the form:
   - **Code**: `ui-london-mrc-discount`
   - **Name**: `London DC — 5% MRC Discount`
   - **Rule Type**: select `Discount %`
   - **Value**: `5`
   - **Charge Type Filter**: select `MRC only`
   - **Product Offering**: leave as `Global (all products)`
   - **Applicability Condition**:
     - Attribute: `data_centre`
     - Operator: `equals (=)`
     - Value: `equinix-ld5`
   - **Sort Order**: `55`
   - Leave **Active** checked
3. Click **Create**

**Expected**: The rule appears in the table. The **Filter** column shows `mrc / data_centre = equinix-ld5`. This rule only applies when the product configuration has `data_centre = equinix-ld5`.

### Test 3 — Create a second rule via UI

1. Click **Create Rule** again
2. Fill in:
   - **Code**: `ui-flat-5-off`
   - **Name**: `$5 Setup Fee Discount`
   - **Rule Type**: select `Discount $`
   - **Value**: `5`
   - **Charge Type Filter**: leave as `All charge types`
   - **Charge Code Filter**: `setup_fee`
   - **Sort Order**: `20`
3. Click **Create**

**Expected**: Two rules in the table, sorted by order (10, 20).

### Test 4 — Edit a rule via UI

1. On the Price Rules list, find `10% NRC Discount` and click **Edit**
2. Change **Value** from `10` to `15`
3. Change **Name** to `15% NRC Discount`
4. Click **Update**

**Expected**: The table updates to show the new name and value "15%".

5. Click **Edit** again, change value back to `10` and name to `10% NRC Discount`, click **Update** (revert for later tests)

### Test 5 — Delete a rule via UI

1. Click **Delete** next to `$5 Setup Fee Discount`
2. Confirm the browser dialog

**Expected**: Rule removed from the list. Only `10% NRC Discount` remains.

3. Re-create the rule for Part B tests:
   - Click **Create Rule** → Code: `ui-flat-5-off`, Name: `$5 Setup Fee Discount`, Type: `Discount $`, Value: `5`, Charge Code Filter: `setup_fee`, Sort Order: `20` → **Create**

---

## Part B — Price Rules Applied During Calculation

These tests verify that rules created via the UI (or API) actually affect price calculations.

> **Important**: Seed rules are active and affect all calculations. The active global seed rules are:
> - `volume-mrc-10pct` (sortOrder=20) — 10% discount on all MRC charges
> - `premium-100g-surcharge` (sortOrder=30) — $50 surcharge on `monthly_port_fee` when `port_size=100G`
> - `cloud-connect-5pct-off` (sortOrder=40) — 5% discount when `cloud_provider` is not empty
>
> Product-scoped seed rules do NOT apply in these API tests because the tests use `productId`, not `offeringId`.

### Step 0 — Get product IDs

```js
const products = await fetch('/api/catalog/products?pageSize=100').then(r => r.json())
const items = products.items ?? products
const accessPort = items.find(p => p.sku === 'GIX-ACCESS-PORT')
const cloudConnect = items.find(p => p.sku === 'GIX-CLOUD-CONNECT')
console.log('Access Port ID:', accessPort?.id)
console.log('Cloud Connect ID:', cloudConnect?.id)
```

Save these IDs — replace `<ACCESS_PORT_ID>` and `<CLOUD_CONNECT_ID>` in tests below.

### Test 6 — discount_percent on NRC charges

With the `ui-nrc-10pct-off` rule (10% discount, chargeTypeFilter=nrc) active:

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
const setupFee = data.primaryCharges.find(c => c.chargeCode === 'setup_fee')
const monthlyFee = data.primaryCharges.find(c => c.chargeCode === 'monthly_port_fee')

console.log('--- Setup Fee (NRC) ---')
console.log('unitPrice:', setupFee.unitPrice, '(expected: 261)')
console.log('totalPrice:', setupFee.totalPrice, '(expected: 261)')
console.log('adjustments:', JSON.stringify(setupFee.adjustments, null, 2))

console.log('--- Monthly Port Fee (MRC) ---')
console.log('unitPrice:', monthlyFee.unitPrice, '(expected: 225)')
console.log('adjustments:', JSON.stringify(monthlyFee.adjustments, null, 2))
```

**Expected**:
- `setup_fee`: unitPrice = 261 (290 × 0.9), totalPrice = 261
  - `adjustments`: 1 entry with `ruleCode: "ui-nrc-10pct-off"`, `unitPriceBefore: 290`, `unitPriceAfter: 261`, `delta: -29`
- `monthly_port_fee`: unitPrice = 225 (250 × 0.9 from seed rule `volume-mrc-10pct`), totalPrice = 225
  - `adjustments`: 1 entry with `ruleCode: "volume-mrc-10pct"`, `unitPriceBefore: 250`, `unitPriceAfter: 225`, `delta: -25`
- `totals.nrcTotal = 261`, `totals.mrcTotal = 225`

### Test 7 — Rule chaining: discount_percent + discount_absolute

Both user rules active: `ui-nrc-10pct-off` (sortOrder=10, 10% NRC) + `ui-flat-5-off` (sortOrder=20, $5 off setup_fee). Seed rule `volume-mrc-10pct` (sortOrder=20) also active.

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
const setupFee = data.primaryCharges.find(c => c.chargeCode === 'setup_fee')
const monthlyFee = data.primaryCharges.find(c => c.chargeCode === 'monthly_port_fee')
console.log('setup_fee unitPrice:', setupFee.unitPrice, '(expected: 256)')
console.log('setup_fee adjustments count:', setupFee.adjustments?.length, '(expected: 2)')
console.log('setup_fee adjustments:', JSON.stringify(setupFee.adjustments, null, 2))
console.log('monthly_port_fee unitPrice:', monthlyFee.unitPrice, '(expected: 225)')
```

**Expected**:
- `setup_fee`:
  - Rule 1 `ui-nrc-10pct-off` (sortOrder=10): 290 × 0.9 = 261
  - Rule 2 `ui-flat-5-off` (sortOrder=20): 261 − 5 = 256
  - Final: unitPrice = 256, totalPrice = 256, 2 adjustments
- `monthly_port_fee`:
  - Rule `volume-mrc-10pct` (sortOrder=20, seed): 250 × 0.9 = 225
  - Final: unitPrice = 225, 1 adjustment

### Test 8 — Create surcharge via UI + test

1. Go to **Sidebar → CPQ → Price Rules**
2. Click **Create Rule**:
   - Code: `ui-mrc-20pct-surcharge`
   - Name: `20% MRC Surcharge`
   - Rule Type: `Surcharge %`
   - Value: `20`
   - Charge Type Filter: `MRC only`
   - Sort Order: `5`
3. Click **Create**

Now test the effect. Note: `ui-mrc-20pct-surcharge` (sortOrder=5) runs BEFORE the seed rule `volume-mrc-10pct` (sortOrder=20), so both rules chain.

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
const monthlyFee = data.primaryCharges.find(c => c.chargeCode === 'monthly_port_fee')
console.log('MRC unitPrice:', monthlyFee.unitPrice, '(expected: 270)')
console.log('MRC adjustments:', JSON.stringify(monthlyFee.adjustments, null, 2))
```

**Expected**: Two rules chain on MRC:
1. `ui-mrc-20pct-surcharge` (sortOrder=5): 250 × 1.2 = 300. Adjustment: `delta: +50`
2. `volume-mrc-10pct` (sortOrder=20, seed): 300 × 0.9 = 270. Adjustment: `delta: -30`

Final: unitPrice = 270, totalPrice = 270, 2 adjustments.

### Test 9 — Create price override via UI + test

1. Go to **Sidebar → CPQ → Price Rules**
2. Click **Create Rule**:
   - Code: `ui-override-setup`
   - Name: `Override Setup Fee to 99`
   - Rule Type: `Override`
   - Value: `99`
   - Charge Code Filter: `setup_fee`
   - Sort Order: `1`
3. Click **Create**

Now test:

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
const setupFee = data.primaryCharges.find(c => c.chargeCode === 'setup_fee')
console.log('setup_fee unitPrice:', setupFee.unitPrice, '(expected: 84.1)')
console.log('adjustments:', JSON.stringify(setupFee.adjustments, null, 2))
```

**Expected**: Three rules chain on `setup_fee`:
1. `ui-override-setup` (sortOrder=1): unitPrice = 99
2. `ui-nrc-10pct-off` (sortOrder=10): 99 × 0.9 = 89.1
3. `ui-flat-5-off` (sortOrder=20): 89.1 − 5 = 84.1

Final: unitPrice = 84.1, totalPrice = 84.1, 3 adjustments.

### Test 10 — Zero floor clamping (discount cannot go below 0)

1. Go to **Sidebar → CPQ → Price Rules**
2. Click **Create Rule**:
   - Code: `ui-huge-discount`
   - Name: `Huge $9999 Discount`
   - Rule Type: `Discount $`
   - Value: `9999`
   - Charge Code Filter: `monthly_port_fee`
   - Sort Order: `100`
3. Click **Create**

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
const monthlyFee = data.primaryCharges.find(c => c.chargeCode === 'monthly_port_fee')
console.log('MRC unitPrice:', monthlyFee.unitPrice, '(expected: 0)')
console.log('MRC totalPrice:', monthlyFee.totalPrice, '(expected: 0)')
```

**Expected**: Multiple rules chain, then the huge discount clamps to zero:
1. `ui-mrc-20pct-surcharge` (sortOrder=5): 250 × 1.2 = 300
2. `volume-mrc-10pct` (sortOrder=20, seed): 300 × 0.9 = 270
3. `ui-huge-discount` (sortOrder=100): max(0, 270 − 9999) = 0

Final: unitPrice = 0, totalPrice = 0. Discount clamped to zero, not negative.

---

## Part C — Cleanup

Delete all test rules through the UI:

1. Go to **Sidebar → CPQ → Price Rules**
2. For each rule starting with `ui-`, click **Delete** and confirm
3. Verify the list is empty

Or use the API:

```js
const list = await fetch('/api/cpq/price-rules').then(r => r.json())
const testRules = list.items.filter(r => r.code.startsWith('ui-'))
for (const rule of testRules) {
  await fetch('/api/cpq/price-rules', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: rule.id })
  })
  console.log('Deleted:', rule.code)
}
const after = await fetch('/api/cpq/price-rules').then(r => r.json())
console.log('Remaining rules:', after.total)
```

**Expected**: All test rules (prefixed `ui-`) soft-deleted. Seed rules remain.
