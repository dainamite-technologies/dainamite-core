import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { BillingSettings } from '../../data/entities'
import { billingEntityIds } from '../../data/entityIds'
import { billingSettingsUpdateSchema } from '../../data/validators'
import { getBillingSettings, missingSellerFields, serializeBillingSettings } from '../../lib/billingSettings'
import { isPaymentGatewayAvailable } from '../../lib/paymentGateway'

/**
 * `GET /api/billing/settings` — the caller organization's billing settings
 * (created with defaults on first read) plus runtime capabilities.
 * `PUT /api/billing/settings` — partial update via `billing.settings.update`.
 *
 * Spec 0: prepaid defaults (moved from core `configs`) and document number
 * masks. `capabilities.gatewayTopups` tells the UI whether online top-ups
 * are available (the `payment_gateways` module is optional, E-D1).
 * Spec B: seller / payment / document fields, plus `completeness` — posting
 * is blocked until the printable minimum (legal name, address, tax id, IBAN)
 * is filled.
 */

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.settings.view'] },
  PUT: { requireAuth: true, requireFeatures: ['billing.settings.manage'] },
}

export const metadata = routeMetadata

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const organizationId = (auth as { orgId?: string }).orgId ?? null
    if (!organizationId) {
      return NextResponse.json({ error: 'Organization scope required' }, { status: 403 })
    }
    const em = (container.resolve('em') as EntityManager).fork()
    const settings = await getBillingSettings(em, { tenantId: auth.tenantId, organizationId })
    const missing = missingSellerFields(settings)
    return NextResponse.json({
      settings: serializeBillingSettings(settings),
      capabilities: { gatewayTopups: isPaymentGatewayAvailable(container as never) },
      completeness: { ready: missing.length === 0, missing },
    })
  } catch (err) {
    console.error('[billing/settings.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

const rawBodySchema = z.object({}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillingSettings,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: z.object({}).passthrough(),
    entityId: billingEntityIds.settings,
    fields: ['id'],
    buildFilters: async () => ({}),
  },
  actions: {
    update: {
      commandId: 'billing.settings.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return billingSettingsUpdateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({ settings: result }),
    },
  },
})

export const PUT = crud.PUT

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'Get billing settings',
      description:
        'Billing settings of the caller organization (prepaid defaults, number masks per series, ' +
        'seller / bank / document fields, default payment terms and VAT rate), ' +
        '`capabilities.gatewayTopups` and `completeness { ready, missing[] }` (posting needs ' +
        '`legalName`, `sellerAddress`, `taxId`, `iban`). The row is created with defaults on first read.',
    },
    PUT: {
      tags: ['Billing'],
      summary: 'Update billing settings',
      description:
        'Partial update. Number masks use `{YYYY} {YY} {MM} {DD}` plus exactly one of ' +
        '`{SEQUENCE_NUM}` (never resets), `{SEQUENCE_NUM_YEAR}` (yearly — needs a year token) or ' +
        '`{SEQUENCE_NUM_MONTH}` (monthly — needs year + month), with an optional `:N` zero-pad. ' +
        'Invalid masks → 400 with the mask error code. IBAN is normalised and mod-97 checked, ' +
        'BIC must be 8 or 11 characters; an empty string clears a text field.',
      requestBody: { schema: billingSettingsUpdateSchema },
    },
  },
}
