import type { CpqRouteContext } from './context'
import type { DefaultCpqQuotingService } from '../services/cpqQuotingService'

/**
 * Resolve CpqQuotingService from the DI container.
 * All sub-services (pricing, validation, product) are registered as scoped in di.ts,
 * ensuring they share the same request-scoped EntityManager.
 */
export function resolveQuotingService(ctx: CpqRouteContext): DefaultCpqQuotingService {
  return ctx.container.resolve('cpqQuotingService') as DefaultCpqQuotingService
}
