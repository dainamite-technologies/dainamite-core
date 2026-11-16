import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { orderSetupUpsertSchema } from '../../../data/validators'
import {
  ORDER_SETUP_RESOURCE_KIND,
  ORDER_SETUP_SAVE_COMMAND_ID,
  type OrderSetupSaveResult,
} from '../../../commands/orderSetup'
import {
  isOrderSetupError,
  type CpqBillingOrderSetupService,
} from '../../../services/orderSetupService'

/**
 * `GET /api/cpq_billing_connector/order-setups/:orderId` — the billing setup
 * of a CPQ order, plus the customer defaults and billable lines the Billing
 * tab needs.
 * `PUT …` — replace it (undoable command `cpq_billing_connector.order_setup.save`).
 *
 * Spec `2026-11-15-cpq-billing-connector-order-billing-setup`.
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq_billing_connector.order_setup.view'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq_billing_connector.order_setup.manage'] },
}

const pathParams = z.object({ orderId: z.string().uuid() })

type RouteParams = { params: Promise<{ orderId: string }> | { orderId: string } }

type RouteScope = {
  container: AwilixContainer
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
  tenantId: string
  organizationId: string
  organizationScope: Awaited<ReturnType<typeof resolveFeatureCheckContext>>['scope'] | null
}

async function resolveScope(req: Request): Promise<RouteScope | NextResponse> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const container = await createRequestContainer()
  const { organizationId, scope } = await resolveFeatureCheckContext({ container, auth, request: req })
  if (!organizationId) {
    return NextResponse.json({ error: 'Organization scope required' }, { status: 403 })
  }
  return {
    container,
    auth,
    tenantId: scope?.tenantId ?? auth.tenantId,
    organizationId,
    organizationScope: scope ?? null,
  }
}

async function resolveOrderId(params: RouteParams['params']): Promise<string | null> {
  const parsed = pathParams.safeParse(await params)
  return parsed.success ? parsed.data.orderId : null
}

function errorResponse(err: unknown, label: string): NextResponse {
  if (isOrderSetupError(err)) return NextResponse.json({ error: err.message }, { status: err.status })
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 })
  }
  console.error(`[cpq_billing_connector/order-setups.${label}]`, err)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}

export async function GET(req: Request, { params }: RouteParams) {
  try {
    const resolved = await resolveScope(req)
    if (resolved instanceof NextResponse) return resolved
    const orderId = await resolveOrderId(params)
    if (!orderId) return NextResponse.json({ error: 'Invalid order id' }, { status: 400 })
    const service = resolved.container.resolve('cpqBillingOrderSetupService') as CpqBillingOrderSetupService
    const view = await service.getView(
      { tenantId: resolved.tenantId, organizationId: resolved.organizationId },
      orderId,
    )
    return NextResponse.json(view)
  } catch (err) {
    return errorResponse(err, 'GET')
  }
}

export async function PUT(req: Request, { params }: RouteParams) {
  try {
    const resolved = await resolveScope(req)
    if (resolved instanceof NextResponse) return resolved
    const orderId = await resolveOrderId(params)
    if (!orderId) return NextResponse.json({ error: 'Invalid order id' }, { status: 400 })

    const raw = await req.json().catch(() => null)
    const parsedBody = orderSetupUpsertSchema.safeParse(raw)
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsedBody.error.issues }, { status: 400 })
    }

    const guard = await runRouteMutationGuards({
      container: resolved.container,
      req,
      auth: {
        userId: resolved.auth.sub ?? '',
        tenantId: resolved.tenantId,
        organizationId: resolved.organizationId,
      },
      input: {
        resourceKind: ORDER_SETUP_RESOURCE_KIND,
        resourceId: orderId,
        operation: 'update',
        mutationPayload: { orderId, ...parsedBody.data },
      },
    })
    if (!guard.ok) return guard.response
    // The order id belongs to the path, never to a guard's modified payload.
    const modified = Object.fromEntries(
      Object.entries(guard.modifiedPayload ?? {}).filter(([key]) => key !== 'orderId'),
    )
    const body = orderSetupUpsertSchema.parse({ ...parsedBody.data, ...modified })

    const commandCtx: CommandRuntimeContext = {
      container: resolved.container,
      auth: resolved.auth,
      organizationScope: resolved.organizationScope,
      selectedOrganizationId: resolved.organizationId,
      organizationIds: [resolved.organizationId],
      request: req,
    }
    const bus = resolved.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await bus.execute<
      { tenantId: string; organizationId: string; orderId: string; body: typeof body },
      OrderSetupSaveResult
    >(ORDER_SETUP_SAVE_COMMAND_ID, {
      input: { tenantId: resolved.tenantId, organizationId: resolved.organizationId, orderId, body },
      ctx: commandCtx,
    })
    await guard.runAfterSuccess()

    const service = resolved.container.resolve('cpqBillingOrderSetupService') as CpqBillingOrderSetupService
    const view = await service.getView(
      { tenantId: resolved.tenantId, organizationId: resolved.organizationId },
      orderId,
    )
    const response = NextResponse.json(view)
    if (logEntry?.undoToken && logEntry.id && logEntry.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: ORDER_SETUP_RESOURCE_KIND,
          resourceId: result.after.id,
          executedAt:
            logEntry.createdAt instanceof Date
              ? logEntry.createdAt.toISOString()
              : typeof logEntry.createdAt === 'string'
                ? logEntry.createdAt
                : new Date().toISOString(),
        }),
      )
    }
    return response
  } catch (err) {
    return errorResponse(err, 'PUT')
  }
}

const errorSchema = z.object({ error: z.string(), details: z.unknown().optional() })
const errorDoc = (status: number, description: string) => ({ status, description, schema: errorSchema })

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Billing Connector',
  summary: 'CPQ order billing setup',
  pathParams,
  methods: {
    GET: {
      summary: 'Get the billing setup of a CPQ order',
      description:
        'Returns `setup` (null until saved), `editable` (order is `draft` / `pending_activation`, a new-sale ' +
        'order, and the setup is not yet applied), `defaults.account` (new-account values from the sales ' +
        'order customer snapshot; absent fields fall back to placeholders at activation) and `defaults.lines` ' +
        '(billable lines with their CPQ service start). Account candidates come from ' +
        '`GET /api/billing/accounts?customerId&currencyCode&isActive=true`. For ARC amend / cancel orders, ' +
        '`earliestActivationDate` (YYYY-MM-DD) is the first day the order may be activated — the latest bill start of the ' +
        "target subscriptions' active billing items — with `earliestActivationReason { subscriptionId, itemDescription }`; " +
        'both are null for other orders. Activating earlier is rejected by the connector guard (422 ' +
        '`cpq_billing_connector.activation_before_billing_start`).',
      responses: [{ status: 200, description: 'The order billing setup view' }],
      errors: [errorDoc(400, 'Invalid order id'), errorDoc(401, 'Unauthorized'), errorDoc(404, 'CPQ order not found')],
    },
    PUT: {
      summary: 'Save the billing setup of a CPQ order',
      description:
        'Full replacement. `accountMode: "existing"` needs `billingAccountId` (active, same customer, same ' +
        'currency); `accountMode: "new"` takes optional `accountOverrides` (only the fields that differ from ' +
        'the customer). `defaultBillStartDate` null = activation date. `lineBillStarts` maps a line id (the ' +
        '`lineId` of `GET /api/cpq/orders/:orderId`) to a `YYYY-MM-DD` bill start. Effective bill start per ' +
        'line: line override → CPQ service start → `defaultBillStartDate` → activation date. Undoable.',
      requestBody: { schema: orderSetupUpsertSchema },
      responses: [{ status: 200, description: 'The saved order billing setup view' }],
      errors: [
        errorDoc(400, 'Validation failed'),
        errorDoc(401, 'Unauthorized'),
        errorDoc(404, 'CPQ order not found'),
        errorDoc(409, 'Order is not editable (status, quote type, or setup already applied)'),
        errorDoc(422, 'Billing account not usable for this order, or a line is not on this order'),
      ],
    },
  },
}
