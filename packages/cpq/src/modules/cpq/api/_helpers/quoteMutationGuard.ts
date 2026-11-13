import {
  runRouteMutationGuards,
  type RouteMutationGuardInput,
  type RouteMutationGuardResult,
} from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CpqRouteContext } from '../context'

/** Mutation-guard resource kinds for CPQ quote writes (`module.entity`). */
export const CPQ_QUOTE_RESOURCE_KIND = 'cpq.quote'
export const CPQ_QUOTE_LINE_RESOURCE_KIND = 'cpq.quote_line'
/** Catalog cost elements of a product charge (cost-plus pricing). */
export const CPQ_CHARGE_COST_ELEMENT_RESOURCE_KIND = 'cpq.charge_cost_element'
/** Manual cost lines and cost confirmation on a quote. */
export const CPQ_QUOTE_LINE_COST_RESOURCE_KIND = 'cpq.quote_line_cost'
/** Per-line markup overrides of a cost-plus charge. */
export const CPQ_QUOTE_MARKUP_OVERRIDE_RESOURCE_KIND = 'cpq.quote_markup_override'

/**
 * Run every registered mutation guard for a CPQ custom write route.
 *
 * Quote routes are hand-written (not `makeCrudRoute`), so they wire guards
 * explicitly through the framework's registry-based wrapper. Projects use
 * this hook to enforce rules CPQ does not own — e.g. blocking
 * `ready → with_customer` or order conversion until an approval workflow
 * signs a discounted quote off. With no guard registered the call passes.
 *
 * Call `runAfterSuccess()` on the passed result only after the write commits.
 */
export function runCpqMutationGuards(
  ctx: Pick<CpqRouteContext, 'container' | 'auth' | 'tenantId' | 'organizationId'>,
  req: Request,
  input: RouteMutationGuardInput,
): Promise<RouteMutationGuardResult> {
  return runRouteMutationGuards({
    container: ctx.container,
    req,
    auth: {
      userId: ctx.auth?.sub ?? '',
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId || null,
    },
    input,
  })
}
