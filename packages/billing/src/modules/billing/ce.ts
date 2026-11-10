import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'

/**
 * Billing module custom-entity specs (labels / custom-field surfaces).
 *
 * These ids are real MikroORM tables, not virtual custom entities. The
 * framework only knows that while each id is also in the app's generated
 * `E.billing` registry (fed by the package's shipped
 * `generated/entities.ids.generated.ts`). For an id missing there,
 * `mercato entities install` writes an active `custom_entities` row, and the
 * query engine then reads the id from custom-entity storage instead of its
 * table — every billing list comes back empty.
 *
 * `fields: []` means billing does NOT expose custom-field surfaces on
 * these entities today (no EAV). Adding fields here is reserved for
 * Phase 4+ if operators request per-tenant custom fields on Billing
 * Account or Billing Item.
 *
 * `showInSidebar: false` keeps the Custom Entities admin UI from listing
 * these — they are first-class entities with their own dedicated pages
 * (Phase 4), not generic EAV entries.
 */
const entities: CustomEntitySpec[] = [
  {
    id: 'billing:billing_account',
    label: 'Billing Account',
    description: 'A per-customer container for billing items, usage, and bill-cycle metadata.',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'billing:billing_item',
    label: 'Billing Item',
    description: 'A single charge (one_time / recurring / usage) attached to a Billing Account.',
    labelField: 'description',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'billing:billing_account_usage',
    label: 'Billing Account Usage',
    description: 'A pre-aggregated usage record uploaded by external metering systems.',
    labelField: 'id',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'billing:billing_run',
    label: 'Bill Run',
    description: 'A single execution of the Bill Run engine (schedule or manual trigger).',
    labelField: 'id',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'billing:billing_run_outcome',
    label: 'Bill Run Outcome',
    description: 'Per-account outcome of a Bill Run — success / warnings / skipped / failed.',
    labelField: 'id',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'billing:billing_draft_invoice_edit',
    label: 'Draft Invoice Edit',
    description: 'Append-only audit of operator edits on draft invoice lines.',
    labelField: 'id',
    showInSidebar: false,
    fields: [],
  },
]

export { entities }
export default entities
