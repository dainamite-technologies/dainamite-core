import type { AwilixContainer } from 'awilix'
import type { MutationGuard, MutationGuardInput, MutationGuardResult } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isActivationBlocked, type EarliestActivation } from '../lib/earliestActivation'
import { todayIsoDate } from '../lib/orderSetupResolution'
import type { CpqBillingOrderSetupService } from '../services/orderSetupService'

/**
 * Mutation guards of the CPQ → Billing connector (auto-discovered from
 * `data/guards.ts`, registered in `.mercato/generated/guards.generated.ts`).
 *
 * `activation-before-billing-start` — spec
 * `2026-11-16-billing-operator-polish-and-bill-cycle-day` Part 2, D11 / 6c.
 * CPQ's activate route runs the guards with resource kind `cpq.order`,
 * operation `update` and payload `{ action: 'activate', orderId }`. An
 * `amend` / `cancel` order takes effect the moment it is activated, so
 * activating it before billing of a target subscription has started is
 * rejected with 422 and the earliest possible date. CPQ stays unaware of
 * billing; this guard owns the rule.
 */

export const ACTIVATION_BEFORE_BILLING_START_CODE = 'cpq_billing_connector.activation_before_billing_start'

export type ActivationGuardDeps = {
  /** The request container (resolves `cpqBillingOrderSetupService`). */
  container: () => Promise<Pick<AwilixContainer, 'resolve'>>
  /** Today as YYYY-MM-DD (UTC — the same calendar CPQ derives the effective date from). */
  today: () => string
}

const defaultDeps: ActivationGuardDeps = {
  container: () => createRequestContainer(),
  today: todayIsoDate,
}

function blockedResult(earliest: EarliestActivation): MutationGuardResult {
  return {
    ok: false,
    status: 422,
    body: {
      error:
        `This order can be activated from ${earliest.date}, when billing for subscription ` +
        `${earliest.subscriptionId} (${earliest.itemDescription}) starts. Activating earlier is blocked.`,
      code: ACTIVATION_BEFORE_BILLING_START_CODE,
      earliestActivationDate: earliest.date,
    },
  }
}

export function createActivationGuard(deps: ActivationGuardDeps = defaultDeps): MutationGuard {
  return {
    id: 'cpq_billing_connector.activation-before-billing-start',
    targetEntity: 'cpq.order',
    operations: ['update'],
    priority: 50,
    async validate(input: MutationGuardInput): Promise<MutationGuardResult> {
      const payload = input.mutationPayload ?? {}
      if (payload.action !== 'activate') return { ok: true }
      const orderId = typeof payload.orderId === 'string' && payload.orderId ? payload.orderId : input.resourceId
      if (!orderId || !input.organizationId) return { ok: true }
      const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
      let earliest: EarliestActivation | null
      try {
        const container = await deps.container()
        const service = container.resolve('cpqBillingOrderSetupService') as CpqBillingOrderSetupService
        earliest = await service.resolveEarliestActivationForOrder(scope, orderId)
      } catch (err) {
        // A missing order is CPQ's 404 to report; the route runs next and
        // answers it. Any other read failure fails open and is logged — the
        // subscribers still clamp end dates to `billStartDate − 1`, so an
        // early activation cannot end an item before it starts.
        if ((err as { status?: number } | null)?.status !== 404) {
          console.warn('[cpq_billing_connector] activation guard could not read billing; allowing', err)
        }
        return { ok: true }
      }
      return isActivationBlocked(earliest, deps.today()) && earliest ? blockedResult(earliest) : { ok: true }
    },
  }
}

export const guards: MutationGuard[] = [createActivationGuard()]
