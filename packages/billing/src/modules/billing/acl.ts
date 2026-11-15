export const features = [
  { id: 'billing.account.manage', title: 'Manage Billing Accounts', module: 'billing' },
  { id: 'billing.account.view', title: 'View Billing Accounts', module: 'billing' },
  { id: 'billing.item.manage', title: 'Manage Billing Items', module: 'billing' },
  { id: 'billing.item.view', title: 'View Billing Items', module: 'billing' },
  { id: 'billing.usage.ingest', title: 'Ingest Usage Records', module: 'billing' },
  { id: 'billing.usage.view', title: 'View Usage Records', module: 'billing' },
  { id: 'billing.run.trigger', title: 'Trigger Bill Run', module: 'billing' },
  { id: 'billing.run.dry_run', title: 'Trigger Bill Run (dry-run)', module: 'billing' },
  { id: 'billing.run.view', title: 'View Bill Run History', module: 'billing' },
  // Spec F — delete test / dry runs (real runs are never deleted)
  { id: 'billing.run.delete', title: 'Delete Test / Dry Bill Runs', module: 'billing' },
  { id: 'billing.invoice.post', title: 'Post Draft Invoice', module: 'billing' },
  { id: 'billing.invoice.edit_draft', title: 'Edit Draft Invoice', module: 'billing' },
  { id: 'billing.invoice.view', title: 'View Billing Invoices', module: 'billing' },
  { id: 'billing.invoice.send', title: 'Email Billing Invoices', module: 'billing' },
  // Spec D — corrective documents
  { id: 'billing.invoice.correct', title: 'Create Credit / Debit Memos', module: 'billing' },
  // Spec C — payments
  { id: 'billing.payment.view', title: 'View Billing Payments', module: 'billing' },
  { id: 'billing.payment.manage', title: 'Manage Billing Payments (assign, allocate, ignore, convert)', module: 'billing' },
  { id: 'billing.payment.import', title: 'Import Bank Payments (CSV)', module: 'billing' },
  // ─── Prepaid balance billing (SPEC-002) ──────────────────────
  { id: 'billing.balance.view', title: 'View Balance & Transactions', module: 'billing' },
  { id: 'billing.balance.adjust', title: 'Adjust Balance (manual credit/debit)', module: 'billing' },
  { id: 'billing.topup.create', title: 'Initiate Account Top-up', module: 'billing' },
  { id: 'billing.topup.view', title: 'View Account Top-ups', module: 'billing' },
  { id: 'billing.statement.view', title: 'View Consumption Statements', module: 'billing' },
  { id: 'billing.statement.generate', title: 'Generate Consumption Statement', module: 'billing' },
  { id: 'billing.credit.view', title: 'View Account Credit Status', module: 'billing' },
  // ─── Billing settings (Spec 0) ───────────────────────────────
  { id: 'billing.settings.view', title: 'View Billing Settings', module: 'billing' },
  { id: 'billing.settings.manage', title: 'Manage Billing Settings', module: 'billing' },
] as const

export default features
