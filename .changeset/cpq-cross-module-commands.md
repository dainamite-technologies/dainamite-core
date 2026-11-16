---
'@dainamite/cpq': patch
---

CPQ now writes sales and catalog records through the owning module instead of editing them directly.

- Deleting a CPQ quote (`DELETE /api/cpq/quotes/{quoteId}`) removes the underlying sales quote and its lines with the sales module's `sales.quotes.delete` command. Sales events, the audit log entry (with undo) and search/index cleanup now run. The sales quote is removed the way the sales module removes quotes (not just flagged as deleted); the CPQ quote and its line configurations are still soft-deleted. The response is unchanged.
- Creating a product specification without a `productId` (`POST /api/cpq/product-specifications`) creates the catalog product with the catalog module's `catalog.products.create` command, so catalog events, audit log and indexing run. Reusing an existing product by handle or SKU works as before.
- Errors raised by those commands (for example 403 scope, 409 duplicate) are returned with their own status instead of a generic 500.
