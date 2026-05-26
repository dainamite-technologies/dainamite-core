import type { AppContainer } from '@open-mercato/shared/lib/di/container'

/**
 * No DI registrations — the connector resolves billing's command bus
 * + dependencies from the host container at subscriber invocation
 * time. Kept as a no-op so the generator picks `cpq_billing_connector`
 * up as a DI-aware module without surprises when registrations land
 * in a later phase.
 */
export function register(_container: AppContainer): void {
  // intentionally empty
}
