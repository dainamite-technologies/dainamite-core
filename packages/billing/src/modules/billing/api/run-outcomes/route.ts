import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { SalesInvoice } from '@open-mercato/core/modules/sales/data/entities'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { BillingAccount, BillRunOutcome } from '../../data/entities'
import { billingEntityIds } from '../../data/entityIds'
import {
  BILL_RUN_OUTCOME_STATUSES,
} from '../../data/validators'
import { createBillingCrudOpenApi, createPagedListResponseSchema } from '../openapi'

/**
 * `GET /api/billing/run-outcomes` — list per-account outcomes,
 * typically filtered by `billRunId` to populate the "show me what
 * happened in this run" detail panel.
 *
 * Read-only; outcomes are written by the engine itself, never by API
 * clients.
 */

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.run.view'] },
}

export const metadata = routeMetadata

const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    billRunId: z.string().uuid().optional(),
    billAccountId: z.string().uuid().optional(),
    status: z.enum(BILL_RUN_OUTCOME_STATUSES).optional(),
  })
  .passthrough()

const billRunOutcomeListItemSchema = z.object({
  id: z.string().uuid(),
  billRunId: z.string().uuid(),
  billAccountId: z.string().uuid(),
  status: z.string(),
  errorMessage: z.string().nullable(),
  warnings: z.record(z.string(), z.unknown()).nullable(),
  draftInvoiceId: z.string().uuid().nullable(),
  bill_account_name: z.string().nullable(),
  invoice_number: z.string().nullable(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillRunOutcome,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listQuerySchema,
    entityId: billingEntityIds.runOutcome,
    fields: [
      'id',
      'bill_run_id',
      'bill_account_id',
      'status',
      'error_message',
      'warnings',
      'draft_invoice_id',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.billRunId === 'string') filters.bill_run_id = { $eq: query.billRunId }
      if (typeof query.billAccountId === 'string') {
        filters.bill_account_id = { $eq: query.billAccountId }
      }
      if (typeof query.status === 'string') filters.status = { $eq: query.status }
      return filters
    },
  },
  hooks: {
    // Outcomes reference account + draft invoice by FK id only. The
    // run detail UI wants names — resolve both in two bounded queries.
    afterList: async (payload: unknown, ctx: unknown) => {
      const items = ((payload as { items?: unknown[] } | null)?.items ?? []) as Array<
        Record<string, unknown>
      >
      if (items.length === 0) return
      const em = (ctx as { container: AwilixContainer }).container.resolve<EntityManager>('em')
      const accountIds = Array.from(
        new Set(
          items
            .map((row) => row.bill_account_id)
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
        ),
      )
      const invoiceIds = Array.from(
        new Set(
          items
            .map((row) => row.draft_invoice_id)
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
        ),
      )
      const [accounts, invoices] = await Promise.all([
        accountIds.length
          ? em.find(BillingAccount, { id: { $in: accountIds } })
          : [],
        invoiceIds.length
          ? em.find(SalesInvoice, { id: { $in: invoiceIds } })
          : [],
      ])
      const accountName = new Map(
        accounts.map((a) => [String(a.id), a.name] as [string, unknown]),
      )
      const invoiceNumber = new Map(
        invoices.map((i) => [String(i.id), i.invoiceNumber] as [string, unknown]),
      )
      for (const row of items) {
        row.bill_account_name = accountName.get(String(row.bill_account_id)) ?? null
        row.invoice_number =
          typeof row.draft_invoice_id === 'string'
            ? invoiceNumber.get(row.draft_invoice_id) ?? null
            : null
      }
    },
  },
})

export const GET = crud.GET

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillRunOutcome',
  pluralName: 'BillRunOutcomes',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(billRunOutcomeListItemSchema),
})
