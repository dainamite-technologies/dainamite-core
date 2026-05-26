import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'

/**
 * Billing module entity registry.
 *
 * Listing our MikroORM entities here gets them into the framework's
 * `E.billing.<entity>` generated registry (`entities.ids.generated.ts`),
 * which the CRUD factory, query engine, and indexers reference. Phase 0
 * shipped with no entries because the standalone CLI didn't traverse
 * `@dainamite/*` packages — adding them in Phase 1 once the resolver
 * patch lands.
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
