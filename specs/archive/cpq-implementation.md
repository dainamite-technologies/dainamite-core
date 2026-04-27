Based on the CPQ implementation, here's how to test everything from the frontend:

**1. Seed Data (prerequisite)**

After `yarn reinstall` completes successfully, the CPQ module seeds 4 products (GIX Port, GIX VLAN, GIX Transit, GIX Remote Peering), 15 data centres, pricing tables, product attributes, and charges. Make sure the initialization completed without errors for the `cpq` module.

**2. Backend Admin Pages**

Navigate to these pages in the sidebar (they should appear under a **"CPQ"** group):

- **`/backend/cpq/data-centres`** — Lists all 15 seeded data centres. Click one to see/edit its details (code, city, country, capabilities).

- **`/backend/cpq/products`** — Lists the 4 CPQ-configured products. Click one to see its **Attributes** tab (e.g., port_size, bandwidth for GIX Port) and **Charges** tab (e.g., monthly_port_fee, setup_fee).

  > **Important:** Use **CPQ → Product Configuration** in the sidebar, *not* Catalog → Products & services. The Catalog product page (`/backend/catalog/products/[id]`) is for general product info (title, description, media, tax class, etc.). The CPQ product page (`/backend/cpq/products/[id]`) is where Attributes and Charges tabs live.

  **Edit mode:** Both the Catalog and CPQ product pages open directly in edit mode. This is intentional — they are admin interfaces for editing, with no separate view-only mode.

- **`/backend/cpq/pricing`** — Lists pricing tables (port-pricing, vlan-pricing, transit-pricing, remote-peering-pricing). Click one to see the pricing grid — a dynamic table with dimension columns and price columns.

- **`/backend/cpq/inventory`** — Shows customer inventory items in a tree view (parent items with child items nested). This will be empty until quotes are provisioned.

**3. Quoting Wizard**

This is the core CPQ flow:

- Navigate to **`/backend/cpq/quotes/new`**
- **Step 1 — Select Customer**: Pick an existing customer from the dropdown
- **Step 2 — Choose Path**: Either "New Primary Service" (creates a new port) or "Add Child to Existing" (adds a VLAN/transit to an existing port)
- **Step 3 — Configure**: Fill in product attributes (port size, data centre, bandwidth, etc.). The form is dynamically generated from the product's attributes. Options like data centres and bandwidths are fetched live from the pricing tables.
- **Step 4 — Review & Price**: See a live price preview with all applicable charges (setup, monthly, usage-based). Validation runs automatically.
- **Step 5 — Submit**: Creates a quote configuration tied to a sales quote

**4. Customer Inventory Widget**

- Go to **`/backend/customers`**, click on a customer
- There should be an injected **"CPQ Inventory"** tab on the customer detail page
- This shows that customer's active inventory items, capacity bars, charge summaries, and a "New CPQ Quote" button that links to the wizard

**5. Quote → Order → Inventory flow**

To get from a CPQ quote to inventory items:

1. **Create quote**: Use the wizard at `/backend/cpq/quotes/new` — this creates a `SalesQuote` and a `CpqQuoteConfiguration` linked to it.
2. **Convert to order**: Open the quote document (e.g. `/backend/sales/quotes/[id]`), open the actions menu (⋮), and choose **"Convert to order"**. This creates a `SalesOrder` from the quote.
3. **Provision inventory**: When you convert via the UI, the app automatically calls `provisionFromOrder` after the convert succeeds (the core convert command doesn't emit `sales.order.created`, so we hook into the API response). Inventory items are created for the customer.

   If you convert via a different path (e.g. API only), use the manual provision API:
   ```bash
   POST /api/cpq/inventory/provision-from-order
   Body: { "orderId": "<order-id>" }
   ```

4. **View inventory**: Check the customer's **CPQ Inventory** tab or `/backend/cpq/inventory`.

**6. API Endpoints (for manual testing)**

You can also test the APIs directly:

- `GET /api/cpq/data-centres` — List data centres
- `GET /api/cpq/product-attributes?productId=<id>` — Get attributes for a product
- `GET /api/cpq/product-charges?productId=<id>` — Get charges for a product
- `GET /api/cpq/pricing-tables` — List pricing tables
- `GET /api/cpq/pricing-table-entries?pricingTableId=<id>` — Get entries for a table
- `POST /api/cpq/cpq-quotes/price` — Preview pricing for a configuration
- `POST /api/cpq/cpq-quotes/configure` — Save a quote configuration
- `GET /api/cpq/inventory?customerId=<id>` — Get customer inventory
- `POST /api/cpq/inventory/provision-from-order` — Manually provision inventory from an order (body: `{ "orderId": "<uuid>" }`)

**Quick smoke test path**: Navigate to `/backend/cpq/data-centres` to confirm the seeded data is there. Then go to `/backend/cpq/quotes/new`, pick a customer, choose "New Primary Service", select the GIX Port product, fill in a port size and data centre, and see the price preview calculate.

---

**Troubleshooting: "No products with CPQ configuration found"**

If Product Configuration shows this message, the CPQ seed likely hasn't run or didn't complete. Try:

1. **Run the seed**: `yarn reinstall` (full reset) or `yarn initialize` (re-run init without wiping). During init you should see `📦 cpq...` in the "Seeding module defaults" step.

2. **Manual seed**: If init completed but Product Configuration is still empty, run the CPQ seed manually:
   ```bash
   # Get tenant and org IDs from the database (after init):
   # psql $DATABASE_URL -t -c "SELECT o.tenant_id, o.id FROM organizations o JOIN users u ON u.organization_id = o.id LIMIT 1"
   yarn mercato cpq seed --tenant <tenantId> --org <organizationId>
   ```

3. **Verify data centres**: Go to `/backend/cpq/data-centres`. If that page is also empty, the CPQ seed didn't run at all. If data centres has 15 rows, the seed ran but product attributes/charges may have failed (e.g. catalog products with expected SKUs didn't exist yet).

4. **Check init output**: Look for errors during `yarn reinstall` or `yarn initialize`, especially around the `cpq` module. Warnings like `[CPQ seed] Product not found for SKU "GIX-ACCESS-PORT"` indicate the catalog products weren't created before the CPQ seed ran.