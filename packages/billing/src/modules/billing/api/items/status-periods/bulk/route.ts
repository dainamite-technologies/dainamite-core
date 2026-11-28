import { z } from 'zod'
import { runCommandRoute } from '../../../../lib/commandRoute'

/**
 * `POST /api/billing/items/status-periods/bulk` — pause / suspend / grace
 * every live line of an account (line-period-and-status spec §4.3), e.g.
 * suspending a customer for non-payment. Undoable command
 * `billing.items.status_periods.bulk_create`.
 */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.item.manage'] },
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const bodySchema = z.object({
  billAccountId: z.string().uuid(),
  status: z.enum(['paused', 'suspended', 'grace']),
  fromDate: isoDay,
  toDate: isoDay.nullable().optional(),
  chargeBehavior: z.enum(['charge', 'no_charge']).optional(),
  reason: z.string().trim().max(500).nullable().optional(),
})

const responseSchema = z.object({
  created: z.array(z.object({ id: z.string().uuid(), billingItemId: z.string().uuid() })),
  skipped: z.array(z.object({ billingItemId: z.string().uuid(), reason: z.enum(['read_only', 'overlap', 'ended']) })),
})

export async function POST(req: Request) {
  return runCommandRoute(req, {
    commandId: 'billing.items.status_periods.bulk_create',
    bodySchema,
    resourceKind: 'billing.account',
    resourceId: (body) => body.billAccountId,
    logLabel: 'billing/items/status-periods/bulk.POST',
  })
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: 'Set a status on every line of an account',
      description:
        'Creates the same dated status period (paused / suspended / grace) on every active recurring and usage line of the ' +
        'account. Lines that cannot take it are returned in `skipped`, not failed: `read_only` (a CPQ line — its status ' +
        'comes from the CPQ subscription), `overlap` (it already has a status in that range), `ended` (it ends before ' +
        '`fromDate`). Charge behaviour defaults: paused → `no_charge`, suspended / grace → `charge`.',
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Created and skipped lines', schema: responseSchema }],
      errors: [{ status: 400, description: 'Invalid body' }],
    },
  },
}
