import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  organizationScopeRequiredResponse,
  resolveActiveOrganizationId,
} from '@open-mercato/shared/lib/auth/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { bridgeLegacyGuard, runMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import type { SendInvoiceResult } from '../../../../lib/invoiceDelivery'

/**
 * `POST /api/billing/invoices/[id]/send` — emails a posted billing document
 * with its frozen PDF to the account's invoice email (Spec B), via the
 * `billing.invoices.send` command.
 *
 * 200 `{ invoiceId, to, status: 'sent' | 'failed', error }` — a transport
 * failure is a recorded `failed` delivery, not an HTTP error.
 * 409 `billing.invoice.not_posted` (draft / test). 422
 * `billing.invoice.email_invalid` (placeholder or malformed address).
 */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.invoice.send'] },
}

function userFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  return Array.isArray(features) ? features.filter((value): value is string => typeof value === 'string') : []
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const organizationId = resolveActiveOrganizationId(auth)
    if (!organizationId) return organizationScopeRequiredResponse()
    const { id } = await params
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
      request: req,
    }
    // Custom write route → run the shared mutation guards (record locks etc.)
    // as `update` on the invoice before sending.
    const guardInput = {
      tenantId: auth.tenantId,
      organizationId,
      userId: auth.sub ?? '',
      resourceKind: 'billing.invoice',
      resourceId: id,
      operation: 'update' as const,
      requestMethod: req.method,
      requestHeaders: req.headers,
    }
    const legacyGuard = bridgeLegacyGuard(container)
    const guardResult = legacyGuard
      ? await runMutationGuards([legacyGuard], guardInput, { userFeatures: userFeatures(auth) })
      : { ok: true as const, afterSuccessCallbacks: [] }
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody ?? { error: 'Operation blocked by guard' }, {
        status: guardResult.errorStatus ?? 422,
      })
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const response = await commandBus.execute('billing.invoices.send', {
      input: { tenantId: auth.tenantId, organizationId, invoiceId: id },
      ctx,
    })
    const result = (response as { result?: SendInvoiceResult }).result
    for (const callback of guardResult.afterSuccessCallbacks) {
      if (!callback.guard.afterSuccess) continue
      try {
        await callback.guard.afterSuccess({ ...guardInput, metadata: callback.metadata ?? null })
      } catch (err) {
        console.error('[billing/invoices/[id]/send.POST] guard afterSuccess failed', err)
      }
    }
    return NextResponse.json(result ?? { invoiceId: id, status: 'failed', error: null })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[billing/invoices/[id]/send.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: 'Email a posted billing document',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      description:
        'Sends the frozen PDF to the billing account invoice email through the platform email ' +
        'transport. Each attempt is appended to `metadata.deliveries` and emits ' +
        '`billing.invoice.sent` / `billing.invoice.send_failed`. Transport failures return ' +
        '200 with `status: "failed"` and the error.',
      responses: [
        {
          status: 200,
          description: 'Delivery attempted',
          schema: z.object({
            invoiceId: z.string().uuid(),
            to: z.string(),
            status: z.enum(['sent', 'failed']),
            error: z.string().nullable(),
          }),
        },
      ],
      errors: [
        { status: 409, description: '`billing.invoice.not_posted` — drafts and test documents cannot be sent' },
        { status: 422, description: '`billing.invoice.email_invalid` — placeholder or malformed invoice email' },
      ],
    },
  },
}
