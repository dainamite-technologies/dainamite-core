---
"@dainamite/billing": minor
---

Ship the entity-id registry and declare the CRUD events, so billing records are
indexed on Open Mercato 0.9.

**What was broken.** A standalone app's `mercato generate` found no billing
entity ids: the package shipped no `generated/entities.ids.generated.*`, and the
compiled `dist/.../data/entities.js` exports its classes with `export { … }`,
which the CLI's class scanner does not see. The app's registry therefore held
`"billing": {}`, and:

- every billing account, item, top-up, usage record and balance transaction
  written through a command was saved but not indexed. Each write logged
  `QueryIndexScopeError: Query index entity type is not registered`, added a row
  to `indexer_error_logs`, and wrote no `entity_indexes` row;
- `mercato entities install` (or `mercato init` with examples) registered the
  billing ids as virtual custom entities, after which `GET /api/billing/*`
  returned no rows;
- the CRUD events (`billing.account.created`, …) logged "Emitting undeclared
  event".

**What changed.**

- The package now ships `generated/entities.ids.generated.ts` (all 10
  `billing:*` ids) plus one column file per entity under
  `generated/entities/<key>/`. The build generates them from
  `data/entityIds.ts` and `data/entities.ts`
  (`scripts/generate-entity-registry.mjs`), and a unit test fails if the
  committed files drift.
- `events.ts` declares the CRUD events the commands emit:
  `billing.account.{created,updated,deleted}`,
  `billing.item.{created,updated,deleted}`, `billing.topup.created`,
  `billing.transaction.created` and `billing.usage.created`. Like
  `billing.usage.rated`, `billing.usage.created` fires once per usage upload and
  is excluded from workflow triggers.
- **Renamed entity classes:** `BillRun` → `BillingRun`, `BillRunOutcome` →
  `BillingRunOutcome`, `DraftInvoiceEdit` → `BillingDraftInvoiceEdit`. Open
  Mercato maps an entity id to its table by class name, and its table-name
  fallback never matches on 0.9 with MikroORM 7. So `billing:billing_run`,
  `billing:billing_run_outcome` and `billing:billing_draft_invoice_edit`
  resolved to no table. Tables, columns, ids, API routes and OpenAPI schema
  names are unchanged; no migration. The old names remain as deprecated
  **type-only** aliases. Code that used them as values (`em.find(BillRun, …)`)
  must switch to the new names.

**After upgrading:**

1. Run `yarn generate`, then restart the app. `.mercato/generated/entities.ids.generated.ts`
   should list the 10 `billing:*` ids.
2. Index the rows written while the ids were unregistered:
   `yarn mercato query_index reindex --entity billing:billing_account` (add
   `--tenant <id>` to limit it to one tenant), then the same for
   `billing:billing_item`, `billing:billing_account_usage`,
   `billing:billing_account_transaction` and `billing:billing_topup`.
3. If you ran `mercato entities install` (or `mercato init` with examples) on an
   affected version, the billing lists recover on their own once the ids are
   registered. To remove the leftover virtual-entity rows, run:

   ```sql
   update custom_entities set is_active = false where entity_id like 'billing:%';
   ```
