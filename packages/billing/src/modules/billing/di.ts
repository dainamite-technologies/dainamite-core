import type { AppContainer } from '@open-mercato/shared/lib/di/container'

/**
 * Billing module DI registrar.
 *
 * Phase 0 ships no services — entities, ACL, and tenant setup only. The
 * REST API surface (Phase 1) and Bill Run engine (Phase 2) bring services
 * here. Keeping the file in place so the auto-discovery generator picks
 * up `billing` as a DI-aware module without surprise on the first new
 * registration.
 */
export function register(_container: AppContainer): void {
  // intentionally empty — see file header
}
