import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * Connector has no tenant-init work to do. It ships zero entities,
 * zero dictionaries, zero default roles. The subscribers auto-register
 * via the generator's `subscribers/` discovery; nothing else is
 * required for the module to function.
 */
export const setup: ModuleSetupConfig = {}

export default setup
