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
  { id: 'billing.invoice.post', title: 'Post Draft Invoice', module: 'billing' },
  { id: 'billing.invoice.edit_draft', title: 'Edit Draft Invoice', module: 'billing' },
  { id: 'billing.invoice.view', title: 'View Billing Invoices', module: 'billing' },
] as const

export default features
